/**
 * THE DECK-LAYOUT ADAPTER — turns a committed ELK placement (`tools/fan-elk-layout.mjs` → `fan-layout.elk.json`)
 * into what the scene already understands: a pose per body (`bodyAt` / `bodyDir` / `bodyLen`) and an anchor per
 * net. It is a small reusable mapping, not a layout engine: nothing is laid out at runtime, and a placement is
 * only used when its structural identity matches the composition it is asked to dress — a stale placement is
 * refused, so a rewired circuit can never wear an old layout.
 */
import type { Composition } from '../model/conformance/composition';

export interface ElkLayoutFile {
  tool: string; elkjs: string; structureSha256: string; units: string;
  variant?: Record<string, unknown>; options?: Record<string, string>;
  extent: { w: number; h: number };
  bodies: Record<string, { x: number; z: number; w: number; h: number; group: string | null; bodyOffsetZ?: number; bodyLen?: number;
    ports: Record<string, { x: number; z: number; side?: string }> }>;
  junctions: Record<string, { x: number; z: number }>;
  routes: Record<string, { x: number; z: number }[]>;
  nets: Record<string, string[]>;
}
export interface DeckPose { bodyAt: { x: number; z: number }; bodyDir: [number, number]; bodyLen: number }
export interface DeckPlacement {
  anchors: Record<string, { x: number; z: number }>; poses: Record<string, DeckPose>; extent: { w: number; h: number };
  /** Interior waypoints per body for its two leads, oriented as the scene draws them (in: anchor → body; out: body → anchor). */
  leadRoutes: Record<string, { in?: [number, number][]; out?: [number, number][] }>;
}

/** The STRUCTURAL identity the tool hashed: kinds, names and port wiring only — never volts, points or analysis. */
export function structuralJson(c: Composition): string {
  return JSON.stringify({ sources: c.sources.map((x) => ({ kind: x.kind, name: x.name, plus: x.plus, minus: x.minus })), parts: c.parts.map((x) => ({ kind: x.kind, name: x.name, ports: x.ports })) });
}
export async function structuralSha256(c: Composition): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(structuralJson(c)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Bodies become poses: the chord runs from the FIRST listed port toward the SECOND (the branch's `from` → `to`
 * order in the page), so the pose direction is the unit vector between those two port positions; the centre is
 * the footprint centre shifted by the tool's `bodyOffsetZ` (the motor's can sits at the back of a footprint that
 * also reserves the rotor's space). Nets with a junction take its position; two-member nets take the midpoint of
 * their two ports.
 */
export function placementFrom(layout: ElkLayoutFile, chordPorts: Record<string, [string, string]>): DeckPlacement {
  const poses: Record<string, DeckPose> = {};
  for (const [id, b] of Object.entries(layout.bodies)) {
    const pair = chordPorts[id]; if (!pair) continue;
    const pa = b.ports[pair[0]], pb = b.ports[pair[1]];
    if (!pa || !pb) throw new Error(`Layout body ${id} has no ports ${pair.join('/')}`);
    const dx = pb.x - pa.x, dz = pb.z - pa.z, L = Math.hypot(dx, dz) || 1;
    poses[id] = { bodyAt: { x: b.x, z: b.z + (b.bodyOffsetZ ?? 0) }, bodyDir: [dx / L, dz / L], bodyLen: b.bodyLen ?? 3.6 };
  }
  type P = { x: number; z: number };
  const netOf: Record<string, string> = {}; for (const [net, members] of Object.entries(layout.nets)) for (const m of members) netOf[m] = net;
  const routeBetween = (a: string, b: string): P[] | null => layout.routes[`${a}->${b}`] ?? (layout.routes[`${b}->${a}`] ? [...layout.routes[`${b}->${a}`]].reverse() : null);
  const halfPoint = (pts: P[]): { at: P; k: number } => {   // the point at half the polyline's length, and the segment it falls in
    let total = 0; for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
    let acc = 0; for (let k = 1; k < pts.length; k++) { const L = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z); if (acc + L >= total / 2) { const f = L ? (total / 2 - acc) / L : 0; return { at: { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * f, z: pts[k - 1].z + (pts[k].z - pts[k - 1].z) * f }, k }; } acc += L; }
    return { at: pts[pts.length - 1], k: pts.length - 1 };
  };
  const anchors: Record<string, P> = {};
  const twoNetSplit: Record<string, { pts: P[]; k: number }> = {};
  for (const [net, members] of Object.entries(layout.nets)) {
    if (layout.junctions[net]) { anchors[net] = layout.junctions[net]; continue; }
    const real = members.filter((m) => layout.bodies[m.split('.')[0]]);
    const r = real.length === 2 ? routeBetween(real[0], real[1]) : null;
    if (r && r.length >= 2) { const h = halfPoint(r); anchors[net] = h.at; twoNetSplit[net] = { pts: r, k: h.k }; continue; }
    const pts = real.map((m) => { const [body, port] = m.split('.'); return layout.bodies[body]?.ports[port]; }).filter((q): q is P & { side?: string } => !!q);
    if (pts.length) anchors[net] = { x: pts.reduce((sum, q) => sum + q.x, 0) / pts.length, z: pts.reduce((sum, q) => sum + q.z, 0) / pts.length };
  }
  /** The interior waypoints from a net's anchor to a body port (junction nets: the ELK route; two-member nets: the half of the port-to-port route on this body's side). */
  const towardPort = (net: string, bodyPort: string): [number, number][] | undefined => {
    const interior = (pts: P[]): [number, number][] => pts.slice(1, -1).map((q) => [q.x, q.z]);
    if (layout.junctions[net]) { const r = routeBetween(`net.${net}`, bodyPort); return r ? interior(r) : undefined; }
    const split = twoNetSplit[net]; if (!split) return undefined;
    const members = layout.nets[net].filter((m) => layout.bodies[m.split('.')[0]]);
    const forward = layout.routes[`${members[0]}->${members[1]}`] !== undefined;   // pts run members[0] → members[1]
    const first = forward ? members[0] : members[1];
    // pts[0..k-1] lie on `first`'s side of the anchor, pts[k..] on the other's; orient each half from the anchor toward the port.
    const mine = bodyPort === first ? [...split.pts.slice(0, split.k)].reverse() : split.pts.slice(split.k);
    return mine.slice(0, -1).map((q) => [q.x, q.z]);    // drop the port end (the body end replaces it); the anchor end is not in the slice
  };
  const leadRoutes: DeckPlacement['leadRoutes'] = {};
  for (const [id] of Object.entries(layout.bodies)) {
    const pair = chordPorts[id]; if (!pair) continue;
    const inNet = netOf[`${id}.${pair[0]}`], outNet = netOf[`${id}.${pair[1]}`];
    const inR = inNet ? towardPort(inNet, `${id}.${pair[0]}`) : undefined;
    const outR = outNet ? towardPort(outNet, `${id}.${pair[1]}`) : undefined;
    leadRoutes[id] = { in: inR && inR.length ? inR : undefined, out: outR && outR.length ? [...outR].reverse() : undefined };
  }
  return { anchors, poses, extent: layout.extent, leadRoutes };
}

// ---------------------------------------------------------------- the rail router (deterministic, no library)
/**
 * A RAIL-AND-DROP LAYOUT: two deliberate buses — the + rail along the back, ground along the front — and bodies
 * standing between them, each with a short local drop from its rail-side terminal straight back to the + rail and
 * from its ground-side terminal straight forward to the ground rail. Intermediate nets are short local wires. The
 * page authors the body positions (three zones); this function derives every drop point, every bus segment and the
 * summed current on each segment from those positions and the members' solved currents — the same result for the
 * same input, with no search. It is a router for THIS family of circuits (one rail, one ground, a chain of
 * signal nets), written to be read, not a general layout engine.
 */
export interface RailBody { id: string; x: number; z: number; dir: [number, number]; len: number }
export interface RailMember { body: string; port: 'in' | 'out' | 'vcc' | 'gnd'; x: number; current: number | null }
export interface RailSpec { railZ: number; groundZ: number; railX: [number, number]; groundX: [number, number] }
export interface Bus { id: string; points: [number, number][]; currents: (number | null)[] }

/** The end of a posed body's chord: `in` is the first end (toward `from`), `out` the second (toward `to`). */
export function chordEnd(b: RailBody, which: 'in' | 'out'): [number, number] {
  const h = b.len / 2, sgn = which === 'in' ? -1 : 1;
  return [b.x + sgn * b.dir[0] * h, b.z + sgn * b.dir[1] * h];
}

/**
 * A bus along z = `z` from `lo` to `hi`, fed at `feedX` (where the net's marker stands and its current enters or
 * leaves), with each member taking `taken` amps at its drop x (negative = injecting into the bar). The current on
 * the segment between two consecutive x positions, positive toward +x: right of the feed it is Σ taken of the
 * members beyond the segment; left of the feed it is −Σ taken of the members beyond it on that side. Any null
 * member makes the affected segments null. The sums are KCL by construction — sums of solved figures, not probes.
 */
export function busThrough(id: string, z: number, feedX: number, members: { x: number; taken: number | null }[], extendTo?: [number, number]): Bus {
  const xs = [...new Set([feedX, ...members.map((m) => m.x), ...(extendTo ?? [])])].sort((a, b) => a - b);
  const points: [number, number][] = xs.map((x) => [x, z]);
  const currents: (number | null)[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const mid = (xs[k] + xs[k + 1]) / 2;
    const beyond = mid > feedX ? members.filter((m) => m.x > mid) : members.filter((m) => m.x < mid);
    let sum: number | null = 0; for (const m of beyond) { if (m.taken === null) { sum = null; break; } sum += m.taken; }
    currents.push(sum === null ? null : (mid > feedX ? sum : -sum));
  }
  return { id, points, currents };
}
