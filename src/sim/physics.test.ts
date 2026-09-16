/**
 * FP1 — behaviour tests A, B, C from EXPECTATIONS.md (sha256 d55e4ee0…).
 * Every threshold here is copied FROM that file, which was written and hashed
 * before any of this was run. Nothing here was tuned to an observed value.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { SimWorld } from './world';
import { runTicks } from './step';
import { applyEvent, type InputEvent } from './record';
import {
  defaultConstruction, maxDampingForSpring, maxStiffnessForSpring,
  type Construction, type EntityDesc,
} from '../model/construction';
import { dragK, effectiveArea, terminalSpeed } from '../model/drag';
import { LIMITS, MAX_GAMMA, MAX_OMEGA_N, vlen } from '../model/units';

beforeAll(async () => { await SimWorld.initEngine(); });

const Q_ID = { x: 0, y: 0, z: 0, w: 1 };
const V0 = { x: 0, y: 0, z: 0 };

function dropWorld(medium: 'air' | 'vacuum'): Construction {
  const cube: EntityDesc = {
    id: 'faller', label: 'faller', kinematics: 'dynamic',
    shape: { kind: 'box', hx: 0.25, hy: 0.25, hz: 0.25 },
    material: { mass: 0.5, restitution: 0.0, friction: 0.5 },
    translation: { x: 0, y: 60, z: 0 }, rotation: Q_ID, linvel: V0, angvel: V0, colour: 0xffffff,
  };
  const ground: EntityDesc = {
    id: 'ground', label: 'ground', kinematics: 'fixed',
    shape: { kind: 'box', hx: 50, hy: 0.5, hz: 50 },
    material: { mass: 0, restitution: 0, friction: 0.8 },
    translation: { x: 0, y: -0.5, z: 0 }, rotation: Q_ID, linvel: V0, angvel: V0, colour: 0x333333,
  };
  return {
    format: 'fp1-construction', formatVersion: 1, name: `drop-${medium}`,
    environment: { medium, gravity: { x: 0, y: -9.81, z: 0 } },
    entities: [ground, cube], springs: [], nextSerial: 1,
  };
}

describe('A — terminal velocity in air, and not in vacuum', () => {
  // Analytic values recomputed here from the same formulas the model uses, so the
  // test asserts against the DERIVATION, not against a literal.
  const kDrag = dragK({ kind: 'box', hx: 0.25, hy: 0.25, hz: 0.25 }, undefined, 1.225);
  const vT = terminalSpeed(0.5, kDrag);

  test('A0 the derived constants match what was written down beforehand', () => {
    expect(effectiveArea({ kind: 'box', hx: 0.25, hy: 0.25, hz: 0.25 })).toBeCloseTo(0.375, 12);
    expect(kDrag).toBeCloseTo(0.241171875, 12);
    expect(vT).toBeCloseTo(4.50978, 4);
  });

  test('A1/A4/A5 in air the block approaches v_t from below and flattens out', () => {
    const sim = new SimWorld();
    sim.build(dropWorld('air'));
    const speeds: number[] = [];
    for (let i = 0; i < 180; i++) { sim.tickOnce(); speeds.push(vlen(sim.body('faller').linvel())); }
    const v180 = speeds[179];
    const y = sim.body('faller').translation().y;

    console.log(`A: air v(3.00s) = ${v180.toFixed(6)} m/s   v_t = ${vT.toFixed(6)}   ratio ${(v180 / vT).toFixed(8)}   y = ${y.toFixed(4)} m`);

    // A1: within 1.0 % of 4.50978
    expect(v180).toBeGreaterThan(vT * 0.99);
    expect(v180).toBeLessThan(vT * 1.01);
    // A5: approached FROM BELOW, never overshooting
    expect(v180).toBeLessThan(vT);
    // A4: flattened out — last 0.5 s adds < 0.1 % of v_t
    expect(speeds[179] - speeds[149]).toBeLessThan(0.001 * vT);
    // monotone increasing
    for (let i = 1; i < 180; i++) expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    // and it never touched the ground, as designed
    expect(y).toBeGreaterThan(20);
  });

  test('A2/A3 in vacuum there is no terminal velocity', () => {
    const sim = new SimWorld();
    sim.build(dropWorld('vacuum'));
    runTicks(sim, 180);
    const v = vlen(sim.body('faller').linvel());
    const y = sim.body('faller').translation().y;
    console.log(`A: vacuum v(3.00s) = ${v.toFixed(6)} m/s   g·t = 29.430   y = ${y.toFixed(4)} m`);
    expect(Math.abs(v - 29.430) / 29.430).toBeLessThan(0.001);   // A2
    expect(y).toBeGreaterThan(5);

    const air = new SimWorld();
    air.build(dropWorld('air'));
    runTicks(air, 180);
    const ratio = v / vlen(air.body('faller').linvel());
    console.log(`A3: vacuum/air speed ratio = ${ratio.toFixed(4)} (predicted 6.526)`);
    expect(ratio).toBeGreaterThan(5);                             // A3
  });
});

/**
 * Spring rig helper: platform alone, vacuum, released from rest `amp` above the
 * analytic static equilibrium of the chosen stiffness.
 */
function springRig(kPerSpring: number, cPerSpring: number, amp = 0.15): { c: Construction; yEq: number; amp: number } {
  const c = defaultConstruction();
  c.environment.medium = 'vacuum';
  c.entities = c.entities.filter((e) => e.id === 'ground' || e.id === 'platform');
  for (const s of c.springs) { s.stiffness = kPerSpring; s.damping = cPerSpring; }
  const yEq = 0.96 - (20 * 9.81) / (4 * kPerSpring);       // derived, not observed
  c.entities.find((e) => e.id === 'platform')!.translation.y = yEq + amp;
  return { c, yEq, amp };
}

/**
 * THE INDEPENDENT PHYSICAL PREDICTION. A continuum linear oscillator, from the
 * authored k, c and m alone. It knows nothing about the integrator, so agreeing
 * with it is evidence about the physics and not about the scheme.
 */
function continuum(K: number, C: number, m: number) {
  const omegaN = Math.sqrt(K / m);
  const zeta = C / (2 * Math.sqrt(K * m));
  const omegaD = omegaN * Math.sqrt(1 - zeta * zeta);
  const T = (2 * Math.PI) / omegaD;
  const sigma = C / (2 * m);
  return { omegaN, zeta, omegaD, T, sigma, ratio: Math.exp(-sigma * T) };
}

/**
 * The DERIVED a-priori error of the corrected scheme (R-0): with our forces
 * refreshed on every internal sub-step and Rapier's own sub-division pinned to 1,
 * the 1-DOF sub-step map is symplectic Euler, det = 1 - h*gamma EXACTLY.
 * This is used only to check that the residual is the declared first-order term
 * (R-4d, R-5c). It is NOT what the physics is validated against.
 */
function schemeBound(K: number, C: number, m: number, M: number) {
  const h = 1 / 60 / M, gamma = C / m, w2 = K / m;
  const det = 1 - h * gamma;
  const lam = Math.sqrt(det);
  const theta = Math.acos((2 - h * gamma - h * h * w2) / (2 * lam));
  const sigma = -Math.log(lam) / h;
  const T = (2 * Math.PI * h) / theta;
  return { sigma, T, ratio: Math.exp(-sigma * T) };
}

interface Osc {
  crossings: number[];
  /** Parabolically interpolated positive peak amplitudes and their times. */
  peaks: number[];
  peakTimes: number[];
  period: number;
  ratio: number;
  /** s^-1, least-squares slope of ln(peak) against peak time (R-2b as declared). */
  sigmaFromPeaks: number;
  /** s^-1 and rad/s, from a 3-term linear recurrence identified on the samples. */
  sigmaId: number;
  omegaDId: number;
  periodId: number;
  samples: number[];
}

function run(sim: SimWorld, yEq: number, ticks: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < ticks; i++) { sim.tickOnce(); ys.push(sim.body('platform').translation().y - yEq); }
  return ys;
}

/**
 * ESTIMATORS ONLY — none of these embeds a physical model.
 *
 * `sigmaId` / `omegaDId` identify the 3-term linear recurrence
 *     y[n+1] = a*y[n] + b*y[n-1] + c
 * that the samples satisfy, by ordinary least squares, and read the decay and
 * frequency out of its roots. For a uniformly sampled damped sinusoid this is
 * exact to machine precision at ANY sampling density above 2 samples/period, so
 * it stays honest on the sparsely-sampled stiff rigs where peak interpolation
 * would not. The constant term absorbs any equilibrium offset.
 */
function analyse(ys: number[], dt = 1 / 60, y0 = 0.15): Osc {
  const crossings: number[] = [];
  let prev = y0;
  for (let i = 0; i < ys.length; i++) {
    if ((prev > 0 && ys[i] <= 0) || (prev < 0 && ys[i] >= 0)) {
      const f = prev / (prev - ys[i]);
      crossings.push((i + f) * dt);
    }
    prev = ys[i];
  }
  const peaks: number[] = [], peakTimes: number[] = [];
  for (let i = 1; i < ys.length - 1; i++) {
    if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1] && ys[i] > 0) {
      const denom = ys[i - 1] - 2 * ys[i] + ys[i + 1];
      const d = denom !== 0 ? (0.5 * (ys[i - 1] - ys[i + 1])) / denom : 0;
      peaks.push(ys[i] - 0.25 * (ys[i - 1] - ys[i + 1]) * d);
      peakTimes.push((i + d) * dt);
    }
  }
  // R-2b: least squares of ln(peak) against time.
  let sigmaFromPeaks = NaN;
  if (peaks.length >= 3) {
    const n = peaks.length;
    const mt = peakTimes.reduce((a, b) => a + b, 0) / n;
    const ml = peaks.reduce((a, b) => a + Math.log(b), 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const dx = peakTimes[i] - mt; sxy += dx * (Math.log(peaks[i]) - ml); sxx += dx * dx; }
    sigmaFromPeaks = -sxy / sxx;
  }
  // Recurrence identification.
  let sigmaId = NaN, omegaDId = NaN;
  if (ys.length >= 8) {
    const A: number[][] = [], rhs: number[] = [];
    for (let i = 1; i < ys.length - 1; i++) { A.push([ys[i], ys[i - 1], 1]); rhs.push(ys[i + 1]); }
    const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (let r = 0; r < A.length; r++) {
      for (let i = 0; i < 3; i++) { v[i] += A[r][i] * rhs[r]; for (let j = 0; j < 3; j++) N[i][j] += A[r][i] * A[r][j]; }
    }
    const sol = solve3(N, v);
    if (sol) {
      const [a, b] = sol;
      const rho2 = -b;
      if (rho2 > 0) {
        const rho = Math.sqrt(rho2);
        sigmaId = -Math.log(rho) / dt;
        const cos = a / (2 * rho);
        if (cos >= -1 && cos <= 1) omegaDId = Math.acos(cos) / dt;
      }
    }
  }
  const nHalf = crossings.length - 1;
  return {
    crossings, peaks, peakTimes,
    period: (2 * (crossings[nHalf] - crossings[0])) / nHalf,
    ratio: peaks[1] / peaks[0],
    sigmaFromPeaks, sigmaId, omegaDId, periodId: (2 * Math.PI) / omegaDId,
    samples: ys,
  };
}

function solve3(M: number[][], v: number[]): number[] | null {
  const a = M.map((r, i) => [...r, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

const pct = (got: number, want: number): number => (100 * (got - want)) / want;

/**
 * B / R-2..R-6 — THE SPRING, VALIDATED AGAINST THE CONTINUUM MODEL.
 *
 * The pre-fix build failed the continuum decay prediction by +28.9 % (D-1) and
 * the shipped test then asserted the discrete map instead, which protected the
 * artifact. That record stands in DEVIATIONS.md. What follows validates the
 * corrected integration against the INDEPENDENT physical prediction, with the
 * tolerances written down in EXPECTATIONS-FP1R.md before anything was run.
 */
describe('B / R-2..R-6 — the spring decays at the CONTINUUM rate', () => {
  test('R-2 rig 1 (K=3200, C=40, m=20) against the continuum model', () => {
    const cont = continuum(3200, 40, 20);
    // The continuum constants must be the ones written down beforehand.
    expect(cont.T).toBeCloseTo(0.49828901, 7);
    expect(cont.sigma).toBeCloseTo(1.0, 12);
    expect(cont.ratio).toBeCloseTo(0.60756932, 7);
    expect(cont.zeta).toBeLessThan(1);                                   // underdamped

    const { c, yEq } = springRig(800, 10);
    expect(yEq).toBeCloseTo(0.8986875, 10);
    const sim = new SimWorld();
    sim.build(c);
    expect(sim.subSteps).toBe(4);
    const o = analyse(run(sim, yEq, 180));

    console.log(`R-2  peaks ${o.peaks.slice(0, 4).map((p) => p.toFixed(6)).join(', ')}`);
    console.log(`R-2a period    ${o.period.toFixed(6)} s   continuum ${cont.T.toFixed(6)}   dev ${pct(o.period, cont.T).toFixed(3)}%  (tol 1.5%, derived -0.219%)`);
    console.log(`R-2b sigma     ${o.sigmaFromPeaks.toFixed(6)} /s  continuum ${cont.sigma.toFixed(6)}   dev ${pct(o.sigmaFromPeaks, cont.sigma).toFixed(3)}%  (tol 3%, derived +0.419%)`);
    console.log(`     sigma_id  ${o.sigmaId.toFixed(6)} /s  omega_d_id ${o.omegaDId.toFixed(6)} rad/s (continuum ${cont.omegaD.toFixed(6)})`);
    console.log(`R-2c ratio     ${o.ratio.toFixed(6)}      continuum ${cont.ratio.toFixed(6)}     dev ${pct(o.ratio, cont.ratio).toFixed(3)}%  (tol 2%, derived -0.099%)`);
    console.log(`     PRE-FIX this rig gave ratio 0.782975 = +28.9% — outside this 2% band. See D-1/D-8 in DEVIATIONS.md.`);

    expect(Math.abs(pct(o.period, cont.T))).toBeLessThan(1.5);            // R-2a
    expect(o.peaks.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(pct(o.sigmaFromPeaks, cont.sigma))).toBeLessThan(3);  // R-2b
    expect(Math.abs(pct(o.ratio, cont.ratio))).toBeLessThan(2);           // R-2c
    // R-2d still underdamped
    expect(analyse(o.samples.slice(0, 120)).crossings.length).toBeGreaterThanOrEqual(7);
    expect(o.ratio).toBeGreaterThan(0);
    expect(o.ratio).toBeLessThan(1);
    // and the band really does exclude the artifact it was written to catch
    expect(Math.abs(pct(0.782975, cont.ratio))).toBeGreaterThan(2);
  });

  test('R-3 rig 2 (K=1600, C=20, m=20) against the continuum model', () => {
    const cont = continuum(1600, 20, 20);
    expect(cont.T).toBeCloseTo(0.70358168, 7);
    expect(cont.sigma).toBeCloseTo(0.5, 12);
    expect(cont.ratio).toBeCloseTo(0.70342724, 7);

    const { c, yEq } = springRig(400, 5);
    expect(yEq).toBeCloseTo(0.837375, 9);
    const sim = new SimWorld();
    sim.build(c);
    const o = analyse(run(sim, yEq, 240));

    console.log(`R-3a period ${o.period.toFixed(6)} s  continuum ${cont.T.toFixed(6)}  dev ${pct(o.period, cont.T).toFixed(3)}%  (tol 1.5%, derived -0.110%)`);
    console.log(`R-3b sigma  ${o.sigmaFromPeaks.toFixed(6)} /s continuum ${cont.sigma.toFixed(6)} dev ${pct(o.sigmaFromPeaks, cont.sigma).toFixed(3)}%  (tol 3%, derived +0.209%)`);
    console.log(`R-3c ratio  ${o.ratio.toFixed(6)}     continuum ${cont.ratio.toFixed(6)}    dev ${pct(o.ratio, cont.ratio).toFixed(3)}%  (tol 2%, derived -0.035%)`);
    console.log(`     PRE-FIX this rig gave ratio 0.838756 = +19.2% — outside this 2% band.`);

    expect(Math.abs(pct(o.period, cont.T))).toBeLessThan(1.5);            // R-3a
    expect(Math.abs(pct(o.sigmaFromPeaks, cont.sigma))).toBeLessThan(3);  // R-3b
    expect(Math.abs(pct(o.ratio, cont.ratio))).toBeLessThan(2);           // R-3c
    expect(Math.abs(pct(0.838756, cont.ratio))).toBeGreaterThan(2);
  });

  test('R-4 CONVERGENCE IN THE STEP: the error is first order in h and goes to zero', () => {
    const cont = continuum(3200, 40, 20);
    const rows: Array<{ M: number; sigma: number; err: number; errM: number; derived: number }> = [];
    for (const M of [1, 2, 4, 8, 16]) {
      const { c, yEq } = springRig(800, 10);
      const sim = new SimWorld();
      // BB1-S2: `build()` is now AUTHORITATIVE over the sub-step count, because the
      // construction declares it (absent = the legacy 4). A convergence study that
      // sweeps M outside the declared supported set still does so through the
      // setter — but AFTER the build, not before it. Nothing about this run
      // changes: `build` only creates bodies, and the setter reconfigures the step
      // before the first tick. The assertion below is unchanged.
      sim.build(c);
      sim.subSteps = M;
      expect(sim.subSteps).toBe(M);
      const o = analyse(run(sim, yEq, 180));
      const err = Math.abs(pct(o.sigmaId, cont.sigma));
      rows.push({ M, sigma: o.sigmaId, err, errM: err * M, derived: schemeBound(3200, 40, 20, M).sigma });
    }
    for (const r of rows) {
      console.log(`R-4  M=${String(r.M).padStart(2)}  h=${(1000 / 60 / r.M).toFixed(4)} ms  sigma ${r.sigma.toFixed(6)}  err ${r.err.toFixed(4)}%  err*M ${r.errM.toFixed(4)}  derived-map sigma ${r.derived.toFixed(6)}`);
    }
    // R-4a strictly decreasing
    for (let i = 1; i < rows.length; i++) expect(rows[i].err).toBeLessThan(rows[i - 1].err);
    // R-4b first order: err*M constant to within +/-20% of its value at M=4
    const ref = rows.find((r) => r.M === 4)!.errM;
    for (const r of rows) expect(Math.abs(r.errM - ref) / ref).toBeLessThan(0.20);
    // R-4c the limit is approached
    expect(rows[rows.length - 1].err).toBeLessThan(0.35);
    // R-4d the residual is the DERIVED first-order term, not something unmodelled
    for (const r of rows) expect(Math.abs(pct(r.sigma, r.derived))).toBeLessThan(1);
  });

  test('R-5 CONVERGENCE ACROSS THE OFFERED REGIME (declared grid, not a sweep)', () => {
    const ks = [200, 800, 3200, 12800];
    const cs = [2, 10, 40];
    let n = 0;
    for (const k of ks) {
      for (const cc of cs) {
        const K = 4 * k, C = 4 * cc, m = 20;
        const cont = continuum(K, C, m);
        // every grid point must be INSIDE the declared resolvable regime
        expect(cont.omegaN).toBeLessThanOrEqual(MAX_OMEGA_N);
        expect(C / m).toBeLessThanOrEqual(MAX_GAMMA);
        expect(cont.zeta).toBeLessThan(1);
        // release inside the static tension margin so the rig cannot enter the
        // compressed (buckling) branch recorded as D-3
        const amp = Math.min(0.15, 0.5 * ((m * 9.81) / K));
        const { c, yEq } = springRig(k, cc, amp);
        const sim = new SimWorld();
        sim.build(c);
        const o = analyse(run(sim, yEq, 180), 1 / 60, amp);
        const eS = pct(o.sigmaId, cont.sigma);
        const eT = pct(o.periodId, cont.T);
        const b = schemeBound(K, C, m, 4);
        const bS = pct(b.sigma, cont.sigma), bT = pct(b.T, cont.T);
        console.log(`R-5 k=${String(k).padStart(5)} c=${String(cc).padStart(2)}  omega_n ${cont.omegaN.toFixed(2)}  zeta ${cont.zeta.toFixed(4)}  `
          + `sigma ${eS.toFixed(3)}% (derived ${bS.toFixed(3)}%)   T ${eT.toFixed(3)}% (derived ${bT.toFixed(3)}%)`);
        expect(Math.abs(eS)).toBeLessThanOrEqual(5);              // R-5a
        expect(Math.abs(eT)).toBeLessThanOrEqual(3);              // R-5b
        expect(Math.abs(eS - bS)).toBeLessThanOrEqual(2);         // R-5c
        expect(Math.abs(eT - bT)).toBeLessThanOrEqual(2);         // R-5c
        n++;
      }
    }
    expect(n).toBe(12);
  });

  test('R-6 the UNATTRIBUTED remainder, still unattributed', () => {
    for (const [k, cc, label] of [[800, 10, 'rig1'], [400, 5, 'rig2']] as const) {
      const { c, yEq } = springRig(k, cc);
      const sim = new SimWorld();
      sim.build(c);
      const e0 = sim.budget.current.total;
      run(sim, yEq, 180);
      const owned = sim.budget.dissipatedSpringDamper + sim.budget.dissipatedDrag;
      const frac = sim.budget.unattributed / owned;
      console.log(`R-6 ${label}: E_mech ${e0.toFixed(4)} -> ${sim.budget.current.total.toFixed(4)} J; owned ${owned.toFixed(4)} J; `
        + `UNATTRIBUTED ${sim.budget.unattributed.toFixed(4)} J = ${(100 * frac).toFixed(2)}% of owned (tol 10%; PRE-FIX +49.75% / +50.12%, D-2)`);
      expect(sim.budget.dissipatedDrag).toBeCloseTo(0, 9);   // vacuum
      expect(Math.abs(frac)).toBeLessThan(0.10);             // R-6a
    }
  });

  test('R-1 the offered spring regime is the RESOLVED regime, and edits outside are REFUSED', () => {
    const sim = new SimWorld();
    sim.build(defaultConstruction());
    const mPlatform = sim.runtime('platform').mass;
    const kLimit = Math.floor((mPlatform * MAX_OMEGA_N * MAX_OMEGA_N) / 4);
    const cLimit = Math.floor((mPlatform * MAX_GAMMA) / 4);
    console.log(`R-1 platform ${mPlatform.toFixed(3)} kg on 4 springs: k <= ${kLimit} N/m each, c <= ${cLimit} N·s/m each `
      + `(omega_n <= ${MAX_OMEGA_N.toFixed(1)} rad/s, gamma <= ${MAX_GAMMA.toFixed(1)} /s at h = ${(1000 / 240).toFixed(3)} ms)`);
    const ev = (kind: 'setStiffness' | 'setDamping', target: string, value: number): InputEvent =>
      (kind === 'setStiffness'
        ? { tick: 0, seq: 0, wallClockMs: 0, kind, target, stiffness: value }
        : { tick: 0, seq: 0, wallClockMs: 0, kind, target, damping: value });

    // inside: accepted
    expect(applyEvent(sim, ev('setStiffness', 'spring0', 20000))).toBeNull();
    expect(applyEvent(sim, ev('setStiffness', 'spring0', 800))).toBeNull();
    // outside: REFUSED and surfaced, never clamped
    const rK = applyEvent(sim, ev('setStiffness', 'spring0', 200000));   // the OLD UI maximum
    const rC = applyEvent(sim, ev('setDamping', 'spring0', 5000));
    console.log(`R-1a refusal (k) : ${String(rK)}`);
    console.log(`R-1a refusal (c) : ${String(rC)}`);
    expect(rK).not.toBeNull();
    expect(String(rK)).toMatch(/omega_n/);
    expect(rC).not.toBeNull();
    expect(String(rC)).toMatch(/gamma/);
    expect(sim.springs.find((s) => s.id === 'spring0')!.stiffness).toBe(800);   // not clamped
    expect(sim.springs.find((s) => s.id === 'spring0')!.damping).toBe(10);
    // the UI's own maxima come from the same limit
    const massOf = (id: string): number | undefined => sim.entities.get(id)?.mass;
    expect(maxStiffnessForSpring(sim.springs, 'spring0', massOf)).toBeLessThan(LIMITS.stiffnessMax);
    expect(maxDampingForSpring(sim.springs, 'spring0', massOf)).toBeLessThan(LIMITS.dampingMax);
    console.log(`R-1a UI maxima for spring0: k ${maxStiffnessForSpring(sim.springs, 'spring0', massOf)} N/m, `
      + `c ${maxDampingForSpring(sim.springs, 'spring0', massOf)} N·s/m (was ${LIMITS.stiffnessMax} / ${LIMITS.dampingMax}, never validated)`);
    // a mass edit that would leave the regime is refused too
    const rM = applyEvent(sim, { tick: 0, seq: 0, wallClockMs: 0, kind: 'setMass', target: 'platform', mass: 0.5 });
    console.log(`R-1a refusal (m) : ${String(rM)}`);
    expect(rM).not.toBeNull();
    expect(String(rM)).toMatch(/omega_n|gamma/);
  });
});

describe('C — a stack topples given suitable geometry and impulse', () => {
  test('C1..C5', () => {
    const sim = new SimWorld();
    sim.build(defaultConstruction());
    runTicks(sim, 120);   // settle 2.0 s

    const ids = ['stack0', 'stack1', 'stack2'];
    const before = ids.map((id) => ({ id, t: { ...sim.body(id).translation() }, r: { ...sim.body(id).rotation() } }));
    const mid = sim.body('stack1');
    const com = mid.worldCom();

    const nInterventionsBefore = sim.budget.interventions.length;
    const refusal = applyEvent(sim, {
      tick: sim.tick, seq: 0, wallClockMs: 0, kind: 'push', target: 'stack1',
      impulse: { x: 2.5, y: 0, z: 0 }, point: { x: com.x, y: com.y + 0.12, z: com.z },
    });
    expect(refusal).toBeNull();

    const iv = sim.budget.interventions[nInterventionsBefore];
    console.log(`C5: intervention ${iv.kind} on ${iv.target}: dE_mech = ${iv.deltaEmech.toFixed(4)} J (predicted ~7.81, band [7.0, 8.7])`);
    console.log(`    immediately after: v_x = ${mid.linvel().x.toFixed(4)} m/s (predicted 2.5), omega_z = ${mid.angvel().z.toFixed(4)} rad/s (predicted -31.25)`);
    expect(iv.kind).toBe('push');
    expect(iv.deltaEmech).toBeGreaterThan(7.0);   // C5
    expect(iv.deltaEmech).toBeLessThan(8.7);      // C5

    runTicks(sim, 180);   // 3.0 s after the impulse

    const disp = ids.map((id, i) => {
      const t = sim.body(id).translation();
      return Math.hypot(t.x - before[i].t.x, t.z - before[i].t.z);
    });
    const tilts = ids.map((id, i) => {
      const q = sim.body(id).rotation(), q0 = before[i].r;
      const dot = Math.abs(q.x * q0.x + q.y * q0.y + q.z * q0.z + q.w * q0.w);
      return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    });
    const yNowMax = Math.max(...ids.map((id) => sim.body(id).translation().y));
    const yBeforeMax = Math.max(...before.map((b) => b.t.y));

    console.log(`C1: horizontal displacements = ${disp.map((d) => d.toFixed(3)).join(', ')} m (max must be > 0.30)`);
    console.log(`C2: tilts = ${tilts.map((t) => t.toFixed(1)).join(', ')} deg (max must be > 45)`);
    console.log(`C3: highest stack block ${yBeforeMax.toFixed(3)} -> ${yNowMax.toFixed(3)} m (must drop > 0.20)`);
    console.log(`C4: blocks displaced > 0.10 m = ${disp.filter((d) => d > 0.10).length} (must be >= 2)`);

    expect(Math.max(...disp)).toBeGreaterThan(0.30);        // C1
    expect(Math.max(...tilts)).toBeGreaterThan(45);         // C2
    expect(yBeforeMax - yNowMax).toBeGreaterThan(0.20);     // C3
    expect(disp.filter((d) => d > 0.10).length).toBeGreaterThanOrEqual(2);  // C4
  });
});
