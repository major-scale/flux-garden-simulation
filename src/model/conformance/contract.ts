/**
 * THE TASK CONTRACT — what a trial builder may NOT change, enforced by machine against its candidate composition
 * (not only stated in the task text): the source and its programme, the analysis, the allowed part names and kinds,
 * each part's spec fields and ranges, the external node names and the part count. A candidate that meets a timing
 * target by changing the source, shortening the run, adding a part or renaming an observable fails HERE by name,
 * before the electrical checks are even consulted. Pure data in, named violations out; no solver.
 */
import type { Composition, SourceInstance, PartInstance } from './composition';
import { checkCompositionShape } from './shape';

export interface TaskContract {
  id: string;
  /** The one fixed source, compared field by field (kind, name, nodes, volts or every PWL point). */
  source: SourceInstance;
  /** The fixed analysis: stop, step and (when given) reltol must match exactly. */
  analysis: { stopSeconds: number; stepSeconds: number; reltol?: number };
  /** The external node names the candidate may use (ground `0` included). */
  nodes: string[];
  /** The most parts a candidate may have. */
  maxParts: number;
  /** The allowed parts by NAME: its kind, and every spec field it may carry with an inclusive range. A part name not listed, a kind that differs, a field not listed or a value outside its range is a violation. */
  parts: Record<string, { kind: PartInstance['kind']; ports?: Record<string, string>; spec: Record<string, [number, number]> }>;
  /** Parts that MUST be present (by name), so a candidate cannot satisfy the checks by leaving something out. */
  requiredParts: string[];
}

export interface ContractViolation { cause: string; where: string; message: string }

/** Key order is not content: compare canonical (sorted-key) JSON, so a correct candidate never fails on how it ordered a source's fields. */
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Every way the candidate departs from the contract, by NAME. Empty means the candidate is inside the contract. */
export function checkContract(c: Composition, k: TaskContract): ContractViolation[] {
  const shape = checkCompositionShape(c);
  if (shape.length) return shape;
  const v: ContractViolation[] = [];
  // Source: exactly one, identical to the frozen one.
  if (!Array.isArray(c.sources) || c.sources.length !== 1) v.push({ cause: 'contract-source', where: 'sources', message: `the contract fixes exactly one source (${k.source.name}); the candidate has ${Array.isArray(c.sources) ? c.sources.length : 'none'}` });
  else if (!same(c.sources[0], k.source)) v.push({ cause: 'contract-source', where: c.sources[0].name ?? 'source', message: `the source is frozen: kind, name, nodes and programme must equal the contract's (${JSON.stringify(k.source)})` });
  // Analysis: frozen.
  const a = c.analysis ?? ({} as Composition['analysis']);
  if (a.stopSeconds !== k.analysis.stopSeconds || a.stepSeconds !== k.analysis.stepSeconds || (k.analysis.reltol !== undefined && a.reltol !== k.analysis.reltol))
    v.push({ cause: 'contract-analysis', where: 'analysis', message: `the analysis is frozen at stop ${k.analysis.stopSeconds} s, step ${k.analysis.stepSeconds} s${k.analysis.reltol !== undefined ? `, reltol ${k.analysis.reltol}` : ''}; the candidate has stop ${a.stopSeconds}, step ${a.stepSeconds}${a.reltol !== undefined ? `, reltol ${a.reltol}` : ''}` });
  if ((c as { environments?: unknown[] }).environments?.length) v.push({ cause: 'contract-environment', where: 'environments', message: 'the contract has no environment programmes; the candidate declares some' });
  // Parts: count, names, kinds, ports, spec fields and ranges.
  const parts = Array.isArray(c.parts) ? c.parts : [];
  if (parts.length > k.maxParts) v.push({ cause: 'contract-part-count', where: 'parts', message: `at most ${k.maxParts} parts; the candidate has ${parts.length}` });
  const seen = new Set<string>();
  for (const p of parts) {
    const rule = k.parts[p.name];
    if (!rule) { v.push({ cause: 'contract-part-name', where: p.name, message: `part ${JSON.stringify(p.name)} is not in the contract (allowed: ${Object.keys(k.parts).join(', ')})` }); continue; }
    if (seen.has(p.name)) v.push({ cause: 'contract-part-name', where: p.name, message: `part ${JSON.stringify(p.name)} appears twice` });
    seen.add(p.name);
    if (p.kind !== rule.kind) { v.push({ cause: 'contract-part-kind', where: p.name, message: `part ${p.name} must be a ${rule.kind}; the candidate makes it a ${p.kind}` }); continue; }
    if (rule.ports && !same(p.ports, rule.ports)) v.push({ cause: 'contract-ports', where: p.name, message: `the ports of ${p.name} are frozen at ${JSON.stringify(rule.ports)}; the candidate has ${JSON.stringify(p.ports)}` });
    const spec = (p.spec ?? {}) as Record<string, unknown>;
    for (const [field, val] of Object.entries(spec)) {
      const range = rule.spec[field];
      if (!range) { v.push({ cause: 'contract-spec-field', where: `${p.name}.${field}`, message: `${p.name} may only carry ${Object.keys(rule.spec).join(', ')}; ${field} is not allowed` }); continue; }
      if (typeof val !== 'number' || !Number.isFinite(val) || val < range[0] || val > range[1]) v.push({ cause: 'contract-spec-range', where: `${p.name}.${field}`, message: `${p.name}.${field} must be a finite number in ${range[0]}…${range[1]}; the candidate has ${JSON.stringify(val)}` });
    }
    for (const field of Object.keys(rule.spec)) if (!(field in spec)) v.push({ cause: 'contract-spec-field', where: `${p.name}.${field}`, message: `${p.name} must carry ${field}` });
    for (const node of Object.values(p.ports ?? {})) if (!k.nodes.includes(node as string)) v.push({ cause: 'contract-node', where: `${p.name}`, message: `node ${JSON.stringify(node)} is not in the contract (allowed: ${k.nodes.join(', ')})` });
  }
  for (const name of k.requiredParts) if (!seen.has(name)) v.push({ cause: 'contract-part-missing', where: name, message: `the contract requires a part named ${JSON.stringify(name)}` });
  return v;
}
