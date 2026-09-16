/**
 * THE MAIN-THREAD CLIENT: generations, epochs, deadlines, and a solver that can be killed.
 *
 * Every failure here was observed or is reachable, not imagined:
 *   - the engine RESOLVES on a refused circuit, so results are validated, never trusted;
 *   - it HANGS on a non-ASCII netlist, so every request has a deadline and the worker is
 *     TERMINATED on it rather than abandoned;
 *   - edits outrun solves, so a superseded reply is discarded — but its promise still SETTLES,
 *     because leaving it pending leaks one promise per replaced edit;
 *   - a worker that errored must not stay cached, and its late errors must not kill the
 *     requests belonging to its replacement. Hence an epoch on every request.
 */
import { buildNetlist, type CircuitDescription } from './netlist';
import { toTransient, SolveFault, type RawResult, type Transient } from './transient';
import { buildLampNetlist, type LampDescription } from './lamp-netlist';
import { toLampTransient, type LampTransient } from './lamp-transient';
import { buildMotorNetlist, type MotorDescription } from './motor-netlist';
import { toMotorTransient, type MotorTransient } from './motor-transient';
import { buildControlsNetlist, type ControlsDescription } from './controls-netlist';
import { toControlsTransient, type ControlsTransient } from './controls-transient';
import { buildSensorsNetlist, type SensorsDescription } from './sensors-netlist';
import { toSensorsTransient, type SensorsTransient } from './sensors-transient';
import { prepareComposition, toCompositionTransient, type CompositionTransient } from './composition-transient';
import type { Composition } from '../conformance/composition';
import type { SolveReply } from './solver.worker';

export interface SolveOptions { timeoutMs?: number }

/** A result that arrived after a newer request replaced it. Expected, not a failure. */
export class Superseded extends Error {}

interface Pending {
  resolve: (t: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /**
   * Turns the raw reply into the caller's transient type. It closes over a DEEP COPY of the
   * description taken at submit: the caller's object may be a live form model, and if it mutated
   * before the reply arrived the result would be interpreted under different parameters.
   */
  decode: (raw: RawResult, engine: string) => unknown;
  epoch: number;
}

export class SpiceClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private newest = 0;
  /** Bumped on every terminate. A reply or error from an older epoch is ignored. */
  private epoch = 0;
  restarts = 0;

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const mine = this.epoch;
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SolveReply>) => {
      if (mine !== this.epoch) return;                  // a dead worker's late reply
      this.receive(e.data);
    };
    w.onerror = (e) => {
      if (mine !== this.epoch) return;                  // a dead worker's late error
      // Do NOT leave the broken worker cached: the next solve would post into a corpse.
      this.terminate(`The solver worker failed: ${e.message || 'load or runtime error'}`);
    };
    this.worker = w;
    return w;
  }

  /** Kill the worker outright — the only reliable way to stop WASM that is not cooperating. */
  terminate(reason: string): void {
    this.epoch++;
    if (this.worker) { this.worker.terminate(); this.worker = null; this.restarts++; }
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new SolveFault(reason)); }
    this.pending.clear();
  }

  private settle(id: number, p: Pending, err: Error | null, t?: unknown): void {
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (err) p.reject(err); else p.resolve(t!);
  }

  private receive(reply: SolveReply): void {
    const p = this.pending.get(reply.id);
    if (!p) return;                                     // already settled by timeout
    if (!reply.ok) {
      this.settle(reply.id, p, 'superseded' in reply
        ? new Superseded(reply.reason) : new SolveFault(reply.reason));
      return;
    }
    if (reply.id !== this.newest) {
      this.settle(reply.id, p, new Superseded(
        `Superseded by a newer solve (request ${reply.id} < ${this.newest}).`));
      return;
    }
    try {
      this.settle(reply.id, p, null, p.decode(reply.raw as RawResult, reply.engine));
    } catch (e) {
      this.settle(reply.id, p, e instanceof Error ? e : new SolveFault(String(e)));
    }
  }

  solve(description: CircuitDescription, opts: SolveOptions = {}): Promise<Transient> {
    // Snapshot the description BEFORE anything async, including its nested objects.
    const frozen: CircuitDescription = {
      ...description,
      diode: description.diode ? { ...description.diode } : undefined,
      event: description.event ? { ...description.event } : undefined,
    };
    const netlist = buildNetlist(frozen);               // validates, and refuses non-ASCII
    return this.submit(netlist, (raw, engine) => toTransient(raw, frozen, engine), opts);
  }

  /** The lamp topology: the same worker, deadline, epoch and supersession; its own decoder. */
  solveLamp(description: LampDescription, opts: SolveOptions = {}): Promise<LampTransient> {
    const frozen: LampDescription = {
      ...description,
      mosfet: { ...description.mosfet },
      gate: description.gate.kind === 'pwl'
        ? { kind: 'pwl', points: description.gate.points.map((p) => ({ ...p })) }
        : { ...description.gate },
    };
    const netlist = buildLampNetlist(frozen);
    return this.submit(netlist, (raw, engine) => toLampTransient(raw, frozen, engine), opts);
  }

  /** The motor topology: one deck, one trajectory, its own decoder. */
  solveMotor(description: MotorDescription, opts: SolveOptions = {}): Promise<MotorTransient> {
    const frozen: MotorDescription = { ...description, motor: { ...description.motor }, load: { ...description.load },
      switch: { ...description.switch }, freewheel: { ...description.freewheel }, programme: { ...description.programme } };
    const netlist = buildMotorNetlist(frozen);
    return this.submit(netlist, (raw, engine) => toMotorTransient(raw, frozen, engine), opts);
  }

  /** The controls bench: same worker, deadline, epoch and supersession; its own decoder. */
  solveControls(description: ControlsDescription, opts: SolveOptions = {}): Promise<ControlsTransient> {
    const frozen: ControlsDescription = { ...description, toggle: { ...description.toggle, spec: { ...description.toggle.spec } },
      pot: { ...description.pot }, led: { ...description.led, part: { ...description.led.part } } };
    const netlist = buildControlsNetlist(frozen);
    return this.submit(netlist, (raw, engine) => toControlsTransient(raw, frozen, engine), opts);
  }

  /** The sensing bench: same worker, deadline, epoch and supersession; its own decoder. */
  solveSensors(description: SensorsDescription, opts: SolveOptions = {}): Promise<SensorsTransient> {
    const frozen: SensorsDescription = JSON.parse(JSON.stringify(description)) as SensorsDescription;   // plain data, deep copy
    const netlist = buildSensorsNetlist(frozen);
    return this.submit(netlist, (raw, engine) => toSensorsTransient(raw, frozen, engine), opts);
  }

  /**
   * ANY TYPED COMPOSITION the conformance kit can emit: the same structure the kit checks, the same
   * worker, deadline, epoch and supersession; a generic decoder keyed by observable name.
   */
  solveComposition(c: Composition, opts: SolveOptions = {}): Promise<CompositionTransient> {
    const frozen = JSON.parse(JSON.stringify(c)) as Composition;         // plain data, deep copy
    const structure = prepareComposition(frozen);                        // validates, refuses findings
    return this.submit(structure.netlist, (raw, engine) => toCompositionTransient(raw, frozen, structure, engine), opts);
  }

  private submit<T>(netlist: string, decode: (raw: RawResult, engine: string) => T,
      opts: SolveOptions): Promise<T> {
    if (this.injectedFailure !== null) {
      const reason = this.injectedFailure;
      this.injectedFailure = null;
      return Promise.reject(new SolveFault(reason));
    }
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 15000;

    // Settle the previously newest request NOW rather than when its reply happens to arrive.
    const previous = this.newest;
    this.newest = id;
    const stale = this.pending.get(previous);
    if (stale) this.settle(previous, stale,
      new Superseded(`Superseded by request ${id} before it returned.`));

    const worker = this.spawn();
    const mine = this.epoch;
    const gate = this.heldGate;
    this.heldGate = null;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (!p || mine !== this.epoch) return;
        if (id !== this.newest) {                       // stale AND slow: do not kill a live worker
          this.settle(id, p, new Superseded(`Superseded, then timed out (request ${id}).`));
          return;
        }
        this.terminate(`The solver did not finish within ${timeoutMs} ms and was stopped. `
          + `A netlist this engine cannot handle can hang rather than fail.`);
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (t: unknown) => void, reject, timer, decode, epoch: mine });
      // The request is registered as pending BEFORE the gate, so the page reports busy for the
      // whole held window — which is the state under test.
      if (gate) void gate.then(() => { if (this.pending.has(id)) worker.postMessage({ id, netlist }); });
      else worker.postMessage({ id, netlist });
    });
  }

  get busy(): boolean { return this.pending.size > 0; }

  /**
   * DIAGNOSTIC ONLY: make the next solve fail, so the page's own fault handling can be driven.
   *
   * Faults are otherwise hard to reach from the UI — an invalid input is rejected upstream and
   * never gets near the solver, which is exactly how my first attempt to test this produced a
   * fault that never happened. Injecting at this boundary exercises the real path: the same
   * rejection type, through the same client, into the same status line.
   */
  failNextForTesting(reason: string): void { this.injectedFailure = reason; }
  private injectedFailure: string | null = null;

  /**
   * DIAGNOSTIC ONLY: hold the next solve until the returned function is called.
   *
   * A solve takes about 30 ms, so the busy window cannot be sampled reliably by polling — and
   * "I could not catch it" is not evidence about behaviour, only about my sampling. A latch
   * makes the window as long as the test needs, deterministically, so what happens to the
   * scene DURING a solve can actually be inspected.
   */
  holdNextForTesting(): () => void {
    let release = () => {};
    this.heldGate = new Promise<void>((resolve) => { release = resolve; });
    return release;
  }
  private heldGate: Promise<void> | null = null;
}
