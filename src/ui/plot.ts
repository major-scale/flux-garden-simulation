/**
 * BB1 stage one — THE ONE LIVE PLOT.
 *
 * One component. It draws a `Meter`'s bounded sample buffer against simulated
 * time, labels both axes with their SI units, and — when the demo supplies one —
 * overlays the ANALYTIC REFERENCE the measurement is meant to be compared with.
 *
 * *** A PLOT ALONE IS NOT GUIDED INQUIRY. *** That is why the reference curve and
 * the live residual are part of this component rather than an optional extra: the
 * instrument exists to make a comparison possible. Where a demo has no closed
 * form — the air projectile — the caption says so instead of drawing a line that
 * would imply one.
 *
 * It is deliberately SVG built from a string, redrawn with the rest of the panels
 * at the panel cadence. It is display only; it reads a Meter and writes nothing.
 */

import type { Meter } from '../model/measure';

/** Drawn points are decimated to this many, so a full 1800-sample buffer stays cheap. */
const MAX_DRAWN = 420;

const W = 320, H = 132;
const PAD = { l: 44, r: 8, t: 10, b: 22 };

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

const fmt = (x: number): string => {
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1e4 || a < 1e-3) return x.toExponential(1);
  return x.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
};

/**
 * `meter` supplies the measured series and its unit; `meter.analytic`, when set,
 * supplies the reference curve. Returns an SVG fragment.
 */
export function renderPlot(meter: Meter, opts: { title: string; note?: string; comparison?: { samples: Meter['samples']; label: string } } = { title: '' }): string {
  const s = meter.samples;
  const ext = meter.extent();
  if (!ext || s.length < 2) {
    return `<div class="plot"><div class="plottitle">${opts.title}</div>${opts.comparison ? '<p>Both runs share these axes; range fits both traces. No per-run rescaling.</p>' : ''}`
      + `<div class="plotempty">no samples yet — run the scene, or press <b>reset measurement</b></div></div>`;
  }

  // Include the analytic curve in the value range so the comparison is not clipped.
  let { vMin, vMax } = ext;
  let { tMin, tMax } = ext;
  const other = opts.comparison;
  if (other) for (const p of other.samples) {
    tMin = Math.min(tMin, p.t); tMax = Math.max(tMax, p.t);
    vMin = Math.min(vMin, p.value); vMax = Math.max(vMax, p.value);
  }
  const ref = meter.analytic;
  const refPts: Array<[number, number]> = [];
  if (ref) {
    const n = Math.min(MAX_DRAWN, 240);
    for (let i = 0; i <= n; i++) {
      const t = tMin + ((tMax - tMin) * i) / n;
      const v = ref.at(t);
      if (!Number.isFinite(v)) continue;
      refPts.push([t, v]);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }
  if (vMax - vMin < 1e-9) { vMax += 0.5; vMin -= 0.5; }
  const padV = 0.08 * (vMax - vMin);
  vMin -= padV; vMax += padV;

  const px = (t: number): number => PAD.l + ((t - tMin) / Math.max(1e-9, tMax - tMin)) * (W - PAD.l - PAD.r);
  const py = (v: number): number => H - PAD.b - ((v - vMin) / (vMax - vMin)) * (H - PAD.t - PAD.b);

  const step = Math.max(1, Math.ceil(s.length / MAX_DRAWN));
  const pts: string[] = [];
  for (let i = 0; i < s.length; i += step) pts.push(`${px(s[i].t).toFixed(1)},${py(s[i].value).toFixed(1)}`);
  const last = s[s.length - 1];
  pts.push(`${px(last.t).toFixed(1)},${py(last.value).toFixed(1)}`);

  const grid = niceTicks(vMin, vMax).map((v) =>
    `<line class="pg" x1="${PAD.l}" y1="${py(v).toFixed(1)}" x2="${W - PAD.r}" y2="${py(v).toFixed(1)}" />`
    + `<text class="pl" x="${PAD.l - 4}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join('');
  const tTicks = niceTicks(tMin, tMax, 4).map((t) =>
    `<text class="pl" x="${px(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${fmt(t)}</text>`).join('');

  const otherPath = other ? `<polyline fill="none" stroke="#f3bc68" stroke-width="2" points="${other.samples.map(p => `${px(p.t).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ')}" />` : '';
  const refPath = refPts.length
    ? `<polyline class="pref" points="${refPts.map(([t, v]) => `${px(t).toFixed(1)},${py(v).toFixed(1)}`).join(' ')}" />`
    : '';

  // The live residual: the point of drawing a reference at all.
  let residual = '';
  if (ref) {
    const want = ref.at(last.t);
    residual = Number.isFinite(want)
      ? `<span class="presid">measured − reference = ${last.value - want >= 0 ? '+' : ''}`
        + `${(last.value - want).toPrecision(4)} ${meter.unit}</span>`
      : `<span class="dim">the reference is not defined at t = ${last.t.toFixed(3)} s, so no residual is shown</span>`;
  }

  return `
  <div class="plot">
    <div class="plottitle">${opts.title}</div>${opts.comparison ? '<p>Both runs share these axes; range fits both traces. No per-run rescaling.</p>' : ''}
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img"
         aria-label="${meter.label} in ${meter.unit} against simulated time in seconds">
      <rect class="pbg" x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${H - PAD.t - PAD.b}" />
      ${grid}${tTicks}${otherPath}
      ${refPath}
      <polyline class="pline" points="${pts.join(' ')}" />
      <circle class="phead" cx="${px(last.t).toFixed(1)}" cy="${py(last.value).toFixed(1)}" r="2.6" />
    </svg>
    <div class="plotaxis">
      <span><b>y</b> ${meter.label} / <b>${meter.unit}</b> &nbsp;·&nbsp; <b>x</b> simulated time / <b>s</b></span>
      <span class="dim">${s.length} of ${meter.capacity} samples (bounded ring) · ${meter.describeRef()}</span>
      ${ref
        ? `<span class="prefkey">— — reference: ${ref.label}</span> ${residual}`
        : `<span class="dim">no closed-form reference is claimed for this case — any comparison here is <b>numerical only</b></span>`}
      ${opts.note ? `<span class="dim">${opts.note}</span>` : ''}
    </div>
  </div>`;
}
