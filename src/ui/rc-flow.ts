/** Shared number formatting for the readouts. Lives here so the classifier below, and the
 * tests that pin what it claims, do not have to import the whole page module. */
export const fmt = (n: number) => n === 0 ? '0' : Math.abs(n) < 0.0001 ? n.toExponential(4) : Number(n.toPrecision(7)).toString();

/**
 * WHAT THE READOUT IS ALLOWED TO SAY ABOUT A SMALL CURRENT.
 *
 * Two wrong versions preceded this one, both the same mistake — reading a small current as
 * evidence for something it does not establish.
 *
 * First: "Low current · voltages nearly equal". Sound in an RC loop, where i = (Vs − Vc)/R.
 * False here: with an inductor the current crosses zero at every turning point while the
 * difference is volts. Astra's repro at the opening parameters — t = 30.99 µs, i/full = 3e-5,
 * difference 3.72 V — had the page announcing equality across 3.72 V.
 *
 * Second, mine: "the inductor is reversing it". Also unwarranted. Early in the first charge
 * the current is small, positive AND INCREASING, so a small current with a large difference
 * says nothing about reversal on its own.
 *
 * So this reports only what it measures: the size of the difference, and the sign of di/dt
 * from L·di/dt = Vs − Vc − i·R. No prediction is made from the ratio.
 *
 * Exported because a claim the UI makes has to be testable on its own; a test of the model
 * alone cannot stop this text from regressing.
 */
export function flowExplanation(current: number, driving: number, didt: number,
                                fullCurrent: number, voltageScale: number): string {
  const small = Math.abs(current) < 0.1 * fullCurrent;
  if (!small) return '';
  if (Math.abs(driving) < 0.02 * Math.max(voltageScale, 1e-12))
    return 'Settling · little current, little voltage difference · ';
  const trend = didt > 0 ? 'rising' : didt < 0 ? 'falling' : 'momentarily steady';
  return `Small current · ${fmt(driving)} V across resistor and inductor · current ${trend} · `;
}


/** SI value with an engineering prefix: 2.17e-5 H reads as 21.74 µH, not 0.0000217 H. */
export function siUnit(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `${value} ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const prefixes: [number, string][] = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
    [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
  ];
  const a = Math.abs(value);
  for (const [scale, p] of prefixes)
    if (a >= scale) return `${Number((value / scale).toPrecision(4))} ${p}${unit}`;
  return `${value.toExponential(3)} ${unit}`;
}
