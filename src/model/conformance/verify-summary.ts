/**
 * THE TESTS-STAGE VERDICT of `tools/electronics-v1-verify.mjs`, kept pure so the verdict logic is itself under test.
 *
 * Astra's returns: (7bc1b6c0) the first runner read only the per-assertion statuses, so a run whose process exited 1 with
 * `success: false` and a runtime-error suite — but one passed assertion — came out PASS; (8ec7f748) the first fix still
 * passed a report that parsed to a JSON primitive (`null`, `false`, `0`, `""`) with zero results, because a falsy value
 * skipped every report check. Every shape is now validated before it is trusted.
 *
 * PASS needs ALL of: the process completed (no spawn error, no signal, exit status 0); a JSON report exists, parses, and is
 * an OBJECT whose `testResults` is an array of suite objects (string `name`, string `status`, `assertionResults` an array of
 * objects with a string `status` and a string title), with numeric counters where present; `success === true`; no failed or
 * runtime-error suites; every suite `passed`; at least one assertion — required unconditionally; every assertion `passed`
 * (skipped or todo is not a pass). Otherwise ERROR when the run did not complete or the report is missing or malformed, and
 * FAIL when a well-formed report from a completed run records a failure. Malformed input yields a named diagnostic, never an
 * exception. Every reason is kept.
 */
export interface ProcessOutcome { status: number | null; signal: string | null; error?: string | null; stderrTail?: string }
export interface TestRecord { file: string; title: string; status: string }
export interface TestsStage {
  verdict: 'pass' | 'fail' | 'error'; total: number; passed: number; failed: TestRecord[];
  problems: string[]; process: ProcessOutcome; tests: TestRecord[];
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = (v: unknown): string => v === undefined ? 'missing' : v === null ? 'null' : Array.isArray(v) ? 'an array'
  : typeof v === 'string' ? `the string ${JSON.stringify(v.slice(0, 40))}` : typeof v === 'object' ? 'an object' : `${typeof v} ${JSON.stringify(v)}`;

export function summarizeVitest(proc: ProcessOutcome, reportText: string | null, root = ''): TestsStage {
  const problems: string[] = [];
  const incomplete = Boolean(proc.error) || proc.signal !== null || proc.status === null;
  if (proc.error) problems.push(`the test process could not run: ${proc.error}`);
  if (proc.signal !== null) problems.push(`the test process was terminated by ${proc.signal}`);
  if (proc.status === null && !proc.signal && !proc.error) problems.push('the test process reported no exit status');
  if (proc.status !== null && proc.status !== 0) problems.push(`the test process exited with status ${proc.status}`);

  let report: Record<string, unknown> | null = null, wellFormed = false;
  if (reportText === null || reportText.trim() === '') problems.push('no JSON test report was written');
  else {
    let parsed: unknown;
    try { parsed = JSON.parse(reportText); }
    catch (e) { problems.push(`the JSON test report does not parse: ${e instanceof Error ? e.message : String(e)}`); }
    if (parsed !== undefined) {
      if (isObject(parsed)) report = parsed;
      else problems.push(`malformed test report: the report is ${describe(parsed)}, not an object`);
    }
  }
  const tests: TestRecord[] = [];
  if (report) {
    wellFormed = true;
    const bad = (m: string) => { problems.push(`malformed test report: ${m}`); wellFormed = false; };
    if (report.success !== true) problems.push(`the report says success: ${report.success === undefined ? 'missing' : JSON.stringify(report.success)}`);
    for (const key of ['numFailedTestSuites', 'numRuntimeErrorTestSuites']) {
      const n = report[key];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n)) bad(`${key} is ${describe(n)}, not a number`);
      else if (n > 0) problems.push(key === 'numFailedTestSuites' ? `${n} test file(s) failed as a whole` : `${n} test file(s) hit a runtime error`);
    }
    if (!Array.isArray(report.testResults)) bad(`testResults is ${describe(report.testResults)}, not an array`);
    else report.testResults.forEach((suite: unknown, i: number) => {
      const at = `testResults[${i}]`;
      if (!isObject(suite)) { bad(`${at} is ${describe(suite)}, not an object`); return; }
      if (typeof suite.name !== 'string' || !suite.name) bad(`${at}.name is ${describe(suite.name)}, not a file name`);
      const file = typeof suite.name === 'string' && suite.name ? (suite.name.startsWith(root) ? suite.name.slice(root.length) : suite.name) : at;
      if (typeof suite.status !== 'string') bad(`${at}.status is ${describe(suite.status)}, not a string`);
      else if (suite.status !== 'passed') problems.push(`test file ${file} reported ${JSON.stringify(suite.status)}${typeof suite.message === 'string' && suite.message ? `: ${suite.message.slice(0, 300)}` : ''}`);
      if (!Array.isArray(suite.assertionResults)) { bad(`${at}.assertionResults is ${describe(suite.assertionResults)}, not an array`); return; }
      suite.assertionResults.forEach((a: unknown, j: number) => {
        const aAt = `${at}.assertionResults[${j}]`;
        if (!isObject(a)) { bad(`${aAt} is ${describe(a)}, not an object`); return; }
        const title = typeof a.fullName === 'string' ? a.fullName : typeof a.title === 'string' ? a.title : null;
        if (title === null) bad(`${aAt} has no string title`);
        if (typeof a.status !== 'string') bad(`${aAt}.status is ${describe(a.status)}, not a string`);
        tests.push({ file, title: title ?? aAt, status: typeof a.status === 'string' ? a.status : 'malformed' });
      });
    });
  }
  if (!tests.length) problems.push('the report contains no test results');
  const failed = tests.filter((t) => t.status !== 'passed');
  if (failed.length) problems.push(`${failed.length} test(s) not passed`);
  if (problems.length && proc.stderrTail) problems.push(`stderr tail: ${proc.stderrTail.slice(-600)}`);
  const verdict = !problems.length ? 'pass' : incomplete || !report || !wellFormed ? 'error' : 'fail';
  return { verdict, total: tests.length, passed: tests.length - failed.length, failed, problems, process: proc, tests };
}
