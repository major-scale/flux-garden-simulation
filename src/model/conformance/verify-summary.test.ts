/**
 * Controls for the PRODUCTION tests-stage summarizer that `tools/electronics-v1-verify.mjs` bundles (Astra's returns
 * electronics-v1-closure-7bc1b6c0 and -8ec7f748). Process outcomes come from REAL `spawnSync` calls — a child that exits 0,
 * one that exits 1, one killed by its timeout, a command that cannot spawn — and malformed reports are table-driven: each
 * must not throw, must not pass, and must name its problem.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { summarizeVitest, type ProcessOutcome } from './verify-summary';

const outcome = (r: SpawnSyncReturns<string>): ProcessOutcome =>
  ({ status: r.status, signal: r.signal, error: r.error ? r.error.message : null, stderrTail: (r.stderr ?? '').slice(-800) });
const suite = (extra: Record<string, unknown> = {}) => ({ name: '/root/a.test.ts', status: 'passed',
  assertionResults: [{ title: 't1', fullName: 'a t1', status: 'passed' }, { title: 't2', fullName: 'a t2', status: 'passed' }], ...extra });
const passingReport = (extra: Record<string, unknown> = {}) => JSON.stringify({ success: true, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0, testResults: [suite()], ...extra });
const node = (code: string, timeout?: number) => spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout });
const exited0 = outcome(node('process.exit(0)'));

describe('tests-stage summarizer (production code of the verify runner)', () => {
  it('positive control: a real process exiting 0 with a complete, well-formed passing report → PASS', () => {
    const r = summarizeVitest(exited0, passingReport(), '/root/');
    expect(r.verdict).toBe('pass'); expect(r.total).toBe(2); expect(r.problems).toEqual([]); expect(r.tests[0].file).toBe('a.test.ts');
  });
  it('a real process exiting 1 while every assertion passed → FAIL, naming the exit status', () => {
    const r = summarizeVitest(outcome(node('process.exit(1)')), passingReport());
    expect(r.verdict).toBe('fail'); expect(r.passed).toBe(2); expect(r.problems.join(' ')).toMatch(/exited with status 1/);
  });
  it("Astra's injected case: exit 1, success:false, one runtime-error suite, one passed assertion → not PASS", () => {
    const report = JSON.stringify({ success: false, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 1,
      testResults: [{ name: 'x.test.ts', status: 'passed', assertionResults: [{ title: 'only', status: 'passed' }] }] });
    const r = summarizeVitest(outcome(node('process.exit(1)')), report);
    expect(r.verdict).not.toBe('pass'); expect(r.total).toBe(1);
    expect(r.problems.join(' ')).toMatch(/success: false/); expect(r.problems.join(' ')).toMatch(/runtime error/);
  });
  it('a real child killed by its timeout (signal, no exit status) → ERROR even with a passing report on disk', () => {
    const killed = node('setTimeout(() => {}, 10000)', 300);
    expect(killed.signal).not.toBeNull();
    const r = summarizeVitest(outcome(killed), passingReport());
    expect(r.verdict).toBe('error'); expect(r.problems.join(' ')).toMatch(/terminated by/);
  });
  it('a command that cannot spawn → ERROR with the spawn error kept', () => {
    const r = summarizeVitest(outcome(spawnSync('flux-no-such-command-xyz', [], { encoding: 'utf8' })), null);
    expect(r.verdict).toBe('error'); expect(r.problems.join(' ')).toMatch(/could not run/); expect(r.problems.join(' ')).toMatch(/no JSON test report/);
  });
  it('exit 0 but no report, an empty file, or an unparseable report → ERROR', () => {
    for (const text of [null, '', '   ', '{"success": tru']) expect(summarizeVitest(exited0, text).verdict).toBe('error');
  });
  it('a suite-level (global) error with passed assertions → FAIL, keeping the suite message', () => {
    const report = passingReport({ numFailedTestSuites: 1, testResults: [{ name: 'g.test.ts', status: 'failed', message: 'afterAll hook failed', assertionResults: [{ title: 'ok', status: 'passed' }] }] });
    const r = summarizeVitest(exited0, report);
    expect(r.verdict).toBe('fail'); expect(r.problems.join(' ')).toMatch(/afterAll hook failed/);
  });
  it('an empty result list and a skipped test are not passes', () => {
    expect(summarizeVitest(exited0, JSON.stringify({ success: true, testResults: [] })).verdict).not.toBe('pass');
    const skipped = passingReport({ testResults: [suite({ assertionResults: [{ title: 'a', status: 'passed' }, { title: 'b', status: 'skipped' }] })] });
    expect(summarizeVitest(exited0, skipped).verdict).toBe('fail');
  });
});

// Astra's return 8ec7f748: valid JSON primitives and malformed shapes — a clean process exit must not rescue any of them.
const ok = (x: Record<string, unknown>) => JSON.stringify({ success: true, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0, ...x });
const MALFORMED: [label: string, text: string, names: RegExp][] = [
  ['the JSON literal null', 'null', /not an object/],
  ['the JSON literal false', 'false', /not an object/],
  ['the number 0', '0', /not an object/],
  ['an empty JSON string', '""', /not an object/],
  ['a JSON string', '"passed"', /not an object/],
  ['a JSON array', '[]', /not an object/],
  ['an empty object', '{}', /testResults is missing/],
  ['testResults an object', ok({ testResults: {} }), /testResults is an object, not an array/],
  ['testResults a string', ok({ testResults: 'all passed' }), /not an array/],
  ['testResults true', ok({ testResults: true }), /not an array/],
  ['a null suite', ok({ testResults: [null] }), /testResults\[0\] is null/],
  ['a numeric suite', ok({ testResults: [1] }), /testResults\[0\] is number 1/],
  ['a suite array', ok({ testResults: [[suite()]] }), /testResults\[0\] is an array/],
  ['a suite without a name', ok({ testResults: [{ status: 'passed', assertionResults: [{ title: 'a', status: 'passed' }] }] }), /name is missing/],
  ['a suite whose name is a number', ok({ testResults: [suite({ name: 7 })] }), /name is number 7/],
  ['a suite without a status', ok({ testResults: [suite({ status: undefined })] }), /status is missing/],
  ['assertionResults missing', ok({ testResults: [{ name: 'a.test.ts', status: 'passed' }] }), /assertionResults is missing/],
  ['assertionResults an object', ok({ testResults: [suite({ assertionResults: { t: 'passed' } })] }), /assertionResults is an object/],
  ['a null assertion', ok({ testResults: [suite({ assertionResults: [null] })] }), /assertionResults\[0\] is null/],
  ['a string assertion', ok({ testResults: [suite({ assertionResults: ['passed'] })] }), /assertionResults\[0\] is the string/],
  ['an assertion without a status', ok({ testResults: [suite({ assertionResults: [{ title: 'a' }] })] }), /status is missing/],
  ['an assertion whose status is a number', ok({ testResults: [suite({ assertionResults: [{ title: 'a', status: 1 }] })] }), /status is number 1/],
  ['an assertion without a title', ok({ testResults: [suite({ assertionResults: [{ status: 'passed' }] })] }), /no string title/],
  ['a counter that is a string', ok({ numFailedTestSuites: '0', testResults: [suite()] }), /numFailedTestSuites is the string/],
];

describe('malformed reports never pass and never throw (table)', () => {
  for (const [label, text, names] of MALFORMED) {
    it(`${label} → ERROR with a named problem`, () => {
      let r: ReturnType<typeof summarizeVitest> | undefined;
      expect(() => { r = summarizeVitest(exited0, text); }).not.toThrow();
      expect(r!.verdict).toBe('error');
      expect(r!.problems.join(' | ')).toMatch(names);
    });
  }
  it('one malformed entry among well-formed ones still blocks PASS', () => {
    const r = summarizeVitest(exited0, ok({ testResults: [suite(), { name: 'b.test.ts', status: 'passed', assertionResults: [null] }] }));
    expect(r.verdict).toBe('error'); expect(r.total).toBe(2);
  });
});
