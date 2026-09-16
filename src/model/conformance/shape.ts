/** JSON container/type diagnostics only. No coercion, circuit repair or physical validation. */
export interface ShapeIssue { cause: string; where: string; message: string }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function checkCompositionShape(value: unknown): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  const issue = (where: string, message: string) => issues.push({ cause: 'composition-shape', where, message });
  const number = (v: unknown, where: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) issue(where, `Expected one finite number, not ${Array.isArray(v) ? 'an array/range; write one number (the contract gives its allowed range or fixed value)' : 'a string, object or null'}.`);
  };
  const string = (v: unknown, where: string) => { if (typeof v !== 'string') issue(where, 'Expected a string.'); };
  const record = (v: unknown, where: string): v is Record<string, unknown> => {
    if (object(v)) return true;
    issue(where, 'Expected a JSON object.'); return false;
  };
  const points = (v: unknown, where: string) => {
    if (!Array.isArray(v)) { issue(where, 'Expected an array of {atSeconds, value} objects.'); return; }
    v.forEach((p, i) => { if (record(p, `${where}[${i}]`)) { number(p.atSeconds, `${where}[${i}].atSeconds`); number(p.value, `${where}[${i}].value`); } });
  };
  if (!record(value, '$')) return issues;
  string(value.id, 'id');
  if (!Array.isArray(value.sources)) issue('sources', 'Expected an array sources: [sourceObject, ...], even for one source. Use "sources", not the contract\'s singular "source".');
  else value.sources.forEach((s, i) => {
    if (!record(s, `sources[${i}]`)) return;
    for (const field of ['kind', 'name', 'plus', 'minus']) string(s[field], `sources[${i}].${field}`);
    if (s.kind === 'dc') number(s.volts, `sources[${i}].volts`);
    else if (s.kind === 'pwl') points(s.points, `sources[${i}].points`);
    else if (typeof s.kind === 'string') issue(`sources[${i}].kind`, `Expected "dc" or "pwl", not ${JSON.stringify(s.kind)}. A sine or pulse programme can be written as pwl points.`);
  });
  if (Array.isArray(value.sources) && !value.sources.length) issue('sources', 'The sources array needs at least one source object.');
  if (record(value.analysis, 'analysis')) {
    for (const field of ['stopSeconds', 'stepSeconds', 'reltol']) if (field in value.analysis) number(value.analysis[field], `analysis.${field}`);
  }
  if (value.environments !== undefined) {
    if (!Array.isArray(value.environments)) issue('environments', 'Expected an array of environment objects.');
    else value.environments.forEach((e, i) => {
      if (!record(e, `environments[${i}]`)) return;
      string(e.name, `environments[${i}].name`); string(e.node, `environments[${i}].node`); points(e.points, `environments[${i}].points`);
    });
  }
  if (!Array.isArray(value.parts)) issue('parts', 'Expected an array parts: [{name, kind, ports, spec}, ...], not an object keyed by name. Put each part\'s name inside its object.');
  if (Array.isArray(value.parts) && !value.parts.length) issue('parts', 'The parts array needs at least one part object.');
  // Inspect a mistaken name-keyed map too, to report scalar/range errors in the same response.
  const parts = Array.isArray(value.parts) ? value.parts.map((v, i) => [`parts[${i}]`, v] as const)
    : object(value.parts) ? Object.entries(value.parts).map(([k, v]) => [`parts.${k}`, v] as const) : [];
  for (const [path, part] of parts) {
    if (!record(part, path)) continue;
    string(part.kind, `${path}.kind`);
    if (Array.isArray(value.parts) && typeof part.name !== 'string') issue(`${path}.name`, 'Expected a name string inside each part object.');
    if (record(part.ports, `${path}.ports`)) for (const [port, node] of Object.entries(part.ports)) string(node, `${path}.ports.${port}`);
    if (!record(part.spec, `${path}.spec`)) continue;
    const kind = part.kind;
    for (const [field, v] of Object.entries(part.spec)) {
      const at = `${path}.spec.${field}`;
      const nested = (kind === 'led' && field === 'part') || (kind === 'comparator' && field === 'switch') || (kind === 'motor' && ['motor', 'load', 'rack', 'brake'].includes(field));
      const domain = (kind === 'ldr' && field === 'luxDomain') || (kind === 'ntc' && field === 'celsiusDomain');
      if (nested) {
        // A motor brake's release time may be null: "never released", the locked shaft.
        if (record(v, at)) for (const [k, n] of Object.entries(v)) if (!(n === null && kind === 'motor' && field === 'brake' && k === 'releaseAtSeconds')) number(n, `${at}.${k}`);
      } else if (domain) {
        if (!Array.isArray(v) || v.length !== 2) issue(at, 'Expected a two-number domain array.');
        else v.forEach((n, i) => number(n, `${at}[${i}]`));
      } else number(v, at);
    }
    if (part.kind === 'switch' && record(part.programme, `${path}.programme`)) {
      for (const field of ['closeAtSeconds', 'openAtSeconds', 'edgeSeconds']) {
        const v = part.programme[field];
        if (field !== 'edgeSeconds' && v === null) continue;
        number(v, `${path}.programme.${field}`);
      }
    }
  }
  return issues;
}
