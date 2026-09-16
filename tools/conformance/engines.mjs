/**
 * The two solver engines behind the conformance kit, shared by `tools/conform.mjs` and `tools/electronics-v1-verify.mjs`
 * so both run the same engine code. Two builds of ngspice (WASM in-process, native on PATH) give an EXECUTION-PATH
 * comparison of the same netlist — not independent physical evidence.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** eecircuit-engine: the ngspice WASM build the pages run. */
export async function wasmEngine() {
  const { Simulation } = await import('eecircuit-engine');
  const version = JSON.parse(readFileSync(resolve('node_modules/eecircuit-engine/package.json'), 'utf8')).version;
  return { name: 'eecircuit-engine (ngspice WASM)', version, async run(netlist) { const sim = new Simulation(); await sim.start(); sim.setNetList(netlist); return sim.runSim(); } };
}

/** Whether a native ngspice is on PATH (its absence is a SKIPPED stage, never a pass). */
export function nativeAvailable() {
  try { execFileSync('ngspice', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; }
}

/** Native ngspice in batch mode, writing exactly the requested vectors; `workDir` holds the deck and its output. */
export function nativeEngine(workDir) {
  let version = 'unknown';
  try { version = (execFileSync('ngspice', ['--version'], { encoding: 'utf8' }).match(/ngspice-(\S+)/) ?? [])[1] ?? 'unknown'; } catch { throw new Error('ngspice is not on PATH'); }
  return { name: 'ngspice (native)', version, async run(netlist, vectors) {
    const out = join(workDir, 'out.txt'), cir = join(workDir, 'deck.cir');
    writeFileSync(out, '');
    writeFileSync(cir, `${netlist.replace(/^\.end\s*$/m, '')}.control\nrun\nset numdgt=17\nset filetype=ascii\nwrdata ${out} ${vectors.join(' ')}\n.endc\n.end\n`);
    try { execFileSync('ngspice', ['-b', cir], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'ignore', 'ignore'] }); } catch { return { variableNames: [], data: [] }; }   // a failed run → the kit reports an error
    const text = readFileSync(out, 'utf8');
    const cols = vectors.length * 2, rows = [];
    for (const line of text.split('\n')) { const p = line.trim().split(/\s+/).map(Number); if (p.length < cols || p.some(Number.isNaN)) continue; rows.push(p); }
    return { variableNames: ['time', ...vectors], data: [{ name: 'time', values: rows.map((r) => r[0]) }, ...vectors.map((v, i) => ({ name: v, values: rows.map((r) => r[2 * i + 1]) }))] };
  } };
}
