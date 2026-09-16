import { describe, it, expect } from 'vitest';
import { expm, motorReference, referenceWindow, motorEnergy, motorDomain, coastingReference } from './motor';
import { MOTOR_PRESETS } from './motor-presets';
import { effectiveInertia, loadTorque, buildMotorNetlist, validateMotor } from './spice/motor-netlist';
import type { MotorTransient } from './spice/motor-transient';

const lift = MOTOR_PRESETS[0].build();

describe('the matrix exponential reference', () => {
  it('reproduces the scalar LR closed form to rounding', () => {
    const R = 2.05, L = 5e-3, V = lift.supplyVolts, h = 3e-3;
    const braked = motorReference(lift, true, { i: 0, omega: 0, theta: 0 }, 0, h);
    expect(braked.i).toBeCloseTo((V / R) * (1 - Math.exp(-R * h / L)), 12);
    expect(braked.omega).toBe(0);
  });
  it('is a group action: two half steps equal one whole step', () => {
    const a = motorReference(lift, false, { i: 0, omega: 0, theta: 0 }, 0, 0.1);
    const b1 = motorReference(lift, false, { i: 0, omega: 0, theta: 0 }, 0, 0.05);
    const b = motorReference(lift, false, b1, 0.05, 0.1);
    expect(b.i).toBeCloseTo(a.i, 10); expect(b.omega).toBeCloseTo(a.omega, 9); expect(b.theta).toBeCloseTo(a.theta, 9);
  });
  it('settles to the steady state the algebra predicts', () => {
    const m = lift.motor, R = m.resistanceOhms + lift.switch.rOnOhms, K = m.kVsPerRad, b = m.viscousNmS, tl = loadTorque(lift);
    // steady: V = R i + K ω,  K i = b ω + tl  →  ω = (K V − R tl) / (K² + R b)
    const omega = (K * lift.supplyVolts - R * tl) / (K * K + R * b);
    const s = motorReference(lift, false, { i: 0, omega: 0, theta: 0 }, 0, 5);
    expect(s.omega).toBeCloseTo(omega, 6);
    expect(s.i).toBeCloseTo((b * omega + tl) / K, 6);
  });
  it('e^0 is the identity and e^{diag} is elementwise', () => {
    expect(expm([[0, 0], [0, 0]])).toEqual([[1, 0], [0, 1]]);
    const e = expm([[1, 0], [0, -2]]);
    expect(e[0][0]).toBeCloseTo(Math.E, 12); expect(e[1][1]).toBeCloseTo(Math.exp(-2), 12); expect(e[0][1]).toBe(0);
  });
});

describe('the reference window follows the programme', () => {
  it('opens after the last edge and closes at the switch opening', () => {
    expect(referenceWindow(lift)).toEqual({ from: 0.021, to: 0.6, braked: false });
    expect(referenceWindow(MOTOR_PRESETS[1].build())).toEqual({ from: 0.021, to: 0.6, braked: true });
    expect(referenceWindow(MOTOR_PRESETS[2].build())).toEqual({ from: 0.021, to: 0.40, braked: false });
  });
});

/**
 * A synthetic trajectory that obeys the port laws exactly: the reference itself, sampled. With
 * `brakeNm` a constant torque the brake applies to the shaft (negative resists) — the trajectory
 * is the reference for a load torque reduced by it, and the energy is evaluated against the
 * ORIGINAL load with the brake work booked. That exposes the brake sign a perfect lock hides.
 */
function synthetic(n = 2001, brakeNm = 0): MotorTransient {
  const c = lift, m = c.motor, R = m.resistanceOhms + c.switch.rOnOhms;
  const g = c.load.gravity, r = c.load.pinionRadiusM;
  // τ_load' = τ_load − τ_brake, realised through the mass so J_eff is unchanged only if we also
  // keep the rotor inertia consistent: adjust rotorInertia to compensate the mass change.
  const massPrime = c.load.massKg - brakeNm / (g * r);
  const refC = { ...c, load: { ...c.load, massKg: massPrime },
    motor: { ...c.motor, rotorInertiaKgM2: c.motor.rotorInertiaKgM2 + (c.load.massKg - massPrime) * r * r } };
  const times = new Float64Array(n), z = () => new Float64Array(n);
  const t: MotorTransient = { topology: 'motor', times, supplyVolts: z(), terminalVolts: z(), afterRVolts: z(), backEmfVolts: z(),
    controlVolts: z(), brakeControlVolts: z(), sourceAmps: z(), motorAmps: z(), diodeAmps: z(), brakeTorqueNm: z(),
    omegaRadPerS: z(), thetaRad: z(), switchClosed: new Uint8Array(n).fill(1), description: c, effectiveInertiaKgM2: effectiveInertia(c), loadTorqueNm: loadTorque(c),
    stopSeconds: 0.2, requestedStopSeconds: 0.2, requestedStepSeconds: 1e-4, actualStepSeconds: { min: 1e-4, median: 1e-4, max: 1e-4 },
    edges: [], engine: 'synthetic' };
  for (let k = 0; k < n; k++) {
    const time = 0.2 * k / (n - 1); times[k] = time;
    const s = motorReference(refC, false, { i: 0, omega: 0, theta: 0 }, 0, time);
    t.supplyVolts[k] = c.supplyVolts; t.sourceAmps[k] = s.i; t.motorAmps[k] = s.i;
    t.controlVolts[k] = 1;                                       // switch closed throughout
    t.brakeTorqueNm[k] = brakeNm;
    t.terminalVolts[k] = c.supplyVolts - c.switch.rOnOhms * s.i;   // the switch's own drop
    t.backEmfVolts[k] = m.kVsPerRad * s.omega; t.omegaRadPerS[k] = s.omega; t.thetaRad[k] = s.theta;
    t.afterRVolts[k] = t.terminalVolts[k] - m.resistanceOhms * s.i; void R;
  }
  return t;
}

describe('the energy balances close on a trajectory that obeys the laws', () => {
  it('port, load and source residuals are trapezoid-small, not modelling-large', () => {
    const e = motorEnergy(synthetic());
    const k = e.times.length - 1;
    expect(e.sourceWork[k]).toBeGreaterThan(0.2);
    // Quadrature error only: relative to the largest term, well below 1e-4 on a 1e-4 s grid.
    expect(Math.abs(e.portResidual[k]) / e.sourceWork[k]).toBeLessThan(1e-4);
    expect(Math.abs(e.loadResidual[k]) / e.sourceWork[k]).toBeLessThan(1e-4);
    expect(Math.abs(e.sourceResidual[k]) / e.sourceWork[k]).toBeLessThan(1e-12);   // exact by construction
    expect(e.potential[k]).toBeGreaterThan(0);
    expect(e.heat[k]).toBeGreaterThan(e.kinetic[k]);
  });
  it('books the brake with the right sign: a resisting brake absorbs work, and the load balance still closes', () => {
    const e = motorEnergy(synthetic(2001, -0.02));   // 20 mN·m resisting the shaft throughout
    const k = e.times.length - 1;
    expect(e.brakeWork[k]).toBeLessThan(0);
    expect(Math.abs(e.loadResidual[k]) / e.sourceWork[k]).toBeLessThan(1e-4);
    // With the sign flipped the residual would be twice the brake work — far above the bound.
    expect(Math.abs(2 * e.brakeWork[k]) / e.sourceWork[k]).toBeGreaterThan(1e-3);
  });
  it('coasting: the closed form matches the exponential and integrates θ consistently', () => {
    const c = lift, a = c.motor.viscousNmS / (c.motor.rotorInertiaKgM2 + c.load.massKg * c.load.pinionRadiusM ** 2);
    const w0 = 90, x = coastingReference(c, { omega: w0, theta: 1 }, 0.4, 0.5);
    const wInf = -(c.load.massKg * c.load.gravity * c.load.pinionRadiusM) / c.motor.viscousNmS;
    expect(x.omega).toBeCloseTo(wInf + (w0 - wInf) * Math.exp(-a * 0.1), 9);
    // θ by fine trapezoid of the same ω
    let th = 1, prev = w0; const n = 100000;
    for (let j = 1; j <= n; j++) { const tt = 0.4 + 0.1 * j / n; const wj = coastingReference(c, { omega: w0, theta: 1 }, 0.4, tt).omega; th += 0.5 * (prev + wj) * (0.1 / n); prev = wj; }
    expect(x.theta).toBeCloseTo(th, 7);
  });
  it('refuses a shaft that runs backwards WITH THE SWITCH OPEN — the deferred generator regime', () => {
    const t = synthetic(); t.omegaRadPerS[5] = -0.5; t.controlVolts[5] = 0; t.switchClosed[5] = 0;
    const d = motorDomain(t);
    expect(d.ok).toBe(false); expect(d.reason).toMatch(/reverse rotation with the switch open/);
    // The same dip with the switch CLOSED is motoring against the load, and is reported, not refused.
    const closed = synthetic(); closed.omegaRadPerS[5] = -0.5;
    expect(motorDomain(closed).ok).toBe(true);
    expect(motorDomain(closed).minOmega).toBe(-0.5);
    // A reversed winding current is refused regardless; the conversion sign is reported.
    const rev = synthetic(); rev.motorAmps[7] = -0.01;
    expect(motorDomain(rev).reason).toMatch(/reverse winding current/);
    expect(motorDomain(closed).minConversionWatts).toBeLessThan(0);
    expect(motorDomain(synthetic()).ok).toBe(true);
  });
});

describe('the motor netlist is generated, never authored', () => {
  it('writes the declared map: switch model, port law, equivalent-circuit mechanics, brake and diode probes', () => {
    const n = buildMotorNetlist(lift);
    expect(n).toContain('S1 nd na ctl 0 SWMAIN');
    expect(n).toContain('.model SWMAIN SW(RON=0.05 ROFF=1000000000 VT=0.5 VH=0.1)');
    expect(n).toContain('EB nc 0 vw 0 0.3');
    expect(n).toContain('Bt 0 vw I=0.3*i(LM)');
    expect(n).toContain(`Cj vw 0 ${effectiveInertia(lift)}`);
    expect(n).toContain('Rb vw 0 1000');
    expect(n).toContain(`Il vw 0 DC ${loadTorque(lift)}`);
    expect(n).toContain('Vbr vw bk DC 0');
    expect(n).toContain('D1 dk na DFW');
    expect(n).not.toContain('Bth');   // θ is integrated by the reader, not carried as a node
    expect(n).not.toContain('uic');
  });
  it('refuses an opening before the closing, and events on the boundary', () => {
    const bad = { ...lift, programme: { ...lift.programme, openAtSeconds: 0.01 } };
    expect(() => validateMotor(bad)).toThrow(/only open after/);
    expect(() => validateMotor({ ...lift, programme: { ...lift.programme, closeAtSeconds: 0 } })).toThrow(/Switch close time/);
  });
});
