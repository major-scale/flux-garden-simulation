/**
 * READING THE TRANSISTOR AND THE LAMP from a solved snapshot — never modelling them in the
 * render path. The one equation here, Shichman–Hodges, is for VERIFICATION of the solved
 * trajectory on settled plateaus (tools/lamp-spice-verify.mjs, lamp-parity.test.ts); the page
 * draws what ngspice produced.
 */
import type { MosfetSpec } from './spice/lamp-netlist';
import type { LampSnapshot, LampTransient } from './spice/lamp-transient';

/**
 * Level-1 STATIC channel current, drain to source, for Vds ≥ 0 (mirrored below zero as the
 * model does). This is the DC equation only: through a switching edge the drain TERMINAL current
 * also carries the model's capacitive terms, so it is the reference on plateaus, not at edges —
 * Astra's correction, and the tools are written to it.
 */
export function shichmanHodgesCurrent(vgs: number, vds: number, m: MosfetSpec): number {
  if (vds < 0) return -shichmanHodgesCurrent(vgs - vds, -vds, m);
  const beta = m.kp * (m.widthM / m.lengthM);
  const vov = vgs - m.vto;
  if (vov <= 0) return 0;
  const lam = 1 + m.lambda * vds;
  return vds < vov
    ? beta * (vov * vds - vds * vds / 2) * lam        // triode
    : (beta / 2) * vov * vov * lam;                   // saturation
}

export type MosfetRegion = 'off' | 'triode' | 'saturation';

export interface LampReading {
  /** Vgs and Vds from the snapshot's node voltages (source is the 0 V probe's node). */
  gateSourceVolts: number;
  drainSourceVolts: number;
  region: MosfetRegion;
  /** Power dissipated in the lamp resistor, W: (Vsupply − Vdrain) · I_drain. */
  lampWatts: number;
  /**
   * Vds · I_drain — DRAIN TERMINAL POWER, and labelled as such. It is not guaranteed to be
   * instantaneous heat while gate/drain charge is moving (the model's capacitances store and
   * return energy, and non-conservatively at that). No transistor temperature is invented.
   */
  drainTerminalWatts: number;
  /** The IDEAL zero-drop maximum, Vdd²/R — the brightness reference, not this MOSFET's fully-on. */
  idealFullWatts: number;
  /** 0..1: lampWatts / idealFullWatts, the stated brightness mapping (linear in power). */
  brightness: number;
  gateAmps: number;
  drainAmps: number;
}

export function lampReading(s: LampSnapshot, t: Pick<LampTransient, 'lampOhms' | 'nominalSupplyVolts' | 'mosfet'>): LampReading {
  const vgs = s.gateVolts, vds = s.drainVolts;   // source node is at 0 V through the probe
  const vov = vgs - t.mosfet.vto;
  const region: MosfetRegion = vov <= 0 ? 'off' : vds < vov ? 'triode' : 'saturation';
  const lampWatts = (s.supplyVolts - s.drainVolts) * s.drainAmps + 0;
  const idealFullWatts = t.nominalSupplyVolts * t.nominalSupplyVolts / t.lampOhms;
  return {
    gateSourceVolts: vgs, drainSourceVolts: vds, region,
    lampWatts, drainTerminalWatts: vds * s.drainAmps + 0, idealFullWatts,
    brightness: idealFullWatts > 0 ? Math.min(1, Math.max(0, lampWatts / idealFullWatts)) : 0,
    gateAmps: s.gateAmps, drainAmps: s.drainAmps,
  };
}

export interface LampDomain { ok: boolean; reason: string | null; minDrainVolts: number }

/**
 * THE SUPPORTED DOMAIN, enforced against the trajectory. The drain must not go below the source:
 * with bulk tied to source that would forward-bias the body diode, and this slice shows nothing
 * about reverse conduction. A numerical TOLERANCE, not a physics claim — reversal is scoped as
 * unsupported here, not declared impossible for an NMOS.
 */
export function lampDomain(t: LampTransient, toleranceVolts = 1e-3): LampDomain {
  let min = Infinity;
  for (let k = 0; k < t.drainVolts.length; k++) if (t.drainVolts[k] < min) min = t.drainVolts[k];
  if (min < -toleranceVolts)
    return { ok: false, minDrainVolts: min,
      reason: `Not supported: the drain went ${(-min).toPrecision(3)} V below the source. Reverse `
        + `conduction through the body diode is outside this demonstration.` };
  return { ok: true, reason: null, minDrainVolts: min };
}
