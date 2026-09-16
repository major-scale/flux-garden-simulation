/**
 * THE SOLVER, ISOLATED IN A WORKER, AND STRICTLY SERIAL.
 *
 * Isolation is not for speed. A solve that hangs must be KILLABLE — and this engine really does
 * hang, forever, on a netlist containing a single non-ASCII character — so `worker.terminate()`
 * is the only reliable stop. Off-thread also keeps a slow solve from freezing the UI.
 *
 * SERIALISATION IS NOT OPTIONAL, and the first version got it wrong twice:
 *
 *   - `ready()` cached only the FINISHED engine, so two messages arriving during startup each
 *     saw null and each constructed one. Two engines, two WASM heaps, one of them orphaned.
 *     The START PROMISE is cached now, not its result.
 *   - `setNetList` + `runSim` is a two-step transaction on shared state. Awaiting a warm solve
 *     let a second message overwrite the netlist mid-run, so a result could belong to neither
 *     request. Solves now run one at a time through an explicit chain.
 *
 * Only the LATEST waiting request is kept: an edit burst should cost one solve, not a queue.
 */
import { Simulation } from 'eecircuit-engine';

export interface SolveRequest { id: number; netlist: string }
export type SolveReply =
  | { id: number; ok: true; raw: unknown; engine: string; solveMs: number }
  | { id: number; ok: false; reason: string }
  | { id: number; ok: false; superseded: true; reason: string };

const ENGINE_NAME = 'eecircuit-engine (ngspice WASM)';
let startPromise: Promise<Simulation> | null = null;
let running = false;
/** At most ONE request may be waiting. A newer one replaces it, and the replaced one is told. */
let waiting: SolveRequest | null = null;

function ready(): Promise<Simulation> {
  // Cache the PROMISE. Caching only the resolved engine let concurrent callers each build one.
  if (!startPromise) {
    startPromise = (async () => {
      const sim = new Simulation();
      await sim.start();
      return sim;
    })().catch((err) => {
      // A REJECTED START MUST NOT STAY CACHED, or every later attempt replays the same failure
      // and only a page refresh recovers. Clearing it lets the next request genuinely retry.
      startPromise = null;
      throw err;
    });
  }
  return startPromise;
}

const post = (m: SolveReply) => (self as unknown as Worker).postMessage(m);

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (waiting) {
      const req = waiting;
      waiting = null;
      try {
        const sim = await ready();
        sim.setNetList(req.netlist);          // safe: nothing else can touch it inside the chain
        const t0 = performance.now();
        const raw = await sim.runSim();
        // NOT VALIDATED HERE, on purpose: the engine resolves even when the circuit was
        // refused, so judging a result needs the description, which lives on the client.
        post({ id: req.id, ok: true, raw, engine: ENGINE_NAME, solveMs: performance.now() - t0 });
      } catch (err) {
        post({ id: req.id, ok: false, reason: String(err) });
      }
    }
  } finally {
    running = false;
  }
}

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  if (waiting) {
    // Replaced before it ever ran. Say so, so the client can settle it rather than leak it.
    post({ id: waiting.id, ok: false, superseded: true, reason: 'Replaced by a newer request' });
  }
  waiting = e.data;
  void pump();
};
