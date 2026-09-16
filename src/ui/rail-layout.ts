/**
 * THE RAIL LAYOUT KIT — a deterministic template for the single-supply circuit family, and a fail-closed validator.
 *
 * Peter approved turning the fan's rail layout (his words: "MUCH MUCH BETTER") into something a smaller model can
 * use: it hands in a composition — parts with named ports on named nets — and gets back poses, drops, rails and
 * routes it did not have to author, plus NAMED diagnostics when the input cannot be laid out or the result would
 * be misleading. No three.js in here: everything is deck-plane geometry (x across, z toward the viewer, y up only
 * for lifted cables and the rotor), so it runs in vitest and in the page alike.
 *
 * WHAT THE TEMPLATE KNOWS: one supply, its + net (the RAIL, a bar along the back) and its − net (GROUND, a bar
 * along the front); every other net is a SIGNAL net. A part's ROLE is read from which of its two main ports sit
 * on which kind of net — nothing is guessed from names:
 *   rail ↔ ground   (a reference pot)      vertical column, rail end back, ground end front, wiper to the side
 *   rail ↔ signal   (a sensor: vertical, signal end forward; a motor: horizontal on the back row, rotor in front)
 *   signal ↔ ground (a divider resistor, a MOSFET: vertical, ground end front; stacked under an upstream partner
 *                    in the same group when they share a signal net)
 *   signal ↔ signal (a comparator, a series resistor: horizontal on the signal row, input on the left)
 *   signal ↔ rail   (a flyback diode: vertical beside its signal junction, rail end back, an L-route to the junction)
 * Groups are laid out left to right in the order given; inside a group, parts follow the signal chain.
 *
 * WHAT THE GEOMETRY TABLE KNOWS: for every kind the shared body's chord length, half-width (body plus tube radius),
 * every terminal's location relative to the chord (main ends, the pot's wiper, the comparator's inn/vcc/gnd pins,
 * the MOSFET's gate pin, the motor's shaft exit) and, for the motor, the rotor hub height and swept disc. These
 * numbers mirror `potential-scene.ts`; `PotentialScene.terminals()` exposes the drawn ones so a browser probe can
 * confirm the table (that confirmation is browser evidence, kept separate from these plane checks).
 *
 * WHAT THE VALIDATOR REFUSES, BY NAME: see `RailDiagnostic['cause']`. It measures real polylines (with tube
 * radius and cable lift) against real body bounds and the rotor's swept volume, distinguishes a junction from an
 * unconnected crossing by NET IDENTITY, and treats a lifted crossing as acceptable only with a tube diameter of
 * vertical clearance. It cannot see pixels: label overlap, marker obstruction and clipping are browser checks.
 */
import type { Composition, PartInstance } from '../model/conformance/composition';

export const TEMPLATE_VERSION = 'rail-template-1';
export const GEOMETRY_VERSION = 'deck-bodies-2026-09-10d';

// ---------------------------------------------------------------- geometry of the shared bodies (deck units)
export type DeckKind = 'resistor' | 'switch' | 'diode' | 'led' | 'pot' | 'ldr' | 'ntc' | 'comparator' | 'mosfet' | 'motor' | 'capacitor' | 'inductor';
/**
 * A terminal relative to the pose: `u` along the chord from −1 (first end) to +1 (second end); `dz` an ABSOLUTE
 * offset toward the viewer (+z) — the renderer places pins and the shaft toward +z whatever way the chord runs;
 * `y` the height above the deck where a cable leaves it.
 */
export interface TerminalRel { u: number; dz: number; y?: number   /** Direction a conductor leaves this terminal in, in body terms [along the chord, up, world +z]; main terminals default to outward along the chord. */
  exit?: [number, number, number];
}
export interface BodyGeometry {
  /** Preferred chord length (the pose's bodyLen). */
  len: number;
  /** Half-width of the DRAWN package across the chord (the conductor tube radius is added by the checks, not folded in here). */
  halfWidth: number;
  /** Height of the drawn body above the deck (mirrors the renderer; confirmed against `PotentialScene.geometry()` in the browser). */
  height: number;
  /** Terminal locations by port name; `main` names the two chord ends in order (first = the branch's `from`). */
  main: [string, string];
  terminals: Record<string, TerminalRel>;
  /** The motor only: rotor hub height above the deck and swept-disc radius (scene units), centred `rotorAhead` in front of the can. */
  rotor?: { hubY: number; radius: number; ahead: number };
  /** Half-length of the drawn PACKAGE along the chord when it is shorter than the terminal reach (the MOSFET's leads stick out of its package): a drop leaving a horizontal body must clear this face. */
  packageHalfLen?: number;
  /** Extra obstacle shapes of the drawn body besides its package (the pot's knob), as boxes relative to the pose centre in WORLD axes (not rotated with the chord). */
  extras?: { min: [number, number, number]; max: [number, number, number] }[];
  /** Offset of the package's centre across the chord (world +z) from the chord line, when the drawn package is not centred on it. */
  acrossOffset?: number;
}
export const TUBE_RADIUS = 0.175;   // TUBE_BASE + TUBE_PER_AMP at full scale (0.035 + 0.10·1.4)
/**
 * Mirrors the deck blocks of potential-scene.ts EXACTLY as they draw: each body sits between two lerp fractions of
 * its chord (its main terminals are THOSE points, where the leads end — not the chord ends), and its pins leave
 * toward +z by fixed offsets. Confirmed against the renderer by `PotentialScene.terminals()` in the browser probe.
 */
const f2u = (lo: number, hi: number): [number, number] => [2 * lo - 1, 2 * hi - 1];
const ends = (lo: number, hi: number, a: string, b: string): Record<string, TerminalRel> => { const [ua, ub] = f2u(lo, hi); return { [a]: { u: ua, dz: 0 }, [b]: { u: ub, dz: 0 } }; };
export const BODY_GEOMETRY: Record<DeckKind, BodyGeometry> = {
  resistor:   { len: 3.6, halfWidth: 0.275, height: 0.6, main: ['a', 'b'], terminals: ends(.52, .84, 'a', 'b') },                // the deck 'load' body: lerp .52….84, shell r .275
  // capacitor: two plates 0.32 apart about the chord's middle (lerp .42/.58 of a 3.6 chord), 0.8 wide, 0.65 high; the leads
  // end at the plates' outer faces. inductor: the winding between lerp .3 and .7, radius 0.4.
  capacitor:  { len: 3.6, halfWidth: 0.4,   height: 0.7, main: ['plus', 'minus'], terminals: ends(.42, .58, 'plus', 'minus') },
  inductor:   { len: 3.6, halfWidth: 0.4,   height: 0.85, main: ['plus', 'minus'], terminals: ends(.3, .7, 'plus', 'minus') },
  switch:     { len: 3.6, halfWidth: 0.425, height: 1.0, main: ['a', 'b'], terminals: ends(.3, .7, 'a', 'b') },
  diode:      { len: 3.6, halfWidth: 0.325, height: 0.7, main: ['anode', 'cathode'], terminals: ends(.3, .7, 'anode', 'cathode') },
  led:        { len: 3.6, halfWidth: 0.325, height: 0.8, main: ['anode', 'cathode'], terminals: ends(.3, .7, 'anode', 'cathode') },
  ldr:        { len: 3.0, halfWidth: 0.375, height: 0.3, main: ['a', 'b'], terminals: ends(.3, .7, 'a', 'b') },
  ntc:        { len: 3.0, halfWidth: 0.375, height: 0.7, main: ['a', 'b'], terminals: ends(.3, .7, 'a', 'b') },
  // pot: the TRACK from lerp .18 to .82, 0.36 wide and 0.14 high; the wiper at fraction f along it (f = 0.5 here), its lead
  // leaving 0.6 up (its exit is set from the layout's wiperSide); the KNOB is a dial 0.42 in radius, 0.22 thick, centred
  // 0.9 up and 0.9 toward −z from the track's middle — a separate obstacle (`extras`), not folded into one envelope.
  pot:        { len: 3.0, halfWidth: 0.18, height: 0.2, main: ['a', 'b'], terminals: { ...ends(.18, .82, 'a', 'b'), w: { u: 0, dz: 0, y: 0.6, exit: [0, 1, 0] } }, extras: [{ min: [-0.42, 0.48, -1.01], max: [0.42, 1.32, -0.79] }] },
  // comparator: a triangular PLATE 0.3 thick along the chord at the centre, 1.56 wide, 0.66 high; the + tip 0.7 before the
  // centre and the out pin 0.5 after it (absolute units on a 3.6 chord), the − pin 0.5 toward +z beside the tip (its cable
  // arrives along the chord), vcc 0.4 up at the centre and gnd 0.4 behind and 0.12 up — both INSIDE the plate, so their
  // cables leave straight UP.
  comparator: { len: 3.6, halfWidth: 0.78, height: 0.66, main: ['inp', 'out'], terminals: { inp: { u: -0.7 / 1.8, dz: 0 }, out: { u: 0.5 / 1.8, dz: 0 }, inn: { u: -0.7 / 1.8, dz: 0.5, exit: [-1, 0, 0] }, vcc: { u: 0, dz: 0, y: 0.4, exit: [0, 1, 0] }, gnd: { u: 0, dz: -0.4, y: 0.12, exit: [0, 1, 0] } }, packageHalfLen: 0.15 },
  // mosfet: the PACKAGE (slab + tab) between lerp .36 and .64 of the chord, 0.625 deep toward −z from the chord and 0.275
  // toward +z, 0.635 high; the gate PIN is a post from the package to 0.7 toward +z (an attachment point, not an obstacle)
  mosfet:     { len: 3.0, halfWidth: 0.32, height: 0.64, main: ['drain', 'source'], terminals: { ...ends(.32, .68, 'drain', 'source'), gate: { u: 0, dz: 0.7, exit: [0, 0, 1] } }, packageHalfLen: 0.43, acrossOffset: -0.04 },
  // motor: posts at lerp .26/.74; the can's axis 0.68 above the deck unmounted, the shaft exiting 0.75 toward +z. The
  // template RAISES the whole motor on a mount until the declared rotor disc clears the deck — the blade radius is the
  // page's declared scale and is never shrunk; `terminalAt` adds the pose's mount to the shaft height.
  motor:      { len: 5.0, halfWidth: 0.75, height: 1.36, main: ['plus', 'minus'], terminals: { ...ends(.26, .74, 'plus', 'minus'), shaft: { u: 0, dz: 0.75, y: 0.68 } }, rotor: { hubY: 0.68, radius: 1.3, ahead: 3.4 }, packageHalfLen: 0.62 },   // the can: 1.24 long along the chord, 1.5 along z; the posts stand 0.58 beyond it
};

/**
 * THE CABLE MODEL, mirroring `cable()` in potential-scene.ts: a centripetal Catmull–Rom through a, a + (side, lift, bow),
 * (a.x + side, b.y + lift, b.z + bow·1.55), b — sampled to a 3D polyline. An approximation of the drawn tube's centreline;
 * the renderer's own sampled route (`PotentialScene.geometry()`) is the truth and is validated separately in the browser.
 */
export function cablePoints3(a: [number, number, number], b: [number, number, number], bow: number, lift: number, side = 0, samples = 16): [number, number, number][] {
  const P: [number, number, number][] = [a, [a[0] + side, a[1] + lift, a[2] + bow], [a[0] + side, b[1] + lift, b[2] + bow * 1.55], b];
  const at = (u: number): [number, number, number] => {   // three segments P0→P1→P2→P3 (three.js maps u∈[0,1] over them equally), Barry–Goldman with centripetal knots, ends clamped
    const seg = Math.min(2, Math.floor(u * 3)); const i = seg + 1;
    const uu = u * 3 - seg;
    const p0 = P[Math.max(0, i - 2)], p1 = P[i - 1], p2 = P[i], p3 = P[Math.min(3, i + 1)];
    const knot = (a: number[], b: number[]) => Math.max(1e-4, Math.pow(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), .5));   // centripetal, never a zero interval (clamped ends repeat a point)
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const tt = t1 + (t2 - t1) * uu;
    const L = (pa: number[], pb: number[], ta: number, tb: number) => pa.map((v, k) => ((tb - tt) * v + (tt - ta) * pb[k]) / (tb - ta));
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3), C = L(B1, B2, t1, t2);
    return [C[0], C[1], C[2]];
  };
  const out: [number, number, number][] = []; for (let k = 0; k <= samples; k++) out.push(at(k / samples)); return out;
}

// ---------------------------------------------------------------- the template
export interface RailInput {
  /** The one supply: its name and its two nets (+ = rail, − = ground). */
  supply: { name: string; plus: string; minus: string };
  /** Parts as the composition has them, plus the group each belongs to (any string; groups lay out in `groups` order). */
  parts: { id: string; kind: DeckKind; ports: Record<string, string>; group: string; wiperFraction?: number }[];
  groups: string[];
}
export interface RailPose { id: string; kind: DeckKind; group: string; x: number; z: number; dir: [number, number]; len: number; role: string; column: number; /** motor only: how far the can is raised so the rotor clears the deck */ mount?: number }
/**
 * A drawn wire: plan points (x, z) with, for a cable, the sampled 3D centreline the renderer's curve gives (`points3`,
 * [x, y, z]); its net; its owner (a part, a bus, or the supply); and which terminals its ends land on (`ends`), which is
 * the ONLY contact a wire may make with a body — checked by port and net, never by owner.
 */
export interface Polyline { points: [number, number][]; points3?: [number, number, number][]; net: string; owner: string; kind: 'lead' | 'drop' | 'bus' | 'cable'; lift?: number; ends?: { part: string; port: string }[] }
export interface RailLayout {
  templateVersion: string; geometryVersion: string; structureSha256: string;
  rail: { z: number; x0: number; x1: number; feedX: number }; ground: { z: number; x0: number; x1: number; feedX: number };
  signalZ: number; backZ: number;
  poses: Record<string, RailPose>;
  /** Net anchors (where the potential marker stands): the rail/ground feed points and the signal junctions. */
  anchors: Record<string, { x: number; z: number }>;
  /** Every drawn wire as a polyline with its net — leads (anchor/drop → body end), rail drops, the two buses, cables. */
  wires: Polyline[];
  /** Per part: the drawn start/end overrides and routes the scene consumes. */
  leads: Record<string, { leadFrom?: [number, number]; leadTo?: [number, number]; leadRoutes?: { in?: [number, number][]; out?: [number, number][] }; supplyFrom?: [number, number]; groundTo?: [number, number]; refLift?: number; wiperSide?: number; gateLift?: number; supplyLift?: number; groundLift?: number }>;
  /** Bus member drops in x, for the page's summed-current buses (currents are the page's solved figures). */
  busMembers: { rail: { part: string; port: string; x: number }[]; ground: { part: string; port: string; x: number }[] };
  rotor: { x: number; z: number; hubY: number; radius: number } | null;
}
export type RailCause = 'duplicate-instance' | 'missing-port' | 'unassigned-port' | 'unsupported-topology' | 'unknown-group' | 'net-mismatch' | 'ambiguous-role';
export class RailLayoutError extends Error { constructor(readonly cause_: RailCause, readonly where: string, message: string) { super(message); } }

/** The structural identity a layout is bound to: kinds, names and port wiring — never volts, points or analysis. */
export function structuralJsonOf(c: Composition): string {
  return JSON.stringify({ sources: c.sources.map((x) => ({ kind: x.kind, name: x.name, plus: x.plus, minus: x.minus })), parts: c.parts.map((x) => ({ kind: x.kind, name: x.name, ports: x.ports })) });
}
/** A synchronous FNV-1a 64-bit-ish hex of the structural JSON — enough to detect a stale artifact deterministically without WebCrypto. */
export function structuralHash(c: Composition): string {
  const s = structuralJsonOf(c); let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ ch, 0x01000193 + 2) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Turn a kit composition into template input (parts keep their names; groups are the caller's). */
export function railInputFrom(c: Composition, groupOf: (p: PartInstance) => string, groups: string[]): RailInput {
  const src = c.sources[0]; if (c.sources.length !== 1 || !src) throw new RailLayoutError('unsupported-topology', 'sources', `The rail template supports exactly one supply; the composition has ${c.sources.length}`);
  return { supply: { name: src.name, plus: src.plus, minus: src.minus }, groups,
    parts: c.parts.map((p) => ({ id: p.name, kind: p.kind as DeckKind, ports: p.ports as Record<string, string>, group: groupOf(p), wiperFraction: p.kind === 'pot' ? p.spec.wiperFraction : undefined })) };
}

/** Row constants; the rail and ground rows are DERIVED per layout from the longest body on each side plus the clearance a drop needs. */
export const ROWS = { signal: -0.9, back: -2.5, feedX: -13.0, columnPitch: 3.0, groupGap: 3.0, junctionGap: 1.1, stackGap: 1.9, dropMin: 0.9 };
/** Every (kind, first-main-net-kind → second-main-net-kind) the template lays out; anything else is refused by name. */
const ROLE_TABLE: Record<DeckKind, Record<string, string>> = {
  resistor:   { 'signal>ground': 'signal-ground', 'signal>signal': 'signal-signal', 'rail>signal': 'rail-signal' },
  switch:     { 'rail>signal': 'rail-signal', 'signal>signal': 'signal-signal' },
  diode:      { 'signal>rail': 'signal-rail', 'signal>signal': 'signal-signal' },
  led:        { 'signal>ground': 'signal-ground', 'signal>signal': 'signal-signal' },
  ldr:        { 'rail>signal': 'rail-signal', 'signal>ground': 'signal-ground' },
  ntc:        { 'rail>signal': 'rail-signal', 'signal>ground': 'signal-ground' },
  pot:        { 'rail>ground': 'rail-ground', 'signal>ground': 'signal-ground' },
  comparator: { 'signal>signal': 'signal-signal' },
  mosfet:     { 'signal>ground': 'signal-ground' },
  motor:      { 'rail>signal': 'motor' },
  capacitor:  { 'signal>ground': 'signal-ground', 'signal>signal': 'signal-signal', 'rail>signal': 'rail-signal', 'rail>ground': 'rail-ground' },
  inductor:   { 'signal>ground': 'signal-ground', 'signal>signal': 'signal-signal', 'rail>signal': 'rail-signal' },
};

/** The two chord ends of a pose. */
export function poseEnds(p: RailPose): { a: [number, number]; b: [number, number] } {
  const h = p.len / 2; return { a: [p.x - p.dir[0] * h, p.z - p.dir[1] * h], b: [p.x + p.dir[0] * h, p.z + p.dir[1] * h] };
}
/** A terminal's deck position (and height) from the pose and the geometry table. */
export function terminalAt(p: RailPose, port: string): { x: number; z: number; y: number } {
  const g = BODY_GEOMETRY[p.kind], t = g.terminals[port]; if (!t) throw new RailLayoutError('missing-port', `${p.id}.${port}`, `${p.kind} has no terminal ${port}`);
  const h = p.len / 2;
  return { x: p.x + p.dir[0] * t.u * h, z: p.z + p.dir[1] * t.u * h + t.dz, y: (t.y ?? 0) + (port === 'shaft' ? (p.mount ?? 0) : 0) };
}
/** The drawn body's extent: between its two main terminals (the chord ends beyond them carry only the leads). */
export function bodySpan(p: RailPose): { a: [number, number]; b: [number, number] } {
  const [m0, m1] = BODY_GEOMETRY[p.kind].main; const A = terminalAt(p, m0), B = terminalAt(p, m1);
  return { a: [A.x, A.z], b: [B.x, B.z] };
}

/**
 * LAY OUT. Deterministic: the same input gives the same object (tested by double generation and JSON equality).
 * Throws RailLayoutError for input it cannot lay out; never invents a plausible picture.
 */
export function railLayout(input: RailInput, structureSha256: string, expected?: { structureSha256: string; label?: string }): RailLayout {
  const { supply, parts, groups } = input;
  // A FROZEN EXPECTED TOPOLOGY, when the caller has one: the layout may not be obtained by rewiring the circuit.
  if (expected && expected.structureSha256 !== structureSha256) throw new RailLayoutError('net-mismatch', expected.label ?? 'composition', `The circuit's structure (${structureSha256}) is not the expected ${expected.structureSha256}: a port, net or part differs from the frozen topology — repair the layout input, not the circuit`);
  const seen = new Set<string>();
  for (const p of parts) { if (seen.has(p.id)) throw new RailLayoutError('duplicate-instance', p.id, `Part ${p.id} appears twice`); seen.add(p.id); if (!BODY_GEOMETRY[p.kind]) throw new RailLayoutError('unsupported-topology', p.id, `No body geometry for kind ${p.kind}`); if (!groups.includes(p.group)) throw new RailLayoutError('unknown-group', p.id, `Part ${p.id} is in group ${JSON.stringify(p.group)}, which is not in the group order ${groups.join(' → ')}`); }
  const RAILNET = supply.plus, GNDNET = supply.minus;
  const netKind = (net: string) => net === RAILNET ? 'rail' : net === GNDNET ? 'ground' : 'signal';
  // Every terminal the geometry table knows must be wired; every wired port must be a known terminal.
  for (const p of parts) {
    const g = BODY_GEOMETRY[p.kind];
    for (const port of Object.keys(g.terminals)) if (port !== 'shaft' && port !== 'w' && port !== 'gnd' && !(port in p.ports)) throw new RailLayoutError('missing-port', `${p.id}.${port}`, `${p.kind} ${p.id} has no net on its ${port} terminal`);
    if (p.kind === 'pot' && !('w' in p.ports)) throw new RailLayoutError('missing-port', `${p.id}.w`, `pot ${p.id} has no net on its wiper`);
    for (const port of Object.keys(p.ports)) if (!(port in g.terminals) && !(p.kind === 'ldr' && port === 'env') && !(p.kind === 'ntc' && port === 'env')) throw new RailLayoutError('unassigned-port', `${p.id}.${port}`, `${p.kind} ${p.id} wires a port ${port} the body does not have`);
  }
  // Roles from the TYPED KIND plus the complete main-port pattern (ROLE_TABLE); extra terminals must be on the net kinds the body expects.
  const role = (p: RailInput['parts'][number]): string => {
    const [m0, m1] = BODY_GEOMETRY[p.kind].main; const k0 = netKind(p.ports[m0]), k1 = netKind(p.ports[m1]);
    const r = ROLE_TABLE[p.kind][`${k0}>${k1}`];
    if (!r) throw new RailLayoutError('unsupported-topology', p.id, `${p.kind} ${p.id} sits ${k0} → ${k1} (${m0} on ${p.ports[m0]}, ${m1} on ${p.ports[m1]}); the rail template lays a ${p.kind} out only as ${Object.keys(ROLE_TABLE[p.kind]).join(' or ')}`);
    if (p.kind === 'comparator' && netKind(p.ports.vcc) !== 'rail') throw new RailLayoutError('unsupported-topology', `${p.id}.vcc`, `comparator ${p.id} is powered from ${p.ports.vcc}, not the rail`);
    if (p.kind === 'comparator' && netKind(p.ports.inn) !== 'signal') throw new RailLayoutError('unsupported-topology', `${p.id}.inn`, `comparator ${p.id} has its − input on ${p.ports.inn}, not a signal net`);
    if (p.kind === 'mosfet' && netKind(p.ports.gate) !== 'signal') throw new RailLayoutError('unsupported-topology', `${p.id}.gate`, `MOSFET ${p.id} has its gate on ${p.ports.gate}, not a signal net`);
    if (p.kind === 'pot' && netKind(p.ports.w) !== 'signal') throw new RailLayoutError('unsupported-topology', `${p.id}.w`, `pot ${p.id} has its wiper on ${p.ports.w}, not a signal net`);
    return r;
  };
  // Order inside a group: follow the signal chain (a part whose first main port's net is produced by another part in the group comes after it).
  const byGroup = new Map<string, RailInput['parts']>(); for (const g of groups) byGroup.set(g, []);
  for (const p of parts) byGroup.get(p.group)!.push(p);
  const producers = new Map<string, string[]>();  // signal net → parts whose SECOND main port is on it
  for (const p of parts) { const n = p.ports[BODY_GEOMETRY[p.kind].main[1]]; if (netKind(n) === 'signal') producers.set(n, [...(producers.get(n) ?? []), p.id]); }
  const orderGroup = (ps: RailInput['parts']): RailInput['parts'] => {
    const ids = new Set(ps.map((p) => p.id)); const out: RailInput['parts'] = []; const placed = new Set<string>();
    const depth = (p: RailInput['parts'][number], guard = 0): number => { if (guard > 20) return guard; const inNet = p.ports[BODY_GEOMETRY[p.kind].main[0]]; const ups = (producers.get(inNet) ?? []).filter((id) => ids.has(id) && id !== p.id); return ups.length ? 1 + Math.max(...ups.map((id) => depth(ps.find((q) => q.id === id)!, guard + 1))) : 0; };
    for (const p of [...ps].sort((a, b) => depth(a) - depth(b) || a.id.localeCompare(b.id))) if (!placed.has(p.id)) { out.push(p); placed.add(p.id); }
    return out;
  };
  // Rows from the bodies that reach each rail: a rail-side body's far end must clear the bus by dropMin beyond its half-width.
  const roles = new Map(parts.map((p) => [p.id, role(p)] as const));
  const railSide = parts.filter((p) => ['rail-signal', 'rail-ground', 'signal-rail'].includes(roles.get(p.id)!)), groundSide = parts.filter((p) => ['signal-ground', 'rail-ground'].includes(roles.get(p.id)!));
  const reach = (ps: RailInput['parts']) => Math.max(0, ...ps.map((p) => BODY_GEOMETRY[p.kind].len + BODY_GEOMETRY[p.kind].halfWidth));
  const railZ = ROWS.signal - ROWS.junctionGap - reach(railSide) - ROWS.dropMin - TUBE_RADIUS;
  const groundZ = ROWS.signal + ROWS.stackGap + reach(groundSide) + ROWS.dropMin + TUBE_RADIUS;
  // Columns. A signal-ground part directly downstream of a rail-signal part in the same group STACKS under it.
  const poses: Record<string, RailPose> = {}; let x = ROWS.feedX + 2.0; let column = 0;
  for (const g of groups) {
    const ps = orderGroup(byGroup.get(g)!); if (!ps.length) continue;
    x += 1.0;
    const stackedUnder = new Map<string, string>();
    for (const p of ps) if (role(p) === 'signal-ground') { const inNet = p.ports[BODY_GEOMETRY[p.kind].main[0]]; const up = ps.find((q) => q !== p && role(q) === 'rail-signal' && q.ports[BODY_GEOMETRY[q.kind].main[1]] === inNet); if (up) stackedUnder.set(p.id, up.id); }
    for (const p of ps) {
      const r = role(p), g2 = BODY_GEOMETRY[p.kind];
      if (stackedUnder.has(p.id)) { const up = poses[stackedUnder.get(p.id)!]; poses[p.id] = { id: p.id, kind: p.kind, group: p.group, x: up.x, z: ROWS.signal + ROWS.stackGap + g2.len / 2, dir: [0, 1], len: g2.len, role: r, column: up.column }; continue; }
      x += (column === 0 ? 0 : ROWS.columnPitch); column++;
      switch (r) {
        case 'rail-ground': poses[p.id] = { id: p.id, kind: p.kind, group: p.group, x, z: ROWS.signal - ROWS.junctionGap - g2.len / 2, dir: [0, 1], len: g2.len, role: r, column }; break;
        case 'rail-signal': poses[p.id] = { id: p.id, kind: p.kind, group: p.group, x, z: ROWS.signal - ROWS.junctionGap - g2.len / 2, dir: [0, 1], len: g2.len, role: r, column }; break;
        // Unstacked: the body's first end sits ON the signal row, where its junction is. A body whose pin leaves toward +z (the
        // MOSFET's gate) lies ALONG x so the pin exits sideways, its drain (first end) toward the load side on the right.
        case 'signal-ground': poses[p.id] = p.kind === 'mosfet'
          ? { id: p.id, kind: p.kind, group: p.group, x, z: ROWS.signal, dir: [-1, 0], len: g2.len, role: r, column }
          : { id: p.id, kind: p.kind, group: p.group, x, z: ROWS.signal + FACE_STEP - g2.terminals[g2.main[0]].u * (g2.len / 2), dir: [0, 1], len: g2.len, role: r, column }; break;   // first TERMINAL one face-step past the row: its lead turns in along the chord
        case 'signal-signal': x += g2.len / 2 - 1.0; poses[p.id] = { id: p.id, kind: p.kind, group: p.group, x, z: ROWS.signal, dir: [1, 0], len: g2.len, role: r, column }; x += g2.len / 2 - 1.0; break;
        // A signal→rail part (a flyback) stands at ITS JUNCTION's column, behind the back row, reaching the rail with a short drop;
        // the column is reserved so the junction has room (placed after the motor: see the anchor rule).
        case 'signal-rail': {   // standing behind the back row: its first terminal a full corridor behind the row's junction, its second dropping to the rail
          const uFirst = g2.terminals[g2.main[0]].u; const corridor = g2.halfWidth + TUBE_RADIUS + CLEAR_MIN + 0.3;
          const zc = ROWS.back - corridor + uFirst * (g2.len / 2);   // dir (0,−1): terminal z = zc − u·h; we want zc − u·h = back − corridor
          poses[p.id] = { id: p.id, kind: p.kind, group: p.group, x, z: zc, dir: [0, -1], len: g2.len, role: r, column }; break;
        }
        case 'motor': {
          x += g2.len / 2 - 1.5; const rot = g2.rotor!; const mount = Math.max(0, rot.radius + 0.15 - rot.hubY);
          poses[p.id] = { id: p.id, kind: p.kind, group: p.group, x, z: ROWS.back, dir: [-1, 0], len: g2.len, role: r, column, mount }; x += g2.len / 2 - 1.5; break;
        }
      }
    }
    x += ROWS.groupGap;
  }
  // A signal→rail part moves to the column just before the part that feeds its junction (the motor's signal end): the
  // junction is then a T on the back row — the motor's lead from the right, the switch's lead from the left, the flyback behind.
  for (const p of parts) if (poses[p.id].role === 'signal-rail') {
    const net = p.ports[BODY_GEOMETRY[p.kind].main[0]];
    const feeder = parts.find((q) => q !== p && q.ports[BODY_GEOMETRY[q.kind].main[1]] === net && poses[q.id].role === 'motor');
    if (feeder) { const end = poseEnds(poses[feeder.id]).b; poses[p.id].x = end[0] - 1.4; }
  }
  // Anchors: rail/ground feeds; signal nets at rule points.
  const anchors: Record<string, { x: number; z: number }> = { [RAILNET]: { x: ROWS.feedX, z: railZ }, [GNDNET]: { x: ROWS.feedX, z: groundZ } };
  const signalNets = new Set<string>(); for (const p of parts) for (const n of Object.values(p.ports)) if (netKind(n) === 'signal') signalNets.add(n);
  for (const net of signalNets) {
    const members: { pose: RailPose; port: string }[] = [];
    for (const p of parts) for (const [port, n] of Object.entries(p.ports)) if (n === net && BODY_GEOMETRY[p.kind].terminals[port]) members.push({ pose: poses[p.id], port });
    if (!members.length) continue;
    // A stacked column's junction sits on the signal row in that column; a motor's low node sits at its signal end; a wiper net beside the pot; otherwise between the two main ends.
    const mainEnds = members.filter((m) => BODY_GEOMETRY[m.pose.kind].main.includes(m.port)).map((m) => ({ ...terminalAt(m.pose, m.port), m }));
    const wiper = members.find((m) => m.port === 'w');
    if (wiper) { const t = terminalAt(wiper.pose, 'w'); anchors[net] = { x: t.x + 1.5, z: t.z }; continue; }   // beside the wiper, same row: its lead crosses nothing
    const pin = members.find((m) => !BODY_GEOMETRY[m.pose.kind].main.includes(m.port));
    if (pin && mainEnds.length === 1) { const pt = terminalAt(pin.pose, pin.port); anchors[net] = { x: (mainEnds[0].x + pt.x) / 2, z: mainEnds[0].z }; continue; }
    const motorEnd = mainEnds.find((e) => e.m.pose.kind === 'motor');
    // The motor's low node: a T at the flyback's anode terminal when there is one (the flyback stands behind the row), else just before the motor's end.
    if (motorEnd) { const fly = mainEnds.find((e) => e.m.pose.role === 'signal-rail'); anchors[net] = { x: fly ? fly.m.pose.x : motorEnd.x - 1.0, z: ROWS.back }; continue; }   // a T on the back row: motor from the right, switch from the front-left, flyback straight behind
    const onRow = mainEnds.filter((e) => Math.abs(e.z - ROWS.signal) < 1e-6);
    if (onRow.length >= 2) { const xs = onRow.map((e) => e.x).sort((a, b) => a - b); anchors[net] = { x: (xs[0] + xs[xs.length - 1]) / 2, z: ROWS.signal }; continue; }
    const col = mainEnds.find((e) => e.m.pose.dir[1] !== 0);
    anchors[net] = col ? { x: col.x, z: ROWS.signal } : { x: mainEnds[0].x, z: mainEnds[0].z };
  }
  // Leads, drops, buses, cables.
  const wires: Polyline[] = []; const leads: RailLayout['leads'] = {}; const busMembers: RailLayout['busMembers'] = { rail: [], ground: [] };
  let railX1 = ROWS.feedX, groundX1 = ROWS.feedX;
  for (const p of parts) {
    const pose = poses[p.id], g = BODY_GEOMETRY[p.kind], [m0, m1] = g.main; const ends = bodySpan(pose); const L: RailLayout['leads'][string] = {};
    const attach = (port: string, end: [number, number], which: 'in' | 'out') => {
      const net = p.ports[port], kind = netKind(net);
      if (kind === 'rail' || kind === 'ground') {
        const rowZ = kind === 'rail' ? railZ : groundZ;
        // A body standing along z drops straight along its chord. A body LYING along x has its drop run past its own end
        // face: step outward along the chord until the tube clears that face (tube radius + clearance beyond the package's
        // end), then turn to the row. Found by the rendered-geometry check on the MOSFET's source drop (0.10 beyond the tube).
        const outward: [number, number] = which === 'in' ? [-pose.dir[0], -pose.dir[1]] : [pose.dir[0], pose.dir[1]];
        const horizontal = Math.abs(outward[0]) > 0.5;
        const tOff = Math.abs(g.terminals[port]?.u ?? 1) * (pose.len / 2);              // terminal distance from the body centre along the chord
        const step = Math.max(0, (g.packageHalfLen ?? tOff) + FACE_STEP - tOff);   // the terminal sits at the package face unless the geometry says the package is shorter
        const exitPt: [number, number] = horizontal && step > 0 ? [end[0] + outward[0] * step, end[1]] : end;
        const drop: [number, number] = [exitPt[0], rowZ];
        const viaExit = exitPt !== end;
        const pts: [number, number][] = kind === 'rail' ? (viaExit ? [drop, exitPt, end] : [drop, end]) : (viaExit ? [end, exitPt, drop] : [end, drop]);
        wires.push({ points: pts, net, owner: p.id, kind: 'drop', ends: [{ part: p.id, port }] });
        (kind === 'rail' ? busMembers.rail : busMembers.ground).push({ part: p.id, port, x: drop[0] });
        if (kind === 'rail') railX1 = Math.max(railX1, drop[0]); else groundX1 = Math.max(groundX1, drop[0]);
        if (which === 'in') L.leadFrom = drop; else L.leadTo = drop;
        if (viaExit) L.leadRoutes = { ...(L.leadRoutes ?? {}), [which]: [exitPt] };
      }
      else {
        const a = anchors[net];
        // Leave the terminal ALONG THE CHORD, outward, for the corridor the body's envelope demands; then, if the anchor is not
        // in line, route orthogonally (the exit axis first, then the other) so the bend lies outside every envelope.
        const outward: [number, number] = which === 'in' ? [-pose.dir[0], -pose.dir[1]] : [pose.dir[0], pose.dir[1]];
        const corridor = g.halfWidth + TUBE_RADIUS + CLEAR_MIN + 0.1;
        const exitPt: [number, number] = [end[0] + outward[0] * corridor, end[1] + outward[1] * corridor];
        const alongX = Math.abs(outward[0]) > 0.5;
        // Straight when the junction lies on the chord line beyond the terminal. Otherwise an L: the corner on the exit axis at the
        // junction's row/column when that is at least a face-step past the terminal (a lead never runs along a package face — the
        // geometry core checks it against the package), else out to the corridor first.
        const onChord = alongX ? Math.abs(a.z - end[1]) < 1e-6 : Math.abs(a.x - end[0]) < 1e-6;
        let via: [number, number][];
        if (onChord) via = [];
        else {
          const corner: [number, number] = alongX ? [a.x, end[1]] : [end[0], a.z];
          const past = (corner[0] - end[0]) * outward[0] + (corner[1] - end[1]) * outward[1];
          via = past >= FACE_STEP - 1e-6 && past < corridor ? [corner] : [exitPt, alongX ? [a.x, exitPt[1]] : [exitPt[0], a.z]];
        }
        const pts: [number, number][] = which === 'in' ? [[a.x, a.z], ...[...via].reverse(), end] : [end, ...via, [a.x, a.z]];
        if (via.length) L.leadRoutes = { ...(L.leadRoutes ?? {}), [which]: which === 'in' ? [...via].reverse() : via };
        wires.push({ points: pts, net, owner: p.id, kind: 'lead', ends: [{ part: p.id, port }] });
      }
    };
    attach(m0, ends.a, 'in'); attach(m1, ends.b, 'out');
    // Extra terminals: comparator vcc/gnd drops and its reference cable (lifted), the pot's wiper lead, the MOSFET's gate pin.
    const cable = (from: [number, number, number], to: [number, number, number], net: string, bow: number, lift: number, endsOn: { part: string; port: string }[], side = 0, kindTag: 'cable' = 'cable') => {
      const p3 = cablePoints3(from, to, bow, lift, side); wires.push({ points: p3.map((q) => [q[0], q[2]] as [number, number]), points3: p3, net, owner: p.id, kind: kindTag, lift: lift || undefined, ends: endsOn });
    };
    if (p.kind === 'comparator') {
      const vcc = terminalAt(pose, 'vcc'), gnd = terminalAt(pose, 'gnd'), inn = terminalAt(pose, 'inn'), ref = anchors[p.ports.inn];
      // Both power pins sit INSIDE the plate; the cables are lifted so they come down onto the Vcc pin and rise from the
      // ground pin, clearing the plate — at deck level they ran through it (the rendered check, return 489ec0d7).
      L.supplyFrom = [pose.x, railZ]; L.supplyLift = SUPPLY_LIFT; cable([pose.x, 0, railZ], [vcc.x, vcc.y, vcc.z], p.ports.vcc, 0, SUPPLY_LIFT, [{ part: p.id, port: 'vcc' }]); busMembers.rail.push({ part: p.id, port: 'vcc', x: pose.x }); railX1 = Math.max(railX1, pose.x);
      L.groundTo = [pose.x, groundZ]; L.groundLift = GROUND_LIFT; cable([gnd.x, gnd.y, gnd.z], [pose.x, 0, groundZ], GNDNET, 0, GROUND_LIFT, [{ part: p.id, port: 'gnd' }]); busMembers.ground.push({ part: p.id, port: 'gnd', x: pose.x }); groundX1 = Math.max(groundX1, pose.x);
      L.refLift = 1.2; cable([ref.x, 0, ref.z], [inn.x, inn.y, inn.z], p.ports.inn, .9, 1.2, [{ part: p.id, port: 'inn' }]);
    }
    // The wiper's cable leaves SIDEWAYS toward its anchor (beside the wiper on the same row) rather than bowing along the
    // track: bowing along z carried it over the pot's own ground drop 0.25 above the deck (a near-touch of two nets that
    // the old "one body's own pins" exemption hid). The gate cable is LIFTED over the MOSFET's source drop: the gate pin
    // sits past the source end on the drop's side, so any on-deck approach from the comparator crosses that drop.
    if (p.kind === 'pot') { const w = terminalAt(pose, 'w'), a = anchors[p.ports.w]; const side = a.x - w.x - Math.sign(a.x - w.x) * 0.3; L.wiperSide = side; cable([w.x, w.y, w.z], [a.x, 0, a.z], p.ports.w, 0, 0, [{ part: p.id, port: 'w' }], side); }   // 0.3 short of the anchor: the curve lands from the side, not through the deck
    if (p.kind === 'mosfet') { const gp = terminalAt(pose, 'gate'), a = anchors[p.ports.gate]; L.gateLift = GATE_LIFT; cable([a.x, 0, a.z], [gp.x, gp.y, gp.z], p.ports.gate, .45, GATE_LIFT, [{ part: p.id, port: 'gate' }]); }
    leads[p.id] = L;
  }
  wires.push({ points: [[ROWS.feedX, railZ], [railX1, railZ]], net: RAILNET, owner: 'rail', kind: 'bus' });
  wires.push({ points: [[ROWS.feedX, groundZ], [groundX1, groundZ]], net: GNDNET, owner: 'ground', kind: 'bus' });
  wires.push({ points: [[ROWS.feedX, groundZ], [ROWS.feedX, railZ]], net: `${GNDNET}|${RAILNET}`, owner: supply.name, kind: 'cable' });
  const motor = Object.values(poses).find((p) => p.kind === 'motor');
  const rotor = motor ? { x: motor.x, z: motor.z + BODY_GEOMETRY.motor.rotor!.ahead, hubY: BODY_GEOMETRY.motor.rotor!.hubY + (motor.mount ?? 0), radius: BODY_GEOMETRY.motor.rotor!.radius } : null;
  return { templateVersion: TEMPLATE_VERSION, geometryVersion: GEOMETRY_VERSION, structureSha256,
    rail: { z: railZ, x0: ROWS.feedX, x1: railX1, feedX: ROWS.feedX }, ground: { z: groundZ, x0: ROWS.feedX, x1: groundX1, feedX: ROWS.feedX }, signalZ: ROWS.signal, backZ: ROWS.back,
    poses, anchors, wires, leads, busMembers, rotor };
}

// ---------------------------------------------------------------- the validator
export type DiagCause = 'stale-geometry' | 'stale-template' | 'stale-structure' | 'invalid-geometry' | 'coverage' | 'disconnected-net' | 'clearance' | 'rotor-intrusion' | 'ambiguous-crossing' | 'rotor-below-deck' | 'lifted-crossing' | 'unsupported-check';
export interface RailDiagnostic { cause: DiagCause; where: string; measured?: number; required?: number; message: string; severity: 'error' | 'info' }
export interface RailReport { ok: boolean; diagnostics: RailDiagnostic[]; checked: { wires: number; bodies: number; pairs: number; terminals: number } }
type P3 = [number, number, number];
type P = [number, number];
/** Plan (x, z) distance between two segments, 0 when they cross. */
const segDist = (p: P, q: P, r: P, t: P): number => {
  const pt = (u: P, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; const s = l2 ? Math.max(0, Math.min(1, ((u[0] - a[0]) * dx + (u[1] - a[1]) * dz) / l2)) : 0; return Math.hypot(u[0] - (a[0] + dx * s), u[1] - (a[1] + dz * s)); };
  const cr = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  if (cr(p, q, r) * cr(p, q, t) < 0 && cr(r, t, p) * cr(r, t, q) < 0) return 0;
  return Math.min(pt(p, r, t), pt(q, r, t), pt(r, p, q), pt(t, p, q));
};
const CLEAR_MIN = 0.15;
/** How far a conductor stands off a package face it does not enter (tube radius + clearance + a margin): the jog a drop or lead makes before turning. */
const FACE_STEP = TUBE_RADIUS + CLEAR_MIN + 0.05;
/** Lift of the MOSFET's gate cable over its own source drop (a declared height-separated crossing; the validator measures it). */
const GATE_LIFT = 1.5;
/** Lifts of the comparator's Vcc (onto its top pin) and ground (from its rear pin) cables over the plate. */
const SUPPLY_LIFT = 0.9, GROUND_LIFT = 1.2;
/** Radius around a same-net junction within which its conductors may run close (their fan-out). */
const JUNCTION_FANOUT = 1.2;   // 1.0 put the crossing at 0.45 exactly, the threshold
const finite3 = (p: number[]) => p.every((v) => Number.isFinite(v));
/** Closest distance between two 3D segments (a robust clamped evaluation on a fine parameter grid — exact enough at tube scale, and simple to read). */
function segDist3(p0: P3, p1: P3, q0: P3, q1: P3): number {
  const d = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const lerp = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pt = (x: P3, a: P3, b: P3): number => { const ab: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; const t = l2 ? Math.max(0, Math.min(1, ((x[0] - a[0]) * ab[0] + (x[1] - a[1]) * ab[1] + (x[2] - a[2]) * ab[2]) / l2)) : 0; return d(x, lerp(a, b, t)); };
  let best = Math.min(pt(p0, q0, q1), pt(p1, q0, q1), pt(q0, p0, p1), pt(q1, p0, p1));
  for (let k = 1; k < 32; k++) { const t = k / 32; best = Math.min(best, pt(lerp(p0, p1, t), q0, q1), pt(lerp(q0, q1, t), p0, p1)); }
  return best;
}
/** A body as the validator sees it: a plan rectangle around its drawn span (from the geometry table; the kind name `capsule` is historical) or the renderer's own box. */
export type BodyShape = { id: string; kind: 'capsule'; a: [number, number]; b: [number, number]; halfWidth: number; height: number } | { id: string; kind: 'box'; min: P3; max: P3 };
/**
 * EXACT distance from a segment to an axis-aligned box, and the length of the segment inside it. The squared distance is
 * piecewise quadratic in the segment parameter, the pieces bounded by the six slab crossings; each piece is minimised in
 * closed form. No sampling: a box narrower than any sample spacing cannot be missed (Astra's return 489ec0d7).
 */
function segBoxExact(p0: P3, p1: P3, min: P3, max: P3): { dist: number; insideLen: number } {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; const len = Math.hypot(d[0], d[1], d[2]);
  const ts = [0, 1];
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > 1e-12) for (const b of [min[i], max[i]]) { const t = (b - p0[i]) / d[i]; if (t > 0 && t < 1) ts.push(t); }
  ts.sort((a, b) => a - b);
  let best = Infinity, insideLen = 0;
  for (let k = 1; k < ts.length; k++) {
    const ta = ts[k - 1], tb = ts[k]; if (tb - ta < 1e-12) continue; const tm = (ta + tb) / 2;
    let A = 0, B = 0, C = 0, active = 0;
    for (let i = 0; i < 3; i++) {
      const pm = p0[i] + d[i] * tm; let a: number, b: number;
      if (pm < min[i]) { a = min[i] - p0[i]; b = -d[i]; } else if (pm > max[i]) { a = p0[i] - max[i]; b = d[i]; } else continue;
      active++; A += b * b; B += 2 * a * b; C += a * a;
    }
    if (!active) { best = 0; insideLen += len * (tb - ta); continue; }
    const cands = [ta, tb]; if (A > 1e-18) { const t = -B / (2 * A); if (t > ta && t < tb) cands.push(t); }
    for (const t of cands) best = Math.min(best, A * t * t + B * t + C);
  }
  return { dist: Math.sqrt(Math.max(0, best)), insideLen };
}
/** A body as an axis-aligned box in its own frame plus the transform into it (the plan rectangle's chord is axis-aligned in this template). */
function bodyFrame(body: BodyShape): { toLocal: (p: P3) => P3; min: P3; max: P3 } {
  if (body.kind === 'box') return { toLocal: (p) => p, min: body.min, max: body.max };
  const ax = body.b[0] - body.a[0], az = body.b[1] - body.a[1]; const L = Math.hypot(ax, az) || 1; const ux = ax / L, uz = az / L; const cx = (body.a[0] + body.b[0]) / 2, cz = (body.a[1] + body.b[1]) / 2;
  return { toLocal: (p) => [(p[0] - cx) * ux + (p[2] - cz) * uz, p[1], -(p[0] - cx) * uz + (p[2] - cz) * ux], min: [-L / 2, 0, -body.halfWidth], max: [L / 2, body.height, body.halfWidth] };
}
/** Exact segment-to-body distance (0 when the segment enters the body) and the length inside it. */
function bodyDistance3(p0: P3, p1: P3, body: BodyShape): { dist: number; insideLen: number } {
  const f = bodyFrame(body); return segBoxExact(f.toLocal(p0), f.toLocal(p1), f.min, f.max);
}
/** The parameter interval of segment p0p1 inside a sphere (quadratic), or null. */
function sphereInterval(p0: P3, p1: P3, c: P3, r: number): [number, number] | null {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], B = 2 * (d[0] * w[0] + d[1] * w[1] + d[2] * w[2]), C = w[0] * w[0] + w[1] * w[1] + w[2] * w[2] - r * r;
  if (A < 1e-18) return C <= 0 ? [0, 1] : null;
  const disc = B * B - 4 * A * C; if (disc < 0) return null; const q = Math.sqrt(disc); const t0 = Math.max(0, (-B - q) / (2 * A)), t1 = Math.min(1, (-B + q) / (2 * A));
  return t1 > t0 ? [t0, t1] : null;
}
/** The parameter interval of segment p0p1 inside a finite cylinder from `c` along unit `e` (length `len`, radius `r`), or null. */
function tubeInterval(p0: P3, p1: P3, c: P3, e: P3, len: number, r: number): [number, number] | null {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
  const de = d[0] * e[0] + d[1] * e[1] + d[2] * e[2], we = w[0] * e[0] + w[1] * e[1] + w[2] * e[2];
  // slab 0 ≤ along ≤ len
  let ta = 0, tb = 1;
  if (Math.abs(de) < 1e-12) { if (we < 0 || we > len) return null; } else { const t0 = (0 - we) / de, t1 = (len - we) / de; ta = Math.max(ta, Math.min(t0, t1)); tb = Math.min(tb, Math.max(t0, t1)); }
  if (tb <= ta) return null;
  // perpendicular distance² ≤ r²: quadratic in t
  const dp = [d[0] - de * e[0], d[1] - de * e[1], d[2] - de * e[2]], wp = [w[0] - we * e[0], w[1] - we * e[1], w[2] - we * e[2]];
  const A = dp[0] * dp[0] + dp[1] * dp[1] + dp[2] * dp[2], B = 2 * (dp[0] * wp[0] + dp[1] * wp[1] + dp[2] * wp[2]), C = wp[0] * wp[0] + wp[1] * wp[1] + wp[2] * wp[2] - r * r;
  if (A < 1e-18) return C <= 0 ? [ta, tb] : null;
  const disc = B * B - 4 * A * C; if (disc < 0) return null; const q = Math.sqrt(disc); const u0 = Math.max(ta, (-B - q) / (2 * A)), u1 = Math.min(tb, (-B + q) / (2 * A));
  return u1 > u0 ? [u0, u1] : null;
}
/** Exact test of a segment against the rotor's swept disc (a short cylinder about the z axis at the hub): the closest approach to the axis within the disc's slab. */
function segDiscIntrusion(p0: P3, p1: P3, rotor: RotorShape, r: number): number | null {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; const half = rotor.thickness + r;
  let ta = 0, tb = 1;
  if (Math.abs(d[2]) < 1e-12) { if (Math.abs(p0[2] - rotor.hub[2]) >= half) return null; } else { const t0 = (rotor.hub[2] - half - p0[2]) / d[2], t1 = (rotor.hub[2] + half - p0[2]) / d[2]; ta = Math.max(0, Math.min(t0, t1)); tb = Math.min(1, Math.max(t0, t1)); }
  if (tb <= ta) return null;
  const wx = p0[0] - rotor.hub[0], wy = p0[1] - rotor.hub[1]; const A = d[0] * d[0] + d[1] * d[1], B = 2 * (d[0] * wx + d[1] * wy), C = wx * wx + wy * wy;
  const cands = [ta, tb]; if (A > 1e-18) { const t = -B / (2 * A); if (t > ta && t < tb) cands.push(t); }
  let best = Infinity; for (const t of cands) best = Math.min(best, A * t * t + B * t + C);
  const radial = Math.sqrt(Math.max(0, best)); return radial < rotor.radius + r ? radial : null;
}
/** The sub-interval of segment X within `need` of segment Y (the distance along X is convex, so it is one interval), or null. */
function closeInterval(X: { a: P3; b: P3 }, Y: { a: P3; b: P3 }, need: number): [number, number] | null {
  const at = (t: number): P3 => [X.a[0] + (X.b[0] - X.a[0]) * t, X.a[1] + (X.b[1] - X.a[1]) * t, X.a[2] + (X.b[2] - X.a[2]) * t];
  const g = (t: number) => { const p = at(t); return segDist3(p, p, Y.a, Y.b); };
  let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (g(m1) <= g(m2)) hi = m2; else lo = m1; }
  const tm = (lo + hi) / 2; if (g(tm) >= need) return null;
  const cross = (a: number, b: number): number => { for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (g(m) < need) b = m; else a = m; } return b; };   // a: outside, b: inside
  const t0 = g(0) < need ? 0 : cross(0, tm), t1 = g(1) < need ? 1 : cross(1, tm);
  return [Math.min(t0, t1), Math.max(t0, t1)];
}
export interface Wire3 { id: string; net: string; owner: string; kind: string; points: P3[]; ends?: { part: string; port: string }[]; planCrossing?: boolean }
export interface Terminal3 { part: string; port: string; net: string | null; at: P3; /** direction a conductor leaves this terminal in — [x, y, z], or a plan [x, z] pair (main terminals: outward along the chord; pins: from the geometry table) */ out?: [number, number] | [number, number, number] }
export interface RotorShape { hub: P3; radius: number; thickness: number }
/**
 * THE GEOMETRY CORE, shared by the offline validator (mirrored geometry) and the browser (rendered geometry): coverage
 * of every terminal by a wire of its net, connectivity of every net, clearance of every wire from every body it does
 * not terminate on (with the tube radius, in 3D), the rotor's swept volume, and crossings by net identity in 3D.
 */
export function checkGeometry3D(wires: Wire3[], bodies: BodyShape[], terminals: Terminal3[], rotor: RotorShape | null, nets: Record<string, string[]>, opts: { minClearance?: number; /** how close a wire end must be to a terminal to count as landing on it (the renderer lifts conductors 0.06 off the deck) */ endEps?: number } = {}): { diagnostics: RailDiagnostic[]; pairs: number } {
  const d: RailDiagnostic[] = []; const minClear = opts.minClearance ?? CLEAR_MIN; const need = 2 * TUBE_RADIUS + 0.1; const EPS = opts.endEps ?? 0.06;
  for (const w of wires) if (w.points.length < 2 || w.points.some((p) => !finite3(p))) d.push({ cause: 'invalid-geometry', where: w.id, message: `Wire ${w.id} has ${w.points.length < 2 ? 'fewer than two points' : 'a non-finite point'}`, severity: 'error' });
  for (const b of bodies) if (b.kind === 'box' ? !finite3(b.min) || !finite3(b.max) : !finite3([...b.a, ...b.b, b.halfWidth, b.height])) d.push({ cause: 'invalid-geometry', where: b.id, message: `Body ${b.id} is not finite`, severity: 'error' });
  if (d.length) return { diagnostics: d, pairs: 0 };
  const netOf = (w: Wire3) => w.net.split('|');
  const nearP = (a: P3, b: P3, eps: number) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < eps;
  // COVERAGE: every terminal with a net has a wire end of that net on it.
  for (const t of terminals) {
    if (!t.net) continue;
    const hit = wires.some((w) => netOf(w).includes(t.net!) && (nearP(w.points[0], t.at, EPS) || nearP(w.points[w.points.length - 1], t.at, EPS)));
    if (!hit) d.push({ cause: 'coverage', where: `${t.part}.${t.port}`, message: `Terminal ${t.part}.${t.port} (net ${t.net}) has no wire of its net ending on it`, severity: 'error' });
  }
  // CONNECTIVITY: per net, union-find over wire points and terminals that touch.
  for (const [net, members] of Object.entries(nets)) {
    const ws = wires.filter((w) => netOf(w).includes(net)); if (!ws.length) { if (members.length) d.push({ cause: 'disconnected-net', where: net, message: `Net ${net} has ${members.length} terminals and no wire`, severity: 'error' }); continue; }
    const parent = new Map<number, number>(); const find = (x: number): number => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; }; const union = (a: number, b: number) => { parent.set(find(a), find(b)); };
    ws.forEach((_, k) => parent.set(k, k));
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const A = ws[i], B = ws[j]; let touch = false;
      outer: for (let a = 1; a < A.points.length; a++) for (let b = 1; b < B.points.length; b++) if (segDist3(A.points[a - 1], A.points[a], B.points[b - 1], B.points[b]) < EPS) { touch = true; break outer; }
      if (touch) union(i, j);
    }
    const termWire = (m: string): number => { const t = terminals.find((x) => `${x.part}.${x.port}` === m); if (!t) return -1; return ws.findIndex((w) => nearP(w.points[0], t.at, EPS) || nearP(w.points[w.points.length - 1], t.at, EPS)); };
    const roots = new Set<number>(); for (const m of members) { const k = termWire(m); if (k >= 0) roots.add(find(k)); }
    for (let k = 0; k < ws.length; k++) roots.add(find(k));
    if (roots.size > 1) d.push({ cause: 'disconnected-net', where: net, measured: roots.size, required: 1, message: `Net ${net} is drawn as ${roots.size} separate pieces (its terminals: ${members.join(', ')})`, severity: 'error' });
  }
  // Which terminals each WIRE's two ends land on, net-matched (a wire may only touch bodies there).
  const attach = new Map<Wire3, Terminal3[]>();
  for (const w of wires) attach.set(w, terminals.filter((t) => t.net && netOf(w).includes(t.net) && (nearP(w.points[0], t.at, EPS) || nearP(w.points[w.points.length - 1], t.at, EPS))));
  const shapesOf = (id: string) => bodies.filter((b) => b.id === id);
  /** The plan rectangle enclosing all of one part's shapes (its footprint), for the own-pins crossing exemption. */
  const footprintOf = (id: string): { x0: number; x1: number; z0: number; z1: number } | null => {
    const sh = shapesOf(id); if (!sh.length) return null; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of sh) { const pts: [number, number][] = b.kind === 'box' ? [[b.min[0], b.min[2]], [b.max[0], b.max[2]]] : (() => { const ax = b.b[0] - b.a[0], az = b.b[1] - b.a[1]; const L = Math.hypot(ax, az) || 1; const nx = -az / L * b.halfWidth, nz = ax / L * b.halfWidth; return [[b.a[0] + nx, b.a[1] + nz], [b.a[0] - nx, b.a[1] - nz], [b.b[0] + nx, b.b[1] + nz], [b.b[0] - nx, b.b[1] - nz]] as [number, number][]; })(); for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } }
    return { x0, x1, z0, z1 };
  };
  const exitOf = (t: Terminal3): P3 | null => { if (!t.out) return null; const v: P3 = t.out.length === 3 ? [t.out[0], t.out[1], t.out[2]] : [t.out[0], 0, t.out[1]]; const n = Math.hypot(v[0], v[1], v[2]); return n < 1e-9 ? null : [v[0] / n, v[1] / n, v[2] / n]; };
  const hwOf = (b: BodyShape) => b.kind === 'capsule' ? b.halfWidth : Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2;
  // CLEARANCE: every wire segment against every body shape, EXACTLY. A wire attached to a terminal of the shape's part is
  // exempt only in a LOCAL corridor at that terminal: the joint (a sphere of two tube radii) and a tube along the terminal's
  // exit direction (a tube radius wide, a corridor long); farther out but still within the corridor radius its tube may not
  // overlap the body (it may touch); beyond that, full clearance. Nothing else exempts a wire from its own body — a cable
  // that leaves a pin and traverses its package is caught like any other wire (Astra's return 489ec0d7).
  let pairs = 0;
  const JOINT_R = 2 * TUBE_RADIUS;
  for (const w of wires) for (let k = 1; k < w.points.length; k++) {
    const s0 = w.points[k - 1], s1 = w.points[k];
    const at = (t: number): P3 => [s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t, s0[2] + (s1[2] - s0[2]) * t];
    for (const body of bodies) {
      pairs++;
      const own = (attach.get(w) ?? []).filter((t) => t.part === body.id);
      // Exempt (joint ∪ tube) and near (corridor sphere) intervals of this segment, per attached terminal of this part.
      const exempt: [number, number][] = []; const near: [number, number][] = [];
      const corridor = Math.max(...shapesOf(body.id).map(hwOf)) + TUBE_RADIUS + minClear + 0.1;
      for (const t of own) {
        const j = sphereInterval(s0, s1, t.at, JOINT_R); if (j) exempt.push(j);
        const e = exitOf(t); if (e) { const u = tubeInterval(s0, s1, t.at, e, corridor, TUBE_RADIUS + 0.05); if (u) exempt.push(u); }
        const n = sphereInterval(s0, s1, t.at, corridor); if (n) near.push(n);
      }
      const cuts = new Set<number>([0, 1]); for (const [a, b] of [...exempt, ...near]) { cuts.add(a); cuts.add(b); }
      const ts = [...cuts].sort((a, b) => a - b);
      let worst: { dist: number; required: number; piece: number } | null = null;
      for (let q = 1; q < ts.length; q++) {
        const ta = ts[q - 1], tb = ts[q]; if (tb - ta < 1e-9) continue; const tm = (ta + tb) / 2;
        if (exempt.some(([a, b]) => tm >= a && tm <= b)) continue;
        const required = near.some(([a, b]) => tm >= a && tm <= b) ? 0 : minClear;   // within the corridor: no overlap; beyond: clearance
        const r = bodyDistance3(at(ta), at(tb), body); const dist = r.dist - TUBE_RADIUS;
        if (dist < required && (!worst || dist - required < worst.dist - worst.required)) worst = { dist, required, piece: q };
      }
      if (worst) d.push({ cause: 'clearance', where: `${w.id}[${k - 1}] vs ${body.id}`, measured: +worst.dist.toFixed(3), required: worst.required, message: `Wire ${w.id} (net ${w.net}) passes ${worst.dist.toFixed(2)} from the body of ${body.id} beyond the tube radius (need ${worst.required}${own.length ? ', attached at ' + own.map((t) => t.port).join('/') : ''})`, severity: 'error' });
    }
    // ROTOR: the swept disc is a thin vertical cylinder at the hub; any conductor inside it (radius + tube) is an intrusion — exact.
    if (rotor) { const radial = segDiscIntrusion(s0, s1, rotor, TUBE_RADIUS); if (radial !== null) d.push({ cause: 'rotor-intrusion', where: `${w.id}[${k - 1}]`, measured: +radial.toFixed(3), required: rotor.radius + TUBE_RADIUS, message: `Wire ${w.id} enters the rotor's swept disc`, severity: 'error' }); }
  }
  if (rotor) {
    for (const body of bodies) {
      // Exact box-vs-disc overlap: the body's z-range meets the disc's slab and the axis point is within the radius of the body's xy rectangle.
      const f = bodyFrame(body); const corners: P3[] = body.kind === 'box' ? [body.min, body.max] : [[body.a[0], 0, body.a[1]], [body.b[0], body.height, body.b[1]]];
      void f; const xs = body.kind === 'box' ? [body.min[0], body.max[0]] : (() => { const ax = body.b[0] - body.a[0], az = body.b[1] - body.a[1]; const L = Math.hypot(ax, az) || 1; const nx = Math.abs(-az / L * body.halfWidth); return [Math.min(body.a[0], body.b[0]) - nx, Math.max(body.a[0], body.b[0]) + nx]; })();
      const zs = body.kind === 'box' ? [body.min[2], body.max[2]] : (() => { const ax = body.b[0] - body.a[0], az = body.b[1] - body.a[1]; const L = Math.hypot(ax, az) || 1; const nz = Math.abs(ax / L * body.halfWidth); return [Math.min(body.a[1], body.b[1]) - nz, Math.max(body.a[1], body.b[1]) + nz]; })();
      const ys = [corners[0][1], corners[1][1]];
      const zOverlap = zs[0] < rotor.hub[2] + rotor.thickness && zs[1] > rotor.hub[2] - rotor.thickness;
      const dx = Math.max(xs[0] - rotor.hub[0], 0, rotor.hub[0] - xs[1]), dy = Math.max(ys[0] - rotor.hub[1], 0, rotor.hub[1] - ys[1]);
      if (zOverlap && Math.hypot(dx, dy) < rotor.radius) d.push({ cause: 'rotor-intrusion', where: body.id, message: `Body ${body.id} is inside the rotor's swept disc`, severity: 'error' });
    }
    if (rotor.hub[1] - rotor.radius < 0) d.push({ cause: 'rotor-below-deck', where: 'rotor', measured: +(rotor.hub[1] - rotor.radius).toFixed(3), required: 0, message: `The rotor's swept disc dips ${(rotor.radius - rotor.hub[1]).toFixed(2)} below the deck`, severity: 'error' });
  }
  // CROSSINGS by NET IDENTITY in 3D: different nets may never come within a tube diameter; same net may only meet at a junction.
  const segs = wires.flatMap((w) => { const out: { a: P3; b: P3; w: Wire3 }[] = []; for (let k = 1; k < w.points.length; k++) out.push({ a: w.points[k - 1], b: w.points[k], w }); return out; });
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j]; if (A.w === B.w) continue;
    const dist = segDist3(A.a, A.b, B.a, B.b);
    const plan = segDist([A.a[0], A.a[2]], [A.b[0], A.b[2]], [B.a[0], B.a[2]], [B.b[0], B.b[2]]);
    const sameNet = netOf(A.w).some((n) => netOf(B.w).includes(n));
    const touching = [A.a, A.b].some((p) => segDist3(p, p, B.a, B.b) < EPS) || [B.a, B.b].some((p) => segDist3(p, p, A.a, A.b) < EPS);
    if (dist >= need) { if (plan < 1e-6 && !sameNet && !d.some((x) => x.cause === 'lifted-crossing' && x.where === `${A.w.id} × ${B.w.id}`)) d.push({ cause: 'lifted-crossing', where: `${A.w.id} × ${B.w.id}`, measured: +dist.toFixed(2), required: need, message: `Nets ${A.w.net} and ${B.w.net} cross in plan with ${dist.toFixed(2)} between the conductors`, severity: 'info' }); continue; }
    if (sameNet && touching) continue;
    // The portion of each segment within `need` of the other is ONE interval (convex distance): its two ends bound it exactly.
    // Every exemption below is a convex region, so an exemption that holds at both ends holds throughout — no sampling.
    const ends: P3[] = [];
    for (const [X, Y] of [[A, B], [B, A]] as const) { const iv = closeInterval(X, Y, need); if (iv) for (const t of iv) ends.push([X.a[0] + (X.b[0] - X.a[0]) * t, X.a[1] + (X.b[1] - X.a[1]) * t, X.a[2] + (X.b[2] - X.a[2]) * t]); }
    // Same net near the junction where these two WIRES meet (one's end on the other): the fan-out of a junction, not an overlap.
    if (sameNet) {
      const junctions: P3[] = [];
      for (const [X, Y] of [[A.w, B.w], [B.w, A.w]] as const) for (const e of [X.points[0], X.points[X.points.length - 1]]) for (let k = 1; k < Y.points.length; k++) if (segDist3(e, e, Y.points[k - 1], Y.points[k]) < EPS) junctions.push(e);
      // Fan-out radius: two same-net conductors leaving one junction diverge over about a unit (a cable descending onto an
      // anchor another cable rises from); beyond that, same-net conductors running close are an ambiguous picture.
      if (ends.length && junctions.some((j) => ends.every((p) => nearP(p, j, JUNCTION_FANOUT)))) continue;
    }
    // Two conductors on two different pins of ONE body meeting OVER that body's footprint (a comparator's vcc and gnd cables
    // 0.4 apart inside its own plate): the component's own pins — never on the open deck beside it.
    const shared = (attach.get(A.w) ?? []).find((ta) => (attach.get(B.w) ?? []).some((tb) => tb.part === ta.part && tb.port !== ta.port));
    if (shared) { const fp = footprintOf(shared.part); if (fp && ends.length && ends.every((q) => q[0] > fp.x0 - TUBE_RADIUS && q[0] < fp.x1 + TUBE_RADIUS && q[2] > fp.z0 - TUBE_RADIUS && q[2] < fp.z1 + TUBE_RADIUS)) continue; }
    if (d.some((x) => x.cause === 'ambiguous-crossing' && x.where === `${A.w.id} × ${B.w.id}`)) continue;   // one diagnostic per pair of wires
    d.push({ cause: 'ambiguous-crossing', where: `${A.w.id} × ${B.w.id}`, measured: +dist.toFixed(2), required: need, message: sameNet ? `Two wires of net ${A.w.net} run ${dist.toFixed(2)} apart away from any junction` : `Nets ${A.w.net} and ${B.w.net} come within ${dist.toFixed(2)} of each other (need ${need}) with no junction`, severity: 'error' });
  }
  return { diagnostics: d, pairs };
}

/** The terminals of a layout, with their nets from the composition (the comparator's ground pin is the supply's − net; the shaft has none). */
export function layoutTerminals(layout: RailLayout, c: Composition): Terminal3[] {
  const out: Terminal3[] = []; const gnd = c.sources[0]?.minus ?? '0';
  for (const p of Object.values(layout.poses)) {
    const part = c.parts.find((x) => x.name === p.id); const ports = (part?.ports ?? {}) as Record<string, string>;
    const g = BODY_GEOMETRY[p.kind]; const [m0, m1] = g.main;
    for (const port of Object.keys(g.terminals)) {
      const t = terminalAt(p, port); const rel = g.terminals[port];
      let exit: [number, number, number] | undefined = port === m0 ? [-p.dir[0], 0, -p.dir[1]] : port === m1 ? [p.dir[0], 0, p.dir[1]] : rel.exit ? [rel.exit[0] * p.dir[0], rel.exit[1], rel.exit[0] * p.dir[1] + rel.exit[2]] : undefined;
      if (port === 'w' && p.kind === 'pot') { const side = layout.leads[p.id]?.wiperSide; if (side) exit = [Math.sign(side), 0, 0]; }   // the wiper's cable leaves sideways when the layout says so, else up
      out.push({ part: p.id, port, net: port === 'shaft' ? null : port === 'gnd' && p.kind === 'comparator' ? gnd : (ports[port] ?? null), at: [t.x, t.y, t.z], ...(exit ? { out: exit } : {}) });
    }
  }
  return out;
}
/** The layout's wires as 3D polylines (cables carry their sampled curve; everything else lies on the deck). */
export function layoutWires3(layout: RailLayout): Wire3[] {
  return layout.wires.map((w, k) => ({ id: `${w.owner}:${w.kind}#${k}`, net: w.net, owner: w.owner, kind: w.kind, points: w.points3 ?? w.points.map((p) => [p[0], 0, p[1]] as P3), ends: w.ends }));
}
export function layoutBodies(layout: RailLayout): BodyShape[] {
  // The package rectangle spans the two main terminals, or the declared package when it is shorter (the MOSFET's leads, the
  // motor's posts, the comparator's plate), shifted across the chord when the drawn package is; extras (the pot's knob) are
  // separate boxes of the same part.
  const out: BodyShape[] = [];
  for (const p of Object.values(layout.poses)) {
    const g = BODY_GEOMETRY[p.kind];
    const e = g.packageHalfLen === undefined ? bodySpan(p) : { a: [p.x - p.dir[0] * g.packageHalfLen, p.z - p.dir[1] * g.packageHalfLen] as [number, number], b: [p.x + p.dir[0] * g.packageHalfLen, p.z + p.dir[1] * g.packageHalfLen] as [number, number] };
    const off = g.acrossOffset ?? 0;   // world +z
    out.push({ id: p.id, kind: 'capsule', a: [e.a[0], e.a[1] + off], b: [e.b[0], e.b[1] + off], halfWidth: g.halfWidth, height: g.height + (p.mount ?? 0) });
    for (const x of g.extras ?? []) out.push({ id: p.id, kind: 'box', min: [p.x + x.min[0], x.min[1] + (p.mount ?? 0), p.z + x.min[2]], max: [p.x + x.max[0], x.max[1] + (p.mount ?? 0), p.z + x.max[2]] });
  }
  return out;
}
export function layoutNets(layout: RailLayout, c: Composition): Record<string, string[]> {
  const nets: Record<string, string[]> = {}; for (const t of layoutTerminals(layout, c)) if (t.net) (nets[t.net] ??= []).push(`${t.part}.${t.port}`); return nets;
}
/**
 * Validate a layout against the composition it claims to dress. Staleness first (template, geometry, structure), then
 * the geometry core on the layout's own (mirrored) geometry. The renderer's geometry is validated separately in the
 * browser through the same core (`checkGeometry3D`) — this function never claims that.
 */
export function validateRailLayout(layout: RailLayout, c: Composition, options: { minClearance?: number } = {}): RailReport {
  const d: RailDiagnostic[] = [];
  if (layout.templateVersion !== TEMPLATE_VERSION) d.push({ cause: 'stale-template', where: 'layout', message: `Layout is ${layout.templateVersion}; the template is ${TEMPLATE_VERSION}`, severity: 'error' });
  if (layout.geometryVersion !== GEOMETRY_VERSION) d.push({ cause: 'stale-geometry', where: 'layout', message: `Layout used body geometry ${layout.geometryVersion}; the current table is ${GEOMETRY_VERSION}`, severity: 'error' });
  const sha = structuralHash(c); if (layout.structureSha256 !== sha) d.push({ cause: 'stale-structure', where: 'layout', message: `Layout was generated for structure ${layout.structureSha256}; this composition is ${sha}`, severity: 'error' });
  if (d.length) return { ok: false, diagnostics: d, checked: { wires: 0, bodies: 0, pairs: 0, terminals: 0 } };
  for (const p of Object.values(layout.poses)) if (![p.x, p.z, p.len].every(Number.isFinite) || p.len <= 0 || Math.hypot(p.dir[0], p.dir[1]) < 1e-9) d.push({ cause: 'invalid-geometry', where: p.id, message: `Pose of ${p.id} is not finite`, severity: 'error' });
  if (d.length) return { ok: false, diagnostics: d, checked: { wires: layout.wires.length, bodies: Object.keys(layout.poses).length, pairs: 0, terminals: 0 } };
  const terminals = layoutTerminals(layout, c), wires = layoutWires3(layout), bodies = layoutBodies(layout);
  const rotor: RotorShape | null = layout.rotor ? { hub: [layout.rotor.x, layout.rotor.hubY, layout.rotor.z], radius: layout.rotor.radius, thickness: 0.3 } : null;
  const core = checkGeometry3D(wires, bodies, terminals, rotor, layoutNets(layout, c), options);
  d.push(...core.diagnostics);
  return { ok: !d.some((x) => x.severity === 'error'), diagnostics: d, checked: { wires: wires.length, bodies: bodies.length, pairs: core.pairs, terminals: terminals.length } };
}
