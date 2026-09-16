/**
 * THE TERMINAL MAP — the production sign convention in one table. For every element of a composition (sources,
 * environment programmes, parts) it lists each terminal's NODE and the current INTO that terminal, written as a signed
 * sum of that element's own probe observables. The `energy-balance` check sums v(node)·i(into) over it (Tellegen's
 * closure), and the Lean port-power theorem (`formal/ElectronicsPortPower.lean`) is stated over exactly this shape:
 * terminals mapped to nodes, KCL at every non-ground node, ground at 0 V.
 *
 * Ground terminals are listed like any other (v(0) = 0, so they contribute nothing). Terminals that draw nothing BY
 * CONSTRUCTION are omitted — a comparator's inputs and a sensor's environment read are behavioural reads, so their
 * current is zero, not unobserved. A new part kind without an entry here is a compile error (exhaustive switch).
 */
import type { Composition, PartInstance } from './composition';

export interface Terminal { element: string; terminal: string; node: string; into: [observable: string, coefficient: number][] }

/** How an element's absorbed energy is accounted by `energy-balance`. */
export type EnergyRole = 'dissipative' | 'storing' | 'motor' | 'unbounded';
export const ENERGY_ROLE: Record<PartInstance['kind'], EnergyRole> = {
  resistor: 'dissipative', pot: 'dissipative', switch: 'dissipative', diode: 'dissipative', led: 'dissipative', ldr: 'dissipative', ntc: 'dissipative',
  comparator: 'dissipative', capacitor: 'storing', inductor: 'storing', coupled: 'storing', motor: 'motor', mosfet: 'unbounded',
};

const two = (element: string, a: [string, string], b: [string, string], current: string): Terminal[] => [
  { element, terminal: a[0], node: a[1], into: [[`${element}.${current}`, 1]] },
  { element, terminal: b[0], node: b[1], into: [[`${element}.${current}`, -1]] },
];

/** A part's terminals with the current INTO each, from its emitter's documented probe conventions (`parts.ts`). */
export function partTerminals(p: PartInstance): Terminal[] {
  const n = p.name;
  switch (p.kind) {
    // A 0 V probe in the first lead; the observable is the current entering that terminal.
    case 'resistor': case 'switch': case 'ldr': case 'ntc': return two(n, ['a', p.ports.a], ['b', p.ports.b], 'current');
    case 'capacitor': case 'inductor': case 'motor': return two(n, ['plus', p.ports.plus], ['minus', p.ports.minus], 'current');
    case 'diode': case 'led': return two(n, ['anode', p.ports.anode], ['cathode', p.ports.cathode], 'current');
    // Current INTO A; current OUT of the wiper; B takes the difference.
    case 'pot': return [
      { element: n, terminal: 'a', node: p.ports.a, into: [[`${n}.currentA`, 1]] },
      { element: n, terminal: 'w', node: p.ports.w, into: [[`${n}.currentW`, -1]] },
      { element: n, terminal: 'b', node: p.ports.b, into: [[`${n}.currentA`, -1], [`${n}.currentW`, 1]] },
    ];
    // Supply current INTO vcc; output current OUT of out; the ground returns are on node 0; inputs draw nothing.
    case 'comparator': return [
      { element: n, terminal: 'vcc', node: p.ports.vcc, into: [[`${n}.supplyCurrent`, 1]] },
      { element: n, terminal: 'out', node: p.ports.out, into: [[`${n}.outputCurrent`, -1]] },
    ];
    // Gate current INTO the gate; source current OUT of the source; the drain carries the difference (bulk is tied to source).
    case 'mosfet': return [
      { element: n, terminal: 'gate', node: p.ports.gate, into: [[`${n}.gateCurrent`, 1]] },
      { element: n, terminal: 'source', node: p.ports.source, into: [[`${n}.sourceCurrent`, -1]] },
      { element: n, terminal: 'drain', node: p.ports.drain, into: [[`${n}.sourceCurrent`, 1], [`${n}.gateCurrent`, -1]] },
    ];
    case 'coupled': return [
      ...two(n, ['plus1', p.ports.plus1], ['minus1', p.ports.minus1], 'current1'),
      ...two(n, ['plus2', p.ports.plus2], ['minus2', p.ports.minus2], 'current2'),
    ];
    default: { const unhandled: never = p; throw new Error(`no terminal map for part kind ${JSON.stringify((unhandled as PartInstance).kind)}`); }
  }
}

/** Every element's terminals. Sources and environment programmes: `i(V)` enters the + terminal (SPICE's convention). */
export function terminalMap(c: Composition): Terminal[] {
  const out: Terminal[] = [];
  for (const s of c.sources) out.push(...two(s.name, ['plus', s.plus], ['minus', s.minus], 'current'));
  for (const e of c.environments ?? []) out.push(...two(e.name, ['node', e.node], ['ground', '0'], 'current'));
  for (const p of c.parts) out.push(...partTerminals(p));
  return out;
}
