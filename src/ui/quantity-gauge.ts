/** Quantitative display contract; never changes the model value. */
export interface QuantityGauge {
  quantity: string;
  unit: string;
  value: number;
  reference: string;
  scale: { min: number; max: number; mapping: 'linear' };
}
export function gaugeReading(q: QuantityGauge): { fill: number; text: string } {
  if (![q.value, q.scale.min, q.scale.max].every(Number.isFinite)
    || q.scale.max <= q.scale.min || q.scale.mapping !== 'linear')
    throw new Error('Gauge requires finite values and an increasing linear display range');
  const fraction = (q.value - q.scale.min) / (q.scale.max - q.scale.min);
  const n = (v: number) => Number(v.toPrecision(6)).toString();
  const saturation = fraction > 1 ? ' · ABOVE DISPLAY SCALE' : fraction < 0 ? ' · BELOW DISPLAY SCALE' : '';
  return {
    fill: Math.min(1, Math.max(0, fraction)),
    text: `${q.quantity}: ${n(q.value)} ${q.unit}\nDisplay ${n(q.scale.min)}–${n(q.scale.max)} ${q.unit}${saturation}\n${q.reference}`,
  };
}
