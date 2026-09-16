/**
 * THE ELECTRONICS BENCH — a workspace for circuits, on its own page and its own port.
 *
 * ===========================================================================
 * WHY THIS EXISTS SEPARATELY, AND WHAT IT DELIBERATELY DOES NOT HAVE
 * ===========================================================================
 * Electronics is a large enough chunk of work to deserve its own bench, and the
 * mechanical demos are not needed to reason about a circuit. So this page carries
 * NO three.js, NO WebGL context, NO camera and NO viewport. Electrical connection
 * is by NODE ID, never by anything's position, so nothing is lost by not drawing
 * bodies — and a page with no renderer is much cheaper to leave open.
 *
 * The SAME `SimWorld` runs underneath, at the same fixed 1/60 s public tick, so the
 * solve, the Joule accumulation and the thermal receivers are the ones already
 * verified — not a second, easier implementation of the same physics.
 *
 * Bodies still exist in the world because a resistor's heat has to land in a NAMED
 * receiver with an authored heat capacity. The bench ships one: a chassis. It is a
 * lumped thermal mass, nothing more, and it is never drawn.
 */
import { SimWorld } from '../sim/world';
import { FixedStepDriver } from '../sim/step';
import { Recorder, worldReplaced } from '../sim/record';
import { AuthoringSession, deleteCircuitComponent, deleteCircuitNode } from '../model/authoring';
import type { Construction } from '../model/construction';
import { CONSTRUCTION_FORMAT_VERSION } from '../model/construction';
import type { ComponentDesc } from '../model/circuit';
import { circuitAuthorControls, escapeHtml, NEW_NODE, readComponentForm, refreshCircuitFormLabels } from './authoring';
import { renderCircuitPanel } from './circuit';
import { renderThermalPanel } from './thermal';
import { newElectricalViewState, pinScales, renderElectricalView, type ElectricalViewState } from './electrical-view';
import { renderLfoControls, renderLfoReadout } from './lfo-panel';
import { PotentialScene } from './potential-scene';
import { validateLfo, type LfoWaveform } from '../model/lfo';
import './style.css';

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
};

/**
 * THE BENCH SCENE. One fixed chassis with an authored thermal account, and nothing
 * else. No gravity worth the name, no medium drag, no springs: this bench is about
 * the circuit, and every mechanical term that could muddy the energy books is
 * simply absent rather than present-and-ignored.
 */
function benchConstruction(): Construction {
  return {
    format: 'fp1-construction',
    formatVersion: CONSTRUCTION_FORMAT_VERSION,
    name: 'electronics bench',
    environment: { medium: 'vacuum', gravity: { x: 0, y: 0, z: 0 } },
    entities: [{
      id: 'chassis',
      label: 'chassis',
      kinematics: 'fixed',
      shape: { kind: 'box', hx: 0.5, hy: 0.05, hz: 0.5 },
      material: { mass: 0, restitution: 0, friction: 0.5 },
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 },
      colour: 0x555f6a,
      thermal: { heatCapacity: 2, initialTemperature: 300 },
    }],
    springs: [],
    nextSerial: 1,
  };
}

/**
 * THE BENCH OPENS WITH A WORKING CIRCUIT.
 *
 * It used to open empty and explain how to build one. Peter: "this is annoying
 * default... lets just default to showing the current circuit". He is right — an
 * empty stage plus instructions is worse than the thing itself, and the fastest way
 * to explain a terrace is to show one carrying current.
 *
 * This is ORDINARY AUTHORED CONTENT with no privileges: it is built through the same
 * `edit` path, the same validation and the same refusals as anything typed by hand,
 * and every value is visible and editable the moment the page opens. Delete it and
 * the empty state is still there, still correct.
 */
function withStarterCircuit(c: Construction): Construction {
  const cc = { nodes: [] as Array<{ id: string; label: string }>, components: [] as ComponentDesc[] };
  const node = (label: string): string => {
    const id = `n${c.nextSerial++}`;
    cc.nodes.push({ id, label });
    return id;
  };
  const top = node('+12 V rail'), gnd = node('ground'), mid = node('divider mid');
  cc.components.push({ kind: 'source', model: 'ideal-dc-voltage', modelVersion: 1,
    id: `V${c.nextSerial++}`, label: 'battery', pos: top, neg: gnd, voltage: 12 });
  const res = (label: string, a: string, b: string, r: number): void => {
    cc.components.push({ kind: 'resistor', model: 'linear-resistor', modelVersion: 1,
      id: `R${c.nextSerial++}`, label, a, b, resistance: r, heatReceiver: 'chassis' });
  };
  res('R_load', top, gnd, 10);
  res('R_upper', top, mid, 20);
  res('R_lower', mid, gnd, 20);
  return { ...c, circuit: cc };
}

class Bench {
  sim = new SimWorld();
  recorder = new Recorder();
  author!: AuthoringSession;
  driver!: FixedStepDriver;
  elecView: ElectricalViewState = newElectricalViewState();
  stage: PotentialScene | null = null;
  private stageDirty = true;
  authorNode: string | null = null;
  authorComponent: string | null = null;
  private lastPaint = 0;
  private toastTimer = 0;

  async start(): Promise<void> {
    await SimWorld.initEngine();
    const c = withStarterCircuit(benchConstruction());
    this.sim.build(c);
    this.author = new AuthoringSession(c);
    worldReplaced(this.recorder, 'load', c);
    this.driver = new FixedStepDriver(this.sim, () => {}, () => {});
    this.driver.paused = false;
    this.stage = new PotentialScene($('stage3d'), $('stagelabels'));
    window.addEventListener('resize', () => this.stage?.resize());
    this.build();
    requestAnimationFrame(this.loop);
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this.lastFrame || now)) / 1000);
    this.driver.advance(dt);
    this.lastFrame = now;
    if (this.stage) {
      // A SWEEP changes the solution every tick, so the terraces must follow it.
      // Rebuild when the solve could have moved; otherwise just advance the markers.
      if (this.stageDirty || this.sim.lfo.enabled) { this.stageDirty = false; this.rebuildStage(); }
      this.stage.render(dt);
    }
    // 120 ms is plenty for reading numbers, and it keeps this page cheap.
    if (now - this.lastPaint > 120) { this.lastPaint = now; this.paint(); }
  };
  private lastFrame = 0;

  private rebuildStage(): void {
    if (!this.stage) return;
    this.stage.build(this.sim, this.elecView.displayRef);
    const i = this.stage.getInfo();
    // THREE STATES. An empty bench is NOT a refusal, and must never be reported as
    // one: nothing has been refused. See D-49.
    $('stagelegend').innerHTML = i.empty
      ? `<b>No circuit.</b> You deleted it — nothing is wrong. Open <b>Build a DC circuit</b> on
         the left to make another, or put the starting one back.
         <button id="b-example" class="refit">Restore the starting circuit</button>`
      : i.rejected
      ? `<b class="bad">NOTHING IS DRAWN: the electrical result was REJECTED.</b> ${escapeHtml(i.rejected)}`
      : `<b>Height is potential.</b> ${i.unitsPerVolt.toFixed(4)} drawing units per volt over
         ${i.spanV.toFixed(6)} V · <b>marker SPEED is current</b> at
         ${i.markerScale.toFixed(4)} units/s per ampere, one shared scale for every branch ·
         marker spacing is fixed and encodes nothing · branch <b>thickness</b> also encodes
         |I|, against the widest branch at ${i.fullI.toFixed(6)} A ·
         <b>terraces sit at solved node potentials and nothing is drawn between them</b>,
         because the model has no value there · joules per COULOMB, not per kilogram —
         nothing here falls.
         <br><b>What here is LAYOUT and claims nothing:</b> where a terrace sits <i>around</i>
         the ring, and the sideways offset that fans parallel branches apart so they are not
         drawn on top of each other. Only <b>height</b> carries a value.
         <b>What the moving markers are NOT:</b> a marker's <i>position</i> is not a charge
         location, a transit time or any solved local state — only its <b>speed</b> and
         <b>direction</b> carry the branch current. This is not electron drift (that is of
         order mm/s), not signal propagation (that is near light speed), and not a count of
         charges. Markers are not conserved where branches meet.
         <button id="b-refit" class="refit">Re-frame</button>`;
  }

  private paint(): void {
    $('benchhud').innerHTML =
      `tick <b>${this.sim.tick}</b> · t = <b>${(this.sim.tick / 60).toFixed(2)} s</b>`
      + ` · ${this.driver.paused ? '<b>PAUSED</b>' : 'running'}`
      + ` · fixed 1/60 s public tick = <b>${this.sim.subSteps}</b> internal sub-steps`
      + ` · <b>no renderer on this page</b> — electrical connection is by node id`;
    $('panels').innerHTML =
      renderLfoReadout(this.sim) +
      renderElectricalView(this.sim, this.elecView) +
      renderCircuitPanel(this.sim) +
      renderThermalPanel(this.sim);
  }

  private build(): void {
    $('controls').innerHTML = `
      <div class="grp">
        <button id="b-pause">Pause / resume</button>
        <button id="b-step">Advance one tick</button>
        <button id="b-restart">Restart bench at tick 0</button>
      </div>
      <div class="grp"><label>the chassis — a lumped thermal receiver</label>
        <div class="sceneblurb">One fixed body with an authored <b>C = 2 J/K</b> starting at
        <b>300 K</b>. Name it as a resistor's heat destination and its temperature is
        Q = C(T − T0) from the Joule energy that resistor actually dissipated. It is never drawn:
        there is no viewport on this bench, and a circuit does not need one.</div>
      </div>
      ${renderLfoControls(this.sim)}
      ${circuitAuthorControls(this.author.authored, this.authorNode, this.authorComponent)}`;
    this.bind();
    this.stageDirty = true;
    this.paint();
  }

  private bind(): void {
    const on = (id: string, fn: () => void): void => {
      document.getElementById(id)?.addEventListener('click', () => {
        try { fn(); } catch (e) { this.toast(escapeHtml(String(e)), false); }
      });
    };
    on('b-pause', () => { this.driver.paused = !this.driver.paused; this.paint(); });
    on('b-step', () => { this.driver.paused = true; this.driver.stepOnce(); this.paint(); });
    on('b-restart', () => { this.rebuild('bench restarted at tick 0'); });
    // The legend is re-rendered with the stage, so this is delegated from the container.
    $('stagelegend').addEventListener('click', (ev) => {
      const id = (ev.target as HTMLElement).id;
      if (id === 'b-refit') this.stage?.refit();
      if (id === 'b-example') { try { this.buildExample(); } catch (e) { this.toast(escapeHtml(String(e)), false); } }
    });

    // ---- circuit authoring, the SAME forms and the SAME refusals as the main app
    const sel = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
    document.getElementById('a-cc-kind')?.addEventListener('change', () => refreshCircuitFormLabels());
    document.getElementById('a-cc-a')?.addEventListener('change', () => refreshCircuitFormLabels());
    document.getElementById('a-cc-b')?.addEventListener('change', () => refreshCircuitFormLabels());
    document.getElementById('a-cc-choice')?.addEventListener('change', () => {
      this.authorComponent = sel('a-cc-choice').value || null; this.build();
    });
    document.getElementById('a-cn-choice')?.addEventListener('change', () => {
      this.authorNode = sel('a-cn-choice').value || null; this.build();
    });
    on('a-cc-apply', () => this.commitComponent());
    on('a-cc-delete', () => {
      const id = this.authorComponent;
      if (!id) throw new Error('No component selected');
      this.edit((c) => deleteCircuitComponent(c, id), `deleted component ${id}`);
      this.authorComponent = null;
    });
    on('a-cn-delete', () => {
      const id = this.authorNode;
      if (!id) throw new Error('No node selected');
      this.edit((c) => deleteCircuitNode(c, id), `deleted node ${id}`);
      this.authorNode = null;
    });
    on('a-cc-cancel', () => { this.build(); this.toast('Form changes discarded.', true); });
    on('a-cc-drop', () => this.edit((c) => { delete c.circuit; }, 'circuit deleted'));

    // ---- the sweep
    document.getElementById('lfo-target')?.addEventListener('change', () => {
      const key = sel('lfo-target').value || null;
      this.sim.lfo.targetKey = key;
      const t = this.sim.lfoTarget();
      if (t) {
        // Offer a sensible, IN-RANGE default around the authored value rather than
        // leaving zeros that would be refused the moment Start is pressed.
        const c = t.current;
        const lo = Math.max(t.min, t.kind === 'emf' ? -Math.abs(c) : c * 0.25);
        const hi = Math.min(t.max, t.kind === 'emf' ? Math.abs(c) || 1 : Math.max(c * 4, lo + 1));
        this.sim.lfo.lo = lo; this.sim.lfo.hi = hi;
      }
      this.build();
    });
    document.getElementById('lfo-wave')?.addEventListener('change', () => {
      this.sim.lfo.waveform = sel('lfo-wave').value as LfoWaveform; this.build();
    });
    on('lfo-apply', () => {
      const num = (id: string): number => Number((document.getElementById(id) as HTMLInputElement).value);
      const next = { ...this.sim.lfo, lo: num('lfo-lo'), hi: num('lfo-hi'), periodTicks: num('lfo-period') };
      try {
        validateLfo({ ...next, enabled: true }, this.sim.lfoTarget());   // REFUSE before storing
      } catch (e) {
        // A refused sweep must not leave the REJECTED number sitting in the box as
        // if it had been accepted. Put the stored values back, so what the form
        // shows is always what is actually in force.
        this.build();
        throw e;
      }
      this.sim.lfo = next;
      this.build();
      this.toast('Sweep settings applied.', true);
    });
    on('lfo-toggle', () => {
      if (!this.sim.lfo.enabled) {
        validateLfo({ ...this.sim.lfo, enabled: true }, this.sim.lfoTarget());
        this.sim.lfo.startTick = this.sim.tick;
        this.sim.lfo.enabled = true;
      } else {
        this.sim.lfo.enabled = false;
        this.sim.lfoCurrentValue = null;
        this.sim.sweptCircuit = null;
        this.sim.resolveAuthoredCircuit();
      }
      this.build();
    });
    on('lfo-reset-phase', () => { this.sim.lfo.startTick = this.sim.tick; this.paint(); });

    // ---- the electrical view's own selection / reference / pin controls
    $('panels').addEventListener('click', (ev) => {
      const el = ev.target as HTMLElement | null;
      const pick = el?.closest('[data-elec-select]') as HTMLElement | null;
      if (pick) {
        const [kind, id] = (pick.dataset.elecSelect ?? '').split(':');
        this.elecView.selection = { kind, id } as ElectricalViewState['selection'];
        this.paint(); return;
      }
      const cmd = (el?.closest('[data-elec]') as HTMLElement | null)?.dataset.elec;
      if (!cmd) return;
      if (cmd === 'pin') this.elecView.pinned = pinScales(this.sim, this.elecView);
      else if (cmd === 'unpin') this.elecView.pinned = null;
      else if (cmd === 'clear') this.elecView.selection = null;
      else if (cmd === 'honesty') this.elecView.honestyOpen = !this.elecView.honestyOpen;
      else if (cmd.startsWith('ref:')) { this.elecView.displayRef = cmd.slice(4) || null; this.stageDirty = true; }
      this.paint();
    });
  }

  private commitComponent(): void {
    const form = readComponentForm();
    this.edit((c) => {
      c.circuit ??= { nodes: [], components: [] };
      const cc = c.circuit;
      const nodeFor = (which: 'a' | 'b'): string => {
        const chosen = which === 'a' ? form.a : form.b;
        if (chosen !== NEW_NODE) return chosen;
        const id = `n${c.nextSerial++}`;
        cc.nodes.push({ id, label: (which === 'a' ? form.aName : form.bName) || id });
        return id;
      };
      const a = nodeFor('a'), b = nodeFor('b');
      if (a === b) throw new Error('A component needs two DIFFERENT nodes');
      const id = this.authorComponent ?? `${form.kind === 'source' ? 'V' : form.kind === 'wire' ? 'W' : 'R'}${c.nextSerial++}`;
      const made: ComponentDesc =
        form.kind === 'source'
          ? { kind: 'source', model: 'ideal-dc-voltage', modelVersion: 1, id, label: form.label || id, pos: a, neg: b, voltage: form.value }
          : form.kind === 'wire'
            ? { kind: 'wire', model: 'ideal-wire', modelVersion: 1, id, label: form.label || id, a, b }
            : { kind: 'resistor', model: 'linear-resistor', modelVersion: 1, id, label: form.label || id, a, b,
                resistance: form.value, ...(form.receiver ? { heatReceiver: form.receiver } : {}) };
      const at = cc.components.findIndex((k) => k.id === id);
      if (at >= 0) cc.components[at] = made; else cc.components.push(made);
    }, this.authorComponent ? 'component edited' : 'component created');
    this.authorComponent = null;
  }

  /**
   * A worked example, authored through the SAME model calls the forms use — a
   * 12 V source, a 10 ohm load, and a 20/20 divider, all heating the chassis. It is
   * ordinary authored content with no privileges: every value is visible and
   * editable afterwards, and it goes through the same validation and the same
   * refusals as anything typed by hand.
   */
  private buildExample(): void {
    this.edit((c) => {
      c.circuit = { nodes: [], components: [] };
      const cc = c.circuit;
      const node = (label: string): string => {
        const id = `n${c.nextSerial++}`;
        cc.nodes.push({ id, label });
        return id;
      };
      const top = node('+12 V rail'), gnd = node('ground'), mid = node('divider mid');
      cc.components.push({ kind: 'source', model: 'ideal-dc-voltage', modelVersion: 1,
        id: `V${c.nextSerial++}`, label: 'battery', pos: top, neg: gnd, voltage: 12 });
      const res = (label: string, a: string, b: string, r: number): void => {
        cc.components.push({ kind: 'resistor', model: 'linear-resistor', modelVersion: 1,
          id: `R${c.nextSerial++}`, label, a, b, resistance: r, heatReceiver: 'chassis' });
      };
      res('R_load', top, gnd, 10);
      res('R_upper', top, mid, 20);
      res('R_lower', mid, gnd, 20);
    }, 'example circuit authored — 12 V, a 10 Ω load and a 20/20 divider');
  }

  /** Every authoring edit goes through here, so a refusal never half-applies. */
  private edit(change: (c: Construction) => void, why: string): void {
    this.author.edit(change, why);
    this.rebuild(why);
  }

  private rebuild(why: string): void {
    // A sweep points at ids in the OLD scene. Re-resolve it and stop it if its
    // target no longer exists, rather than sweeping something that is gone.
    this.sim.build(this.author.authored);
    this.sim.sweptCircuit = null;
    this.sim.lfoCurrentValue = null;
    if (this.sim.lfo.enabled && !this.sim.lfoTarget()) {
      this.sim.lfo.enabled = false;
      this.toast('Sweep stopped: the parameter it was driving no longer exists in this circuit.', false);
    }
    this.driver = new FixedStepDriver(this.sim, () => {}, () => {});
    this.driver.paused = false;
    this.elecView.pinned = null;
    this.build();
    this.toast(why, true);
  }

  private toast(msg: string, ok: boolean): void {
    const t = $('toast');
    t.innerHTML = msg;
    t.className = ok ? 'ok' : 'bad';
    t.setAttribute('role', 'status');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { t.innerHTML = ''; t.className = ''; }, 6000);
  }
}

const bench = new Bench();
(window as unknown as Record<string, unknown>).__bench = bench;
bench.start().catch((err) => {
  $('benchhud').textContent = `FAILED TO START: ${String(err)}`;
  console.error(err);
});
