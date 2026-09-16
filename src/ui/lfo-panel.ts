/**
 * BATCH 5 — THE LEARNING LFO, as a control surface.
 *
 * Renders the sweep controls and a drawn picture of the sweep itself, with the
 * live position marked. Drawing only: this module computes no physics and writes
 * nothing. Every number it prints comes from `src/model/lfo.ts` or the world.
 */
import type { SimWorld } from '../sim/world';
import {
  LFO_LIMITS, LFO_TICKS_PER_SECOND, LFO_WAVEFORMS, lfoHz, lfoIsQuasiStatic,
  lfoPeriodSeconds, lfoPhaseAt, lfoShape, lfoValueAt,
} from '../model/lfo';
import { escapeHtml } from './authoring';

const f = (x: number, n = 6): string =>
  (Number.isFinite(x) ? (x === 0 ? '0' : Math.abs(x) >= 1e-4 ? x.toFixed(n) : x.toExponential(3)) : String(x));

/** The sweep drawn as one cycle, with the live phase marked. */
function sweepSvg(sim: SimWorld): string {
  const L = sim.lfo, W = 320, H = 74, PAD = 6;
  const pts: string[] = [];
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const y = PAD + (1 - lfoShape(L.waveform, p)) * (H - 2 * PAD);
    pts.push(`${(PAD + p * (W - 2 * PAD)).toFixed(1)},${y.toFixed(1)}`);
  }
  const ph = lfoPhaseAt(L, sim.tick);
  const mx = PAD + ph * (W - 2 * PAD);
  const my = PAD + (1 - lfoShape(L.waveform, ph)) * (H - 2 * PAD);
  return `<svg class="lfowave" viewBox="0 0 ${W} ${H}" width="100%" role="img"
      aria-label="one cycle of the ${L.waveform} sweep with the current phase marked">
    <line class="lfoaxis" x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" />
    <line class="lfoaxis" x1="${PAD}" y1="${PAD}" x2="${W - PAD}" y2="${PAD}" />
    <polyline class="lfotrace" points="${pts.join(' ')}" />
    <line class="lfonow" x1="${mx.toFixed(1)}" y1="${PAD}" x2="${mx.toFixed(1)}" y2="${H - PAD}" />
    <circle class="lfodot" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.5" />
    <text class="lfolab" x="${PAD + 2}" y="${PAD + 9}">hi</text>
    <text class="lfolab" x="${PAD + 2}" y="${H - PAD - 3}">lo</text>
  </svg>`;
}

/**
 * THE CONTROLS. These live in the LEFT column, which is rebuilt only on an event.
 *
 * They must NOT go in `#panels`: that is re-rendered wholesale every 120 ms, which
 * destroys the element a listener is attached to AND overwrites whatever the author
 * is part-way through typing into an input. This project has been bitten by exactly
 * that before (the honesty <details> snapping shut), so the split is deliberate:
 * anything you TYPE INTO or CLICK is here; anything that merely READS OUT is in
 * `renderLfoReadout`.
 */
export function renderLfoControls(sim: SimWorld): string {
  const L = sim.lfo;
  const targets = sim.lfoTargets();
  const t = sim.lfoTarget();

  const options = [`<option value="" ${L.targetKey ? '' : 'selected'}>— choose what to sweep —</option>`]
    .concat(targets.map((x) =>
      `<option value="${escapeHtml(x.key)}" ${x.key === L.targetKey ? 'selected' : ''}>${escapeHtml(x.label)}</option>`))
    .join('');

  return `<section class="lfopanel"><h2>Sweep — the learning LFO</h2>
    <p>Hook a slow oscillator to one parameter and <b>watch the world answer over time</b>, instead of
    reading one frozen solve. Everything else on this page keeps meaning exactly what it meant.</p>

    <p class="lfoboundary"><b>THE SWEEP IS YOU, NOT THE WORLD.</b> It is an external experimenter turning a
    knob — the same boundary status as the hand. <b>Nothing in this world spends energy to move a
    resistance or an EMF</b>, and no such cost is modelled or booked anywhere. Never read a swept
    parameter as something the world did to itself.</p>

    <div class="grp">
      <label for="lfo-target">Parameter to sweep</label>
      <select id="lfo-target" class="wide">${options}</select>
      ${targets.length === 0 ? '<div class="sceneblurb">Nothing to sweep yet — author a circuit or a spring first.</div>' : ''}
      ${t ? `<div class="sceneblurb">Authored value <b>${f(t.current)} ${escapeHtml(t.unit)}</b>.
        Model range [${f(t.min)}, ${f(t.max)}] ${escapeHtml(t.unit)} — a sweep outside it is
        <b>refused, never clamped</b>.</div>` : ''}
    </div>

    <div class="grp">
      <button id="lfo-toggle" class="${L.enabled ? 'on' : ''}">${L.enabled ? 'Sweeping — stop' : 'Start sweep'}</button>
      <button id="lfo-reset-phase" title="Restart the cycle from its beginning at this tick">Restart cycle</button>
    </div>

    <div class="grp">
      <label for="lfo-wave">Waveform</label>
      <select id="lfo-wave" class="wide">${LFO_WAVEFORMS.map((w) =>
        `<option value="${w.id}" ${w.id === L.waveform ? 'selected' : ''}>${escapeHtml(w.label)}</option>`).join('')}</select>
      <div class="sceneblurb">${escapeHtml(LFO_WAVEFORMS.find((w) => w.id === L.waveform)!.note)}</div>
    </div>

    <div class="grp">
      <label for="lfo-lo">Sweep from (lo) ${t ? escapeHtml(t.unit) : ''}</label>
      <input id="lfo-lo" type="number" step="any" value="${L.lo}" />
      <label for="lfo-hi">Sweep to (hi) ${t ? escapeHtml(t.unit) : ''}</label>
      <input id="lfo-hi" type="number" step="any" value="${L.hi}" />
      <label for="lfo-period">Period — WHOLE public ticks per cycle</label>
      <input id="lfo-period" type="number" step="1" min="${LFO_LIMITS.minPeriodTicks}"
        max="${LFO_LIMITS.maxPeriodTicks}" value="${L.periodTicks}" />
      <button id="lfo-apply">Apply sweep settings</button>
      <div class="sceneblurb">${L.periodTicks} ticks = <b>${f(lfoPeriodSeconds(L), 4)} s</b> per cycle
        = <b>${f(lfoHz(L), 4)} Hz</b>. The period is stored as a whole number of ticks, and Hz is
        <b>derived for display</b>: a float frequency would make the phase depend on accumulated
        rounding, and the sweep would stop being reproducible on replay.</div>
    </div>

  </section>`;
}

/** THE LIVE READOUT. No inputs, no listeners — safe to repaint on the 120 ms tick. */
export function renderLfoReadout(sim: SimWorld): string {
  const L = sim.lfo;
  const t = sim.lfoTarget();
  const live = sim.lfoCurrentValue;
  const slow = lfoIsQuasiStatic(L);
  return `<section class="lfopanel"><h2>Sweep — live</h2>
    ${sweepSvg(sim)}

    <div class="lfonow-readout">
      ${L.enabled && t
        ? `<b>NOW: ${escapeHtml(t.label)} = ${f(live ?? NaN)} ${escapeHtml(t.unit)}</b>
           · phase ${(100 * lfoPhaseAt(L, sim.tick)).toFixed(1)}% of the cycle
           · tick ${sim.tick}
           <div class="dim">Value at this tick is a <b>pure function of the tick number</b>
           — not of wall-clock time, frame rate or an accumulated phase — so replaying these ticks
           reproduces this sweep exactly. At the next tick it will be
           ${f(lfoValueAt(L, sim.tick + 1))} ${escapeHtml(t.unit)}.</div>`
        : '<span class="dim">Not sweeping. The authored values are in force.</span>'}
    </div>

    ${L.enabled && !slow ? `<p class="refusal"><b>THIS SWEEP IS FASTER THAN THE MODEL CAN HONESTLY ANSWER.</b>
      At ${L.periodTicks} ticks per cycle (${f(lfoHz(L), 3)} Hz) you are below the
      ${LFO_QUASISTATIC_TEXT} guideline. Every tick here is an <b>independent DC steady-state solve</b>:
      there is no capacitance, no inductance, no transient and no propagation in this model, so what you
      are watching is a sequence of <b>unrelated steady states</b>, not a real circuit driven at this rate.
      It is still exactly what the model computed, and it is still drawn — it is simply not a prediction
      about fast driving. Slow it down to ${LFO_QUASISTATIC_MIN} ticks or more to stay in the regime where
      reading each frame as settled is defensible.</p>` : ''}

    ${L.enabled ? `<p class="dim">The sweep is applied as an <b>override at solve time</b>. It never writes
      the authored document, so saving the scene saves what you authored rather than wherever the knob
      happened to be.</p>` : ''}
  </section>`;
}

const LFO_QUASISTATIC_MIN = 60;
const LFO_QUASISTATIC_TEXT = `${LFO_QUASISTATIC_MIN}-ticks-per-cycle (${LFO_TICKS_PER_SECOND / LFO_QUASISTATIC_MIN} Hz)`;
