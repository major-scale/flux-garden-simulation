import { expect, it } from 'vitest';
import { gaugeReading, type QuantityGauge } from './quantity-gauge';
const q = (value: number): QuantityGauge => ({quantity:'received heat',unit:'J',value,reference:'since restart',scale:{min:0,max:0.5,mapping:'linear'}});
it('maps energy linearly, so half capacitor voltage gives quarter fill', () => {
  expect(gaugeReading(q(.5)).fill).toBe(1);
  expect(gaugeReading(q(.005 * 5 ** 2)).fill).toBe(.25);
  expect(gaugeReading({...q(.125),quantity:'capacitor energy'}).fill).toBe(gaugeReading(q(.125)).fill);
  expect(gaugeReading(q(0)).fill).toBe(0);
});
it('labels saturation while retaining the actual number and never mutating it', () => {
  const original=q(1.25); const display=gaugeReading(original);
  expect(display.fill).toBe(1); expect(display.text).toContain('1.25 J');
  expect(display.text).toContain('ABOVE DISPLAY SCALE'); expect(original.value).toBe(1.25);
  expect(gaugeReading(q(-1)).text).toContain('BELOW DISPLAY SCALE');
});
it('refuses invalid ranges and nonfinite quantities', () => {
  expect(()=>gaugeReading(q(NaN))).toThrow();
  expect(()=>gaugeReading({...q(0),scale:{min:1,max:1,mapping:'linear'}})).toThrow();
});
