/**
 * BB1 stage one — WITNESSES.
 *
 * Against `EXPECTATIONS-BB1-S1.md` (sha256 `db9311d0…`, stamped
 * 2026-09-06T04:16:49Z), under `bridge/ACCEPTANCE-RULES-v1.md`.
 *
 * Every threshold below is COPIED FROM THAT FILE, which was written and hashed
 * before any of this existed and before anything ran. Wherever an analytic value
 * appears it is RECOMPUTED here from the same derivation the card states, so the
 * assertion is against the derivation and not against a literal; the card's
 * literals are printed alongside so the two can be compared.
 *
 * ORDERING: this file was written and run BEFORE the demo UI was written.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { SimWorld, canonicalSimState } from './world';
import { runTicks } from './step';
import {
  Recorder, applyEvent, replay, restoreCheckpoint, takeCheckpoint,
  worldReplaced, type InputEvent, type InputRecord,
} from './record';
import { SI, SUPPORTED_SUBSTEPS, maxGammaFor, maxOmegaNFor, vlen, vsub } from '../model/units';
import {
  constructionSubsteps, parseConstruction, resolvabilityIssues,
  type Construction, type EntityDesc, type NumericsDesc,
} from '../model/construction';
import {
  Meter, MEASURE_CAPACITY, crossingLinear, crossingQuadratic, olsSlope, peaks, type Sample,
} from '../model/measure';
import {
  COLLISION, FALL, INCLINE, OSCILLATOR, PENDULUM, PENDULUM_PROFILE, PROJECTILE, SCENES,
  collisionContactTime, collisionOutcome, collisionScene, completeK, discreteOscillator,
  fallScene, inclineAcceleration, inclineBlockStart, inclineDown, inclineIsStatic, inclineNormal,
  inclineScene, launchImpulse, oscillatorScene, pendulumExactPeriod, pendulumSmallAnglePeriod,
  pendulumScene, projectileScene,
} from '../model/scenes';
import { dragK, effectiveArea, terminalSpeed } from '../model/drag';

beforeAll(async () => { await SimWorld.initEngine(); });

/** The step Rapier actually integrates with: it stores `timestep` as f32. */
const H = Math.fround(SI.DT / SI.SUBSTEPS);
const G = SI.G;

const log = (...a: unknown[]): void => { console.log('[BB1]', ...a); };
const pct = (got: number, want: number): string => `${(100 * (got / want - 1)).toFixed(4)} %`;

/** Linear interpolation of a uniformly sampled series at time t. Exact for a linear series. */
function valueAtLinear(s: readonly Sample[], t: number): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const f = (t - s[i - 1].t) / (s[i].t - s[i - 1].t);
      return s[i - 1].value + f * (s[i].value - s[i - 1].value);
    }
  }
  return s[s.length - 1].value;
}

type EventNoClock<T> = T extends unknown ? Omit<T, 'wallClockMs'> : never;
const ev = (e: EventNoClock<InputEvent>): InputEvent => ({ wallClockMs: 0, ...e } as InputEvent);

// ===========================================================================
// S1 — THE MEASUREMENT PATH
// ===========================================================================

describe('S1 — the minimal measurement path: named SI quantity, reference, bounded, reset', () => {
  test('S1a a meter carries a named SI quantity, a unit and a declared reference', () => {
    const m = new Meter('disp.x', { kind: 'bodyRelativeToPoint', entityId: 'cart', point: { x: 0, y: 1, z: 0 } });
    expect(m.unit).toBe('m');
    expect(m.label).toBe('displacement along the slider axis');
    expect(m.describeRef()).toContain('cart');
    const e = new Meter('E.total', { kind: 'world' });
    expect(e.unit).toBe('J');
    expect(e.describeRef()).toBe('the world');
  });

  test('S1b the buffer is BOUNDED over 3000 ticks, and reset empties it', () => {
    const sim = new SimWorld();
    sim.build(oscillatorScene());
    const big = new Meter('pos.x', { kind: 'body', entityId: 'cart' });
    const small = new Meter('E.total', { kind: 'world' }, 100);
    for (let i = 0; i < 3000; i++) {
      sim.tickOnce();
      big.sample(sim); small.sample(sim);
      // Re-entry inside the same tick must NOT inflate the series.
      big.sample(sim); small.sample(sim);
    }
    log('S1b samples: default-cap meter', big.samples.length, 'of cap', MEASURE_CAPACITY,
      '| small-cap meter', small.samples.length, 'of cap 100');
    expect(big.samples.length).toBe(MEASURE_CAPACITY);
    expect(small.samples.length).toBe(100);
    // The ring keeps the MOST RECENT samples.
    expect(small.samples[small.samples.length - 1].tick).toBe(3000);
    expect(big.samples[0].t).toBeCloseTo(big.samples[0].tick / 60, 12);
    big.reset(); small.reset();
    expect(big.samples.length).toBe(0);
    expect(small.samples.length).toBe(0);
  });

  test('S1c the meter is a pure observer: sampling does not change the declared replay state', () => {
    const a = new SimWorld(); a.build(oscillatorScene());
    const b = new SimWorld(); b.build(oscillatorScene());
    const m = new Meter('E.total', { kind: 'world' });
    for (let i = 0; i < 120; i++) { a.tickOnce(); m.sample(a); b.tickOnce(); }
    expect(canonicalSimState(a)).toBe(canonicalSimState(b));
    expect(m.samples.length).toBe(120);
  });
});

// ===========================================================================
// S2 — GRAVITY EDITING AS A RECORDED INTERVENTION
// ===========================================================================

function oneBodyScene(): Construction {
  const shot: EntityDesc = {
    id: 'shot', label: 'shot', kinematics: 'dynamic',
    shape: { kind: 'sphere', radius: 0.09 },
    material: { mass: 0.4, restitution: 0.3, friction: 0.4 },
    translation: { x: 0, y: 1.2, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 },
    colour: 0xe8b44f,
  };
  return {
    format: 'fp1-construction', formatVersion: 1, name: 'gravity witness',
    environment: { medium: 'vacuum', gravity: { x: 0, y: -G, z: 0 } },
    entities: [shot], springs: [], joints: [], nextSerial: 1,
  };
}

describe('S2 — gravity edit: booked as an intervention against a FIXED PE datum', () => {
  test('S2a the frozen-edit ΔE_mech is -m y Δg exactly, and UNATTRIBUTED does not move', () => {
    const sim = new SimWorld();
    sim.build(oneBodyScene());
    const m = sim.runtime('shot').mass;
    const y = sim.body('shot').worldCom().y;
    // Card: m y (1.62 - 9.81) with m = 0.4 kg, y = 1.20 m, datum at the origin.
    const predicted = m * y * (1.62 - G);
    const cardValue = -3.9312;
    const before = sim.budget.unattributed;

    const r = applyEvent(sim, ev({ tick: 0, seq: 0, kind: 'setGravity', target: 'world', gravity: { x: 0, y: -1.62, z: 0 } }));
    expect(r).toBeNull();

    const iv = sim.budget.interventions.at(-1)!;
    log('S2a deltaEmech booked', iv.deltaEmech.toFixed(7), 'J | derived', predicted.toFixed(7),
      '| card -3.9312 | dU', (iv.deltaEmech - cardValue).toExponential(3));
    expect(iv.kind).toBe('setGravity');
    expect(Math.abs(iv.deltaEmech - predicted)).toBeLessThan(1e-4);
    expect(Math.abs(iv.deltaEmech - cardValue)).toBeLessThan(1e-4);
    log('S2a unattributed before', before.toExponential(3), 'after', sim.budget.unattributed.toExponential(3));
    expect(Math.abs(sim.budget.unattributed - before)).toBeLessThan(1e-9);
  });

  test('S2b the ENGINE gravity really changed: 60 ticks of fall match the map at the NEW g', () => {
    const sim = new SimWorld();
    sim.build(oneBodyScene());
    applyEvent(sim, ev({ tick: 0, seq: 0, kind: 'setGravity', target: 'world', gravity: { x: 0, y: -1.62, z: 0 } }));
    const y0 = sim.body('shot').translation().y;
    let worst = 0;
    for (let n = 1; n <= 60; n++) {
      sim.tickOnce();
      const t = n * SI.DT;
      const want = y0 - 0.5 * 1.62 * (t * t + H * t);
      worst = Math.max(worst, Math.abs(sim.body('shot').translation().y - want));
    }
    log('S2b worst |y_measured - y_map(g=1.62)| over 60 ticks =', worst.toExponential(3), 'm');
    expect(worst).toBeLessThan(1e-4);
  });

  test('S2c a gravity edit replays and round-trips a checkpoint', () => {
    const rec: InputRecord = {
      format: 'fp1-record', formatVersion: 1, engine: '', construction: oneBodyScene(),
      events: [ev({ tick: 5, seq: 0, kind: 'setGravity', target: 'world', gravity: { x: 0, y: -1.62, z: 0 } })],
      checkpointEvery: 30,
    };
    const a = replay(new SimWorld(), rec, 120);
    const b = replay(new SimWorld(), rec, 120);
    expect(a.map((c) => c.canonical).join('|')).toBe(b.map((c) => c.canonical).join('|'));
    // And the environment gravity is inside the compared scope.
    expect(a.at(-1)!.canonical).toContain('env vacuum');
  });

  test('S2d |g| outside the declared UI limit is REFUSED and surfaced, never clamped', () => {
    const sim = new SimWorld();
    sim.build(oneBodyScene());
    const r = applyEvent(sim, ev({ tick: 0, seq: 0, kind: 'setGravity', target: 'world', gravity: { x: 0, y: -500, z: 0 } }));
    log('S2d refusal:', r);
    expect(r).toMatch(/refused/);
    expect(sim.construction.environment.gravity.y).toBe(-G);
  });
});

// ===========================================================================
// S3 — JOINT ADAPTERS: HINGE AND SLIDER
// ===========================================================================

describe('S3 — hinge and slider: authored identity, snapshot and replay', () => {
  test('S3a authored joint identity survives save -> parse -> build, with NO engine handle', () => {
    const sim = new SimWorld();
    sim.build(oscillatorScene());
    const json = JSON.stringify(sim.construction);
    expect(json).toContain('"slider0"');
    expect(/"(handle|colliderHandle|bodyHandle|jointHandle|rapier)"\s*:/i.test(json)).toBe(false);
    const back = parseConstruction(json);
    const sim2 = new SimWorld();
    sim2.build(back);
    expect(sim2.jointDescs().map((j) => `${j.id}:${j.kind}:${j.bodyA}->${j.bodyB}`))
      .toEqual(['slider0:slider:rail->cart']);
    const p = new SimWorld(); p.build(pendulumScene());
    expect(p.jointDescs().map((j) => `${j.id}:${j.kind}`)).toEqual(['hinge0:hinge']);
  });

  test('S3b the joint constrains what it says it constrains', () => {
    const s = new SimWorld(); s.build(oscillatorScene());
    runTicks(s, 300);
    const t = s.body('cart').translation();
    log('S3b slider after 300 ticks: y =', t.y.toFixed(9), 'z =', t.z.toFixed(9), '(authored y = 1.0, z = 0)');
    expect(Math.abs(t.y - OSCILLATOR.railY)).toBeLessThan(1e-4);
    expect(Math.abs(t.z)).toBeLessThan(1e-4);

    const p = new SimWorld(); p.build(pendulumScene(60));
    runTicks(p, 300);
    const b = p.body('bob').translation();
    const L = Math.hypot(b.x - PENDULUM.pivot.x, b.y - PENDULUM.pivot.y, b.z - PENDULUM.pivot.z);
    log('S3b hinge after 300 ticks: |bob - pivot| =', L.toFixed(9), 'm (authored L = 0.6), z =', b.z.toFixed(9));
    expect(Math.abs(L - PENDULUM.L)).toBeLessThan(1e-3);
    expect(Math.abs(b.z)).toBeLessThan(1e-4);
  });

  test('S3c a jointed scene replays byte-identically twice over the declared replay state', () => {
    for (const build of [() => oscillatorScene(), () => pendulumScene(45)]) {
      const rec: InputRecord = {
        format: 'fp1-record', formatVersion: 1, engine: '', construction: build(),
        events: [ev({ tick: 10, seq: 0, kind: 'setGravity', target: 'world', gravity: { x: 0, y: -3.71, z: 0 } })],
        checkpointEvery: 60,
      };
      const a = replay(new SimWorld(), rec, 300);
      const b = replay(new SimWorld(), rec, 300);
      const bytes = a.reduce((n, c) => n + c.canonical.length, 0);
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) expect(a[i].canonical).toBe(b[i].canonical);
      expect(a.at(-1)!.canonical).toMatch(/^joint /m);
      log('S3c replay x2 identical over', bytes, 'canonical bytes for', rec.construction.name);
    }
  });

  test('S3d a mid-run checkpoint of a jointed scene restores into a desynchronised world and continues identically', () => {
    const c = oscillatorScene();
    const unbroken = new SimWorld(); unbroken.build(c);
    const want = new Map<number, string>();
    for (let i = 0; i < 300; i++) { unbroken.tickOnce(); if (unbroken.tick % 60 === 0) want.set(unbroken.tick, canonicalSimState(unbroken)); }

    const broken = new SimWorld(); broken.build(c);
    runTicks(broken, 150);
    const cp = takeCheckpoint(broken, {
      pendingEvents: [], selectedId: null, settings: { paused: false, recording: false },
      seqCounter: 0, recordedEvents: [], recordingBase: null,
    });
    expect(cp.app.jointHandles.map((h) => h.id)).toEqual(['slider0']);
    expect(cp.app.joints.map((j) => j.id)).toEqual(['slider0']);

    const fresh = new SimWorld(); fresh.build(c);
    runTicks(fresh, 17);                       // deliberately desynchronised
    restoreCheckpoint(fresh, cp);
    expect(fresh.jointDescs().map((j) => j.id)).toEqual(['slider0']);
    let bad = 0;
    for (let i = 0; i < 150; i++) {
      fresh.tickOnce();
      if (fresh.tick % 60 === 0 && canonicalSimState(fresh) !== want.get(fresh.tick)) bad++;
    }
    log('S3d restore-into-desynchronised continuation: diverged checkpoints =', bad);
    expect(bad).toBe(0);
  });

  test('S3e a joint is refused, not silently repaired, when its axis or bodies are wrong', () => {
    const bad = oscillatorScene();
    (bad.joints![0] as { axis: { x: number; y: number; z: number } }).axis = { x: 2, y: 0, z: 0 };
    expect(() => new SimWorld().build(bad)).toThrow(/not a unit vector/);
    const bad2 = oscillatorScene();
    bad2.joints![0].bodyB = 'nope';
    expect(() => new SimWorld().build(bad2)).toThrow(/no entity nope/);
  });
});

// ===========================================================================
// S4 — SCENE SELECTOR: WORLD AND RECORDING RESET COHERENTLY
// ===========================================================================

describe('S4 — the preset selector resets world AND recording coherently', () => {
  test('S4a every preset builds, and each returns the world to tick 0', () => {
    for (const p of SCENES) {
      const sim = new SimWorld();
      sim.build(p.build());
      expect(sim.tick).toBe(0);
      expect(sim.dynamicIds().length).toBeGreaterThan(0);
      log('S4a preset', p.id, '->', sim.order.length, 'bodies,', sim.springs.length, 'springs,', sim.jointOrder.length, 'joints');
    }
  });

  test('S4b switching to a DIFFERENT preset terminates a live recording and states why', () => {
    const r = new Recorder();
    r.begin(SCENES[0].build());
    r.record(ev({ tick: 3, seq: 0, kind: 'push', target: 'platform', impulse: { x: 1, y: 0, z: 0 } }));
    expect(r.events.length).toBe(1);
    const out = worldReplaced(r, 'load', projectileScene());
    log('S4b', out.note);
    expect(r.recording).toBe(false);
    expect(r.events.length).toBe(0);
    expect(r.seq).toBe(0);
    expect(out.pending).toEqual([]);
    expect(out.note).toMatch(/RECORDING TERMINATED/);
  });

  test('S4c re-selecting the SAME preset rebases the recording to tick 0 rather than ending it', () => {
    const r = new Recorder();
    const base = oscillatorScene();
    r.begin(base);
    r.record(ev({ tick: 9, seq: 0, kind: 'push', target: 'cart', impulse: { x: 1, y: 0, z: 0 } }));
    const out = worldReplaced(r, 'reset', base);
    log('S4c', out.note);
    expect(r.recording).toBe(true);
    expect(r.events.length).toBe(0);
    expect(r.seq).toBe(0);
  });
});

// ===========================================================================
// DEMO 1 — VACUUM PROJECTILE.  Card 1.
// ===========================================================================

interface Flight {
  x: Sample[]; y: Sample[];
  vx: number; vy: number; x0: number; y0: number;
}

function fly(medium: 'air' | 'vacuum', angleDeg: number, ticks: number): Flight {
  const sim = new SimWorld();
  sim.build(projectileScene(medium));
  const J = launchImpulse(angleDeg);
  const r = applyEvent(sim, ev({ tick: 0, seq: 0, kind: 'push', target: 'shot', impulse: J }));
  if (r) throw new Error(r);
  const mx = new Meter('pos.x', { kind: 'body', entityId: 'shot' });
  const my = new Meter('pos.y', { kind: 'body', entityId: 'shot' });
  const b0 = sim.body('shot');
  const v = b0.linvel();
  const t0 = b0.translation();
  const out: Flight = { x: [], y: [], vx: v.x, vy: v.y, x0: t0.x, y0: t0.y };
  out.x.push({ tick: 0, t: 0, value: t0.x });
  out.y.push({ tick: 0, t: 0, value: t0.y });
  for (let i = 0; i < ticks; i++) {
    sim.tickOnce();
    mx.sample(sim); my.sample(sim);
  }
  // Re-key to t = 0 at the launch instant.
  out.x.push(...mx.samples.map((s) => ({ ...s })));
  out.y.push(...my.samples.map((s) => ({ ...s })));
  return out;
}

const RAD = Math.PI / 180;
/** Continuum: T_c = 2 v0 sinθ / g, R_c = v0² sin2θ / g. */
const Tc = (deg: number, v0 = PROJECTILE.speed): number => (2 * v0 * Math.sin(deg * RAD)) / G;
const Rc = (deg: number, v0 = PROJECTILE.speed): number => (v0 * v0 * Math.sin(2 * deg * RAD)) / G;
/** This scheme: T_d = T_c − h, R_d = R_c − v_x h. */
const Td = (deg: number, v0 = PROJECTILE.speed): number => Tc(deg, v0) - H;
const Rd = (deg: number, v0 = PROJECTILE.speed): number => Rc(deg, v0) - v0 * Math.cos(deg * RAD) * H;

describe('D1 — vacuum projectile against the analytic reference', () => {
  test('C1.1 every per-tick sample matches the derived discrete trajectory within 1e-4 m', () => {
    const f = fly('vacuum', PROJECTILE.angleDeg, 100);
    const vx = PROJECTILE.speed * Math.cos(PROJECTILE.angleDeg * RAD);
    const vy = PROJECTILE.speed * Math.sin(PROJECTILE.angleDeg * RAD);
    log('C1.1 launch velocity: engine', `(${f.vx.toFixed(9)}, ${f.vy.toFixed(9)})`,
      'card', `(${vx.toFixed(9)}, ${vy.toFixed(9)})`);
    let worstX = 0, worstY = 0;
    const n = Math.min(f.x.length, Math.round(Td(PROJECTILE.angleDeg) * 60));
    for (let i = 0; i < n; i++) {
      const t = f.x[i].t;
      worstX = Math.max(worstX, Math.abs(f.x[i].value - (PROJECTILE.launch.x + vx * t)));
      worstY = Math.max(worstY, Math.abs(f.y[i].value - (PROJECTILE.launch.y + vy * t - 0.5 * G * (t * t + H * t))));
    }
    log('C1.1 worst |Δx| =', worstX.toExponential(3), 'm, worst |Δy| =', worstY.toExponential(3), 'm over', n, 'ticks');
    expect(worstX).toBeLessThan(1e-4);
    expect(worstY).toBeLessThan(1e-4);
  });

  test('C1.2 flight time 1.5684024 s ± 1e-4 s and range 14.417591 m ± 1e-3 m', () => {
    const f = fly('vacuum', PROJECTILE.angleDeg, 100);
    const tq = crossingQuadratic(f.y, PROJECTILE.launch.y, 0.1)!;
    const tl = crossingLinear(f.y, PROJECTILE.launch.y, 0.1)!;
    const range = valueAtLinear(f.x, tq) - PROJECTILE.launch.x;
    const wantT = Td(PROJECTILE.angleDeg), wantR = Rd(PROJECTILE.angleDeg);
    log('C1.2 flight time: quadratic', tq.toFixed(7), 's | linear', tl.toFixed(7),
      's | derived T_d', wantT.toFixed(7), '| continuum T_c', Tc(PROJECTILE.angleDeg).toFixed(7),
      '| vs continuum', pct(tq, Tc(PROJECTILE.angleDeg)));
    log('C1.2 range:', range.toFixed(6), 'm | derived R_d', wantR.toFixed(6),
      '| continuum R_c', Rc(PROJECTILE.angleDeg).toFixed(6), '| vs continuum', pct(range, Rc(PROJECTILE.angleDeg)));
    expect(Math.abs(tq - wantT)).toBeLessThan(1e-4);
    expect(Math.abs(tq - 1.5684024)).toBeLessThan(1e-4);
    expect(Math.abs(range - wantR)).toBeLessThan(1e-3);
    expect(Math.abs(range - 14.417591)).toBeLessThan(1e-3);
    // Reported, not asserted: the derived bias of the linear estimator, 4.4e-5 s.
    log('C1.2 linear-vs-quadratic crossing difference', (tl - tq).toExponential(3), 's (derived bias 4.4e-5 s)');
  });

  test('C1.3 the angle sweep, and the 30/60 range equality BROKEN by exactly (vx30 - vx60)h', () => {
    const rows: Array<{ deg: number; got: number }> = [];
    for (const deg of [15, 30, 40, 45, 60, 75]) {
      const f = fly('vacuum', deg, Math.ceil(Tc(deg) * 60) + 6);
      const t = crossingQuadratic(f.y, PROJECTILE.launch.y, 0.1)!;
      const r = valueAtLinear(f.x, t) - PROJECTILE.launch.x;
      rows.push({ deg, got: r });
      log(`C1.3 theta=${deg}deg  R_measured ${r.toFixed(6)}  R_d ${Rd(deg).toFixed(6)}  R_c ${Rc(deg).toFixed(6)}  vs R_d ${pct(r, Rd(deg))}`);
      expect(Math.abs(r - Rd(deg))).toBeLessThan(1e-3);
    }
    const r30 = rows.find((x) => x.deg === 30)!.got;
    const r60 = rows.find((x) => x.deg === 60)!.got;
    const predictedGap = (PROJECTILE.speed * Math.cos(30 * RAD) - PROJECTILE.speed * Math.cos(60 * RAD)) * H;
    log('C1.3 R(60) - R(30) =', (r60 - r30).toFixed(7), 'm | derived +', predictedGap.toFixed(7),
      'm | continuum says 0');
    expect(Math.abs((r60 - r30) - predictedGap)).toBeLessThan(2e-4);
    expect(Math.abs(predictedGap - 0.0183013)).toBeLessThan(1e-6);
    expect(r60).toBeGreaterThan(r30);
  });

  test('C1.4 apex above launch 3.0164353 m ± 1e-3 m', () => {
    const f = fly('vacuum', PROJECTILE.angleDeg, 100);
    const top = peaks(f.y, 1)[0];
    const vy = PROJECTILE.speed * Math.sin(PROJECTILE.angleDeg * RAD);
    const wantH = ((vy - G * H / 2) ** 2) / (2 * G);
    const apex = top.value - PROJECTILE.launch.y;
    log('C1.4 apex above launch', apex.toFixed(7), 'm | derived', wantH.toFixed(7),
      '| continuum', (vy * vy / (2 * G)).toFixed(7), '| vs continuum', pct(apex, vy * vy / (2 * G)));
    expect(Math.abs(apex - wantH)).toBeLessThan(1e-3);
    expect(Math.abs(apex - 3.0164353)).toBeLessThan(1e-3);
  });

  test('C1.5/C1.6 AIR is an explicitly NUMERICAL comparison — no closed form is asserted', () => {
    const vac = fly('vacuum', PROJECTILE.angleDeg, 120);
    const air = fly('air', PROJECTILE.angleDeg, 120);
    const tVac = crossingQuadratic(vac.y, PROJECTILE.launch.y, 0.1)!;
    const tAir = crossingQuadratic(air.y, PROJECTILE.launch.y, 0.1)!;
    const rVac = valueAtLinear(vac.x, tVac) - PROJECTILE.launch.x;
    const rAir = valueAtLinear(air.x, tAir) - PROJECTILE.launch.x;
    const apexAir = peaks(air.y, 1)[0];
    const up = apexAir.t, down = tAir - apexAir.t;
    const k = dragK({ kind: 'sphere', radius: PROJECTILE.radius }, undefined, 1.225);
    log('C1.5 range: vacuum', rVac.toFixed(6), 'm | air', rAir.toFixed(6), 'm | deficit',
      (rVac - rAir).toFixed(6), 'm =', (100 * (1 - rAir / rVac)).toFixed(2), '%  [NUMERICAL ONLY, no closed form]');
    log('C1.6 air legs: launch->apex', up.toFixed(6), 's | apex->landing', down.toFixed(6),
      's | asymmetry', (down - up).toFixed(6), 's; k_drag =', k.toExponential(4), 'kg/m');
    expect(rAir).toBeLessThan(rVac * 0.95);
    expect(up).toBeLessThan(down);
  });
});

// ===========================================================================
// DEMO 2 — SIMPLE PENDULUM ON A HINGE.  Card 2.
// ===========================================================================

/**
 * Mean period over the first `nPeriods` whole periods, from interpolated zero crossings.
 *
 * THE PROFILE IS DECLARED BY THE CONSTRUCTION, not poked onto the world after
 * the fact. `LEGACY` means a construction with no `numerics` field at all, which
 * is what D-29's retained red is asserted against; the ladder passes an explicit
 * rung. Also returns the wall-clock cost of the run so accuracy and cost are
 * measured together and never quoted apart.
 */
const LEGACY = 'legacy' as const;
const prof = (m: number): NumericsDesc => ({ substeps: m });

function pendulumPeriod(deg: number, nPeriods = 6, numerics: NumericsDesc | 'legacy' = PENDULUM_PROFILE): {
  period: number; drift: number; theta: Sample[]; msPerTick: number; substeps: number;
} {
  const T = pendulumExactPeriod(deg * RAD);
  const ticks = Math.ceil((T * (nPeriods + 1.5)) * 60);
  const sim = new SimWorld();
  sim.build(pendulumScene(deg, numerics));
  const m = new Meter('angle', { kind: 'bodyRelativeToPoint', entityId: 'bob', point: PENDULUM.pivot }, 8000);
  m.sample(sim);
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) { sim.tickOnce(); m.sample(sim); }
  const msPerTick = (performance.now() - t0) / ticks;
  const s = m.samples;
  const zeros: number[] = [];
  let after = -Infinity;
  for (;;) {
    const t = crossingLinear(s, 0, after);
    if (t === null) break;
    zeros.push(t);
    after = t + 1e-6;
    if (zeros.length > 2 * nPeriods + 2) break;
  }
  if (zeros.length < 2 * nPeriods + 1) throw new Error(`only ${zeros.length} zero crossings at ${deg} deg`);
  const period = (zeros[2 * nPeriods] - zeros[0]) / nPeriods;
  const pk = peaks(s, 1);
  const drift = pk.length >= 2 ? pk[pk.length - 1].value / pk[0].value - 1 : NaN;
  return { period, drift, theta: s, msPerTick, substeps: sim.subSteps };
}

/**
 * The free-spin witness: zero gravity, no torque of any kind, so kinetic energy
 * MUST be conserved. Returns the loss over the declared FINITE window.
 */
function freeSpinLoss(numerics: NumericsDesc | 'legacy', ticks = 660, w = 5.7): {
  ke0: number; ke1: number; rel: number; owned: number; unattributed: number; interventions: number;
  msPerTick: number; substeps: number;
} {
  const c = pendulumScene(0, numerics);
  c.environment.gravity = { x: 0, y: 0, z: 0 };
  const bobDesc = c.entities.find((e) => e.id === 'bob')!;
  bobDesc.linvel = { x: w * PENDULUM.L, y: 0, z: 0 };
  bobDesc.angvel = { x: 0, y: 0, z: w };
  const sim = new SimWorld();
  sim.build(c);
  const ke0 = sim.budget.current.keTranslational + sim.budget.current.keRotational;
  const t0 = performance.now();
  runTicks(sim, ticks);
  const msPerTick = (performance.now() - t0) / ticks;
  const ke1 = sim.budget.current.keTranslational + sim.budget.current.keRotational;
  return {
    ke0, ke1, rel: ke1 / ke0 - 1,
    owned: sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper,
    unattributed: sim.budget.unattributed,
    interventions: sim.budget.interventionsTotal,
    msPerTick, substeps: sim.subSteps,
  };
}

describe('D2 — pendulum on a hinge: the small-angle period, and where it stops being true', () => {
  const T0 = pendulumSmallAnglePeriod();

  test('C2.0 the derived references match the card', () => {
    // A1 §2: the card's 1.5569985 and 2.1375273 were MY desk-arithmetic slips, retained
    // as C2.0's original red and corrected here to the values recomputed BY HAND in
    // EXPECTATIONS-BB1-S1-A1.md (4df23641…). The tolerances are unchanged.
    log('C2.0 T0 =', T0.toFixed(7), 's (card 1.5569985, corrected 1.5569973), omega_0 =',
      (2 * Math.PI / T0).toFixed(7), 'rad/s');
    expect(Math.abs(T0 - 1.5569973)).toBeLessThan(1e-6);
    expect(Math.abs((2 / Math.PI) * completeK(Math.sin(45 * RAD)) - 1.1803406)).toBeLessThan(1e-6);
    expect(Math.abs(pendulumExactPeriod(120 * RAD) - 2.1375710)).toBeLessThan(1e-5);
  });

  test('C2.1 at 3 deg the measured period is within 0.5 % of the small-angle T0', () => {
    const { period, drift, substeps } = pendulumPeriod(3);
    log('C2.1 profile: the scene\'s DECLARED M =', substeps);
    log('C2.1 theta0=3deg: T_measured', period.toFixed(7), 's | T0', T0.toFixed(7),
      '| deviation', pct(period, T0), '| exact', pendulumExactPeriod(3 * RAD).toFixed(7),
      '| vs exact', pct(period, pendulumExactPeriod(3 * RAD)), '| amplitude drift', (100 * drift).toFixed(4), '%');
    expect(Math.abs(period / T0 - 1)).toBeLessThan(0.005);
  });

  /**
   * *** THIS TEST IS RED AND STAYS RED. ***
   * C2.2 fails at 90 deg (-4.07 %) and 120 deg (-11.73 %) against its declared 1.0 %,
   * and C2.3's discriminator fails at both. The tolerance is NOT widened, the amplitude
   * range is NOT shrunk and no case is deleted. The cause is established in
   * EXPECTATIONS-BB1-S1-A1.md sec 3 and in DEVIATIONS.md D-29; an explanation is not a
   * justification, and no correction exists inside this build's declared invariants.
   */
  test('C2.2/C2.3 [RETAINED RED, LEGACY M=4] every amplitude matches the EXACT elliptic period', () => {
    const results: Array<{ deg: number; T: number; drift: number }> = [];
    for (const deg of [3, 30, 60, 90, 120]) {
      const { period, drift, substeps } = pendulumPeriod(deg, 6, LEGACY);
      expect(substeps).toBe(4);            // the LEGACY construction, not a poked world
      const exact = pendulumExactPeriod(deg * RAD);
      results.push({ deg, T: period, drift });
      log(`C2.2 theta0=${deg}deg  T_meas ${period.toFixed(7)}  T_exact ${exact.toFixed(7)}  vs exact ${pct(period, exact)}`
        + `  |  T0 ${T0.toFixed(7)}  T_meas vs T0 ${pct(period, T0)}  |  amplitude drift ${(100 * drift).toFixed(4)} %`);
      expect(Math.abs(period / exact - 1)).toBeLessThan(0.010);
    }
    const at90 = results.find((r) => r.deg === 90)!.T;
    const at120 = results.find((r) => r.deg === 120)!.T;
    log('C2.3 discriminator: T(90)/T0 - 1 =', pct(at90, T0), ', T(120)/T0 - 1 =', pct(at120, T0));
    expect(at90 / T0 - 1).toBeGreaterThan(0.15);
    expect(at120 / T0 - 1).toBeGreaterThan(0.30);
  });

  test('C2.4 refinement does not make it worse', () => {
    const exact = pendulumExactPeriod(3 * RAD);
    const m4 = pendulumPeriod(3, 6, LEGACY).period;
    const m8 = pendulumPeriod(3, 6, prof(8)).period;
    const e4 = Math.abs(m4 - exact), e8 = Math.abs(m8 - exact);
    log('C2.4 M=4 T', m4.toFixed(7), 'err', e4.toExponential(3), '| M=8 T', m8.toFixed(7), 'err', e8.toExponential(3),
      '| exact', exact.toFixed(7));
    expect(e8).toBeLessThanOrEqual(e4);
  });

  /**
   * C2.6 — A CHARACTERISATION TEST, NOT A PREDICTION. Its numbers were OBSERVED before
   * it was written (A1 sec 4), so it asserts only two properties that follow from the
   * derivation rather than from any observed magnitude: with zero gravity and no torque
   * the hinge still loses kinetic energy, all of it lands in UNATTRIBUTED with owned
   * dissipation identically zero, and the loss shrinks monotonically as h is refined.
   * It exists so this cannot go quiet later. It does not turn C2.2's red green.
   */
  test('C2.6 CHARACTERISATION: the hinge itself loses energy with NO torque, first order in h', () => {
    // FIXTURE NOTE (D-30). The first version of this test set gravity through an
    // intervention and then wrote the spin velocity straight onto the body, AFTER
    // `build()` had already taken the energy baseline at rest. The identity clause
    // then failed by construction — the baseline did not contain the kinetic energy
    // the test had injected behind it. The spin and the zero gravity are AUTHORED
    // here instead, so the baseline is the real initial state and the identity
    // assertion below is meaningful rather than trivially wrong.
    const losses: number[] = [];
    const decs: number[] = [];
    for (const M of SUPPORTED_SUBSTEPS) {
      const r = freeSpinLoss(M === 4 ? LEGACY : prof(M));
      expect(r.substeps).toBe(M);
      losses.push(-r.rel);
      decs.push(-Math.log(r.ke1 / r.ke0));
      log(`C2.6 free spin, zero gravity, NO torque, M=${String(M).padStart(3)}: `
        + `KE ${r.ke0.toFixed(6)} -> ${r.ke1.toFixed(6)} J  (${(100 * r.rel).toFixed(4)} % over the DECLARED `
        + `FINITE 11.000 s window)  log-decrement ${(-Math.log(r.ke1 / r.ke0)).toFixed(6)}`
        + `  owned dissipation ${r.owned.toFixed(6)} J  UNATTRIBUTED ${r.unattributed.toFixed(6)} J`
        + `  cost ${r.msPerTick.toFixed(4)} ms/tick`);
      expect(r.owned).toBe(0);                                 // nothing to call heat, and nothing is
      expect(r.interventions).toBe(0);                         // nothing booked to an edit either
      expect(r.rel).toBeLessThan(0);                            // the hinge loses energy with no torque
      expect(Math.abs(r.unattributed - (r.ke1 - r.ke0))).toBeLessThan(1e-6);
    }
    for (let i = 1; i < losses.length; i++) expect(losses[i]).toBeLessThan(losses[i - 1]);
    // D-33 / P-A12: the RATE, reported no more precisely than the data show. The
    // successive log-decrement ratios are NOT 1/2; they approach it from above.
    const ratios = decs.slice(1).map((d, i) => d / decs[i]);
    log('C2.6 successive log-decrement ratios M=4->8->16->32->64->128:',
      ratios.map((r) => r.toFixed(4)).join(', '),
      '— first order would give 0.5000 at every step; these do NOT, so no asymptotic rate is claimed');
    // The ONLY thing asserted about the rate is that refinement helps and that it
    // never beats first order in this measured range. No literal is asserted.
    for (const r of ratios) { expect(r).toBeGreaterThan(0.4); expect(r).toBeLessThan(1); }
    // AND THE POINT THAT MUST NOT GO QUIET: at the scene's DECLARED profile the
    // hinge STILL loses kinetic energy with no torque. Period accuracy is not
    // energy conservation and this build never claims it is.
    const declared = freeSpinLoss(PENDULUM_PROFILE);
    log(`C2.6 AT THE DECLARED PROFILE M=${declared.substeps}: KE ${declared.ke0.toFixed(6)} -> `
      + `${declared.ke1.toFixed(6)} J = ${(100 * declared.rel).toFixed(4)} % over 11 s, ALL of it UNATTRIBUTED. `
      + `THIS IS NOT AN ENERGY-CONSERVING ADAPTER and the finite 11 s window bounds nothing beyond itself.`);
    expect(declared.rel).toBeLessThan(0);
    expect(declared.owned).toBe(0);
  });

  test('C2.5 amplitude drift is REPORTED, and no part of it is called heat', () => {
    const sim = new SimWorld();
    sim.build(pendulumScene(60));                              // the scene's DECLARED profile
    runTicks(sim, 600);
    const b = sim.budget;
    const owned = b.dissipatedDrag + b.dissipatedSpringDamper;
    log('C2.5 after 10 s at 60 deg: E_mech', b.current.total.toFixed(6), 'J | baseline', b.baselineTotal.toFixed(6),
      'J | owned dissipation', owned.toExponential(3), 'J | UNATTRIBUTED', b.unattributed.toExponential(4), 'J');
    // The scene is a vacuum with no spring, so this build owns NO dissipation
    // channel here at all: whatever the hinge constraint does is UNATTRIBUTED by
    // construction, and it is not turned into heat.
    expect(owned).toBe(0);
    expect(b.interventionsTotal).toBe(0);
    expect(Math.abs(b.unattributed - (b.current.total - b.baselineTotal))).toBeLessThan(1e-9);
  });
});

// ===========================================================================
// DEMO 3 — GUIDED SPRING OSCILLATOR ON A SLIDER.  Card 3.
// ===========================================================================

/** Least-squares 3-term recurrence estimator of D-14: y[n+1] = a y[n] + b y[n-1] + c. */
function recurrenceEstimator(s: readonly Sample[], dt: number): { sigma: number; period: number } {
  const n = s.length;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const r = [0, 0, 0];
  for (let i = 1; i < n - 1; i++) {
    const f = [s[i].value, s[i - 1].value, 1];
    const y = s[i + 1].value;
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) M[a][b] += f[a] * f[b]; r[a] += f[a] * y; }
  }
  // Gaussian elimination with partial pivoting.
  const A = M.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    [A[c], A[p]] = [A[p], A[c]];
    for (let i = 0; i < 3; i++) {
      if (i === c) continue;
      const k = A[i][c] / A[c][c];
      for (let j = c; j < 4; j++) A[i][j] -= k * A[c][j];
    }
  }
  const a = A[0][3] / A[0][0], b = A[1][3] / A[1][1];
  const disc = a * a + 4 * b;
  if (disc >= 0) return { sigma: NaN, period: NaN };
  const mod = Math.sqrt(-b);
  const arg = Math.atan2(Math.sqrt(-disc) / 2, a / 2);
  return { sigma: -Math.log(mod) / dt, period: (2 * Math.PI * dt) / arg };
}

describe('D3 — guided spring oscillator on a slider, against the DISCRETE map of this scheme', () => {
  const omegaN = Math.sqrt(OSCILLATOR.stiffness / OSCILLATOR.mass);
  const gamma = OSCILLATOR.damping / OSCILLATOR.mass;
  const d = discreteOscillator(omegaN, gamma, H);
  const omegaD = omegaN * Math.sqrt(1 - (gamma / (2 * omegaN)) ** 2);
  const Tcont = (2 * Math.PI) / omegaD;

  test('C3.0 the derived discrete references match the card', () => {
    log('C3.0 continuum: T_c', Tcont.toFixed(7), 's, sigma 1.0 s^-1, peak ratio', Math.exp(-1 * Tcont).toFixed(7));
    log('C3.0 discrete : T_num', d.period.toFixed(7), 's (card 0.6301330), sigma_num', d.sigma.toFixed(7),
      '(card 1.0041902), peak ratio', d.peakRatio.toFixed(7), '(card 0.5311114)');
    expect(Math.abs(Tcont - 0.6314838)).toBeLessThan(1e-6);
    expect(Math.abs(d.period - 0.6301330)).toBeLessThan(1e-6);
    expect(Math.abs(d.sigma - 1.0041902)).toBeLessThan(1e-6);
    // A1 §2: 0.5311114 was MY desk-arithmetic slip; 0.5311177 is the hand recomputation.
    expect(Math.abs(d.peakRatio - 0.5311177)).toBeLessThan(1e-6);
    expect(Math.abs(d.det - (1 - H * gamma))).toBeLessThan(1e-15);
  });

  function run(ticks: number): { x: Meter; e: Meter; sim: SimWorld } {
    const sim = new SimWorld();
    sim.build(oscillatorScene());
    const x = new Meter('disp.x', { kind: 'body', entityId: 'cart' }, 4000);
    const e = new Meter('E.total', { kind: 'world' }, 4000);
    x.sample(sim); e.sample(sim);
    for (let i = 0; i < ticks; i++) { sim.tickOnce(); x.sample(sim); e.sample(sim); }
    return { x, e, sim };
  }

  test('C3.1 period matches the discrete map within 0.10 %, undershooting the continuum as derived', () => {
    const { x } = run(600);
    const pos = peaks(x.samples, 1);
    const gaps: number[] = [];
    for (let i = 1; i < pos.length; i++) gaps.push(pos[i].t - pos[i - 1].t);
    const T = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const rec = recurrenceEstimator(x.samples, SI.DT);
    log('C3.1 T_measured (peak-to-peak, n =', gaps.length, ')', T.toFixed(7),
      's | recurrence', rec.period.toFixed(7), '| T_num', d.period.toFixed(7), '| vs T_num', pct(T, d.period),
      '| vs T_c', pct(T, Tcont));
    expect(Math.abs(T / d.period - 1)).toBeLessThan(0.0010);
    expect(T / Tcont - 1).toBeGreaterThan(-0.0040);
    expect(T / Tcont - 1).toBeLessThan(-0.0010);
  });

  test('C3.2 decay rate in [1.000, 1.010] s^-1 by BOTH estimators, above the continuum 1.0', () => {
    const { x } = run(600);
    const all = [...peaks(x.samples, 1), ...peaks(x.samples, -1)].sort((a, b) => a.t - b.t);
    const sigmaFit = -olsSlope(all.map((p) => p.t), all.map((p) => Math.log(Math.abs(p.value))));
    const rec = recurrenceEstimator(x.samples, SI.DT);
    log('C3.2 sigma: peak fit', sigmaFit.toFixed(7), 's^-1 | recurrence', rec.sigma.toFixed(7),
      '| derived sigma_num', d.sigma.toFixed(7), '| continuum 1.0 | fit vs derived', pct(sigmaFit, d.sigma));
    for (const s of [sigmaFit, rec.sigma]) {
      expect(s).toBeGreaterThanOrEqual(1.000);
      expect(s).toBeLessThanOrEqual(1.010);
    }
  });

  test('C3.3 successive same-sign peak ratio within 0.5 % of the derived 0.5311177', () => {
    const { x } = run(600);
    const pos = peaks(x.samples, 1).filter((p) => p.value > 1e-4);
    const ratios: number[] = [];
    for (let i = 1; i < pos.length; i++) ratios.push(pos[i].value / pos[i - 1].value);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    log('C3.3 peak ratio mean over', ratios.length, 'pairs', mean.toFixed(7),
      '| derived', d.peakRatio.toFixed(7), '| continuum', Math.exp(-Tcont).toFixed(7), '| vs derived', pct(mean, d.peakRatio));
    // The card literal, uncorrected, would also have passed this 0.5 % band.
    expect(Math.abs(mean / d.peakRatio - 1)).toBeLessThan(0.005);
  });

  test('C3.4 |UNATTRIBUTED| <= 2 % of owned dissipation over 3.0 s; the slider is NOT decomposed', () => {
    const { sim } = run(180);
    const b = sim.budget;
    const owned = b.dissipatedDrag + b.dissipatedSpringDamper;
    log('C3.4 at t = 3.0 s: E_mech', b.current.total.toFixed(6), 'J | baseline', b.baselineTotal.toFixed(6),
      'J | owned dissipation', owned.toFixed(6), 'J (drag', b.dissipatedDrag.toExponential(2),
      ', damper', b.dissipatedSpringDamper.toFixed(6), ') | UNATTRIBUTED', b.unattributed.toExponential(4),
      'J =', (100 * Math.abs(b.unattributed) / owned).toFixed(4), '% of owned');
    expect(b.dissipatedDrag).toBe(0);           // vacuum: no owned drag channel at all
    expect(owned).toBeGreaterThan(1);
    expect(Math.abs(b.unattributed) / owned).toBeLessThan(0.02);
  });

  test('C3.5 the SAME measurement path drives demo 1 and demo 3 — one plot, two consumers', () => {
    const { x, e } = run(120);
    expect(x.unit).toBe('m');
    expect(e.unit).toBe('J');
    expect(x.samples.length).toBe(121);
    // Demo 1 uses the same Meter class and the same quantity catalogue.
    const f = fly('vacuum', PROJECTILE.angleDeg, 20);
    expect(f.y.length).toBe(21);
    log('C3.5 second consumer confirmed: Meter("disp.x") + Meter("E.total") for demo 3,',
      'Meter("pos.x") + Meter("pos.y") for demo 1, one catalogue, one plot component.');
  });
});

// ===========================================================================
// BB1 STAGE TWO
// Against EXPECTATIONS-BB1-S2.md (stamped 2026-09-06T05:06:14Z, sha256 88030e17…),
// written and run BEFORE the stage-two UI was written.
// ===========================================================================

// ---------------------------------------------------------------------------
// PART A — the pendulum's DECLARED NUMERICAL PROFILE
// ---------------------------------------------------------------------------

describe('S5 — the declared numerical profile is authored content: recorded, restored, compared, refused', () => {
  test('P-A1 a construction with NO declared profile is byte-identically the legacy M = 4', () => {
    const legacy = pendulumScene(30, LEGACY);
    expect(legacy.numerics).toBeUndefined();
    const explicit = pendulumScene(30, prof(4));
    expect(explicit.numerics).toEqual({ substeps: 4 });

    const a = new SimWorld(); a.build(legacy);
    const b = new SimWorld(); b.build(explicit);
    expect(a.subSteps).toBe(4);
    expect(b.subSteps).toBe(4);
    // The only in-scope difference is the declared-profile line itself; every body,
    // every velocity and the whole budget must agree BYTE FOR BYTE over 300 ticks.
    const strip = (x: string): string => x.split('\n').filter((l) => !l.startsWith('numerics ')).join('\n');
    for (let i = 0; i < 300; i++) { a.tickOnce(); b.tickOnce(); }
    expect(strip(canonicalSimState(b))).toBe(strip(canonicalSimState(a)));
    log('P-A1 legacy-absent and explicit {substeps:4} agree byte for byte over 300 ticks; '
      + 'the declared-profile line is the only difference, and it is the point of the line');

    // ...and the profile line REALLY IS in the canonical bytes, distinguishing them.
    expect(canonicalSimState(b)).not.toBe(canonicalSimState(a));
  });

  test('P-A2 an unsupported profile is REFUSED, never substituted', () => {
    for (const bad of [1, 3, 5, 6, 100, 256, 0, -4, 4.5, NaN]) {
      const c = pendulumScene(30, { substeps: bad });
      const sim = new SimWorld();
      expect(() => sim.build(c)).toThrow(/not one of the supported/);
      // AND NOTHING WAS SILENTLY BUILT AT SOME OTHER M.
      expect(() => sim.body('bob')).toThrow();
      // The same refusal reaches the loader, so a saved file cannot smuggle one in.
      expect(() => parseConstruction(JSON.stringify(c))).toThrow(/not one of the supported/);
    }
    log('P-A2 refused, with the value and the supported set named:',
      (() => { try { constructionSubsteps({ numerics: { substeps: 5 } }); return ''; } catch (e) { return (e as Error).message; } })());
    for (const good of SUPPORTED_SUBSTEPS) {
      expect(constructionSubsteps({ numerics: { substeps: good } })).toBe(good);
    }
  });

  test('P-A3 the declared profile is in the canonical comparison', () => {
    const a = new SimWorld(); a.build(pendulumScene(30, prof(4)));
    const b = new SimWorld(); b.build(pendulumScene(30, prof(8)));
    expect(canonicalSimState(a)).not.toBe(canonicalSimState(b));
    expect(canonicalSimState(a)).toContain('subSteps ');
    expect(canonicalSimState(a)).toContain('numerics ');
    expect(canonicalSimState(pendulumBuilt(LEGACY))).toContain('numerics legacy4');
    log('P-A3 canonicalSimState carries BOTH the live subSteps and the DECLARED profile');
  });

  test('P-A4 an old-profile record replays unchanged, twice, and matches the pre-change manual path', () => {
    const rec: InputRecord = {
      format: 'fp1-record', formatVersion: 1,
      engine: `@dimforge/rapier3d-compat@${SimWorld.engineVersion()}`,
      construction: pendulumScene(60, LEGACY), events: [], checkpointEvery: 60,
    };
    const s1 = new SimWorld(), s2 = new SimWorld();
    const r1 = replay(s1, rec, 300), r2 = replay(s2, rec, 300);
    expect(r2.map((c) => c.canonical)).toEqual(r1.map((c) => c.canonical));
    expect(s1.subSteps).toBe(4);

    // THE PRE-CHANGE PATH: a legacy construction with sim.subSteps set by hand to 4,
    // which is exactly what the code did before profiles existed.
    const manual = new SimWorld();
    manual.build(pendulumScene(60, LEGACY));
    manual.subSteps = 4;
    for (let i = 0; i < 300; i++) manual.tickOnce();
    expect(canonicalSimState(manual)).toBe(r1[r1.length - 1].canonical);
    log('P-A4 legacy replay is idempotent and byte-identical to the pre-change manual path over 300 ticks');
  });

  test('P-A5 a mid-run checkpoint at the DECLARED profile restores into a desynchronised world and continues', () => {
    const c = pendulumScene(90);                      // declared profile, not 4
    const unbroken = new SimWorld(); unbroken.build(c);
    expect(unbroken.subSteps).toBe(PENDULUM_PROFILE.substeps);
    const want = new Map<number, string>();
    for (let i = 0; i < 180; i++) { unbroken.tickOnce(); if (unbroken.tick % 30 === 0) want.set(unbroken.tick, canonicalSimState(unbroken)); }

    const live = new SimWorld(); live.build(c);
    for (let i = 0; i < 60; i++) live.tickOnce();
    const cp = takeCheckpoint(live, {
      pendingEvents: [], selectedId: 'bob', settings: { paused: false, recording: false },
      seqCounter: 0, recordedEvents: [], recordingBase: null,
    });
    expect(cp.app.numerics).toEqual(PENDULUM_PROFILE);

    // DESYNCHRONISED: a DIFFERENT construction, on the LEGACY profile, stepped a
    // different number of ticks. Without the profile in the checkpoint this world
    // would go on running at 4 and diverge immediately.
    const fresh = new SimWorld();
    fresh.build(oscillatorScene());
    for (let i = 0; i < 37; i++) fresh.tickOnce();
    expect(fresh.subSteps).toBe(4);
    restoreCheckpoint(fresh, cp);
    expect(fresh.subSteps).toBe(PENDULUM_PROFILE.substeps);
    expect(fresh.tick).toBe(60);

    let checked = 0, bad = 0;
    for (let i = 0; i < 120; i++) {
      fresh.tickOnce();
      if (want.has(fresh.tick)) { checked++; if (canonicalSimState(fresh) !== want.get(fresh.tick)) bad++; }
    }
    log(`P-A5 restored into a desynchronised world at M=${fresh.subSteps}: ${checked} comparison ticks, ${bad} mismatches`);
    expect(checked).toBeGreaterThanOrEqual(4);
    expect(bad).toBe(0);

    // AND A CHECKPOINT WITHOUT THE FIELD MEANS THE LEGACY M = 4, not "whatever is running".
    const legacyCp = JSON.parse(JSON.stringify(cp)) as typeof cp;
    delete (legacyCp.app as { numerics?: unknown }).numerics;
    const w2 = new SimWorld(); w2.build(pendulumScene(30, prof(64)));
    expect(w2.subSteps).toBe(64);
    restoreCheckpoint(w2, legacyCp);
    expect(w2.subSteps).toBe(4);
    log('P-A5 a checkpoint with no profile field restores to the LEGACY 4, not to what happened to be running');
  });

  test('P-A6 the resolvability guard is computed from the ACTUAL internal h', () => {
    const springs = oscillatorScene().springs;
    const massOf = (): number => OSCILLATOR.mass;
    const h4 = SI.DT / 4, h128 = SI.DT / 128;
    log(`P-A6 at M=4 h=${(1000 * h4).toFixed(4)} ms: omega_n <= ${maxOmegaNFor(h4).toFixed(1)} rad/s, `
      + `gamma <= ${maxGammaFor(h4).toFixed(1)} /s | at M=128 h=${(1000 * h128).toFixed(4)} ms: `
      + `omega_n <= ${maxOmegaNFor(h128).toFixed(1)} rad/s, gamma <= ${maxGammaFor(h128).toFixed(1)} /s`);
    expect(maxOmegaNFor(h128) / maxOmegaNFor(h4)).toBeCloseTo(32, 9);
    expect(maxGammaFor(h128) / maxGammaFor(h4)).toBeCloseTo(32, 9);

    // A regime the LEGACY step refuses and the declared profile admits.
    const stiff = springs.map((sp) => ({ ...sp, stiffness: 20_000 }));      // omega_n = 100 rad/s on 2 kg
    expect(resolvabilityIssues(stiff, massOf, h4).length).toBe(1);
    expect(resolvabilityIssues(stiff, massOf, h128).length).toBe(0);
    // and the message quotes the step it was computed at, so the two cannot be confused
    expect(resolvabilityIssues(stiff, massOf, h4)[0].message).toContain('4.1667 ms');
    // the live world hands its own h to the guard
    const sim = new SimWorld(); sim.build(pendulumScene(30));
    expect(sim.hSub).toBeCloseTo(SI.DT / PENDULUM_PROFILE.substeps, 15);
  });
});

/** Build a pendulum world at a given profile. Used only for canonical-string checks. */
function pendulumBuilt(numerics: NumericsDesc | 'legacy'): SimWorld {
  const s = new SimWorld();
  s.build(pendulumScene(30, numerics));
  return s;
}

describe('D2b — the M ladder, and the ORIGINAL C2.2/C2.3 criteria at the DECLARED profile', () => {
  const T0 = pendulumSmallAnglePeriod();

  /**
   * *** THE TOLERANCES HERE ARE THE STAMPED ONES FROM EXPECTATIONS-BB1-S1.md. ***
   * 1.0 % against the EXACT elliptic period, > 15 % at 90 deg and > 30 % at 120 deg
   * against T0. Nothing was widened, no amplitude was dropped, and the M = 4 case
   * above stays in the suite failing. This asserts the SAME criteria against a
   * CORRECTED implementation — a finer DECLARED fixed profile — not against a
   * softened criterion.
   */
  test('C2.7 at the DECLARED profile the ORIGINAL C2.2 and C2.3 hold, unmoved', () => {
    const results: Array<{ deg: number; T: number; drift: number }> = [];
    for (const deg of [3, 30, 60, 90, 120]) {
      const { period, drift, substeps, msPerTick } = pendulumPeriod(deg, 6, PENDULUM_PROFILE);
      expect(substeps).toBe(PENDULUM_PROFILE.substeps);
      const exact = pendulumExactPeriod(deg * RAD);
      results.push({ deg, T: period, drift });
      log(`C2.7 M=${substeps} theta0=${deg}deg  T_meas ${period.toFixed(7)}  T_exact(CONTINUUM) ${exact.toFixed(7)}`
        + `  vs exact ${pct(period, exact)}  |  T0 ${T0.toFixed(7)}  vs T0 ${pct(period, T0)}`
        + `  |  amplitude drift ${(100 * drift).toFixed(4)} %  |  ${msPerTick.toFixed(4)} ms/tick`);
      expect(Math.abs(period / exact - 1)).toBeLessThan(0.010);      // C2.2, unmoved
    }
    const at90 = results.find((r) => r.deg === 90)!.T;
    const at120 = results.find((r) => r.deg === 120)!.T;
    log('C2.7 discriminator: T(90)/T0 - 1 =', pct(at90, T0), ', T(120)/T0 - 1 =', pct(at120, T0));
    expect(at90 / T0 - 1).toBeGreaterThan(0.15);                     // C2.3, unmoved
    expect(at120 / T0 - 1).toBeGreaterThan(0.30);                    // C2.3, unmoved
  }, 300_000);

  /**
   * THE BOUNDED LADDER, REPORTED. M = 4, 8, 16 retained from A1; 32, 64, 128 added;
   * STOPPED AT 128. Accuracy AND cost in the same table, because a profile that met
   * the accuracy criterion outside the responsiveness budget would not be an answer.
   * These are MEASUREMENTS against criteria stamped on 2026-09-06 — not predictions,
   * and not a search for whichever rung happens to be green.
   */
  test('C2.8 the ladder: continuum error and cost at every rung, 4 -> 128', () => {
    log('C2.8 | M | theta0 | T_meas | T_exact (CONTINUUM) | vs exact | vs T0 | drift/6T | ms/tick |');
    for (const M of SUPPORTED_SUBSTEPS) {
      for (const deg of [3, 30, 60, 90, 120]) {
        const r = pendulumPeriod(deg, 6, M === 4 ? LEGACY : prof(M));
        const exact = pendulumExactPeriod(deg * RAD);
        log(`C2.8 | ${String(M).padStart(3)} | ${String(deg).padStart(3)} | ${r.period.toFixed(7)} | `
          + `${exact.toFixed(7)} | ${(100 * (r.period / exact - 1)).toFixed(4)}% | `
          + `${(100 * (r.period / T0 - 1)).toFixed(4)}% | ${(100 * r.drift).toFixed(4)}% | `
          + `${r.msPerTick.toFixed(4)} |`);
      }
    }
    // The only assertion: the CONTINUUM error at the largest amplitude shrinks
    // monotonically with refinement. No rate is claimed and no literal is asserted.
    const errs = SUPPORTED_SUBSTEPS.map((M) =>
      Math.abs(pendulumPeriod(120, 6, M === 4 ? LEGACY : prof(M)).period / pendulumExactPeriod(120 * RAD) - 1));
    log('C2.8 |T/T_exact - 1| at 120 deg across the ladder:', errs.map((e) => (100 * e).toFixed(4) + '%').join(' -> '));
    for (let i = 1; i < errs.length; i++) expect(errs[i]).toBeLessThan(errs[i - 1]);
  }, 600_000);

  test('C2.9 cost at the declared profile is inside the EXISTING responsiveness budget', () => {
    // Warm up, then measure. The budget is EXPECTATIONS.md sec F: unacceptable above
    // 16.67 ms/tick, warning line at 8 ms/tick. Headless here; the RENDERED scene is
    // measured in the browser and reported separately.
    pendulumPeriod(30, 2, PENDULUM_PROFILE);
    const r = pendulumPeriod(30, 6, PENDULUM_PROFILE);
    const legacy = pendulumPeriod(30, 6, LEGACY);
    log(`C2.9 headless physics cost: M=4 ${legacy.msPerTick.toFixed(4)} ms/tick, `
      + `M=${r.substeps} ${r.msPerTick.toFixed(4)} ms/tick (budget 16.67, warning line 8.00) `
      + `— ratio ${(r.msPerTick / legacy.msPerTick).toFixed(1)}x`);
    expect(r.msPerTick).toBeLessThan(16.67);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// DEMO 4 — TWO-BODY COLLISION, a controlled ISOLATED PAIR.  Card 4.
// ---------------------------------------------------------------------------

const X_AXIS = { x: 1, y: 0, z: 0 };

/** Run the isolated pair and sample everything card 4 declares, at the declared times. */
function collisionRun(e: number, ticks = 120): {
  vA: Meter; vB: Meter; p: Meter; sim: SimWorld; contactsOther: number;
} {
  const sim = new SimWorld();
  sim.build(collisionScene(e));
  const vA = new Meter('along.vel', { kind: 'bodyAlongAxis', entityId: 'ballA', point: { x: 0, y: 0, z: 0 }, axis: X_AXIS }, 4000);
  const vB = new Meter('along.vel', { kind: 'bodyAlongAxis', entityId: 'ballB', point: { x: 0, y: 0, z: 0 }, axis: X_AXIS }, 4000);
  const p = new Meter('p.along', { kind: 'worldAlongAxis', axis: X_AXIS }, 4000);
  for (const m of [vA, vB, p]) m.sample(sim);
  // THE ISOLATED-PAIR CONDITION IS ASSERTED, NOT ASSUMED: count every contact pair
  // that involves anything other than the two balls.
  let contactsOther = 0;
  const world = sim.rapier;
  for (let i = 0; i < ticks; i++) {
    sim.tickOnce();
    for (const m of [vA, vB, p]) m.sample(sim);
    world.contactPairsWith(sim.body('ballA').collider(0), (other) => {
      if (other.handle !== sim.body('ballB').collider(0).handle) contactsOther++;
    });
    world.contactPairsWith(sim.body('ground').collider(0), () => { contactsOther++; });
  }
  return { vA, vB, p, sim, contactsOther };
}

describe('D4 — two-body collision: momentum, and what restitution does to the energy', () => {
  const at = (s: readonly Sample[], t: number): number => valueAtLinear(s, t);

  test('C4.1/C4.5 momentum is conserved at EVERY tick, and the pair really is isolated', () => {
    for (const e of [COLLISION.restitution, 1.0]) {
      const { p, sim, contactsOther } = collisionRun(e);
      const want = collisionOutcome(e).p;
      let worst = 0;
      for (const s of p.samples) worst = Math.max(worst, Math.abs(s.value - want));
      const owned = sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper;
      log(`C4.1 e=${e}: p_x predicted ${want.toFixed(7)} kg·m/s, worst deviation over ${p.samples.length} ticks `
        + `${worst.toExponential(3)} | contacts with anything but the pair ${contactsOther} `
        + `| gravity ${JSON.stringify(sim.construction.environment.gravity)} | owned dissipation ${owned} J `
        + `| registry contributions ${sim.registry.contributions.length}`);
      expect(worst).toBeLessThan(1e-4);
      expect(contactsOther).toBe(0);                                    // C4.5
      expect(sim.construction.environment.gravity).toEqual({ x: 0, y: 0, z: 0 });
      expect(owned).toBe(0);
      expect(sim.registry.contributions.length).toBe(0);
      expect(sim.foreignAccumulatorWrites).toBe(0);
      // y and z momentum are zero and stay zero
      const py = new Meter('p.along', { kind: 'worldAlongAxis', axis: { x: 0, y: 1, z: 0 } });
      const pz = new Meter('p.along', { kind: 'worldAlongAxis', axis: { x: 0, y: 0, z: 1 } });
      py.sample(sim); pz.sample(sim);
      expect(Math.abs(py.samples[0].value)).toBeLessThan(1e-4);
      expect(Math.abs(pz.samples[0].value)).toBeLessThan(1e-4);
    }
  }, 120_000);

  test('C4.2/C4.3/C4.4 restitution and energy against the isolated-pair reference', () => {
    for (const e of [COLLISION.restitution, 1.0]) {
      const o = collisionOutcome(e);
      const { vA, vB, sim } = collisionRun(e);
      // DECLARED MEASUREMENT TIMES: incoming t = 0.25 s, outgoing t = 1.00 s.
      const inA = at(vA.samples, 0.25), inB = at(vB.samples, 0.25);
      const outA = at(vA.samples, 1.00), outB = at(vB.samples, 1.00);
      const eMeas = -(outB - outA) / (inB - inA);
      const ke0 = 0.5 * COLLISION.massA * inA * inA + 0.5 * COLLISION.massB * inB * inB;
      const ke1 = 0.5 * COLLISION.massA * outA * outA + 0.5 * COLLISION.massB * outB * outB;
      log(`C4.2 e_authored=${e} contact at t=${collisionContactTime().toFixed(4)} s: `
        + `in (${inA.toFixed(6)}, ${inB.toFixed(6)}) -> out (${outA.toFixed(6)}, ${outB.toFixed(6)}) m/s `
        + `| predicted (${o.vA1.toFixed(6)}, ${o.vB1.toFixed(6)}) | e_meas ${eMeas.toFixed(6)}`);
      log(`C4.4 KE ${ke0.toFixed(6)} -> ${ke1.toFixed(6)} J, ratio ${(ke1 / ke0).toFixed(6)} `
        + `| predicted ${o.ke0.toFixed(6)} -> ${o.ke1.toFixed(6)}, ratio ${(o.ke1 / o.ke0).toFixed(7)} `
        + `| destructible KE_cm ${o.keCm.toFixed(6)} J, untouchable KE_com ${o.keCom.toFixed(7)} J`
        + `| UNATTRIBUTED ${sim.budget.unattributed.toFixed(6)} J, owned dissipation `
        + `${(sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper).toFixed(6)} J `
        + `— the inelastic loss is PHYSICAL but this build attributes none of it, and NONE of it is called heat`);
      expect(Math.abs(eMeas - e)).toBeLessThan(0.05);                         // C4.2
      expect(Math.abs(outA / o.vA1 - 1)).toBeLessThan(0.05);                  // C4.3
      expect(Math.abs(outB / o.vB1 - 1)).toBeLessThan(0.05);                  // C4.3
      expect(Math.abs(ke1 / ke0 - o.ke1 / o.ke0)).toBeLessThan(0.05);         // C4.4
      if (e < 1) expect(ke1 / ke0).toBeLessThan(1);                            // C4.4
      // C4.6: NOT called heat, NOT booked as owned dissipation.
      expect(sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper).toBe(0);
      expect(sim.budget.interventionsTotal).toBe(0);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// DEMO 5 — INCLINED-PLANE SLIDE.  Card 5.
// ---------------------------------------------------------------------------

/** Slide the block and measure ALONG THE DECLARED DOWN-SLOPE AXIS. */
function inclineRun(angleDeg: number, mu: number, ticks: number): {
  disp: Sample[]; vel: Sample[]; normal: number; sim: SimWorld;
} {
  const th = (angleDeg * Math.PI) / 180;
  const d = inclineDown(th), n = inclineNormal(th);
  const start = inclineBlockStart(angleDeg);
  const sim = new SimWorld();
  sim.build(inclineScene(angleDeg, mu));
  const disp = new Meter('along.disp', { kind: 'bodyAlongAxis', entityId: 'block', point: start, axis: d }, 4000);
  const vel = new Meter('along.vel', { kind: 'bodyAlongAxis', entityId: 'block', point: start, axis: d }, 4000);
  const nrm = new Meter('along.disp', { kind: 'bodyAlongAxis', entityId: 'block', point: start, axis: n }, 4000);
  for (const m of [disp, vel, nrm]) m.sample(sim);
  for (let i = 0; i < ticks; i++) { sim.tickOnce(); for (const m of [disp, vel, nrm]) m.sample(sim); }
  let normal = 0;
  for (const s of nrm.samples) normal = Math.max(normal, Math.abs(s.value));
  return { disp: disp.samples, vel: vel.samples, normal, sim };
}

describe('D5 — inclined-plane slide: the FRICTIONLESS reference first, friction only with its model named', () => {
  test('C5.1 frictionless displacement matches THIS SCHEME s = 1/2 a (t^2 + h t)', () => {
    const a = inclineAcceleration(INCLINE.angleDeg, 0);
    const { disp, normal } = inclineRun(INCLINE.angleDeg, 0, 60);
    for (const t of [0.5, 0.8]) {
      const got = valueAtLinear(disp, t);
      const cont = 0.5 * a * t * t;
      const disc = 0.5 * a * (t * t + H * t);
      log(`C5.1 theta=${INCLINE.angleDeg}deg mu=0 t=${t.toFixed(2)} s: s_meas ${got.toFixed(7)} m `
        + `| this scheme ${disc.toFixed(7)} (${pct(got, disc)}) | CONTINUUM ${cont.toFixed(7)} (${pct(got, cont)}) `
        + `| the scheme's own offset -1/2 a h t = ${(-0.5 * a * H * t).toExponential(3)} m`);
      expect(Math.abs(got / disc - 1)).toBeLessThan(0.03);
    }
    log(`C5.3 largest departure from the plane |(r-r0).n| = ${normal.toExponential(3)} m `
      + `(Rapier's own normalizedAllowedLinearError is 5.0e-3 m)`);
    expect(normal).toBeLessThan(0.010);                                        // C5.3
  }, 120_000);

  test('C5.2 the FRICTIONLESS acceleration is g sin(theta), at two angles', () => {
    for (const deg of [25, 15]) {
      const want = inclineAcceleration(deg, 0);
      const { vel } = inclineRun(deg, 0, 60);
      const win = vel.filter((s) => s.t >= 0.20 && s.t <= 0.80);
      const aMeas = olsSlope(win.map((s) => s.t), win.map((s) => s.value));
      log(`C5.2 theta=${deg}deg mu=0: a_OLS over [0.20,0.80] s = ${aMeas.toFixed(7)} m/s^2 `
        + `| CONTINUUM g sin(theta) = ${want.toFixed(7)} | ${pct(aMeas, want)} `
        + `(v(t) = a t is EXACT in this scheme, so there is no discrete correction to apply)`);
      expect(Math.abs(aMeas / want - 1)).toBeLessThan(0.02);
    }
  }, 120_000);

  test('C5.4/C5.5 friction, with the engine model named, and the sliding/static discriminator', () => {
    // SLIDING: tan(25 deg) = 0.4663 > mu = 0.30
    const want = inclineAcceleration(25, INCLINE.mu);
    const { vel } = inclineRun(25, INCLINE.mu, 60);
    const win = vel.filter((s) => s.t >= 0.20 && s.t <= 0.80);
    const aMeas = olsSlope(win.map((s) => s.t), win.map((s) => s.value));
    log(`C5.4 theta=25deg mu=${INCLINE.mu} (Coulomb MODEL a = g(sin-mu cos); ENGINE: per-contact impulse cone `
      + `|lambda_t| <= mu lambda_n at ONE velocity iteration, pair coefficient by Rapier's default AVERAGE combine, `
      + `both colliders authored equal, mu_s = mu_k in this build): a_OLS ${aMeas.toFixed(7)} m/s^2 `
      + `| model ${want.toFixed(7)} | ${pct(aMeas, want)}`);
    expect(inclineIsStatic(25, INCLINE.mu)).toBe(false);
    expect(Math.abs(aMeas / want - 1)).toBeLessThan(0.05);

    // STATIC, at the SAME coefficient and at a larger one.
    for (const [deg, mu] of [[15, INCLINE.mu], [25, 0.60]] as Array<[number, number]>) {
      expect(inclineIsStatic(deg, mu)).toBe(true);
      const r = inclineRun(deg, mu, 120);
      const moved = Math.abs(r.disp[r.disp.length - 1].value);
      log(`C5.5 theta=${deg}deg mu=${mu}: tan(theta) = ${Math.tan(deg * RAD).toFixed(6)} <= mu, `
        + `so the model says it does not slide. Displacement over 2.00 s = ${moved.toExponential(3)} m`);
      expect(moved).toBeLessThan(0.02);
    }
    log('C5.5 the transition is BRACKETED between 15 and 25 deg at mu = 0.30 and is NOT resolved to an angle. '
      + 'No angle of repose of any real material is measured or claimed: mu is a generic mechanical coefficient.');
  }, 200_000);
});

// ---------------------------------------------------------------------------
// DEMO 6 — AIR / DRAG-FREE FALL.  Card 6. REUSES the validated drag work.
// ---------------------------------------------------------------------------

describe('D6 — air vs drag-free fall: the ALREADY-VALIDATED drag law, exposed as a comparison', () => {
  const k = dragK({ kind: 'sphere', radius: FALL.radius }, undefined, SI.RHO_AIR);
  const vT = terminalSpeed(FALL.mass, k);
  const tau = vT / SI.G;

  test('C6.0 the reused constants are the ones the card derived', () => {
    log(`C6.0 A_eff ${effectiveArea({ kind: 'sphere', radius: FALL.radius }).toFixed(9)} m^2 (card 0.045238934) | `
      + `k ${k.toFixed(9)} kg/m (card 0.013023158) | v_t ${vT.toFixed(6)} m/s (card 10.629724) | `
      + `tau ${tau.toFixed(7)} s (card 1.0835600). Drag law NOT revalidated here — EXPECTATIONS.md A0-A5.`);
    expect(Math.abs(k - 0.013023158)).toBeLessThan(1e-8);
    expect(Math.abs(vT - 10.629724)).toBeLessThan(1e-5);
  });

  test('C6.1/C6.2 the drag-free ball follows this scheme; the air ball follows the validated closed form', () => {
    const sim = new SimWorld();
    sim.build(fallScene('air'));
    const yF = new Meter('pos.y', { kind: 'body', entityId: 'freeBall' }, 4000);
    const vF = new Meter('vel.y', { kind: 'body', entityId: 'freeBall' }, 4000);
    const yA = new Meter('pos.y', { kind: 'body', entityId: 'airBall' }, 4000);
    const vA = new Meter('vel.y', { kind: 'body', entityId: 'airBall' }, 4000);
    for (const m of [yF, vF, yA, vA]) m.sample(sim);
    for (let i = 0; i < 150; i++) { sim.tickOnce(); for (const m of [yF, vF, yA, vA]) m.sample(sim); }

    // C6.1 — every per-tick sample of the DRAG-FREE ball against the exact map.
    let worstY = 0, worstV = 0;
    for (const s of yF.samples) worstY = Math.max(worstY, Math.abs(s.value - (FALL.releaseY - 0.5 * SI.G * (s.t * s.t + H * s.t))));
    for (const s of vF.samples) worstV = Math.max(worstV, Math.abs(s.value - -SI.G * s.t));
    log(`C6.1 drag-free ball over 150 ticks: worst |y - (y0 - 1/2 g (t^2+ht))| ${worstY.toExponential(3)} m, `
      + `worst |v + g t| ${worstV.toExponential(3)} m/s (bounds are f32 accumulation, not a physics claim)`);
    expect(worstY).toBeLessThan(1e-2);
    expect(worstV).toBeLessThan(1e-3);

    // C6.2 — the air ball at t = 2.5 s against the already-validated closed form.
    const t = 2.5;
    const vWant = vT * Math.tanh(t / tau);
    const dropCont = (vT * vT / SI.G) * Math.log(Math.cosh(t / tau));
    const dropDisc = dropCont + 0.5 * H * vWant;
    const vGot = Math.abs(vA.samples[vA.samples.length - 1].value);
    const dropGot = FALL.releaseY - yA.samples[yA.samples.length - 1].value;
    const dropFree = FALL.releaseY - yF.samples[yF.samples.length - 1].value;
    log(`C6.2 t=2.5 s AIR: |v| ${vGot.toFixed(6)} m/s vs closed form ${vWant.toFixed(6)} (${pct(vGot, vWant)}) | `
      + `drop ${dropGot.toFixed(6)} m vs ${dropDisc.toFixed(6)} (+1/2 h v corrected; continuum ${dropCont.toFixed(6)}) `
      + `(${pct(dropGot, dropDisc)})`);
    log(`C6.2 t=2.5 s DRAG-FREE: |v| ${Math.abs(vF.samples[vF.samples.length - 1].value).toFixed(6)} m/s, `
      + `drop ${dropFree.toFixed(6)} m | drop ratio free/air ${(dropFree / dropGot).toFixed(4)}, `
      + `speed ratio ${(Math.abs(vF.samples[vF.samples.length - 1].value) / vGot).toFixed(4)}`);
    expect(Math.abs(vGot / vWant - 1)).toBeLessThan(0.010);
    expect(Math.abs(dropGot / dropDisc - 1)).toBeLessThan(0.010);
    expect(dropFree - dropGot).toBeGreaterThan(10);                            // C6.3, the air half

    // C6.4 — the drag work is the EXISTING accounting, and the drag-free ball adds none of it.
    const owned = sim.budget.dissipatedDrag;
    log(`C6.4 owned dissipation booked as DRAG WORK by the existing path: ${owned.toFixed(6)} J `
      + `(spring damper ${sim.budget.dissipatedSpringDamper} J). Nothing else is called heat.`);
    expect(owned).toBeGreaterThan(0);
    expect(sim.budget.dissipatedSpringDamper).toBe(0);
  }, 120_000);

  test('C6.3 THE DISCRIMINATOR: in vacuum the two balls fall identically — drag is the only difference', () => {
    const sim = new SimWorld();
    sim.build(fallScene('vacuum'));
    runTicks(sim, 150);
    const a = sim.body('airBall'), f = sim.body('freeBall');
    const dy = Math.abs(a.translation().y - f.translation().y);
    const dv = Math.abs(a.linvel().y - f.linvel().y);
    log(`C6.3 vacuum, t=2.5 s: |y_air - y_free| ${dy.toExponential(3)} m, |v_air - v_free| ${dv.toExponential(3)} m/s `
      + `| bit-identical: ${dy === 0 && dv === 0} | drag work in vacuum ${sim.budget.dissipatedDrag} J`);
    expect(dy).toBeLessThan(1e-9);
    expect(dv).toBeLessThan(1e-9);
    expect(sim.budget.dissipatedDrag).toBe(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// F1 — THE FIXTURE DEFECT SCAN for demo 2's hinge.
//
// TASK A STEP ONE, and it comes first for a reason: a fixture defect — a stray
// contact, hidden damping, an inconsistent anchor or a wrong inertia — would
// change what every other number here means. It has to be RULED OUT before the
// solver is blamed. This began as a throwaway probe; it is a permanent witness
// instead, so the scan cannot go quiet later.
//
// COST NOTE, stated rather than hidden: the pendulum scene's DECLARED profile is
// 128 internal sub-steps, so this scan integrates 32x more sub-steps per tick
// than it did at the legacy 4 and needs a correspondingly longer timeout. That is
// an accommodation of measured COST. It is NOT a tolerance: every bound asserted
// below is unchanged, and nothing was shortened to fit.
// ---------------------------------------------------------------------------

describe('F1 — fixture scan: rule out a fixture defect BEFORE blaming the solver', () => {
  test('F1 no stray contacts, no damping, consistent anchors and inertia, at 3 amplitudes', () => {
    for (const deg of [30, 90, 120]) {
      const sim = new SimWorld();
      sim.build(pendulumScene(deg, LEGACY));            // the configuration D-29's red is about
      const w = sim.rapier;
      const bob = sim.body('bob'), pivot = sim.body('pivot');
      const bc = bob.collider(0);

      // (1) NO ENGINE DAMPING, NO SLEEP, NO CCD, NO GRAVITY SCALING, NOT A SENSOR.
      expect(bob.linearDamping()).toBe(0);
      expect(bob.angularDamping()).toBe(0);
      expect(bob.gravityScale()).toBe(1);
      expect(bob.isCcdEnabled()).toBe(false);
      expect(bob.isSleeping()).toBe(false);
      expect(bc.isSensor()).toBe(false);
      expect(pivot.bodyType()).toBe(1);                 // the pivot really is FIXED

      // (2) MASS AND INERTIA ARE THE ONES THE CARD ASSUMED. The card treats this as
      //     a PHYSICAL pendulum, I_pivot = (2/5)m r^2 + m L^2, which is only right if
      //     the bob's own inertia really is (2/5) m r^2.
      const wantI = 0.4 * PENDULUM.mass * PENDULUM.r * PENDULUM.r;
      expect(Math.abs(bob.mass() - PENDULUM.mass)).toBeLessThan(1e-6);
      for (const c of [bob.principalInertia().x, bob.principalInertia().y, bob.principalInertia().z]) {
        expect(Math.abs(c / wantI - 1)).toBeLessThan(1e-6);
      }

      // (3) THE JOINT ANCHORS COINCIDE AT t = 0. A construction that started with the
      //     constraint violated would be yanked by the solver on the first sub-step.
      const anchorB = (): { x: number; y: number; z: number } => {
        const t = bob.translation();
        const r = qrotLocal(bob.rotation(), { x: 0, y: PENDULUM.L, z: 0 });
        return { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
      };
      const viol0 = vlen(vsub(pivot.translation(), anchorB()));
      expect(viol0).toBeLessThan(1e-6);

      // (4) RUN, and scan for the things that would invalidate everything else.
      let contacts = 0, maxViol = 0, minR = Infinity, maxR = -Infinity, maxUserF = 0, maxContrib = 0;
      for (let i = 0; i < 600; i++) {
        sim.tickOnce();
        w.contactPairsWith(bc, () => { contacts++; });
        w.contactPairsWith(sim.body('ground').collider(0), () => { contacts++; });
        w.contactPairsWith(pivot.collider(0), () => { contacts++; });
        maxViol = Math.max(maxViol, vlen(vsub(pivot.translation(), anchorB())));
        const r = vlen(vsub(bob.translation(), pivot.translation()));
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        maxUserF = Math.max(maxUserF, vlen(bob.userForce()));
        maxContrib = Math.max(maxContrib, sim.registry.contributions.length);
      }

      // (5) RIGID-ARM CO-ROTATION: the hinge really does tie the bob's spin to the arm
      //     angle, which is what makes this a PHYSICAL pendulum rather than a point mass.
      const rel = vsub(bob.translation(), pivot.translation());
      const v = bob.linvel();
      const armRate = (rel.x * v.y - rel.y * v.x) / (rel.x * rel.x + rel.y * rel.y);

      log(`F1 theta0=${deg}deg: contacts ${contacts} | max anchor violation ${maxViol.toExponential(3)} m | `
        + `arm length ${minR.toFixed(9)}..${maxR.toFixed(9)} (L = ${PENDULUM.L}) | max |userForce| ${maxUserF.toExponential(3)} N | `
        + `max registry contributions ${maxContrib} | foreign accumulator writes ${sim.foreignAccumulatorWrites} | `
        + `owned dissipation ${(sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper).toExponential(3)} J | `
        + `arm rate ${armRate.toFixed(9)} vs bob spin ${bob.angvel().z.toFixed(9)} rad/s `
        + `(difference ${Math.abs(armRate - bob.angvel().z).toExponential(3)})`);

      expect(contacts).toBe(0);                          // NO stray contact anywhere
      expect(maxUserF).toBe(0);                          // vacuum, no spring: no force of ours at all
      expect(maxContrib).toBe(0);
      expect(sim.foreignAccumulatorWrites).toBe(0);
      expect(sim.budget.dissipatedDrag + sim.budget.dissipatedSpringDamper).toBe(0);
      expect(maxViol).toBeLessThan(1e-3);                // the joint holds, to sub-millimetre
      expect(minR).toBeGreaterThan(PENDULUM.L - 1e-3);   // the arm neither stretches nor collapses
      expect(maxR).toBeLessThan(PENDULUM.L + 1e-3);
      expect(Math.abs(armRate - bob.angvel().z)).toBeLessThan(0.01);
    }
    log('F1 VERDICT: NO FIXTURE DEFECT. No contact, no engine damping, no sleep, no CCD, mass and inertia '
      + 'exactly as the card assumed, anchors coincident at release and held to sub-millimetre, and the bob '
      + 'co-rotates with the arm. The large-amplitude period error is therefore NOT explained by the fixture. '
      + 'NARROW: this rules the fixture out for THIS scene at THIS configuration; it establishes nothing about '
      + 'any other adapter, fixture or mechanism.');
  }, 300_000);

  test('F1b the engine assumption demos 4 and 5 declare is READ BACK, not assumed', () => {
    const sim = new SimWorld();
    sim.build(collisionScene(0.6));
    const c = sim.body('ballA').collider(0);
    log(`F1b Rapier coefficient combine rules: friction ${c.frictionCombineRule()}, `
      + `restitution ${c.restitutionCombineRule()} (0 = Average). Both colliders of every pair in demos 4 and 5 `
      + 'are authored EQUAL, so Average, Min and Max all return the authored coefficient — and a measured e^2 or '
      + 'mu^2 would falsify the assumption instead of hiding inside it.');
    expect(c.frictionCombineRule()).toBe(0);
    expect(c.restitutionCombineRule()).toBe(0);
  });
});

/** World-frame rotation of a body-local vector. Local to this witness. */
function qrotLocal(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
