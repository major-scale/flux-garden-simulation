import type { Composition, PartInstance, SourceInstance } from '../conformance/composition';

export type ImportCause =
  | 'empty-netlist' | 'non-ascii' | 'continuation' | 'unsupported-device' | 'unsupported-directive'
  | 'unsupported-option' | 'unsupported-source' | 'malformed-element' | 'malformed-value'
  | 'duplicate-identity' | 'node-identity-collision' | 'missing-analysis' | 'duplicate-analysis' | 'missing-end' | 'content-after-end';

export class SpiceImportError extends Error {
  constructor(public readonly cause_: ImportCause, public readonly line: number, message: string) {
    super(`line ${line}: ${message}`);
  }
}

export interface IdentityMapping {
  spiceName: string;
  stableId: string;
  kind: 'source' | 'resistor' | 'capacitor' | 'inductor';
  line: number;
}

export interface SpiceImportResult {
  composition: Composition;
  manifest: {
    format: 'flux-spice-subset-1';
    title: string;
    identities: IdentityMapping[];
    nodes: Record<string, string>;
    recognisedNonSemantic: { line: number; directive: string; reason: string }[];
    pulseDefaults: 'ngspice: TD=0, TR=TSTEP, TF=TSTEP, PW=TSTOP, PER=TSTOP';
  };
}

const SUFFIX: Record<string, number> = {
  '': 1, t: 1e12, g: 1e9, meg: 1e6, k: 1e3, mil: 25.4e-6,
  m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

function number(token: string, line: number): number {
  const m = token.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]+)?$/i);
  if (!m) throw new SpiceImportError('malformed-value', line, `invalid numeric value ${JSON.stringify(token)}`);
  const suffix = (m[2] ?? '').toLowerCase();
  if (!(suffix in SUFFIX)) throw new SpiceImportError('malformed-value', line, `unsupported engineering suffix ${JSON.stringify(m[2])} in ${JSON.stringify(token)}`);
  const value = Number(m[1]) * SUFFIX[suffix];
  if (!Number.isFinite(value)) throw new SpiceImportError('malformed-value', line, `non-finite numeric value ${JSON.stringify(token)}`);
  return value;
}

const stableName = (name: string, line: number): string => {
  const out = name.toLowerCase();
  if (!/^[a-z][a-z0-9]*$/.test(out)) throw new SpiceImportError('malformed-element', line, `instance ${JSON.stringify(name)} cannot be represented as a stable Flux identity (letters and digits only)`);
  return out;
};

const nodeName = (node: string, line: number): string => {
  if (node === '0') return '0';
  const lower = node.toLowerCase();
  if (!/^[a-z0-9]+$/.test(lower)) throw new SpiceImportError('malformed-element', line, `node ${JSON.stringify(node)} is outside the supported alphanumeric subset`);
  return /^[a-z]/.test(lower) ? lower : `n${lower}`;
};

interface RawSource { name: string; plus: string; minus: string; args: string; line: number }

/** Deterministic, fail-closed importer for the deliberately small subset documented by CIRCUIT-IMPORT-PILOT-v1-PLAN.md. */
export function importSpiceSubset(text: string, id = 'imported-spice'): SpiceImportResult {
  if (!text.length) throw new SpiceImportError('empty-netlist', 1, 'netlist is empty');
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c > 126)
      throw new SpiceImportError('non-ascii', text.slice(0, k).split('\n').length, `unsupported character U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // SPICE reserves the PHYSICAL first line as the title, even when it is blank or begins with `*`.
  // Never scan forward for a title: doing that can silently consume the first circuit element.
  const title = lines[0].trim();
  let ended = false;
  let analysis: { stopSeconds: number; stepSeconds: number; reltol: number } | null = null;
  const rawSources: RawSource[] = [], parts: PartInstance[] = [], identities: IdentityMapping[] = [];
  const used = new Set<string>();
  // Map avoids inherited-object keys such as "constructor" and "toString". SPICE nodes compare
  // case-insensitively, while `stableNodeOwners` makes normalization injective ("1" and "n1"
  // cannot both become "n1").
  const nodeMap = new Map<string, string>([['0', '0']]);
  const stableNodeOwners = new Map<string, string>([['0', '0']]);
  const recognisedNonSemantic: SpiceImportResult['manifest']['recognisedNonSemantic'] = [];
  const mapNode = (raw: string, line: number) => {
    const spiceKey = raw.toLowerCase(), prior = nodeMap.get(spiceKey);
    if (prior !== undefined) return prior;
    const stable = nodeName(raw, line), owner = stableNodeOwners.get(stable.toLowerCase());
    if (owner !== undefined && owner !== spiceKey)
      throw new SpiceImportError('node-identity-collision', line, `SPICE nodes ${JSON.stringify(owner)} and ${JSON.stringify(raw)} both normalize to Flux node ${JSON.stringify(stable)}`);
    nodeMap.set(spiceKey, stable); stableNodeOwners.set(stable.toLowerCase(), spiceKey); return stable;
  };
  const claim = (raw: string, kind: IdentityMapping['kind'], line: number) => {
    const stableId = stableName(raw, line), key = stableId.toLowerCase();
    if (used.has(key)) throw new SpiceImportError('duplicate-identity', line, `instance identity ${JSON.stringify(raw)} collides case-insensitively with an earlier element`);
    used.add(key); identities.push({ spiceName: raw, stableId, kind, line }); return stableId;
  };

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1, raw = lines[i], s = raw.trim();
    if (!s || s.startsWith('*')) continue;
    if (ended) throw new SpiceImportError('content-after-end', lineNo, `content after .end is not supported: ${JSON.stringify(s)}`);
    if (s.startsWith('+')) throw new SpiceImportError('continuation', lineNo, 'continuation lines are not supported');
    if (/^\.end$/i.test(s)) { ended = true; continue; }
    const tran = s.match(/^\.tran\s+(\S+)\s+(\S+)$/i);
    if (tran) {
      if (analysis) throw new SpiceImportError('duplicate-analysis', lineNo, 'only one .tran analysis is supported');
      analysis = { stepSeconds: number(tran[1], lineNo), stopSeconds: number(tran[2], lineNo), reltol: 1e-4 };
      continue;
    }
    if (/^\.options\s+noacct$/i.test(s)) {
      recognisedNonSemantic.push({ line: lineNo, directive: s, reason: 'ngspice accounting-output switch; it does not change the circuit equations' }); continue;
    }
    if (/^\.options\b/i.test(s)) throw new SpiceImportError('unsupported-option', lineNo, `solver option is not supported: ${JSON.stringify(s)}`);
    if (/^\.plot\s+tran\b/i.test(s)) {
      recognisedNonSemantic.push({ line: lineNo, directive: s, reason: 'output selection only; the verifier requests vectors directly from both solvers' }); continue;
    }
    if (s.startsWith('.')) throw new SpiceImportError('unsupported-directive', lineNo, `directive is not supported: ${JSON.stringify(s.split(/\s+/)[0])}`);
    const tok = s.split(/\s+/), designator = tok[0][0]?.toUpperCase();
    if (designator === 'R' || designator === 'C' || designator === 'L') {
      if (tok.length !== 4) throw new SpiceImportError('malformed-element', lineNo, `${designator} element needs name, two nodes and one value`);
      const kind = designator === 'R' ? 'resistor' : designator === 'C' ? 'capacitor' : 'inductor';
      const name = claim(tok[0], kind, lineNo), a = mapNode(tok[1], lineNo), b = mapNode(tok[2], lineNo), value = number(tok[3], lineNo);
      if (kind === 'resistor') parts.push({ kind, name, ports: { a, b }, spec: { ohms: value } });
      else if (kind === 'capacitor') parts.push({ kind, name, ports: { plus: a, minus: b }, spec: { farads: value } });
      else parts.push({ kind, name, ports: { plus: a, minus: b }, spec: { henries: value } });
      continue;
    }
    if (designator === 'V') {
      if (tok.length < 4) throw new SpiceImportError('malformed-element', lineNo, 'voltage source needs name, two nodes and a source form');
      const name = claim(tok[0], 'source', lineNo), plus = mapNode(tok[1], lineNo), minus = mapNode(tok[2], lineNo);
      rawSources.push({ name, plus, minus, args: tok.slice(3).join(' '), line: lineNo }); continue;
    }
    throw new SpiceImportError('unsupported-device', lineNo, `device ${JSON.stringify(tok[0])} is not supported (supported: R, C, L, V)`);
  }
  if (!ended) throw new SpiceImportError('missing-end', lines.length, 'netlist needs .end');
  if (!analysis) throw new SpiceImportError('missing-analysis', lines.length, 'this pilot requires one .tran analysis');
  if (!(analysis.stepSeconds > 0 && analysis.stopSeconds >= analysis.stepSeconds)) throw new SpiceImportError('malformed-value', 1, '.tran requires 0 < TSTEP <= TSTOP');

  const sources: SourceInstance[] = rawSources.map((s) => {
    const dc = s.args.match(/^(?:dc\s+)?(\S+)$/i);
    if (dc) return { kind: 'dc', name: s.name, plus: s.plus, minus: s.minus, volts: number(dc[1], s.line) };
    const pulse = s.args.match(/^pulse\s*\(\s*(\S+)\s+(\S+)\s*\)(?:\s+ac\s+\S+)?$/i);
    if (!pulse) throw new SpiceImportError('unsupported-source', s.line, `voltage source form is not supported: ${JSON.stringify(s.args)}`);
    if (!(analysis!.stepSeconds < analysis!.stopSeconds)) throw new SpiceImportError('unsupported-source', s.line, 'two-argument PULSE needs TSTEP < TSTOP so its default rise and pulse width produce distinct PWL points');
    const v1 = number(pulse[1], s.line), v2 = number(pulse[2], s.line);
    return { kind: 'pwl', name: s.name, plus: s.plus, minus: s.minus,
      points: [{ atSeconds: 0, value: v1 }, { atSeconds: analysis!.stepSeconds, value: v2 }, { atSeconds: analysis!.stopSeconds, value: v2 }] };
  });
  return { composition: { id, sources, parts, analysis }, manifest: {
    format: 'flux-spice-subset-1', title, identities, nodes: Object.fromEntries(nodeMap), recognisedNonSemantic,
    pulseDefaults: 'ngspice: TD=0, TR=TSTEP, TF=TSTEP, PW=TSTOP, PER=TSTOP',
  } };
}
