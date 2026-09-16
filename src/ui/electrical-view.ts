/**
 * BATCH 4 — VISIBLE ELECTRICITY.  See VISUAL-DECLARATION.md, written and stamped
 * BEFORE this file existed.
 *
 * ===========================================================================
 * THIS IS A DRAWING OF NUMBERS THAT ALREADY EXIST.  IT ADDS NO PHYSICS.
 * ===========================================================================
 * It reads `sim.circuitSolution`, `sim.circuitMerge`, `sim.electrical` and the
 * thermal receivers, and it writes NOTHING. Selection, the display reference and
 * the pinned scale are UI-LOCAL presentation state: they never reach the
 * simulation, the recorder, a checkpoint or an authored document, and they cannot
 * change one simulated value.
 *
 *   *** VOLTAGE-AS-HEIGHT IS AN ENCODING. Electric potential is J/C;
 *       gravitational potential is J/kg. They are DIFFERENT QUANTITIES. The bar
 *       height is a chart axis, not a hill, and no physical body is ever moved to
 *       indicate a voltage. ***
 *   *** THERE IS NO SPATIAL FIELD HERE. The solver gives potentials AT NODES and
 *       nothing between them, so nothing is drawn between them: no interpolated
 *       glow, no gradient, no contour, no field line, no particle. ***
 *   *** "CURRENT FLOWS DOWNHILL" IS FALSE FOR A COMPLETE LOOP. Ideal wires carry
 *       current between nodes at EQUAL potential, and the SOURCE SUPPLIES THE
 *       RISE. Only through a passive resistor does conventional current follow
 *       the drop. ***
 *   *** COLOUR AND WIDTH ARE NEVER THE ONLY CARRIER. Every bar, arrow and
 *       temperature also prints its SI number. ***
 */

import type { SimWorld } from '../sim/world';
import { resistorsOf, sourcesOf, voltageAt, wiresOf, type NodeMerge } from '../model/circuit';
import { temperature } from '../model/thermal';
import { escapeHtml } from './authoring';

// ---------------------------------------------------------------------------
// UI-LOCAL PRESENTATION STATE.  None of this is simulated, recorded or saved.
// ---------------------------------------------------------------------------

export type ElectricalSelection =
  | { kind: 'node'; id: string }
  | { kind: 'resistor'; id: string }
  | { kind: 'source'; id: string };

/**
 * A frozen drawing scale, plus the values it was frozen at. Two runs drawn under
 * one of these are drawn on ONE scale — the whole point. Without it, each run
 * auto-scales to its own maximum and a 12 V circuit looks exactly like a 6 V one.
 */
export interface PinnedScale {
  /** Human description of when it was pinned. Presentation only. */
  at: string;
  /**
   * V per DRAWING UNIT (SVG user units, not screen pixels — the <svg> is
   * width="100%" and scales responsively). THE SCALE ITSELF is what is pinned
   * — NOT a clamped window.
   * Clamping a run that fell outside a pinned window drew two DIFFERENT
   * potentials at the SAME height, which is the exact lie this whole view exists
   * to avoid. Pinning V/px instead means a 12 V circuit draws twice as tall as a
   * 6 V one and nothing is ever clamped: the drawing grows instead.
   */
  vpp: number;
  /** A. |I| mapped to the widest arrow. */
  fullI: number;
  /** K. The two ends of the labelled temperature ramp. */
  loK: number; hiK: number;
  /**
   * Node potentials in the MODEL'S OWN reference (NOT the display reference that
   * happened to be selected when the pin was taken). Storing them display-relative
   * meant a later reference shift moved the live rails and left the ghosts behind,
   * inventing a difference between two identical runs — see D-47.
   */
  nodes: Array<{ rep: string; v: number }>;
  /** The merged rep used as the model's 0 V when pinned, for the invalidation check. */
  refRepAtPin: string;
  resistors: Array<{ id: string; i: number; p: number }>;
  receivers: Array<{ id: string; t: number }>;
  suppliedEnergy: number;
  sourceCurrent: number;
}

export interface ElectricalViewState {
  selection: ElectricalSelection | null;
  /**
   * Whether the honesty block is expanded. It has to live here: the panels are
   * re-rendered wholesale every 120 ms, so a natively-toggled <details> SNAPPED
   * SHUT a fraction of a second after being opened. Seen on screen.
   */
  honestyOpen: boolean;
  /** Authored node id used as the DISPLAY zero, or null for the model's own 0 V reference. */
  displayRef: string | null;
  pinned: PinnedScale | null;
}

export const newElectricalViewState = (): ElectricalViewState => ({ selection: null, honestyOpen: false, displayRef: null, pinned: null });

// ---------------------------------------------------------------------------

const f = (x: number, n = 6): string =>
  (Number.isFinite(x) ? (x === 0 ? '0' : Math.abs(x) >= 1e-4 ? x.toFixed(n) : x.toExponential(3)) : String(x));
/** Compact number for a label drawn inside the diagram. */
const fs = (x: number): string => {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  return a >= 1e5 || a < 1e-3 ? x.toExponential(2) : x.toFixed(a >= 100 ? 1 : a >= 1 ? 3 : 4);
};
/** Signed value, with an explicit + so a sign convention can actually be read. */
const fsig = (x: number, n = 6): string => (x === 0 ? '0' : `${x > 0 ? '+' : '−'}${f(Math.abs(x), n)}`);

/**
 * Nominal ladder height in px that the AUTO scale fits a run into. It is only a
 * starting point: once a scale is pinned, V/px is fixed and the drawing height
 * follows the data instead.
 */
const BASE_PLOT = 132;

/**
 * Current-arrow width, in px, as ONE definition used by both the drawing and
 * the printed scale. A nonzero arrow is `ARROW_BASE + |I| / app` px wide, where
 * `app = fullI / ARROW_SPAN`. The two used to be separate literals (5.4 in the
 * geometry, 6 in the printed A/px), so the stated scale did not reproduce the
 * drawing and reading a width back gave a current ~15% too high.
 *
 * ARROW_BASE is a visibility pedestal, NOT part of the encoding: it is the same
 * for every nonzero current, so it cancels out of any width DIFFERENCE and must
 * be subtracted before applying A/px. ARROW_ZERO is wider than ARROW_BASE on
 * purpose — exactly zero is drawn flat, greyed and without an arrowhead, so it
 * can never be misread as a small current.
 */
export const ARROW_BASE = 1.2;
const ARROW_SPAN = 5.4;
export const ARROW_ZERO = 1.6;
/** |I|/fullI beyond which the arrow stops widening (pinned scales only). */
const ARROW_CLAMP = 1.3;

/**
 * The drawn stroke width, in px, of one resistor's current arrow. EXPORTED so
 * the printed scale and a test can both go through this one definition instead
 * of restating the geometry.
 */
export const arrowWidthPx = (cur: number, fullI: number): number =>
  (cur === 0 ? ARROW_ZERO : ARROW_BASE + ARROW_SPAN * Math.min(ARROW_CLAMP, Math.abs(cur) / fullI));

/**
 * The A-per-px printed beside the drawing. It is the INVERSE of `arrowWidthPx`
 * above `ARROW_BASE`, so `(arrowWidthPx(I, fullI) - ARROW_BASE) * ampsPerPixel(fullI)`
 * returns |I| for any unclamped current. That round trip is the whole contract
 * and it is asserted in `electrical-view.test.ts`.
 */
export const ampsPerPixel = (fullI: number): number => fullI / ARROW_SPAN;

// ---------------------------------------------------------------------------
// THE VIEW
// ---------------------------------------------------------------------------

export function renderElectricalView(sim: SimWorld, st: ElectricalViewState): string {
  const c = sim.construction?.circuit;
  if (!c) return '';
  const sol = sim.circuitSolution, merge = sim.circuitMerge;
  const head = '<section class="elecview"><h2>Visible electricity</h2>';
  if (sim.electrical.rejected || !sol || !merge) {
    return `${head}<p class="refusal"><b>NOTHING IS DRAWN: the electrical result was REJECTED.</b>
      A rejected solve is not drawn approximately and no earlier drawing is reused.
      ${escapeHtml(sim.electrical.rejected ?? 'no accepted solution')}</p></section>`;
  }

  const src = sourcesOf(c)[0];
  const resistors = resistorsOf(c);
  const wires = wiresOf(c);
  const nodeLabel = (id: string): string => {
    const n = c.nodes.find((x) => x.id === id);
    return n ? n.label : id;
  };
  const railName = (rep: string): string => merge.members(rep).map(nodeLabel).join(' = ');

  // ---- THE DISPLAY REFERENCE.  A CHOICE, NOT A FACT. ----------------------
  // Shifting it slides every bar by one constant and changes NO voltage
  // difference, NO current, NO power and NO heat. That is the point of offering it.
  const refRep = st.displayRef ? merge.find(st.displayRef) : merge.find(src.neg);
  const refOffset = voltageAt(sol, merge, refRep);
  const dispV = (rep: string): number => voltageAt(sol, merge, rep) - refOffset;
  const shifted = refRep !== merge.find(src.neg);

  // ---- SCALES.  EXPLICIT, PRINTED, AND PINNABLE. --------------------------
  const reps = sol.nodeVoltages.map((r) => r.rep);
  const vals = reps.map(dispV);
  // ---- THE PINNED RUN, RE-EXPRESSED IN THE REFERENCE CHOSEN *NOW*. --------
  // A pinned comparison is only honest if BOTH runs are drawn against the same
  // chosen zero. The pinned potentials are stored in the model's own reference,
  // so they are shifted by the pinned run's own potential AT THE NODE THE VIEWER
  // HAS CHOSEN. If that node does not exist in the pinned topology there is no
  // correct offset, and the comparison is INVALIDATED rather than guessed.
  const pinRefEntry = st.pinned ? st.pinned.nodes.find((n) => n.rep === refRep) : undefined;
  const pinBroken = st.pinned ? !pinRefEntry : false;
  const pinOff = pinRefEntry ? pinRefEntry.v : 0;
  const pinnedDisp: Array<{ rep: string; v: number }> =
    st.pinned && !pinBroken ? st.pinned.nodes.map((n) => ({ rep: n.rep, v: n.v - pinOff })) : [];

  const rawLo = Math.min(0, ...vals), rawHi = Math.max(0, ...vals);
  const rawSpan = Math.max(rawHi - rawLo, 1e-12);
  const vpp = st.pinned ? st.pinned.vpp : rawSpan / BASE_PLOT;   // volts per DRAWING UNIT
  const rawFullI = Math.max(...resistors.map((r) => Math.abs(currentOf(sol, r.id))), Math.abs(sol.sourceCurrent), 0);
  const fullI = st.pinned ? st.pinned.fullI : (rawFullI > 0 ? rawFullI : 1);
  const overI = rawFullI > fullI * (1 + 1e-12);

  // ---- LADDER GEOMETRY.  Vertical position = potential. Horizontal = layout only.
  const W = 344, TOP = 26, BOT = 32;
  const RAIL_L = 104, RAIL_R = W - 8;

  // RAILS AT THE SAME POTENTIAL ARE DRAWN AT THE SAME HEIGHT. That is the whole
  // encoding and it is not traded away for legibility. Two DISTINCT nodes that
  // happen to share a potential are therefore listed separately on one height —
  // they are NOT merged, and merged nodes appear instead as one name joined by '='.
  const railRows = reps.map((rep, i) => ({ rep, i, v: dispV(rep) })).sort((a, b) => (b.v - a.v) || (a.i - b.i));
  const groups: Array<{ v: number; reps: string[] }> = [];
  for (const r of railRows) {
    const g = groups.find((q) => q.v === r.v);
    if (g) g.reps.push(r.rep); else groups.push({ v: r.v, reps: [r.rep] });
  }
  // A selection is presentation state and can outlive the thing it names — an
  // authored edit starts a new run. A stale selection is DROPPED, never resolved
  // against a node that no longer exists.
  const raw = st.selection;
  const sel: ElectricalSelection | null =
    raw === null ? null
      : raw.kind === 'node' ? (c.nodes.some((n) => n.id === raw.id) ? raw : null)
        : raw.kind === 'resistor' ? (resistors.some((r) => r.id === raw.id) ? raw : null)
          : (raw.id === src.id ? raw : null);
  const selRep = sel?.kind === 'node' ? merge.find(sel.id) : null;

  const LINE = 9;
  const labelH = (g: { reps: string[] }): number => LINE * (g.reps.length + 1);
  const need = groups.reduce((a, g) => a + labelH(g) + 6, 0);
  // NOTHING IS EVER CLAMPED. At a fixed V/px the drawing simply grows to hold
  // whatever potentials this run has, so two distinct potentials can never be
  // squashed onto one height to fit a window.
  const yr = (v: number): number => -v / vpp;
  // BOTH runs are in the extent. Excluding the pinned one drew ghosts outside the
  // viewBox — evidence clipped off-screen rather than compared. See D-47.
  const yAll = [...vals.map(yr), ...pinnedDisp.map((n) => yr(n.v)), yr(0)];
  const yMin = Math.min(...yAll), yMax = Math.max(...yAll);
  const drawH = yMax - yMin;
  const slack = Math.max(0, need + 10 - drawH) / 2;
  const H = Math.max(178, TOP + BOT + Math.max(drawH, need + 10));
  const y = (v: number): number => TOP + slack + (yr(v) - yMin);
  const app = ampsPerPixel(fullI);           // A per px of arrow width ABOVE ARROW_BASE

  // Label blocks are NUDGED APART so they stay legible. The RAIL LINE itself
  // stays at the true encoded height and a thin leader joins the two, so nothing
  // about the encoding moves — only the text does.
  let cursor = TOP - LINE;
  const placed = groups.map((g) => {
    const gy = y(g.v), h = labelH(g);
    const top = Math.max(gy - h / 2, cursor + 6);
    cursor = top + h;
    return { g, gy, top, h };
  });

  const railSvg = placed.map(({ g, gy, top, h }) => {
    const on = g.reps.some((r) => r === selRep);
    const isRef = g.reps.includes(refRep);
    const names = g.reps.map((rep, k) => {
      const ty = top + LINE * (k + 1) - 2;
      return `<g class="railpick${rep === selRep ? ' on' : ''}" data-elec-select="node:${escapeHtml(rep)}" tabindex="0" role="button"
          aria-label="node ${escapeHtml(railName(rep))} at ${fs(g.v)} volts">
        <rect class="railhit" x="0" y="${(ty - LINE + 1).toFixed(1)}" width="${RAIL_L - 6}" height="${LINE}" />
        <text class="rlab" x="${RAIL_L - 8}" y="${ty.toFixed(1)}" text-anchor="end">${escapeHtml(railName(rep))}</text></g>`;
    }).join('');
    const vy = top + LINE * (g.reps.length + 1) - 2;
    const mid = top + h / 2;
    return `<g class="rail${on ? ' on' : ''}">
      <line class="leader" x1="${(RAIL_L - 5).toFixed(1)}" y1="${mid.toFixed(1)}" x2="${RAIL_L}" y2="${gy.toFixed(1)}" />
      <g data-elec-select="node:${escapeHtml(g.reps[0])}">
        <rect class="railhit" x="${RAIL_L}" y="${(gy - 6).toFixed(1)}" width="${RAIL_R - RAIL_L}" height="12" />
        <line class="railline" x1="${RAIL_L}" y1="${gy.toFixed(1)}" x2="${RAIL_R}" y2="${gy.toFixed(1)}" />
        <rect class="railcap" x="${RAIL_L - 3}" y="${(gy - 3).toFixed(1)}" width="6" height="6" /></g>
      ${names}
      <text class="rval" x="${RAIL_L - 8}" y="${vy.toFixed(1)}" text-anchor="end">${fs(g.v)} V${isRef ? ' = displayed 0' : ''}</text>
    </g>`;
  }).join('');

  // The displayed zero line. Dashed, because it is a CHOSEN datum, not a thing.
  const zeroY = y(0);
  const zeroSvg = `<line class="zeroline" x1="${RAIL_L - 2}" y1="${zeroY.toFixed(1)}" x2="${RAIL_R}" y2="${zeroY.toFixed(1)}" />
    <text class="zlab" x="${RAIL_R}" y="${(zeroY + 9).toFixed(1)}" text-anchor="end">displayed 0 V datum</text>`;

  // ---- CONNECTORS.  Only components that span TWO rails are drawn between
  // rails. A wire always merges its two nodes into ONE rail, so a wire never
  // spans anything: it is annotated on the rail it collapsed into.
  const spanning: Array<{ kind: 'resistor' | 'source'; id: string }> = [
    { kind: 'source', id: src.id },
    ...resistors.filter((r) => merge.find(r.a) !== merge.find(r.b)).map((r) => ({ kind: 'resistor' as const, id: r.id })),
  ];
  const SLOT_R = RAIL_R - 8;
  const slotW = Math.max(20, (SLOT_R - RAIL_L - 12) / Math.max(1, spanning.length));
  const slotX = (i: number): number => RAIL_L + 12 + slotW * (i + 0.5);

  /**
   * NUMBERED CALLOUTS, not names, inside the drawing. Component names written on
   * the diagram overlapped each other and the rails at every slot spacing that
   * fitted the panel — seen on screen, not in a test. The badge carries the
   * identity; the LEGEND below carries the full name and the full-precision
   * reading, at readable size. The number by the arrow is still there, so the
   * arrow itself never depends on colour or width alone.
   */
  const legend: string[] = [];

  const connSvg = spanning.map((s, i) => {
    const x = slotX(i), n = i + 1;
    const badge = (by: number): string =>
      `<circle class="badge" cx="${x.toFixed(1)}" cy="${by.toFixed(1)}" r="6.5" />
       <text class="bnum" x="${x.toFixed(1)}" y="${(by + 3).toFixed(1)}" text-anchor="middle">${n}</text>`;
    /*
     * The reading is CENTRED IN ITS OWN SLOT, below the badge, with a dark halo
     * (paint-order: stroke) so it stays readable where it crosses its own arrow.
     * Side-anchored captions ran into the NEXT slot's caption as soon as the
     * ladder compressed — seen on screen at 6 V, not in a test.
     */
    const tx = x.toFixed(1), ta = 'middle';
    if (s.kind === 'source') {
      const on = sel?.kind === 'source';
      /*
       * THE ARROW FOLLOWS THE CONVENTIONAL CURRENT *INSIDE* THE SOURCE, and its
       * label is DERIVED from the two potentials it actually connects — never
       * asserted. Drawing it always negative-to-positive and always calling it
       * "the RISE" was WRONG the moment the authored EMF went negative: current
       * then enters the positive terminal, and the arrow pointed DOWN the page
       * while the caption said RISE. Found by reversing the polarity on screen.
       */
      const fromRep = sol.sourceCurrent >= 0 ? merge.find(src.neg) : merge.find(src.pos);
      const toRep = sol.sourceCurrent >= 0 ? merge.find(src.pos) : merge.find(src.neg);
      const yf = y(dispV(fromRep)), yt = y(dispV(toRep));
      // A potential DIFFERENCE, so it does not depend on the displayed reference.
      const rise = dispV(toRep) - dispV(fromRep);
      const flat = rise === 0;
      const mid = (yf + yt) / 2;
      const word = flat ? 'no rise: 0 V' : rise > 0 ? `the RISE ${fsig(rise)} V` : `a FALL ${fsig(rise)} V`;
      // Short inside the drawing, where a long caption lands on the next arrow;
      // the full signed value is in the legend line below at full precision.
      const shortWord = flat ? 'no rise' : rise > 0 ? 'the RISE' : 'a FALL';
      legend.push(`<li><b>${n}</b> &mdash; <b>SOURCE ${escapeHtml(src.label)}</b> (${escapeHtml(src.id)}),
        EMF ${f(src.voltage)} V, current ${fsig(sol.sourceCurrent)} A out of its positive terminal, delivering
        ${f(sol.sourceDeliveredPower)} W. The green edge follows the conventional current <b>inside</b> the source,
        from ${escapeHtml(railName(fromRep))} to ${escapeHtml(railName(toRep))}: ${flat
          ? '<b>zero EMF, so there is no rise at all and no current.</b>'
          : rise > 0 ? `<b>a RISE of ${fsig(rise)} V — the source lifts the current it carries</b>, which is why a circuit is a loop and not a slope.`
            : `<b>a FALL of ${fsig(rise)} V: this source is ABSORBING, not supplying.</b>`}
        ${src.voltage < 0 ? '<b>The EMF is negative, so the positive terminal sits BELOW the negative one</b> — the arrow still follows the current, and the resistor heating below is unchanged by the reversal.' : ''}</li>`);
      return `<g class="conn src${on ? ' on' : ''}" data-elec-select="source:${escapeHtml(src.id)}" tabindex="0" role="button"
          aria-label="source ${escapeHtml(src.label)}, ${fs(sol.sourceCurrent)} amperes, drawn along the current inside it, ${word}">
        <rect class="connhit" x="${(x - 10).toFixed(1)}" y="${(Math.min(yf, yt) - 4).toFixed(1)}" width="20" height="${(Math.abs(yf - yt) + 8).toFixed(1)}" />
        <line class="srcline" x1="${x.toFixed(1)}" y1="${yf.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yt.toFixed(1)}"
          marker-end="${flat ? 'none' : 'url(#riseArrow)'}" />
        ${badge(mid)}
        <text class="clab dimlab" x="${tx}" y="${(mid + 16).toFixed(1)}" text-anchor="${ta}">${shortWord}</text>
      </g>`;
    }
    const r = resistors.find((q) => q.id === s.id)!;
    const cur = currentOf(sol, r.id);
    const ya = y(dispV(merge.find(r.a))), yb = y(dispV(merge.find(r.b)));
    const zero = cur === 0;
    // Conventional current: A->B when I > 0, B->A when I < 0. EXACTLY ZERO gets
    // NO arrowhead — it must be impossible to read zero as "small".
    // A resistor between two rails at the SAME height is drawn FLAT: no drop, and
    // therefore, by I = dV/R, exactly no current.
    const flat = Math.abs(ya - yb) < 1.5;
    const y1 = cur >= 0 ? ya : yb, y2 = cur >= 0 ? yb : ya;
    const wdt = arrowWidthPx(zero ? 0 : cur, fullI);
    const on = sel?.kind === 'resistor' && sel.id === r.id;
    const mid = flat ? ya : (ya + yb) / 2;
    const dest = r.heatReceiver
      ? `heat &rarr; <b>${escapeHtml(sim.runtime(r.heatReceiver).desc.label)}</b> (${escapeHtml(r.heatReceiver)})`
      : 'heat &rarr; <b class="over">unmodelled heat destination</b>';
    legend.push(`<li><b>${n}</b> &mdash; <b>${escapeHtml(r.label)}</b> (${escapeHtml(r.id)}), ${f(r.resistance)} &#8486;,
      &Delta;V = ${fsig(sol.resistors.find((q) => q.id === r.id)!.voltage)} V,
      <b>I = ${fsig(cur)} A</b> ${zero ? '<b>&mdash; EXACTLY zero, drawn flat with no arrowhead</b>'
        : `(conventional current ${cur >= 0 ? 'A &rarr; B' : 'B &rarr; A'})`},
      P = ${f(sol.resistors.find((q) => q.id === r.id)!.power)} W, ${dest}.</li>`);
    const body = flat
      ? `<line class="resline flat" x1="${(x - 13).toFixed(1)}" y1="${ya.toFixed(1)}" x2="${(x + 13).toFixed(1)}" y2="${ya.toFixed(1)}" stroke-width="${wdt.toFixed(2)}" />
         <line class="zerotick" x1="${(x - 13).toFixed(1)}" y1="${(ya - 4).toFixed(1)}" x2="${(x - 13).toFixed(1)}" y2="${(ya + 4).toFixed(1)}" />
         <line class="zerotick" x1="${(x + 13).toFixed(1)}" y1="${(ya - 4).toFixed(1)}" x2="${(x + 13).toFixed(1)}" y2="${(ya + 4).toFixed(1)}" />`
      : `<line class="resline" x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}"
           stroke-width="${wdt.toFixed(2)}" marker-end="${zero ? 'none' : 'url(#curArrow)'}" />`;
    return `<g class="conn res${on ? ' on' : ''}${zero ? ' zero' : ''}" data-elec-select="resistor:${escapeHtml(r.id)}" tabindex="0" role="button"
        aria-label="resistor ${escapeHtml(r.label)} carrying ${fs(cur)} amperes">
      <rect class="connhit" x="${(x - 12).toFixed(1)}" y="${(Math.min(ya, yb) - 5).toFixed(1)}" width="24" height="${(Math.abs(ya - yb) + 10).toFixed(1)}" />
      ${body}${badge(mid)}
      <text class="clab ${zero ? 'zerolab' : 'curlab'}" x="${tx}" y="${(flat ? mid - 11 : mid + 16).toFixed(1)}" text-anchor="${ta}">${
        zero ? '0 A' : `${fs(cur)} A`}</text>
    </g>`;
  }).join('');

  // Ghost marks from the pinned reference: the SAME axis, so two runs are
  // genuinely comparable rather than each renormalised to itself.
  const ghost = st.pinned && !pinBroken ? placed.map(({ g }) => {
    const p = pinnedDisp.find((n) => g.reps.includes(n.rep));
    if (!p) return '';
    const yy = y(p.v);
    return `<line class="ghost" x1="${RAIL_L}" y1="${yy.toFixed(1)}" x2="${(RAIL_L + 22).toFixed(1)}" y2="${yy.toFixed(1)}" />`;
  }).join('') : '';

  // markerUnits="userSpaceOnUse" so the ARROWHEAD IS A CONSTANT SIZE. Left on the
  // default it scales with stroke width, and a wide (large-current) arrow grew a
  // head that swallowed the drawing — seen on screen, not in a test.
  const svg = `<svg class="ladder" viewBox="0 0 ${W} ${H}" width="100%" role="img"
      aria-label="node potential ladder: vertical position encodes electric potential in volts against the displayed zero">
    <defs>
      <marker id="curArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9"
        markerUnits="userSpaceOnUse" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#6fb3e0" /></marker>
      <marker id="riseArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9"
        markerUnits="userSpaceOnUse" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#7fd1a8" /></marker>
    </defs>
    <text class="axtitle" x="4" y="12">potential / V — an ENCODING, not a height</text>
    ${zeroSvg}${ghost}${connSvg}${railSvg}
  </svg>`;

  // ---- SCALE BLOCK.  Printed in SI, always, pinned or not. ----------------
  const scaleBlock = `<div class="scalebox">
    <div><b>Scales, stated in SI and never hidden.</b> ${st.pinned ? '<b class="pin">PINNED</b>' : 'auto (fits this drawing)'}</div>
    <div>potential: <b>${f(vpp)} V per drawing unit</b>. This run spans <b>${f(rawSpan)} V</b>
      (${f(rawLo)} … ${f(rawHi)} V as displayed)${st.pinned
        ? ' — drawn at the <b>pinned</b> V/px, so a smaller span draws a <b>shorter</b> ladder instead of being renormalised to full height. <b>Nothing is clamped:</b> the drawing grows if it must.'
        : ''}</div>
    <div>current: widest arrow = <b>${f(fullI)} A</b> → <b>${f(app)} A per drawing unit of width</b>
      above a <b>${ARROW_BASE}-unit baseline</b> — the baseline is a visibility pedestal shared by every
      nonzero arrow, so subtract it before reading a width, and it cancels out of any width
      <i>difference</i>. Exactly zero is drawn flat and greyed at ${ARROW_ZERO} units with no arrowhead.${
      overI ? ` <b class="over">— |I| reaches ${f(rawFullI)} A, ABOVE the pinned full scale</b>` : ''}</div>
    ${pinBroken ? `<div class="refusal"><b>THE PINNED COMPARISON IS INVALIDATED, NOT GUESSED.</b>
      The node now chosen as the displayed zero does not exist in the pinned run, so there is no
      correct constant by which to express that run against this zero. Drawing the ghosts anyway
      would put two runs on one axis while silently referring them to two different zeros — a
      difference that is not there. No ghost marks are drawn. Choose a reference the pinned run
      also has, or release the pin.</div>` : ''}
    ${st.pinned && !pinBroken ? `<div class="dim">Pinned ${escapeHtml(st.pinned.at)}. Faint left-hand ticks are the pinned run's node
      potentials on <b>this same axis</b>. Changing R or the EMF now redraws <b>on the frozen scale</b>, so a halved
      current draws a visibly thinner arrow instead of being renormalised back to full width.
      Both runs are referred to the <b>same displayed zero</b> and both are inside the drawn extent,
      so a ghost can neither drift under a reference shift nor be clipped off-screen.</div>` : ''}
    <div class="dim"><b>A DRAWING UNIT IS NOT A SCREEN PIXEL.</b> This diagram is
      <code>width="100%"</code> over a ${W}-unit viewBox, so it is rescaled to whatever width the panel
      currently has and one drawing unit is only <i>approximately</i> one screen pixel. The scales above
      are exact in drawing units and are what the geometry is built from; measuring the rendered image
      with a screen ruler picks up that rescaling and will not reproduce them. This is why every value
      is also printed as a number.</div>
    <div class="dim"><b>Colour and width are never the only carrier</b>: every bar, arrow and temperature also prints
      its SI number, so the view is fully readable with colour discrimination absent.</div>
    <div class="grp">
      <button data-elec="${st.pinned ? 'unpin' : 'pin'}">${st.pinned ? 'Release pinned scales' : 'Pin scales for comparison'}</button>
    </div></div>`;

  // ---- REFERENCE SHIFT ----------------------------------------------------
  const refButtons = `<div class="grp">
    <button data-elec="ref:" aria-pressed="${!shifted}">source − (the model's own 0 V)</button>
    ${railRows.filter((r) => r.rep !== merge.find(src.neg)).map((r) =>
      `<button data-elec="ref:${escapeHtml(r.rep)}" aria-pressed="${r.rep === refRep}">${escapeHtml(railName(r.rep))}</button>`).join('')}
  </div>`;

  // ---- SEMANTIC ZOOM ------------------------------------------------------
  const detail = sel ? renderDetail(sim, st, sel, merge, dispV) : `<p class="dim">
    <b>Select a rail, a resistor or the source in the drawing above</b> (or with the buttons below) to expand it.
    Selection is presentation only: it changes nothing simulated.</p>
    <div class="grp">${[
      ...railRows.map((r) => `<button data-elec-select="node:${escapeHtml(r.rep)}">node ${escapeHtml(railName(r.rep))}</button>`),
      ...resistors.map((r) => `<button data-elec-select="resistor:${escapeHtml(r.id)}">resistor ${escapeHtml(r.label)}</button>`),
      `<button data-elec-select="source:${escapeHtml(src.id)}">source ${escapeHtml(src.label)}</button>`,
    ].join('')}</div>`;

  // ---- TEMPERATURE RAMP.  A LABELLED CHART SCALE. NOT INCANDESCENCE. ------
  const named = new Map<string, string[]>();
  for (const r of resistors) if (r.heatReceiver) named.set(r.heatReceiver, [...(named.get(r.heatReceiver) ?? []), r.label]);
  const receivers = sim.thermal.bodies.filter((b) => named.has(b.id)).map((b) => {
    const d = sim.runtime(b.id).desc;
    return { id: b.id, label: d.label, T: temperature(d.thermal!, b.heat), T0: d.thermal!.initialTemperature, from: named.get(b.id)! };
  });
  // The ramp runs from the AUTHORED STARTING temperature, so an empty bar means
  // "no rise yet" rather than an arbitrary window around whatever it reads now.
  const rawLoK = receivers.length ? Math.min(...receivers.map((r) => Math.min(r.T, r.T0))) : 0;
  const rawHiK = receivers.length ? Math.max(...receivers.map((r) => Math.max(r.T, r.T0))) : 1;
  const loK = st.pinned ? st.pinned.loK : Math.min(rawLoK, rawHiK - 1);
  const hiK = st.pinned ? st.pinned.hiK : Math.max(rawHiK, rawLoK + 1);
  const tempBlock = receivers.length ? `<h3>Named heat destinations</h3>
    <p>Each of these bodies is <b>named by a resistor</b> and receives <b>100%</b> of that resistor's Joule power.
      There is <b>no default receiver and no split</b>.</p>
    ${receivers.map((r) => {
      const t = Math.max(0, Math.min(1, (r.T - loK) / Math.max(1e-12, hiK - loK)));
      const pin = st.pinned?.receivers.find((x) => x.id === r.id);
      return `<div class="trow"><div><b>${escapeHtml(r.label)}</b> (${escapeHtml(r.id)}) ← ${
        escapeHtml(r.from.join(', '))}</div>
        <div class="tbar"><i style="width:${(t * 100).toFixed(1)}%"></i></div>
        <div><b>${f(r.T)} K</b> &middot; started at ${f(r.T0)} K &middot; risen ${fsig(r.T - r.T0)} K${
          pin ? ` &middot; pinned run ${f(pin.t)} K, difference ${fsig(r.T - pin.t)} K` : ''}</div></div>`;
    }).join('')}
    <p class="dim"><b>The colour ramp is a LABELLED VISUALIZATION SCALE</b> running
      <b>${f(loK)} K</b> (empty &mdash; the authored starting temperature) to <b>${f(hiK)} K</b> (full)${st.pinned ? ' — <b class="pin">PINNED</b>, so two runs share it' : ''}.
      <b>It is not simulated incandescence</b>, not a blackbody colour and not a claim about visible emission. The
      kelvin number beside it is the value; the bar is decoration for it.</p>`
    : `<h3>Named heat destinations</h3><p>No resistor here names a receiver, so every joule dissipated is an
      <b>explicitly unmodelled heat destination</b> — outgoing, reported, and given to no body.
      Cumulative unrouted dissipation: <b>${f(sim.electrical.unroutedEnergy)} J</b>.</p>`;

  // ---- THE HONESTY BLOCK.  Not an appendix: it is the point. --------------
  const honesty = `<details class="elechonest" ${st.honestyOpen ? 'open' : ''}>
    <summary data-elec="honesty">What these pictures mean, and what they do NOT mean</summary>
    <p><b>1 &middot; Height here is an ENCODING of potential, not a height.</b> Electric potential is <b>joules per
      coulomb</b>; gravitational potential is <b>joules per kilogram</b>. They are different quantities in different
      units. The vertical axis is a chart axis. <b>No physical body in the viewport is moved, tilted or re-posed to
      indicate a voltage</b>, and the horizontal placement of a rail is layout only and means nothing.</p>
    <p><b>2 &middot; This is NOT a spatial electric-field solution.</b> The solver gives one potential per merged node
      and <b>no value anywhere else</b>. So nothing is drawn between nodes: <b>no interpolated glow, no gradient, no
      contour, no field line, no particle and no electron</b>. Drawing one would be inventing data the model does not
      have.</p>
    <p><b>3 &middot; &ldquo;Current always flows downhill&rdquo; is FALSE for a complete loop.</b> A circuit is a loop;
      if current only ever fell it could never return. <b>Ideal wires carry current between nodes at exactly equal
      potential</b> — no drop at all — and <b>the source supplies the RISE</b>: inside the source, current goes from
      the terminal it enters to the terminal it leaves, and <b>that is a rise in potential whichever terminal is which</b>
      — with a negative authored EMF the positive terminal sits <i>below</i> the negative one and the rise is still a
      rise. <b>Only through a passive resistor</b> does conventional current follow the voltage drop. That is why the
      source edge above is drawn along the current <b>inside</b> the source and labelled from the two potentials it
      actually connects, rather than always pointing from negative to positive.</p>
    <p><b>4 &middot; The reference is a choice.</b> Shifting the displayed reference <b>adds one constant to every
      displayed potential and changes NO voltage difference, NO current, NO power and NO heat</b>. Try the buttons:
      every height <b>label</b> changes, the dashed <b>0 V datum moves to a different rail</b>, and every &Delta;V, I,
      P and Q printed on this page stays <b>identical</b>. The <b>gaps</b> between rails do not move, and that is not
      the drawing failing to respond — a gap <b>is</b> a potential difference, and potential differences are exactly
      what a reference shift cannot touch. <b>Only differences are physical; the absolute number is bookkeeping.</b></p>
    <p><b>5 &middot; Reversing the source polarity reverses every current arrow but NOT the resistor heat.</b>
      <b>P = V&sup2;/R</b> is even in the sign of V, so the arrows flip and the heating is unchanged.</p>
    <p><b>6 &middot; Arrows are CONVENTIONAL current</b> — the direction positive charge would move. This is not
      the electron drift direction, and this view makes no claim about charge carriers. Sign convention: <b>positive
      A &rarr; B</b>, <b>V = V(A) &minus; V(B)</b>; a negative current is drawn pointing B &rarr; A with its signed
      number shown. Nothing animates: width is |I| in amperes and that is all. <b>Exactly zero is drawn as a flat
      hairline with no arrowhead and the words &ldquo;0 A &mdash; no current&rdquo;</b>, so zero can never read as
      small.</p>
    <p><b>7 &middot; No per-wire arrow is drawn.</b> <b>This view does not compute individual wire currents.
      Ideal-wire loops can make their allocation nonunique; connected nodes share one potential.</b> A wire bridge in a
      tree <i>can</i> have a current fixed by KCL &mdash; the earlier blanket claim that the ideal model determines no
      wire current at all was too broad and is corrected — but this scope displays the merged potential and
      <b>no wire current at all</b>, and <b>builds no wire-current solver</b>.</p>
    <p><b>8 &middot; Static DC only.</b> No propagation, no delay, no transient, no RC, no switching, no semiconductor
      and no temperature feedback. Nothing here says how the circuit reached this state.</p></details>`;

  const wireNote = wires.length ? `<p class="dim"><b>Ideal wires:</b> ${wires.map((w) =>
    `${escapeHtml(w.label)} (${escapeHtml(w.id)}) merges ${escapeHtml(nodeLabel(w.a))} and ${escapeHtml(nodeLabel(w.b))}`).join('; ')}.
    Each has <b>collapsed into one rail</b> above, so it spans nothing and carries <b>no drawn arrow</b>.</p>` : '';
  const shortedNote = resistors.some((r) => merge.find(r.a) === merge.find(r.b))
    ? `<p class="dim">${resistors.filter((r) => merge.find(r.a) === merge.find(r.b)).map((r) => escapeHtml(r.label)).join(', ')}
       ${resistors.filter((r) => merge.find(r.a) === merge.find(r.b)).length > 1 ? 'have' : 'has'} both terminals on one
       merged node, so ${'it carries EXACTLY zero current'} and is not drawn between rails.</p>` : '';

  return `${head}
  <p>The numbers below are the accepted solution, <b>drawn</b>. Nothing here is computed, estimated or interpolated;
    the drawing adds no physics. <b>This electrical layout is entirely separate from the mechanical viewport</b> —
    electrical connection is by node id, and no body position, contact or drawn crossing has any electrical meaning.</p>
  <h3>1 &middot; Node potentials, as bar heights</h3>
  <p>Vertical position encodes <b>potential in volts</b> against the displayed zero. Rails at the same height are at
    the <b>same potential</b>; the gap between two rails <b>is</b> their potential difference. Connectivity is drawn as
    the components between the rails, so the circuit stays readable as a circuit.</p>
  ${svg}
  <ol class="eleg">${legend.join('')}</ol>
  ${scaleBlock}
  <p><b>Displayed reference</b> — a choice, not a fact. ${shifted
    ? `<b class="over">SHIFTED: potentials are displayed against ${escapeHtml(railName(refRep))}, which the drawing now
       calls 0.</b> Every height <b>label</b> changed and the dashed datum moved; <b>every &Delta;V, current, power and
       heat on this page is unchanged</b>, and so is the <b>spacing</b> between rails — a spacing IS a potential
       difference, and a reference shift cannot touch one. The model's own reference is still the source's negative
       terminal.`
    : 'Potentials are displayed against the model’s own 0 V reference: the source’s negative terminal. Shift it below and watch every label change while no difference, current, power or heat does.'}</p>
  ${refButtons}
  <h3>2 &middot; Oriented resistor currents</h3>
  <p>One arrow per resistor, pointing along <b>conventional current</b>. <b>Width encodes |I|</b> at the printed
    amperes-per-drawing-unit, and <b>every arrow also carries its number in amperes</b>. Sign convention:
    <b>positive A &rarr; B</b> with <b>V = V(A) &minus; V(B)</b>; a negative current is drawn B &rarr; A.
    <b>Exactly zero is drawn as zero</b>: a flat greyed hairline with no arrowhead.</p>
  ${wireNote}${shortedNote}
  <h3>3 &middot; Selected detail</h3>
  ${detail}
  ${tempBlock}
  ${honesty}
  </section>`;
}

const currentOf = (sol: NonNullable<SimWorld['circuitSolution']>, id: string): number =>
  sol.resistors.find((x) => x.id === id)?.current ?? 0;

// ---------------------------------------------------------------------------
// SEMANTIC ZOOM.  Every value here is already in the accepted solution: this
// reveals no new physics, probes nothing and perturbs nothing.
// ---------------------------------------------------------------------------

function renderDetail(
  sim: SimWorld, st: ElectricalViewState, sel: ElectricalSelection,
  merge: NodeMerge, dispV: (rep: string) => number,
): string {
  const c = sim.construction!.circuit!;
  const sol = sim.circuitSolution!;
  const src = sourcesOf(c)[0];
  const resistors = resistorsOf(c);
  const nodeLabel = (id: string): string => c.nodes.find((x) => x.id === id)?.label ?? id;
  const close = '<div class="grp"><button data-elec="clear">Close this detail</button></div>';

  if (sel.kind === 'node') {
    const rep = merge.find(sel.id);
    const members = merge.members(rep);
    // SIGN CONVENTION, stated: POSITIVE = INTO THIS NODE.
    const branches: Array<{ what: string; into: number; note: string }> = [];
    for (const r of resistors) {
      const ra = merge.find(r.a), rb = merge.find(r.b);
      if (ra === rb) {
        if (ra === rep) branches.push({ what: `${r.label} (${r.id})`, into: 0, note: 'both terminals on this merged node — EXACTLY zero' });
        continue;
      }
      const i = currentOf(sol, r.id);
      if (ra === rep) branches.push({ what: `${r.label} (${r.id})`, into: -i, note: 'terminal A here; +I leaves A, so it enters as −I' });
      else if (rb === rep) branches.push({ what: `${r.label} (${r.id})`, into: +i, note: 'terminal B here; +I arrives at B' });
    }
    const isPos = merge.find(src.pos) === rep, isNeg = merge.find(src.neg) === rep;
    if (isPos) branches.push({ what: `${src.label} (${src.id}) — SOURCE branch`, into: +sol.sourceCurrent, note: 'positive terminal: the source drives current INTO this node' });
    if (isNeg) branches.push({ what: `${src.label} (${src.id}) — SOURCE branch`, into: -sol.sourceCurrent, note: 'negative terminal: current returns OUT of this node into the source' });
    const sum = branches.reduce((a, b) => a + b.into, 0);
    const scale = branches.reduce((a, b) => a + Math.abs(b.into), 0);
    const tol = Math.max(1e-12, 1e-9 * scale);
    return `<div class="zoom"><h4>NODE &mdash; ${escapeHtml(members.map(nodeLabel).join(' = '))}</h4>
      <p>Authored node${members.length > 1 ? 's' : ''} <b>${members.map((m) => escapeHtml(m)).join(', ')}</b>${
        members.length > 1 ? ', <b>merged into one potential by ideal wire(s)</b> — a wire is not a small resistor' : ''}.</p>
      <div class="row strong"><span class="k">potential, model reference (source − = 0 V)</span><span class="v">${f(sol.nodeVoltages.find((n) => n.rep === rep)!.voltage)} V</span></div>
      <div class="row"><span class="k">potential as displayed here</span><span class="v">${f(dispV(rep))} V</span></div>
      <p><b>Incident branch currents.</b> Sign convention: <b>positive means INTO this node</b>. Ideal wires appear
        nowhere in this sum — this view computes no individual wire current; ideal-wire loops can make their
        allocation nonunique, and connected nodes share one potential.</p>
      <div class="scroll-x"><table><thead><tr><th>Branch</th><th>I into node (A)</th><th>why that sign</th></tr></thead>
        <tbody>${branches.map((b) => `<tr><td>${escapeHtml(b.what)}</td><td>${fsig(b.into)}</td><td class="dim">${b.note}</td></tr>`).join('')
        || '<tr><td colspan="3">no incident branch</td></tr>'}</tbody></table></div>
      <div class="row strong"><span class="k">SIGNED KCL SUM &Sigma;I<sub>into</sub></span><span class="v">${fsig(sum)} A</span></div>
      <p class="dim">Accepted against <b>max(1e-12 A, 1e-9 &times; ${f(scale)} A) = ${f(tol)} A</b> &mdash; the frozen,
        scale-aware KCL threshold, not a threshold chosen after seeing this number.</p>
      ${isPos || isNeg ? '<p class="dim">This node carries a <b>source terminal</b>, so the source branch is part of the sum. Without it the resistor branches alone would not close, and that would not be a solver failure.</p>' : ''}
      ${close}</div>`;
  }

  if (sel.kind === 'resistor') {
    const r = resistors.find((x) => x.id === sel.id);
    if (!r) return `<p class="dim">That resistor is no longer in the circuit.</p>${close}`;
    const s = sol.resistors.find((x) => x.id === r.id)!;
    const va = voltageAt(sol, merge, r.a), vb = voltageAt(sol, merge, r.b);
    const acc = sim.electrical.resistors.find((x) => x.id === r.id);
    const dest = r.heatReceiver
      ? (() => { const d = sim.runtime(r.heatReceiver!).desc; return `<b>${escapeHtml(d.label)}</b> (${escapeHtml(r.heatReceiver!)})`; })()
      : '<b class="over">unmodelled heat destination</b>';
    const routed = (sim.thermal.routedElectrical ?? []).find((x) => x.componentId === r.id)?.heat ?? 0;
    const pin = st.pinned?.resistors.find((x) => x.id === r.id);
    return `<div class="zoom"><h4>RESISTOR &mdash; ${escapeHtml(r.label)} (${escapeHtml(r.id)})</h4>
      <p>Terminal <b>A = ${escapeHtml(nodeLabel(r.a))}</b> (${escapeHtml(r.a)}) &rarr;
         <b>B = ${escapeHtml(nodeLabel(r.b))}</b> (${escapeHtml(r.b)}). Current is <b>positive A &rarr; B</b>.</p>
      <div class="row"><span class="k">V(A), model reference</span><span class="v">${f(va)} V</span></div>
      <div class="row"><span class="k">V(B), model reference</span><span class="v">${f(vb)} V</span></div>
      <div class="row strong"><span class="k">&Delta;V = V(A) &minus; V(B)</span><span class="v">${fsig(s.voltage)} V</span></div>
      <div class="row strong"><span class="k">I (positive A &rarr; B)</span><span class="v">${fsig(s.current)} A</span></div>
      <div class="row"><span class="k">R (authored)</span><span class="v">${f(r.resistance)} &#8486;</span></div>
      <div class="row strong"><span class="k">P = V&sup2;/R</span><span class="v">${f(s.power)} W</span></div>
      <div class="row"><span class="k">cumulative dissipation</span><span class="v">${f(acc?.energy ?? 0)} J</span></div>
      <div class="row strong"><span class="k">thermal destination</span><span class="v">${dest}</span></div>
      ${r.heatReceiver
        ? `<div class="row"><span class="k">delivered to it so far</span><span class="v">${f(routed)} J</span></div>
           <p class="dim"><b>100%</b> of this resistor's Joule power goes to that one named body. No default receiver, no split.</p>`
        : `<p class="dim"><b>This resistor has no named destination.</b> Its ${f(acc?.energy ?? 0)} J is
           <b>explicitly outgoing and unmodelled</b>: it is reported, given to no body, and not silently discarded.</p>`}
      ${s.current === 0 ? '<p class="dim"><b>EXACTLY zero current</b>, hence exactly zero power and zero heat — not a small number, and not a rounding artefact.</p>' : ''}
      ${pin ? `<p class="dim">Pinned run: I = ${fsig(pin.i)} A, P = ${f(pin.p)} W &middot; change
        ${fsig(s.current - pin.i)} A, ${fsig(s.power - pin.p)} W — both runs drawn on the SAME pinned scale above.</p>` : ''}
      <p class="dim"><b>Reversing the source polarity would reverse I and &Delta;V but leave P unchanged</b>:
        P = V&sup2;/R is even in the sign of V, so the heating does not flip with the arrows.</p>
      ${close}</div>`;
  }

  const e = sim.electrical;
  const pin = st.pinned;
  return `<div class="zoom"><h4>SOURCE &mdash; ${escapeHtml(src.label)} (${escapeHtml(src.id)})</h4>
    <p>EMF <b>${f(src.voltage)} V</b>, with <b>${escapeHtml(nodeLabel(src.neg))}</b> as the model's
      <b>0 V reference</b> and <b>${escapeHtml(nodeLabel(src.pos))}</b> as the positive terminal.
      ${sol.sourceCurrent === 0 || src.voltage === 0
        ? '<b>No current and no rise.</b>'
        : `Conventional current runs <b>inside</b> the source from
           <b>${escapeHtml(nodeLabel(sol.sourceCurrent >= 0 ? src.neg : src.pos))}</b> to
           <b>${escapeHtml(nodeLabel(sol.sourceCurrent >= 0 ? src.pos : src.neg))}</b>, a
           <b>${sol.sourceDeliveredPower > 0 ? 'RISE' : 'FALL'}</b> of
           <b>${f(Math.abs(src.voltage))} V</b>. <b>The source supplies that rise</b> — which is why a circuit is a
           loop and not a slope, and why "current always flows downhill" is false for a complete circuit.`}
      ${src.voltage < 0 ? '<b>This EMF is negative: the positive terminal sits BELOW the negative one, every current arrow is reversed, and every resistor power is unchanged.</b>' : ''}</p>
    <div class="row strong"><span class="k">current the whole network demands</span><span class="v">${fsig(sol.sourceCurrent)} A</span></div>
    <div class="row strong"><span class="k">power the whole network demands</span><span class="v">${f(sol.sourceDeliveredPower)} W</span></div>
    <div class="row"><span class="k">&Sigma; resistor power (independently summed)</span><span class="v">${f(sol.resistorPowerTotal)} W</span></div>
    <div class="row strong"><span class="k">cumulative energy supplied</span><span class="v">${f(e.suppliedEnergy)} J</span></div>
    <div class="row dim"><span class="k">over</span><span class="v">${e.ticks} public ticks = ${f(e.ticks / 60)} simulated s</span></div>
    ${pin ? `<div class="row dim"><span class="k">pinned run at the pin</span><span class="v">${fsig(pin.sourceCurrent)} A, ${f(pin.suppliedEnergy)} J</span></div>` : ''}
    <p class="dim"><b>This is energy crossing the boundary from an IDEAL EXTERNAL SOURCE.</b> It is never energy
      created inside the world. <b>The source has no finite stored charge: nothing is stored and nothing depletes</b>,
      and no internal resistance or self-heating is modelled for it or for the ideal wires.</p>
    <p class="dim">Sign convention: current is <b>positive out of the positive terminal</b> into the network, and
      delivered power is positive when the external source is <b>supplying</b> the network.</p>
    ${close}</div>`;
}

// ---------------------------------------------------------------------------
// PINNING.  Freeze the CURRENT drawing scale and the values it was frozen at.
// ---------------------------------------------------------------------------

export function pinScales(sim: SimWorld, st: ElectricalViewState): PinnedScale | null {
  const c = sim.construction?.circuit;
  const sol = sim.circuitSolution, merge = sim.circuitMerge;
  if (!c || !sol || !merge || sim.electrical.rejected) return null;
  const src = sourcesOf(c)[0];
  const refRep = st.displayRef ? merge.find(st.displayRef) : merge.find(src.neg);
  const off = voltageAt(sol, merge, refRep);
  const vals = sol.nodeVoltages.map((n) => n.voltage - off);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = Math.max(hi - lo, 1e-12);
  const maxI = Math.max(...sol.resistors.map((r) => Math.abs(r.current)), Math.abs(sol.sourceCurrent), 0);
  const temps = sim.thermal.bodies
    .filter((b) => resistorsOf(c).some((r) => r.heatReceiver === b.id))
    .map((b) => ({ id: b.id, t: temperature(sim.runtime(b.id).desc.thermal!, b.heat), t0: sim.runtime(b.id).desc.thermal!.initialTemperature }));
  const tLo = temps.length ? Math.min(...temps.flatMap((x) => [x.t, x.t0])) : 0;
  const tHi = temps.length ? Math.max(...temps.flatMap((x) => [x.t, x.t0])) : 1;
  return {
    at: `at t = ${(sim.tick / 60).toFixed(2)} s, EMF ${src.voltage} V`,
    vpp: span / BASE_PLOT,
    fullI: maxI > 0 ? maxI : 1,
    loK: Math.min(tLo, tHi - 1), hiK: Math.max(tHi, tLo + 1),
    // MODEL reference, deliberately NOT `- off`: the display reference is a choice
    // the viewer can change after pinning, so it must not be baked in here.
    nodes: sol.nodeVoltages.map((n) => ({ rep: n.rep, v: n.voltage })),
    refRepAtPin: refRep,
    resistors: sol.resistors.map((r) => ({ id: r.id, i: r.current, p: r.power })),
    receivers: temps.map((x) => ({ id: x.id, t: x.t })),
    suppliedEnergy: sim.electrical.suppliedEnergy,
    sourceCurrent: sol.sourceCurrent,
  };
}
