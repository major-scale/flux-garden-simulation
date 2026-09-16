/**
 * BB1 stage one — THE MINIMAL MEASUREMENT PATH.
 *
 * ===========================================================================
 * WHAT THIS IS, AND DELIBERATELY WHAT IT IS NOT
 * ===========================================================================
 * It is: tick/time + a NAMED SI QUANTITY + a BODY-OR-WORLD REFERENCE, a BOUNDED
 * sample buffer, and a reset. One live plot consumes it (`ui/plot.ts`).
 *
 * It is NOT a universal "plot any quantity" expression language, and it is NOT a
 * ruler-and-protractor suite. The brief rules both out, and both would be a
 * library designed in advance of a consumer. The catalogue below is a CLOSED,
 * ENUMERATED set of quantities, each of which an actual stage-one demo reads.
 * Adding one means adding a row here with its unit and its reference — not
 * writing a parser.
 *
 * *** A PLOT ALONE IS NOT GUIDED INQUIRY. *** Every quantity below therefore
 * carries the ANALYTIC REFERENCE it is meant to be compared against, when the
 * demo that reads it has one, so the instrument makes a comparison possible
 * rather than just drawing a line. Where there is no closed form — the air
 * projectile — the reference is explicitly `null` and the UI says so.
 *
 * UNITS ARE SI AND DECLARED, per `units.ts`. Every sample carries the unit of
 * the quantity that produced it; nothing is plotted without one.
 */

import { temperature, supportedTemperature } from './thermal';
import type { SimWorld } from '../sim/world';
import { SI, vdot, vlen, vsub, type Vec3 } from './units';

/** The reference frame a measurement is taken against. Never implicit. */
export type MeasureRef =
  | { kind: 'world' }
  | { kind: 'body'; entityId: string }
  /** A body's state relative to a fixed world point, e.g. a hinge pivot. */
  | { kind: 'bodyRelativeToPoint'; entityId: string; point: Vec3 }
  /**
   * A body's state along a FIXED WORLD AXIS from a fixed world point. Added for
   * demo 5, whose observable lives on a tilted line and cannot be read off any
   * world axis; demo 4 is its second consumer, reading each ball's velocity
   * along +X. `axis` must be a unit vector; it is not normalised behind the
   * author's back, exactly as a joint axis is not.
   */
  | { kind: 'bodyAlongAxis'; entityId: string; point: Vec3; axis: Vec3 }
  /** The whole world, resolved along a fixed axis. Demo 4's momentum sum. */
  | { kind: 'worldAlongAxis'; axis: Vec3 };

export interface Sample {
  /** Simulation tick. The authoritative clock. */
  tick: number;
  /** s. tick / 60 — derived, never a wall clock. */
  t: number;
  /** The measured value, in `quantity.unit`. */
  value: number;
}

export interface QuantityDef {
  key: string;
  /** Human label, e.g. "height above launch". */
  label: string;
  /** SI unit symbol, e.g. "m", "m/s", "J", "rad". */
  unit: string;
  /** Read one value. Returns null when the reference is not currently resolvable. */
  read: (sim: SimWorld, ref: MeasureRef) => number | null;
}

/**
 * BOUNDED. The buffer is a ring: once full, the oldest sample is dropped. There
 * is deliberately no unbounded history and no per-sub-step row — the same
 * discipline the hand's diagnostic buffers already follow.
 */
export const MEASURE_CAPACITY = 1800;   // samples = 30 s at one per tick

// ---------------------------------------------------------------------------
// THE CLOSED CATALOGUE. One row per quantity an actual demo reads.
// ---------------------------------------------------------------------------

function body(sim: SimWorld, ref: MeasureRef): { id: string } | null {
  if (ref.kind === 'world' || ref.kind === 'worldAlongAxis') return null;
  if (!sim.entities.has(ref.entityId)) return null;
  return { id: ref.entityId };
}

export const QUANTITIES: readonly QuantityDef[] = [
  /**
   * BATCH 4 — the two electrical observables a comparison actually needs. Both are
   * WORLD-scoped, because they are properties of the one circuit, not of a body.
   * Receiver temperature is already covered by `thermal.T` on the receiving body.
   * A REJECTED electrical solve reads as null rather than as a stale last-good value.
   */
  {key:'elec.supplied',label:'energy supplied by the ideal external source',unit:'J',read:(sim,ref)=>{
    if(ref.kind!=='world'||!sim.construction?.circuit)return null;
    return Number.isFinite(sim.electrical.suppliedEnergy)?sim.electrical.suppliedEnergy:null;
  }},
  {key:'elec.P',label:'total resistor dissipated power',unit:'W',read:(sim,ref)=>{
    if(ref.kind!=='world'||!sim.construction?.circuit||!sim.circuitSolution||sim.electrical.rejected)return null;
    const p=sim.circuitSolution.resistorPowerTotal;return Number.isFinite(p)?p:null;
  }},
  {key:'thermal.T',label:'damper housing temperature',unit:'K',read:(sim,ref)=>{
    if(ref.kind!=='body')return null;const b=sim.thermal.bodies.find(b=>b.id===ref.entityId),t=sim.entities.get(ref.entityId)?.desc.thermal;
    if(!b||!t)return null;const value=temperature(t,b.heat);return supportedTemperature(value)?value:null;
  }},
  {key:'thermal.Q',label:'thermal energy change',unit:'J',read:(sim,ref)=>{
    if(ref.kind!=='body')return null;const b=sim.thermal.bodies.find(b=>b.id===ref.entityId);return b&&Number.isFinite(b.heat)?b.heat:null;
  }},
  {
    key: 'pos.x', label: 'position x', unit: 'm',
    read: (sim, ref) => { const b = body(sim, ref); return b ? sim.body(b.id).translation().x : null; },
  },
  {
    key: 'pos.y', label: 'height y', unit: 'm',
    read: (sim, ref) => { const b = body(sim, ref); return b ? sim.body(b.id).translation().y : null; },
  },
  {
    key: 'speed', label: 'speed |v|', unit: 'm/s',
    read: (sim, ref) => { const b = body(sim, ref); return b ? vlen(sim.body(b.id).linvel()) : null; },
  },
  {
    key: 'vel.y', label: 'vertical velocity', unit: 'm/s',
    read: (sim, ref) => { const b = body(sim, ref); return b ? sim.body(b.id).linvel().y : null; },
  },
  {
    /** Signed angle from the DOWNWARD vertical, in the XY plane, about a fixed point. */
    key: 'angle', label: 'angle from downward vertical', unit: 'rad',
    read: (sim, ref) => {
      if (ref.kind !== 'bodyRelativeToPoint' || !sim.entities.has(ref.entityId)) return null;
      const t = sim.body(ref.entityId).translation();
      return Math.atan2(t.x - ref.point.x, -(t.y - ref.point.y));
    },
  },
  {
    /** Signed displacement along +X from a fixed point. The slider demo's observable. */
    key: 'disp.x', label: 'displacement along the slider axis', unit: 'm',
    read: (sim, ref) => {
      if (ref.kind === 'bodyRelativeToPoint' && sim.entities.has(ref.entityId)) {
        return sim.body(ref.entityId).translation().x - ref.point.x;
      }
      const b = body(sim, ref);
      return b ? sim.body(b.id).translation().x : null;
    },
  },
  {
    /** Signed displacement of a body from a fixed point, resolved along a fixed axis. */
    key: 'along.disp', label: 'displacement along the declared axis', unit: 'm',
    read: (sim, ref) => {
      if (ref.kind !== 'bodyAlongAxis' || !sim.entities.has(ref.entityId)) return null;
      return vdot(vsub(sim.body(ref.entityId).translation(), ref.point), ref.axis);
    },
  },
  {
    /** Signed velocity of a body resolved along a fixed axis. */
    key: 'along.vel', label: 'velocity along the declared axis', unit: 'm/s',
    read: (sim, ref) => {
      if (ref.kind !== 'bodyAlongAxis' || !sim.entities.has(ref.entityId)) return null;
      return vdot(sim.body(ref.entityId).linvel(), ref.axis);
    },
  },
  {
    /**
     * TOTAL LINEAR MOMENTUM of every DYNAMIC body, along a fixed axis. Fixed
     * bodies are excluded because they have no finite mass to carry momentum in
     * this engine: including them would report a number that is not the system's.
     */
    key: 'p.along', label: 'total momentum of the dynamic bodies along the declared axis', unit: 'kg·m/s',
    read: (sim, ref) => {
      if (ref.kind !== 'worldAlongAxis') return null;
      let p = 0;
      for (const id of sim.dynamicIds()) p += sim.runtime(id).mass * vdot(sim.body(id).linvel(), ref.axis);
      return p;
    },
  },
  {
    key: 'E.total', label: 'resolved mechanical energy E_mech', unit: 'J',
    read: (sim) => sim.budget.current.total,
  },
  {
    key: 'E.kinetic', label: 'kinetic energy (translational + rotational)', unit: 'J',
    read: (sim) => sim.budget.current.keTranslational + sim.budget.current.keRotational,
  },
  {
    key: 'E.spring', label: 'declared spring potential ½kx²', unit: 'J',
    read: (sim) => sim.budget.current.springPotential,
  },
  {
    key: 'E.unattributed', label: 'UNATTRIBUTED remainder', unit: 'J',
    read: (sim) => sim.budget.unattributed,
  },
] as const;

export function quantity(key: string): QuantityDef {
  const q = QUANTITIES.find((x) => x.key === key);
  if (!q) throw new Error(`no such measured quantity: ${key}`);
  return q;
}

/**
 * An ANALYTIC REFERENCE a demo supplies alongside a measured quantity, so the
 * plot shows a comparison and not just a line. `null` where there is no closed
 * form — which is the honest answer for the air projectile.
 */
export interface AnalyticReference {
  label: string;
  /** value at simulated time t, in the measured quantity's unit. */
  at: (t: number) => number;
}

/**
 * ONE METER: one quantity, one reference, one bounded buffer, one reset.
 *
 * It is a pure observer. It never writes to the simulation, so it is not part of
 * the declared replay state and adding it cannot change any recorded run.
 */
export class Meter {
  samples: Sample[] = [];
  /** Set by whoever creates the meter. Reported in the plot's caption. */
  analytic: AnalyticReference | null = null;
  private lastTick = -1;

  constructor(
    public quantityKey: string,
    public ref: MeasureRef,
    public capacity: number = MEASURE_CAPACITY,
  ) {}

  get def(): QuantityDef { return quantity(this.quantityKey); }
  get unit(): string { return this.def.unit; }
  get label(): string { return this.def.label; }

  /** Human description of what is being measured against what. */
  describeRef(): string {
    switch (this.ref.kind) {
      case 'world': return 'the world';
      case 'body': return `body ${this.ref.entityId}`;
      case 'bodyRelativeToPoint':
        return `body ${this.ref.entityId} relative to world point `
          + `(${this.ref.point.x}, ${this.ref.point.y}, ${this.ref.point.z}) m`;
      case 'bodyAlongAxis':
        return `body ${this.ref.entityId} along axis `
          + `(${this.ref.axis.x.toFixed(6)}, ${this.ref.axis.y.toFixed(6)}, ${this.ref.axis.z.toFixed(6)}) `
          + `from world point (${this.ref.point.x.toFixed(4)}, ${this.ref.point.y.toFixed(4)}, ${this.ref.point.z.toFixed(4)}) m`;
      case 'worldAlongAxis':
        return `the world along axis `
          + `(${this.ref.axis.x.toFixed(6)}, ${this.ref.axis.y.toFixed(6)}, ${this.ref.axis.z.toFixed(6)})`;
    }
  }

  /**
   * Take at most ONE sample per public tick. Called after the tick has advanced.
   * Re-entry within the same tick is a no-op, so a repainted UI cannot inflate
   * the series.
   */
  sample(sim: SimWorld): void {
    if (sim.tick === this.lastTick) return;
    this.lastTick = sim.tick;
    const v = this.def.read(sim, this.ref);
    if (v === null || !Number.isFinite(v)) return;
    this.samples.push({ tick: sim.tick, t: sim.tick * SI.DT, value: v });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  /** Empty the buffer. The reset the brief asks for. */
  reset(): void { this.samples.length = 0; this.lastTick = -1; }

  /** Value range over the retained samples, for the plot's autoscale. */
  extent(): { tMin: number; tMax: number; vMin: number; vMax: number } | null {
    if (!this.samples.length) return null;
    let vMin = Infinity, vMax = -Infinity;
    for (const s of this.samples) { if (s.value < vMin) vMin = s.value; if (s.value > vMax) vMax = s.value; }
    return { tMin: this.samples[0].t, tMax: this.samples[this.samples.length - 1].t, vMin, vMax };
  }
}

// ---------------------------------------------------------------------------
// Estimators the witnesses and the demos share. They embed NO physical model:
// each is ordinary interpolation on a uniformly sampled series.
// ---------------------------------------------------------------------------

/**
 * The time at which a series crosses `level`, between the two samples that
 * bracket it, by QUADRATIC interpolation through three consecutive samples —
 * exact for a series that is quadratic in t, which a constant-acceleration
 * trajectory under semi-implicit Euler provably is.
 *
 * `after` skips crossings at or before that time. Returns null if none.
 */
export function crossingQuadratic(s: readonly Sample[], level: number, after = -Infinity): number | null {
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1].t <= after) continue;
    const a = s[i - 1].value - level, b = s[i].value - level;
    if (a === 0) return s[i - 1].t;
    if (a * b > 0) continue;
    // Three points centred on the bracket, clamped to the ends of the series.
    const j = Math.min(Math.max(i - 1, 1), s.length - 2);
    const p0 = s[j - 1], p1 = s[j], p2 = s[j + 1];
    const h = p1.t - p0.t;
    if (!(h > 0) || Math.abs((p2.t - p1.t) - h) > 1e-12) return crossingLinear(s, level, after);
    // y(u) = c0 + c1 u + c2 u^2 with u = (t - p1.t)/h
    const c0 = p1.value - level;
    const c1 = (p2.value - p0.value) / 2;
    const c2 = (p2.value - 2 * p1.value + p0.value) / 2;
    let u: number;
    if (Math.abs(c2) < 1e-14) {
      u = -c0 / c1;
    } else {
      const disc = c1 * c1 - 4 * c2 * c0;
      if (disc < 0) return crossingLinear(s, level, after);
      const r = Math.sqrt(disc);
      const u1 = (-c1 + r) / (2 * c2), u2 = (-c1 - r) / (2 * c2);
      // The root inside the bracketing interval [-1, 1] around p1.
      const cand = [u1, u2].filter((x) => x >= -1.0000001 && x <= 1.0000001);
      if (!cand.length) return crossingLinear(s, level, after);
      u = cand.reduce((m, x) => (Math.abs(x) < Math.abs(m) ? x : m), cand[0]);
    }
    const t = p1.t + u * h;
    if (t <= after) continue;
    return t;
  }
  return null;
}

/** The same crossing by LINEAR interpolation. Reported alongside, with its bias. */
export function crossingLinear(s: readonly Sample[], level: number, after = -Infinity): number | null {
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1].t <= after) continue;
    const a = s[i - 1].value - level, b = s[i].value - level;
    if (a === 0) return s[i - 1].t;
    if (a * b > 0) continue;
    return s[i - 1].t + (s[i].t - s[i - 1].t) * (a / (a - b));
  }
  return null;
}

export interface Peak { t: number; value: number; index: number; }

/**
 * Interior local maxima (`sign = +1`) or minima (`sign = -1`) of a uniformly
 * sampled series, each refined by parabolic interpolation through its three
 * samples. Ordinary interpolation; no physical model is assumed.
 */
export function peaks(s: readonly Sample[], sign: 1 | -1): Peak[] {
  const out: Peak[] = [];
  for (let i = 1; i < s.length - 1; i++) {
    const y0 = sign * s[i - 1].value, y1 = sign * s[i].value, y2 = sign * s[i + 1].value;
    if (!(y1 > y0 && y1 >= y2)) continue;
    const denom = y0 - 2 * y1 + y2;
    const du = denom === 0 ? 0 : 0.5 * (y0 - y2) / denom;
    const h = s[i].t - s[i - 1].t;
    out.push({
      t: s[i].t + du * h,
      value: sign * (y1 - 0.25 * (y0 - y2) * du),
      index: i,
    });
  }
  return out;
}

/** Ordinary least squares slope and intercept of y against x. */
export function olsSlope(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
