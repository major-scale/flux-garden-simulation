import { describe, it, expect } from 'vitest';
import { encodeMotorDoc, decodeMotorDoc } from './motor-doc';
import { MOTOR_PRESETS } from './motor-presets';

describe('the motor document', () => {
  it('round-trips every preset exactly, nulls included', () => {
    for (const p of MOTOR_PRESETS) { const c = p.build(); expect(decodeMotorDoc(encodeMotorDoc(c))).toEqual(c); }
  });
  it('refuses other formats by name and validates as the solver would', () => {
    expect(() => decodeMotorDoc(JSON.stringify({ format: 'flux-lamp-1', circuit: {} }))).toThrow(/Not a motor document \(format "flux-lamp-1"/);
    const bad = JSON.parse(encodeMotorDoc(MOTOR_PRESETS[0].build())); bad.circuit.motor.kVsPerRad = 0;
    expect(() => decodeMotorDoc(JSON.stringify(bad))).toThrow(/Motor constant K/);
  });
});
