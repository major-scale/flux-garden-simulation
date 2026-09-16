import { gaugeReading, type QuantityGauge } from './quantity-gauge';
import { displayPolyline } from '../model/coil-package';
import { siUnit as fmtSi } from './rc-flow';
/**
 * THE 3D POTENTIAL TERRACES — voltage shown as the height it always meant.
 *
 * Built to VISUAL-DECLARATION.md (unmodified) as amended by
 * VISUAL-DECLARATION-AMENDMENT-B.md. Read that amendment before changing this file.
 *
 * ===========================================================================
 * The rules below describe the conventional-current view. The RC default
 * electron view uses blue NET-flow streaks with opposite direction; microscopic
 * thermal motion is not shown at circuit scale. It is not a particle solver.
 *
 * THE FOUR RULES FOR THE CONVENTIONAL-CURRENT VIEW
 * ===========================================================================
 *
 * 1. TERRACES, NOT A SURFACE. There is a flat platform at each SOLVED node
 *    potential and NOTHING between platforms except the component connecting them.
 *    No interpolated surface, no gradient, no contour, no field line. The gap
 *    between two terraces is empty because THE MODEL IS EMPTY THERE. Astra caught
 *    this: a smooth landscape through the node potentials would be prettier and
 *    would be exactly the invented data the declaration forbids.
 *
 * 2. HEIGHT IS THE ENCODING, AND IT IS NOT GRAVITY. Electric potential is
 *    JOULES PER COULOMB; gravitational potential is JOULES PER KILOGRAM. The same
 *    shape of idea in a different currency. Nothing here falls, nothing is pulled,
 *    and no mechanical body anywhere in this project moves to indicate a voltage.
 *
 * 3. MOTION ENCODES RATE; STRENGTH ENCODES MAGNITUDE TOO. A marker's SPEED encodes
 *    |I| through that branch at a shared printed scale and its DIRECTION encodes the
 *    sign — but speed is NO LONGER the only magnitude carrier, and saying so here was
 *    stale. A streak's OPACITY and LENGTH follow √(|I|/captured bound) as well, because
 *    speed alone left a millionth of the peak drawn as strongly as the peak: strong
 *    transport that merely crawled. Its POSITION along the branch still encodes no
 *    simulated local state, no charge location and no transit time. Markers are NOT
 *    charges, are NOT conserved at junctions, and imply no drift velocity, no
 *    propagation speed and no transient.
 *
 * 4. ZERO TRANSPORT IS DRAWN AS ZERO TRANSPORT, continuously rather than by a switch at
 *    exactly zero. The √ map has no floor, so the transport drawing vanishes as the
 *    current does. Beneath it a dim, fixed CARRIER-PRESENCE layer stays put: it is a
 *    schematic reminder that charge is still there, not tracked stationary particles,
 *    and it does not fade because charge does not leave when current stops.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SimWorld } from '../sim/world';
import { resistorsOf, sourcesOf, voltageAt, wiresOf } from '../model/circuit';

/** Drawing units per volt is derived per run and PRINTED; it is not hidden. */
const TERRACE_R = 0.95;
/** Radius of the ring the node terraces are arranged on, in the XZ plane. */
const RING_R = 3.0;
/** Height, in drawing units, that a run's full potential span is drawn across. */
const PLOT_H = 7.4;
/** Marker speed: drawing units per second per ampere. Shared by every branch. */
const UNITS_PER_SEC_PER_AMP = 0.55;
/** Fixed spacing between markers on a branch, in drawing units. Encodes NOTHING. */
const MARKER_SPACING = 0.62;
/** Branch tube radius: a constant floor, plus a part that encodes |I|. */
const TUBE_BASE = 0.035;
const TUBE_PER_AMP = 0.10;
/**
 * The energy gauge: FIXED dimensions, so its size encodes nothing and only its FILL
 * FRACTION varies. Deliberately independent of terrace separation — see the note at
 * the gauge's construction.
 */
const GAUGE_H = 2.6;
/** ONE identity colour for everything magnetic: the coil's core, its field, and the
 *  magnetic-energy vessel. The pairing is the point — the vessel filling is the field
 *  strengthening — so they must not be told apart by colour. */
const MAGNETIC = 0x6b45d6;   // darker violet: must hold on a light bench
/** The pickup's own identity: it is neither a store nor part of the driven loop. */
const PICKUP = 0x1f9c7c;
/** Where the loop's gap sits: perpendicular to its normal, biased upward so both ends show. */
function gapDirection(normal: THREE.Vector3, axis: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
  const d = new THREE.Vector3().crossVectors(normal, axis);
  return d.lengthSq() > 0.25 ? d.normalize() : up.clone();
}
export const MAGNETIC_COLOUR = MAGNETIC;
/** Heat is neither store: it is the share that leaves and does not come back, so it gets
 *  its own colour rather than sharing the capacitor's. Electric stays the amber already
 *  used by the field arrows between the plates. */
export const THERMAL_COLOUR = 0xff8a5b;
export const ELECTRIC_COLOUR = 0xd8a657;
const GAUGE_R = 0.30;
const GAUGE_OFFSET = 1.25;
/** Drawn plate size. Fixed: the DRAWN side encodes nothing, only the drawn gap ratio does. */
const PLATES_SIDE = 3.4;
const PLATE_THICK = 0.13;
const PLATES_OFFSET = 1.5;
/**
 * X of the voltage ruler in the spatial RC/RLC scene. It must sit CLEAR OF THE CIRCUIT:
 * widening the layout to fix Peter's "pretty cramped" moved the source out to x = −5,
 * and the ruler — still at −4.55 — ended up drawn through the resistor body.
 */
const AXIS_X = -6.6;
/**
 * Drawing units the FULL potential span occupies in the spatial scene. ONE constant,
 * because it feeds both the height mapping and the ruler drawn beside it — I raised the
 * mapping from 4.4 to give Peter's "pretty cramped" scene room and left the ruler at 4.4,
 * which would have put every tick label at the wrong height. A scale and its ruler cannot
 * be two numbers.
 */
// The ruler's height, in drawing units. It was 6.8 when the components themselves rode it and
// the vertical extent WAS the circuit. Now the circuit is a fixed deck and this only has to be
// tall enough to read: a shorter ruler makes the whole composition wider than tall, which is the
// shape of the viewport, so the fit can enlarge the circuit instead of reserving height for it.
const SPATIAL_PLOT_H = 4.4;
/**
 * The physical assembly's height is FIXED and never derived from a potential —
 * otherwise a voltage change would look like the plates moving. Astra had already
 * pinned it to 0 for the capacitor page before I got here; this note records WHY it
 * must stay pinned, so nobody "helpfully" re-derives it from the terraces later.
 */

/**
 * A NEUTRAL DESCRIPTION OF WHAT TO DRAW, so the DC bench and the RC experiment
 * share ONE visual language. Two pages inventing their own meaning for height and
 * motion would be its own honesty problem: the same encoding must mean the same
 * thing everywhere it appears.
 */
export interface TerraceSpec {
  id: string;
  label: string;
  /** V, already expressed against whatever zero is being displayed. */
  volts: number;
  isRef?: boolean;
  /**
   * AN AUTHORED DECK POSITION for this node's component anchor. When every terrace has one and
   * `SceneSpec.deck` is set, the scene uses the fixed-deck layout — bodies still, potential on
   * a shared ruler by marker — for a topology it has no hard-coded positions for. Layout only:
   * the height of the marker is `y(volts)` regardless, and `y` here is the anchor's own height
   * (a return rail below the deck, say), never a voltage.
   */
  anchor?: { x: number; z: number; y?: number };
  /** Print the voltage in the node's pill (default true). The marker's HEIGHT is the voltage regardless. */
  showValue?: boolean;
}
export interface BranchSpec {
  id: string;
  label: string;
  kind: 'source' | 'resistor' | 'wire' | 'capacitor' | 'inductor' | 'diode' | 'load'
    | 'mosfet' | 'lamp' | 'gate' | 'switch' | 'motor' | 'pot' | 'led' | 'sensor' | 'comparator';
  from: string; to: string;
  /** A, signed from -> to. Null when the model computes no current for this branch. */
  current: number | null;
  /** `mosfet` only: the terrace its gate pin connects to; `from` is the drain, `to` the source. */
  gateTerrace?: string;
  /**
   * `mosfet` only: the current OUT of the source terminal, drawn on the source leg. It differs
   * from `current` (the drain leg) by exactly the gate current while the gate charges, so the
   * source leg must not reuse the drain figure — Astra's condition for the final review.
   */
  sourceCurrent?: number | null;
  /** `mosfet` only: the current INTO the gate pin, drawn on the pin with its own `gateFullScaleA`. */
  gateCurrent?: number | null;
  gateFullScaleA?: number;
  /** `lamp` only: dissipated power now, and the STATED reference it is drawn against. */
  power?: number | null;
  fullPower?: number;
  /** `switch` only: closed or open now (null: unsolved). Drawn as a lever, nothing more. */
  closed?: boolean | null;
  /** `pot` only: wiper terrace, its fraction (0 = at `from`/A, 1 = at `to`/B) and the wiper current. */
  wiperTerrace?: string;
  wiperFraction?: number;
  wiperCurrent?: number | null;
  /** `pot` only: the current through the B leg (`to` side); `current` is the A leg. */
  legBCurrent?: number | null;
  /** `led` only: emission drive 0..1 (max(I,0)/I_max, linear input intensity — a rendering rule). */
  emission?: number | null;
  /**
   * `sensor` only: what the sensor is and the PRESCRIBED environment it is reading, as a fraction
   * of its declared range for the cue (0..1) plus the printed value. The cue is that input at the
   * same playback instant — never a rendered light or heat reaching the sensor.
   */
  sensor?: { kind: 'ldr' | 'ntc'; environmentFraction: number | null; environmentText: string; resistanceOhms: number | null };
  /** `comparator` only: the reference (−) terrace, the supply terrace, and the decided state. */
  refTerrace?: string;
  supplyTerrace?: string;
  high?: boolean | null;
  /**
   * `comparator` only, OPTIONAL — complete terminal separation (Astra, fan-trial-09311c3e). `current` alone was
   * drawn on BOTH the output lead and the Vcc cable, and while the stage sinks (discharging a gate) its supply
   * current is not its output current, so the two ends of one wire disagreed. When given: `outputCurrent` is
   * the signed current leaving the OUT pin toward `to`; `supplyCurrent` the current into the Vcc pin;
   * `groundTerrace` + `groundCurrent` a VISIBLE return lead to ground carrying the signed current out of the
   * ground pin (the page computes it as supply − output, which includes the leak). Absent, each falls back to
   * `current` and no ground lead is drawn — existing callers unchanged.
   */
  outputCurrent?: number | null;
  supplyCurrent?: number | null;
  groundTerrace?: string;
  groundCurrent?: number | null;
  /** `motor` only: the model's INTERNAL back-EMF K·ω, drawn inside the winding against a stated full scale. */
  backEmfVolts?: number | null;
  backEmfFullVolts?: number;
  /**
   * A full scale for THIS branch, when the shared one would misrepresent it.
   *
   * WHAT IT CHANGES, precisely: the branch's transport-marker cue (the √(|i|/full) opacity and
   * scale) and, for the winding, the VISIBILITY of its field lines. It is not a calibration of
   * the magnetic field: the field lines' geometry and direction come from the Biot–Savart
   * solution and no ruler here touches them. Astra's caution — this is a display scale, and
   * saying otherwise would borrow credibility from a separate piece of verified work.
   *
   * It exists because the shared current scale has to span every branch the scene draws,
   * including a load that does not pass through the coil, and scaling the winding against that
   * wider ruler would dim it in proportion to a current it never carries. Absent means "use the
   * shared scale", which is right for every branch that is genuinely comparable.
   */
  fullScaleA?: number;
  /**
   * A LANE OFFSET, scene units, perpendicular to the anchor-to-anchor chord, for a component whose
   * two nodes are ALSO the nodes of another component (a freewheel diode across a motor, a reference
   * pot across the supply). Without it the two bodies stand on the same line. Layout only: the legs
   * still leave the true anchors and slant out to the lane, so the connection is drawn, not implied.
   * Honoured by the diode and pot deck bodies.
   */
  lane?: number;
  /** A deck CAPACITOR's stored charge q = C·(v+ − v−) (C) and the run's full scale, for the plate tint; null until solved. */
  charge?: number | null;
  chargeFull?: number;
  /**
   * AN EXPLICIT COMPONENT POSE (opt-in). Without it a body sits at the midpoint of the chord between its two
   * net anchors — which is why several unrelated bodies sharing a rail cluster at one spot. With `bodyAt` the
   * body stands where the page says, oriented along `bodyDir` (deck x,z; default: toward `to`), `bodyLen` long,
   * and its two LEADS run from the true net anchors to the body's ends — so a shared node stays one shared
   * anchor while the wires branch spatially. The leads carry the branch's carriers. Layout only: nothing here
   * touches the solved numbers.
   */
  bodyAt?: { x: number; z: number };
  bodyDir?: [number, number];
  bodyLen?: number;
  /**
   * ROUTED LEADS (opt-in, with a pose): interior waypoints, deck x/z, for the lead from the `from` anchor to the
   * body's first end (`in`) and from the body's second end to the `to` anchor (`out`). Each lead is then drawn as
   * straight segments through the waypoints with a joint at every bend, and its carriers follow the same path.
   * Consumes a layout tool's routes; encodes nothing.
   */
  leadRoutes?: { in?: [number, number][]; out?: [number, number][] };
  /**
   * WHERE THE LEADS ARE DRAWN FROM / TO (opt-in, with a pose): a point on the net, in deck x/z, that replaces the
   * net's marker anchor as the lead's drawn start (`leadFrom`, for the `from` net) or end (`leadTo`, for the `to`
   * net) — the DROP POINT on a rail bus. The electrical node is still `from` / `to`; a net may meet its wires at
   * several spatial junctions. The comparator's supply/ground/reference cables and the MOSFET's gate pin take the
   * same kind of override (`supplyFrom`, `groundTo`, `refFrom`, `gateFrom`).
   */
  leadFrom?: [number, number];
  leadTo?: [number, number];
  supplyFrom?: [number, number];
  groundTo?: [number, number];
  refFrom?: [number, number];
  gateFrom?: [number, number];
  /** Lift (scene units) of the reference cable's middle, so an unavoidable crossing reads as a hop over, not a junction. */
  refLift?: number;
  /** Opt-in: the pot's wiper cable leaves sideways by this much (toward its anchor) with no bow along the track. */
  wiperSide?: number;
  /** Opt-in: lift of the MOSFET's gate cable (over its own source drop). */
  gateLift?: number;
  /** Opt-in: lifts of the comparator's Vcc and ground cables, so they come down onto / rise from their pins instead of entering the plate at deck level. */
  supplyLift?: number;
  groundLift?: number;
  /**
   * `motor` only: raise the can (and its posts, shaft and bar) by this much on a mount block, so a rotor of the
   * DECLARED radius clears the deck instead of the radius being shrunk to fit. The leads climb the taller posts.
   */
  mountHeight?: number;
}
/**
 * A STORE: a vessel that fills and empties, sitting UNDER the terrace whose level
 * it sets. A capacitor is not a symbol with two plates — it is a thing that holds
 * charge, and whose potential RISES AS IT FILLS. That rise is the whole lesson of a
 * transient, and it is the one thing a schematic structurally cannot show.
 *
 * `fill` is the fraction of `capacityLabel` currently held, used ONLY for the drawn
 * level. Every number beside it is printed in SI, as always.
 */
/**
 * The solved coil, passed in whole. The renderer READS this and computes no physics: the
 * winding positions, the inductance and the field lines were all produced once by
 * buildCoilPackage from a validated geometry. Only the signed current comes per frame.
 */
export interface CoilRender {
  /** Winding radius and turn positions, in METRES. */
  radiusM: number;
  turnPositionsM: number[];
  wireRadiusM: number;
  /** Meridional (r, z) polylines in METRES, already integrated. Shape is current-independent. */
  fieldLines: { points: [number, number][]; stop: string }[];
  /** Scene units per metre — the coil's own stated scale, since the scene's y means volts. */
  sceneUnitsPerMetre: number;
  /** Henries, derived from this winding. Display only; the circuit already used it. */
  inductanceH: number;
  /**
   * The pickup loop, posed in the COIL'S OWN physical frame — metres along and across its
   * axis, mapped by the same sceneUnitsPerMetre. Its pose is what determines the mutual
   * inductance, so it must be the pose that is drawn.
   */
  pickup?: {
    radiusM: number;
    separationM: number;
    orientationDeg: number;
    mutualH: number;
    /**
     * Signed terminal voltage right now, volts. Zero when the current is not changing — but
     * NULL when the rate is not known at all, which is a different thing and must not be drawn
     * as zero. At the reset frame of a solved run there is no rate yet.
     */
    terminalV: number | null;
    /** Flux linkage right now, webers. */
    fluxWb: number;
    /** Full scale of the local indicator, volts. Its own scale, never the height axis. */
    indicatorFullScaleV?: number;
  };
}

export interface StoreSpec {
  /** Caller must provide the full reading nearby when selecting identifier-only labels. */
  labelMode?: 'identifier';
  id: string;
  label: string;
  /** The terrace whose height this store sets. */
  terrace: string;
  /** 0..1 for the drawn fill level. Signed quantities use |q| and say so. */
  fill?: number;
  /** Explicit quantity and display mapping; preferred over legacy precomputed fill. */
  quantity?: QuantityGauge;
  /** Printed beside the vessel, in SI. */
  readout: string;
  /** The lower terrace the store sits above — its other plate / reference. */
  base: string;
  /** An authored deck position: on an authored deck the vessels stand where the page puts them. */
  anchor?: { x: number; z: number };
  /** Identity colour, so a vessel can be paired by eye with the component it belongs to.
   *  Defaults to the shared amber if unset; SIZE AND SCALE STAY IDENTICAL across vessels,
   *  because only the fill is allowed to carry a quantity. */
  colour?: number;
}

/**
 * TWO REAL PLATES, their drawn size derived from the model's own dimensions — Peter's ask:
 * "see capacitance as 2 separate parts close to each other". Derived, with the gap magnified,
 * rather than "at real dimensions": the qualification below is part of the claim, not a footnote
 * to it.
 *
 * DISPLAY EXAGGERATION IS DECLARED, NOT HIDDEN. The domain requires the gap to be at
 * most a tenth of the plate side, so drawn honestly to scale the gap is a hairline
 * and the thing you are meant to grab is invisible. The gap is therefore drawn
 * magnified by `gapExaggeration`, which is PRINTED. Model dimensions and display
 * dimensions are kept distinct everywhere: every label states the REAL metres.
 */
export interface PlatesSpec {
  id: string;
  /** m, real. */
  side: number;
  /** m, real. */
  gap: number;
  /** m^2, real. */
  area: number;
  /** F, derived. */
  capacitance: number;
  /** V across the plates, signed. */
  voltage: number;
  /** V/m, the local ideal bulk-field estimate. Signed. */
  field: number;
  /** C, signed surface charge Q = C*Vc. */
  charge: number;
  /** C, the FIXED full-charge display scale, from authored bounds. */
  chargeFull: number;
  /** V/m, the FIXED full-field display scale, from authored bounds. */
  fieldFull: number;
  /** The terrace the positive plate sits at, and the one the negative sits at. */
  plusTerrace: string;
  minusTerrace: string;
  /** How much the gap is magnified for visibility. Printed, never hidden. */
  gapExaggeration: number;
  dielectricLabel: string;
}

export interface SceneSpec {
  /** Present only in geometry-derived mode. Absent means the phenomenological coil. */
  coil?: CoilRender;
  terraces: TerraceSpec[];
  branches: BranchSpec[];
  stores?: StoreSpec[];
  /**
   * Draw the store VESSELS in the 3D scene, or only supply their data.
   *
   * The vessels stood inside the circuit view as three more component-shaped bodies with three
   * more labels, while the same three numbers were already rendered as cards under "Inspect
   * energy" — a third of the frame spent on a duplicate of a panel. Defaults to drawing them,
   * because the bench pages have no such panel; the RC page turns them off and keeps the data.
   */
  drawStores?: boolean;
  plates?: PlatesSpec[];
  /**
   * THE AUTHORED DECK: present when the page places its own components (every terrace carries an
   * `anchor`). The RC page keeps its hand-set layout; this is how a second topology gets the
   * same fixed-deck treatment without a second set of hard-coded positions in here.
   */
  deck?: { rulerX: number;
    /** The overview's viewing direction (toward the camera), when the page's deck wants its own. */
    viewDir?: [number, number, number];
    /**
     * FRAME THE OBJECTS, NOT THEIR UNION BOX (opt-in). The default fit projects the eight corners of one box
     * around everything; on a deep deck that box's front-bottom and back-top corners are empty air, and the
     * camera stands back for them — measured on the fan bench: the circuit filled 38 % of the stage width.
     * With `tightFit` every body's own bounds, every lead end and every potential marker are projected
     * instead, so the frame is set by things that are actually drawn.
     */
    tightFit?: boolean };
  /**
   * A MECHANISM REPLAYING A SOLVED TRAJECTORY. The rack-and-pinion load of the motor page: the
   * pinion turns by the solved θ and the rack rises by r·θ. KINEMATIC — the page says so on its
   * label — because the trajectory is ngspice's and the drawing follows it; nothing here is
   * integrated or simulated. Drawn sizes are model metres times a stated scale.
   */
  mechanism?: RackMechanism | RotorMechanism;
  /** Keeps a run's height scale steady instead of rescaling every frame. */
  fixedSpan?: { lo: number; hi: number };
  /**
   * A, held FIXED for the whole run. Astra's catch, and it is a real one: without
   * it the marker speed and branch thickness are normalised against the CURRENT
   * maximum every frame, so a current that decays to nothing would be drawn at
   * full speed and full width the entire time — a fading current shown as a
   * constant one. Pass the largest current the run can reach.
   */
  fixedFullI?: number;
  /**
   * A READABILITY CALIBRATION FOR THE TRANSPORT CUES (opt-in). By default a cue's travel speed is |I| on the
   * shared scale in SOLVED seconds — so at a slow playback a small current barely moves, and Peter could not
   * see it. With `flowCue` the cues travel per WALL second at floor + (full − floor)·√(|I|/scale) for any
   * nonzero current, while their visibility (opacity and streak length) is (|I|/scale)^visibilityPower —
   * CONTINUOUS to zero, no brightness floor and no cutoff: a decaying current visibly fades and shortens all
   * the way down. DIRECTION is still the solved sign, zero draws and moves nothing, pause stops them — but the
   * SPEED is a qualitative cue, not electron drift and not proportional to the current. The page must say so.
   */
  flowCue?: { fullUnitsPerSecond: number; floorUnitsPerSecond: number; visibilityPower: number };
  /**
   * RAIL BUSES (opt-in): a shared net drawn as a deliberate bar with local drops — the + rail along the back, the
   * ground rail along the front — instead of a star of diagonals from one marker. `points` are the bus polyline in
   * deck x/z; `currents[k]` is the signed current along the segment points[k] → points[k+1], which the PAGE supplies
   * (the partial sums of its members' solved currents along the bar — KCL by construction, so say so). Drawn as
   * routed wires with the same thickness and carrier rules as every other conductor; the bus is layout, the
   * segment currents are sums of solved figures.
   */
  buses?: { id: string; points: [number, number][]; currents: (number | null)[]; fullScaleA?: number }[];
}

export interface RackMechanism {
  kind: 'rack';
  anchor: { x: number; z: number };
  pinionRadiusM: number;
  /** Drawing scale for the mechanism only, stated on its label. */
  sceneUnitsPerMetre: number;
  /** The run's full travel, so the guide column is sized once and the rack never leaves it. */
  travelM: number;
  thetaRad: number | null;
  heightM: number | null;
  omegaRadPerS: number | null;
  massKg: number;
  label: string;
}

/**
 * A FAN-SHAPED ROTOR on the motor's shaft, turned by the solved θ(t) = ∫ω dt. KINEMATIC replay of a
 * DECLARED inertia-plus-linear-drag load: the blades are an illustration of what the load might be,
 * and the page says so. No aerodynamic torque, airflow, or heat transfer is modelled or implied.
 */
export interface RotorMechanism {
  kind: 'rotor';
  anchor: { x: number; z: number };
  bladeRadiusM: number;
  /** Drawing scale for the mechanism only, stated on its label. */
  sceneUnitsPerMetre: number;
  blades: number;
  thetaRad: number | null;
  omegaRadPerS: number | null;
  label: string;
}

export interface PotentialSceneInfo {
  unitsPerVolt: number;
  markerScale: number;
  fullI: number;
  spanV: number;
  nodes: number;
  branches: number;
  /**
   * THREE DISTINCT STATES, never collapsed into two. `empty` means no circuit has
   * been authored yet; `rejected` means one WAS authored and the solve REFUSED it,
   * with the reason. Reporting the empty state as a refusal is a FALSE STATEMENT
   * about the model — nothing was refused — and it is what this field exists to
   * prevent. See D-49.
   */
  empty: boolean;
  rejected: string | null;
}

/** A label the scene can update in place: the DOM node and the world point it is projected from. */
interface LiveLabel { el: HTMLDivElement; pos: THREE.Vector3; centred?: boolean }

/**
 * Place a unit-height leader between a potential disc (at `markerY`) and the point its label
 * hangs from (`labelY`), leaving a small gap above the disc. Hidden when the two are close
 * enough that the label already sits on its disc. Scale-and-position, never rebuilt.
 */
function placeLeader(leader: THREE.Mesh, x: number, markerY: number, z: number, labelY: number): void {
  // The label is CENTRED on labelY (see `centred` in the label layout), so the leader runs from
  // just outside the disc to just inside the pill's edge, whichever side of the disc it is on.
  const dir = Math.sign(labelY - markerY) || 1;
  const from = markerY + 0.12 * dir, to = labelY - 0.20 * dir;
  const len = (to - from) * dir;
  leader.visible = len > 0.2;
  leader.scale.y = Math.max(len, 1e-6);
  leader.position.set(x, (from + to) / 2, z);
}

/**
 * HANDLES TO EVERYTHING THAT CHANGES BETWEEN FRAMES, kept so the scene can be UPDATED rather than
 * rebuilt.
 *
 * `buildFromSpec` used to be the only entry point, and the page called it on every paint — about
 * twelve times a second while playing. Each call disposed every geometry and material, freed every
 * label node, and reallocated all of it: 86 allocation sites, torn down and recreated, for a scene
 * whose topology had not changed. Object identity was lost every frame, so labels were reflowed
 * from scratch, the collision push-down re-ran against an empty list, and the GPU re-uploaded
 * every buffer.
 *
 * Now a build registers handles here, and `applySpec` takes the fast path when the topology
 * signature matches: it mutates positions, scales, opacities and label text on the SAME objects.
 * A real change — a component added, the coil regeometried, a new solve with new bounds — still
 * rebuilds, and disposes what it replaces.
 */
interface LiveHandles {
  signature: string;
  y: (v: number) => number;
  refRep: string;
  nodes: Map<string, { disc: THREE.Mesh; ring: THREE.Mesh; stem: THREE.Mesh | null; leader: THREE.Mesh | null;
                       label: LiveLabel; anchor: THREE.Vector3; marker: THREE.Vector3; isRef: boolean }>;
  /** addBranch tubes by their branch id; the tube's geometry is built at TUBE_BASE and SCALED. */
  tubes: Map<string, { tube: THREE.Mesh | THREE.Group; tubeMat: THREE.MeshStandardMaterial;
                       lineMat: THREE.LineBasicMaterial; colour: number }>;
  /** Component labels by SPEC branch id, so a label whose text carries state can be refreshed. */
  componentLabels: Map<string, LiveLabel>;
  diode: { cone: THREE.Mesh; lit: THREE.MeshStandardMaterial } | null;
  resistor: { bronze: THREE.MeshStandardMaterial } | null;
  mosfet: { pkg: THREE.MeshStandardMaterial } | null;
  switch: { lever: THREE.Mesh; closedQuat: THREE.Quaternion; openQuat: THREE.Quaternion; lamp: THREE.MeshStandardMaterial } | null;
  motor: { bar: THREE.Mesh; barMat: THREE.MeshStandardMaterial; barMax: number; base: THREE.Vector3; shaftExit: THREE.Vector3 } | null;
  pot: { wiper: THREE.Group; knob: THREE.Group; trackA: THREE.Vector3; trackB: THREE.Vector3; knobAxis: THREE.Vector3 } | null;
  led: { dome: THREE.MeshStandardMaterial; glow: THREE.PointLight } | null;
  sensor: { cue: THREE.MeshStandardMaterial; cueLight: THREE.PointLight | null; bar: THREE.Mesh | null; barBase: THREE.Vector3; barMax: number } | null;
  comparator: { body: THREE.MeshStandardMaterial; outLamp: THREE.MeshStandardMaterial } | null;
  /** Authored-deck vessels: unit-height fills scaled per frame, and their labels. */
  stores: Map<string, { fill: THREE.Mesh; label: LiveLabel; yBase: number }>;
  mechanism: { spin: THREE.Group; carriage: THREE.Group | null; label: LiveLabel; u: number; contactY: number } | null;
  /** WHERE THE DRAWN TERMINALS ARE, by spec branch id and port name — so a layout kit's geometry table can be checked against the renderer. */
  terminals: Map<string, Record<string, THREE.Vector3>>;
  /** THE DRAWN BODY OBJECTS, by spec branch id — their world bounds are the renderer's truth for clearance. */
  bodies: Map<string, THREE.Object3D[]>;
  /** Deck capacitors' plate meshes by branch id, for the charge tint updated in place. */
  deckCapacitors: Map<string, THREE.Mesh[]>;
  lamp: { filament: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; glow: THREE.PointLight } | null;
  field: { lineMat: THREE.MeshBasicMaterial; headMat: THREE.MeshBasicMaterial;
           lines: THREE.Mesh[]; heads: Array<{ head: THREE.Mesh; loop: THREE.Curve<THREE.Vector3>; uu: number }>;
           fullScaleA: number | undefined; lastSign: number } | null;
  pickup: { beadA: THREE.Mesh; beadB: THREE.Mesh; signA: LiveLabel; signB: LiveLabel;
            fill: THREE.Mesh; barBase: THREE.Vector3; up: THREE.Vector3; barMax: number;
            label: LiveLabel } | null;
  /** Plates: the bodies are static; arrows and charge marks live in `dyn` and are redrawn. */
  plates: { dyn: THREE.Group; redraw: (pl: PlatesSpec) => void; label: LiveLabel;
            labelText: (pl: PlatesSpec) => string } | null;
}

interface Branch {
  /** Overrides the shared full scale for this branch alone. See BranchSpec.fullScaleA. */
  fullScaleA?: number;
  kind: 'source' | 'resistor' | 'wire' | 'capacitor' | 'inductor' | 'diode' | 'load'
    | 'mosfet' | 'lamp' | 'gate' | 'switch' | 'motor' | 'pot' | 'led' | 'sensor' | 'comparator';
  id: string; label: string;
  yA: number; yB: number;
  xA: number; xB: number;
  zA: number; zB: number;
  /** A. Signed, A -> B positive. Null when the model computes no current for it. */
  current: number | null;
  markers: THREE.InstancedMesh | null;
  electronCues?: boolean;
  phase: number;
  /** The path the current cues travel. Must be the SAME curve the conductor is drawn
   *  along, or the cues drift off the wire wherever the two splines differ. */
  route?: THREE.Curve<THREE.Vector3>;
  routeLength?: number;
  /**
   * CARRIERS PRESENT, drawn at constant opacity and never moved.
   *
   * The moving streaks encode NET TRANSPORT and now fade to nothing as the current does. That
   * alone would make "almost no current" and "no carriers at all" look identical, so this
   * layer stays put underneath: what fades is the transport, not the charge.
   */
  stillMarkers?: THREE.InstancedMesh | null;
  /**
   * How far to lift the cues off the route so they are not buried inside an opaque conductor.
   * A fixed 0.12 was tuned for the thick drawn wires; the solved coil's conductor is at TRUE
   * scale (0.016 units), so that lift floated the cues about seven wire-radii clear of the
   * winding — measured at 0.11999 in the running page, which is the lift itself.
   */
  surfaceLift?: number;
  line: THREE.Line | null;
}

/**
 * WHAT WOULD REQUIRE A REBUILD, as one string.
 *
 * Everything whose change alters GEOMETRY or the ruler: which nodes and branches exist, the coil's
 * winding and pickup pose, the plates' dimensions, the display span and the current scale (both
 * fixed for the life of a solved run and recaptured only on a new solve), and whether the
 * electron view is on (it changes marker geometry). Deliberately NOT the values — voltages,
 * currents, charge, field, label text — which the update path handles on the same objects.
 */
/** FNV-1a over a number sequence: a cheap, stable content hash for a geometry descriptor. */
function hashNumbers(nums: Iterable<number>): string {
  let h = 0x811c9dc5;
  for (const n of nums) {
    // Hash the float's bit pattern, not its decimal rendering, so equal geometry hashes equal.
    const f = new Float64Array([n]); const b = new Uint8Array(f.buffer);
    for (let i = 0; i < 8; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16);
}

function sceneSignature(spec: SceneSpec, electronView: boolean): string {
  const c = spec.coil;
  // THE COIL'S GEOMETRY IS DESCRIBED, NOT SUMMARISED. A first version keyed only the turn count,
  // first and last turn positions and the number of field lines — which could not tell apart
  // two windings with the same envelope, or the same winding with a differently traced field.
  // The winding is generated deterministically from `turnPositionsM`, `radiusM`, `wireRadiusM`
  // and the scene scale, and the field lines from the same package; hashing every turn position
  // and every field line's point count, end points and stop reason keys that generated geometry
  // UNDER ONE STATED ASSUMPTION: the coil package is produced by a deterministic generator, so a
  // field line's interior points are a function of the coil parameters and its endpoints/count/
  // stop. That holds for this page's generator and is NOT a claim about every SceneSpec — a
  // caller supplying hand-authored field polylines with equal endpoints and count would defeat
  // it. Hashing every interior point per paint was rejected as a per-frame allocation over
  // hundreds of points; if the generator ever stops being deterministic the fix is a cached
  // version stamp on the package, not a longer hash here. Astra asked for this to be explicit.
  const coil = c
    ? hashNumbers([c.radiusM, c.wireRadiusM, c.sceneUnitsPerMetre, c.turnPositionsM.length,
        ...c.turnPositionsM,
        ...c.fieldLines.flatMap((l) => [l.points.length,
          l.points[0]?.[0] ?? 0, l.points[0]?.[1] ?? 0,
          l.points[l.points.length - 1]?.[0] ?? 0, l.points[l.points.length - 1]?.[1] ?? 0,
          l.stop === 'closed' ? 1 : l.stop === 'conductor' ? 2 : 3])])
      + (c.pickup ? `/pk:${c.pickup.radiusM}:${c.pickup.separationM}:${c.pickup.orientationDeg}` : '')
    : 'nocoil';
  const plates = (spec.plates ?? [])
    .map((q) => `${q.id}:${q.side}:${q.gap}:${q.gapExaggeration}:${q.chargeFull}:${q.fieldFull}`).join(',');
  return [
    spec.terraces.map((t) => `${t.id}${t.isRef ? '*' : ''}`).join(','),
    spec.branches.map((b) => `${b.kind}:${b.id}:${b.from}>${b.to}:${b.fullScaleA ?? ''}`
      + `${b.gateTerrace ? '^' + b.gateTerrace + ':' + (b.gateFullScaleA ?? '') : ''}${b.fullPower ?? ''}${b.wiperTerrace ? '~' + b.wiperTerrace : ''}${b.refTerrace ? '<' + b.refTerrace + '|' + (b.supplyTerrace ?? '') : ''}${b.groundTerrace ? '_' + b.groundTerrace : ''}${b.sensor ? '#' + b.sensor.kind : ''}${b.lane ? '/' + b.lane : ''}${b.bodyAt ? '@' + b.bodyAt.x + ',' + b.bodyAt.z + ':' + (b.bodyDir ?? '') + ':' + (b.bodyLen ?? '') : ''}${b.leadRoutes ? '~' + JSON.stringify(b.leadRoutes) : ''}${b.mountHeight ? '^' + b.mountHeight : ''}`).join(','),
    spec.terraces.map((t) => t.showValue === false ? 'n' : 'v').join(''),
    (spec.buses ?? []).map((b) => `${b.id}:${JSON.stringify(b.points)}:${b.fullScaleA ?? ''}`).join(','),
    spec.branches.map((b) => [b.leadFrom, b.leadTo, b.supplyFrom, b.groundTo, b.refFrom, b.gateFrom].map((p) => p ? p.join(',') : '').join('/') + (b.refLift ?? '') + '|' + (b.wiperSide ?? '') + '|' + (b.gateLift ?? '') + '|' + (b.supplyLift ?? '') + '|' + (b.groundLift ?? '')).join(';'),
    spec.terraces.map((t) => t.anchor ? `${t.anchor.x},${t.anchor.y ?? 0},${t.anchor.z}` : '').join(';'),
    spec.deck ? `deck@${spec.deck.rulerX}` : 'ring',
    (spec.stores ?? []).map((x) => `${x.id}${x.anchor ? '@' + x.anchor.x + ',' + x.anchor.z : ''}`).join(','), String(spec.drawStores !== false),
    spec.mechanism ? (spec.mechanism.kind === 'rack'
      ? `rack@${spec.mechanism.anchor.x},${spec.mechanism.anchor.z}:${spec.mechanism.pinionRadiusM}:${spec.mechanism.sceneUnitsPerMetre}:${spec.mechanism.travelM}`
      : `rotor@${spec.mechanism.anchor.x},${spec.mechanism.anchor.z}:${spec.mechanism.bladeRadiusM}:${spec.mechanism.sceneUnitsPerMetre}:${spec.mechanism.blades}`) : '',
    spec.branches.map((b) => b.backEmfFullVolts ?? '').join(','),
    plates, coil,
    spec.fixedSpan ? `${spec.fixedSpan.lo}..${spec.fixedSpan.hi}` : 'auto',
    String(spec.fixedFullI ?? 'auto'), String(electronView),
  ].join('|');
}

/** A deck capacitor's plate tint: the solved charge fraction, signed — the + plate warms and the − plate cools as q grows positive. */
function tintPlates(plates: THREE.Mesh[], charge: number, chargeFull: number): void {
  const full = Math.max(chargeFull, 1e-30); const f = Math.min(1, Math.abs(charge) / full) * Math.sign(charge);
  const [plus, minus] = plates;
  (plus.material as THREE.MeshStandardMaterial).emissive.setRGB(Math.max(0, f) * .55, Math.max(0, f) * .18, Math.max(0, -f) * .55);
  (minus.material as THREE.MeshStandardMaterial).emissive.setRGB(Math.max(0, -f) * .55, Math.max(0, -f) * .18, Math.max(0, f) * .55);
}
export class PotentialScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private branches: Branch[] = [];
  /** An authored deck's own overview direction; null means the built-in one. */
  private deckView: THREE.Vector3 | null = null;
  private electronView = true;
  setElectronView(enabled: boolean): void { this.electronView = enabled; }
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private resistorTime = 0;
  private resistorInterior: { atoms: THREE.InstancedMesh; length: number; fraction: number } | null = null;
  private stores: Array<{ spec: StoreSpec; mesh: THREE.Mesh; shell: THREE.Mesh }> = [];
  /**
   * Signature of WHAT is drawn, not of its values. The camera re-frames when the
   * topology changes and NEVER on a value update: the RC page rebuilds twelve times
   * a second, and re-framing each time snapped the camera back mid-orbit and made
   * the view impossible to look around. Values moving is the whole point; the
   * viewpoint moving with them is not.
   */
  private topology = '';
  /**
   * Set once the viewer moves the camera. After that we never re-frame on our own:
   * a scene that snatches the camera back is unusable, and Astra asked for the
   * viewer's choice to survive. `refit()` remains available as an explicit action.
   */
  private cameraOwnedByViewer = false;
  /** World positions of the potential markers, kept so the camera can frame them. */
  private markerPoints: THREE.Vector3[] = [];
  /**
   * How loudly the magnetic field is drawn: 1 when the coil is the subject, lower in overview.
   *
   * It scales OPACITY ONLY. The geometry, the line count, the azimuths and the current response
   * are untouched, so nothing about what the field IS depends on this.
   */
  private fieldEmphasis = 0.3;
  /** The plates, when present, are what the scene is ABOUT — frame on them. */
  private focusBox: THREE.Box3 | null = null;
  private currentMotionScale = UNITS_PER_SEC_PER_AMP;
  /** The run's captured current bound, so cue visibility has a FIXED reference. */
  private fullCurrent = 1;
  private markerGeo = new THREE.SphereGeometry(0.075, 10, 8);
  // Rounded head faces +Y, tapered tail faces -Y; readable in a paused frame.
  private electronGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0,-.18),new THREE.Vector2(.014,-.10),
    new THREE.Vector2(.040,0),new THREE.Vector2(.055,.045),
    new THREE.Vector2(.045,.085),new THREE.Vector2(.025,.105),new THREE.Vector2(0,.112),
  ],10);
  private electronStillGeo = new THREE.SphereGeometry(.055,8,6);
  private rcMarkerGeo = new THREE.ConeGeometry(0.07, 0.28, 12);
  private info: PotentialSceneInfo = { unitsPerVolt: 1, markerScale: UNITS_PER_SEC_PER_AMP, fullI: 1, spanV: 0, nodes: 0, branches: 0, empty: true, rejected: null };
  private labels: LiveLabel[] = [];
  private live: LiveHandles | null = null;
  private host: HTMLElement;
  private labelHost: HTMLElement;

  constructor(host: HTMLElement, labelHost: HTMLElement) {
    this.host = host; this.labelHost = labelHost;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // COLOUR MANAGEMENT AND TONE MAPPING. Without an output colour space the PBR materials were
    // written to the canvas linearly and read flat and grey; ACES gives them roll-off in the
    // highlights instead of clipping. These change how EVERY surface is shaded, uniformly —
    // nothing encoded in height, radius, opacity or speed is touched.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in r185; radius on the light softens it
    // The RC stage's backdrop is the page's CSS radial gradient behind a transparent canvas — an
    // opaque scene background was hiding it, which is part of why the scene read as a flat slab.
    this.scene.background = host.closest('#rc-app') ? null : new THREE.Color(0x0d1117);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.camera.position.set(7.5, 6.2, 10.5);
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    if (host.closest('#rc-app')) this.controls.enableZoom = false;
    this.controls.addEventListener('start', () => { this.cameraOwnedByViewer = true; });
    this.controls.target.set(0, 2.2, 0);
    // A DAYLIT BENCH. Sky/ground hemisphere light for the soft gradient on curved bodies, a
    // warm key from upper-left that CASTS a soft shadow onto the bench (contact shadow is what
    // makes a light scene read as lit rather than washed out), a cool fill for the far side.
    // No rim light: rims are for dark backdrops. Intensities are for ACES at exposure 1.0.
    // The shadow pass is the one real cost added here; it is measured, not assumed.
    this.scene.add(new THREE.HemisphereLight(0xe3ecf5, 0xcfc7b9, 0.9));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const key = new THREE.DirectionalLight(0xfff4e4, 2.0);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -16; key.shadow.camera.right = 12;
    key.shadow.camera.top = 12; key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 1; key.shadow.camera.far = 50;
    key.shadow.bias = -0.0008; key.shadow.radius = 4;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe6f5, 0.6);
    fill.position.set(-9, 6, -4);
    this.scene.add(fill);
    this.scene.add(this.group);
    this.resize();
  }

  /** Free per-build GPU resources; marker geometry is shared across builds. */
  private clearDrawing(): void {
    this.resistorInterior = null;
    this.markerPoints = [];
    this.live = null;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      const drawable = object as THREE.Mesh;
      if (drawable.geometry && drawable.geometry !== this.markerGeo && drawable.geometry !== this.rcMarkerGeo && drawable.geometry !== this.electronGeo && drawable.geometry !== this.electronStillGeo)
        geometries.add(drawable.geometry);
      if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.group.clear();
  }

  resize(): void {
    const w = this.host.clientWidth || 480, h = this.host.clientHeight || 380;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.cameraOwnedByViewer) this.frameAll();
  }

  /** Re-frame on demand — the UI offers this as a button, since orbiting can get lost. */
  refit(): void { this.cameraOwnedByViewer = false; this.setFieldEmphasis(0.3); this.frameAll(); }

  /**
   * Swing the camera toward the coil's axis so a loop facing along it shows its face rather
   * than its edge. This changes only the VIEW: no pose, no geometry and no reading moves, and
   * `refit()` puts the original framing back.
   */
  /** Field prominence follows the subject: full when the coil is being looked at. */
  setFieldEmphasis(v: number): void {
    const next = Math.min(1, Math.max(0, v));
    if (next === this.fieldEmphasis) return;
    this.fieldEmphasis = next;
  }

  focusOnCoilAxis(): void {
    this.setFieldEmphasis(1);
    const b = this.branches.find((x) => x.kind === 'inductor');
    if (!b) return;
    const a = new THREE.Vector3(b.xA, b.yA, b.zA), z = new THREE.Vector3(b.xB, b.yB, b.zB);
    const centre = a.clone().lerp(z, 0.5);
    const axis = z.clone().sub(a).normalize();
    const lift = new THREE.Vector3(0, 1, 0).sub(axis.clone().multiplyScalar(axis.y)).normalize();
    const dist = Math.max(6, a.distanceTo(z) * 2.4);
    this.cameraOwnedByViewer = true;                 // the viewer chose this; do not re-frame
    this.camera.position.copy(centre)
      .addScaledVector(axis, dist * 0.78)
      .addScaledVector(lift, dist * 0.42);
    this.camera.lookAt(centre);
    this.controls.target.copy(centre);
    this.controls.update();
  }

  /**
   * Frame the diode, so "show me it" points at the part rather than leaving the viewer to find a
   * small body among four components. Does nothing when there is no diode: a control that
   * silently moved the camera to an empty spot would be worse than one that did not move.
   */
  focusOnDiode(): void {
    const b = this.branches.find((x) => x.kind === 'diode');
    if (!b) return;
    const a = new THREE.Vector3(b.xA, b.yA, b.zA), z = new THREE.Vector3(b.xB, b.yB, b.zB);
    const centre = a.clone().lerp(z, 0.5);
    // Look from OUTSIDE the ring, so the body is seen against open space rather than through
    // the rest of the loop.
    const outward = new THREE.Vector3(centre.x, 0, centre.z).normalize();
    if (outward.lengthSq() < 1e-9) outward.set(0, 0, 1);
    const dist = Math.max(4.5, a.distanceTo(z) * 3.2);
    this.cameraOwnedByViewer = true;
    this.camera.position.copy(centre)
      .addScaledVector(outward, dist)
      .add(new THREE.Vector3(0, dist * 0.34, 0));
    this.camera.lookAt(centre);
    this.controls.target.copy(centre);
    this.controls.update();
  }

  getInfo(): PotentialSceneInfo { return this.info; }

  /** Rebuild the terraces from the accepted solution. A REJECTED solve draws NOTHING. */
  build(sim: SimWorld, displayRef: string | null): void {
    this.clearDrawing();
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.branches = [];

    const c = sim.solvedCircuit();
    const sol = sim.circuitSolution, merge = sim.circuitMerge;
    // NO CIRCUIT AUTHORED is not a refusal. Nothing has been refused; there is
    // simply nothing to draw yet.
    if (!c || c.components.length === 0) {
      this.info = { ...this.info, empty: true, rejected: null, nodes: 0, branches: 0 };
      return;
    }
    // A circuit EXISTS and the solve refused it. Say so, with the reason.
    if (sim.electrical.rejected) {
      this.info = { ...this.info, empty: false, rejected: sim.electrical.rejected, nodes: 0, branches: 0 };
      return;
    }
    // A circuit exists, was not refused, and yet has no solution. That should be
    // unreachable; report it as the anomaly it is rather than as either of the above.
    if (!sol || !merge) {
      this.info = { ...this.info, empty: false, nodes: 0, branches: 0,
        rejected: 'INTERNAL: a circuit is authored and was not refused, but no solution is present. '
          + 'This is not a refusal and not an empty bench; it is a defect. Nothing is drawn.' };
      return;
    }
    const src = sourcesOf(c)[0];
    const refRep = displayRef ? merge.find(displayRef) : merge.find(src.neg);
    const refOffset = voltageAt(sol, merge, refRep);
    const dispV = (rep: string): number => voltageAt(sol, merge, rep) - refOffset;

    const reps = sol.nodeVoltages.map((r) => r.rep);
    const nodeLabel = (id: string): string => c.nodes.find((n) => n.id === id)?.label ?? id;
    const railName = (rep: string): string => merge.members(rep).map(nodeLabel).join(' = ');

    // ---- DERIVE THE NEUTRAL SPEC, then hand off to the ONE renderer. --------
    const sc0 = sol.sourceCurrent;
    const spec: SceneSpec = {
      terraces: reps.map((rep) => ({ id: rep, label: railName(rep), volts: dispV(rep), isRef: rep === refRep })),
      branches: [
        { id: src.id, label: src.label, kind: 'source' as const,
          from: sc0 >= 0 ? merge.find(src.neg) : merge.find(src.pos),
          to: sc0 >= 0 ? merge.find(src.pos) : merge.find(src.neg),
          current: Math.abs(sc0) },
        ...resistorsOf(c).map((r) => ({ id: r.id, label: r.label, kind: 'resistor' as const,
          from: merge.find(r.a), to: merge.find(r.b),
          current: sol.resistors.find((q) => q.id === r.id)!.current })),
        ...wiresOf(c).map((w) => ({ id: w.id, label: w.label, kind: 'wire' as const,
          from: merge.find(w.a), to: merge.find(w.b), current: null })),
      ],
    };
    this.buildFromSpec(spec);
  }

  /**
   * THE ONE RENDERER. Everything the bench and the RC experiment draw goes through
   * here, so height, motion, thickness and emptiness mean the same thing on both.
   */
  buildFromSpec(spec: SceneSpec): void {
    const previousPhases = new Map(this.branches.map(b => [b.id,b.phase]));
    this.clearDrawing();
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.branches = [];
    this.stores = [];
    this.focusBox = null;
    if (spec.terraces.length === 0) {
      this.info = { ...this.info, empty: true, rejected: null, nodes: 0, branches: 0 };
      return;
    }
    const vals = spec.terraces.map((t) => t.volts);
    const lo = spec.fixedSpan ? spec.fixedSpan.lo : Math.min(0, ...vals);
    const hi = spec.fixedSpan ? spec.fixedSpan.hi : Math.max(0, ...vals);
    const span = Math.max(hi - lo, 1e-12);
    const spatialRC = !!(spec.plates?.length && this.host.closest('#rc-app'));
    // THE AUTHORED DECK: the same fixed-deck treatment as the RC scene, positions from the spec.
    const anchored = !!spec.deck && spec.terraces.length > 0 && spec.terraces.every((t) => !!t.anchor);
    const deck = spatialRC || anchored;
    this.deckView = anchored && spec.deck?.viewDir ? new THREE.Vector3(...spec.deck.viewDir).normalize() : null;
    // DRAWING UNITS PER VOLT. Enlarging the drawn EXTENT is not compressing the physics:
    // the scale is printed and the ruler still reads volts. Peter's word for the RLC scene
    // was "pretty cramped", and the cause is that the honest bound can double or treble the
    // span while the drawn height stayed at 4.4 units — so a wider range squeezed the
    // circuit into a thinner and thinner band.
    const upv = (deck ? SPATIAL_PLOT_H : PLOT_H) / span;
    const y = (v: number): number => (v - lo) * upv;
    const reps = spec.terraces.map((t) => t.id);
    const dispV = (id: string): number => spec.terraces.find((t) => t.id === id)!.volts;
    const railName = (id: string): string => spec.terraces.find((t) => t.id === id)!.label;
    const refRep = (spec.terraces.find((t) => t.isRef) ?? spec.terraces[0]).id;
    const live: LiveHandles = {
      signature: sceneSignature(spec, this.electronView), y, refRep,
      nodes: new Map(), tubes: new Map(), componentLabels: new Map(), deckCapacitors: new Map(),
      diode: null, resistor: null, mosfet: null, lamp: null, switch: null, motor: null, pot: null, led: null, sensor: null, comparator: null,
      stores: new Map(), mechanism: null, terminals: new Map(), bodies: new Map(), field: null, pickup: null, plates: null,
    };

    // ---- TERRACES. One flat platform per SOLVED node potential. -------------
    // Distinct nodes that share a potential share a HEIGHT but get their own
    // platform, because they are distinct nodes; merged nodes are ONE platform.
    //
    // They are arranged around a RING in the horizontal plane, not along a line.
    // Angular position is LAYOUT ONLY and means nothing — but it lets a circuit be
    // seen as the LOOP it is, which a single row cannot show, and it stops parallel
    // branches from being drawn on top of each other.
    // These leads express connectivity, not voltage along their routed shape.
    // Only the labelled potential landings use the height scale.
    const cable = (a: THREE.Vector3, b: THREE.Vector3, colour: number, side = 0, id = "", current: number | null = null, fullScaleA?: number, bow = 0.45, lift = 0): void => {
      const route = new THREE.CatmullRomCurve3([
        a, a.clone().add(new THREE.Vector3(side,lift,bow)),
        new THREE.Vector3(a.x+side, b.y + lift, b.z+bow*1.55), b
      ]);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(route,36,0.09,12,false),
        new THREE.MeshStandardMaterial({color:colour,roughness:0.32,metalness:0.18}));
      this.group.add(mesh);
      if (id) {
        const length = route.getLength();
        const markers = current === null || (current === 0 && !this.electronView) ? null : new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({color: this.electronView ? 0x89dbff : 0xd5fff2}), Math.max(2, Math.ceil(length / (this.electronView ? .30 : .95))));
        if (markers) { markers.frustumCulled = false; this.group.add(markers); }
        // Recorded even with no computed current (a reference lead), so the rendered geometry is complete for validation; no markers then.
        this.branches.push({kind:'wire', id, label:id, xA:a.x,yA:a.y,zA:a.z,xB:b.x,yB:b.y,zB:b.z,
          current, markers, electronCues:this.electronView, phase:previousPhases.get(id) ?? 0, line:null, route, routeLength:length, fullScaleA});
      }
      for(const end of [a,b]) {
        const plug=new THREE.Mesh(new THREE.SphereGeometry(0.14,12,10),new THREE.MeshStandardMaterial({color:0xc0cbd1,metalness:0.65,roughness:0.25}));
        plug.position.copy(end);this.group.add(plug);
      }
    };
    const posOf = new Map<string, THREE.Vector3>();
    /**
     * Where each node's POTENTIAL is drawn, as distinct from where its component sits.
     *
     * Empty unless the spatial layout is in use, in which case every node has an entry. The
     * height is `y(V)` on the shared axis — never an offset from the component's own anchor.
     */
    const potentialOf = new Map<string, THREE.Vector3>();
    /** Height of the component deck, so furniture placed later can sit relative to it. */
    let deckBaseY = 0;
    const n = reps.length;
    // COMPOSITION, not just a fit. When the plates are the subject the landings are
    // pulled IN and made small, so framing the whole scene keeps the capacitor large
    // instead of shrinking everything to fit a wide ring. Astra: "a whole-scene fit
    // that shrinks everything is not enough either."
    const hasPlates = (spec.plates?.length ?? 0) > 0;
    const ringR = hasPlates ? RING_R * 0.42 : RING_R;
    reps.forEach((rep, i) => {
      const a = n === 1 ? 0 : (2 * Math.PI * i) / n + Math.PI / 2 + (n === 3 ? 0.38 : 0);
      const r = n <= 2 ? ringR * 0.62 : ringR;
      posOf.set(rep, new THREE.Vector3(Math.cos(a) * r, y(dispV(rep)), Math.sin(a) * r));
    });

    if (spatialRC) {
      // EXPLICIT SPATIAL PLACEMENT FOR ALL FOUR NODES. rc-mid had none, so it fell back to
      // the generic ring of radius 1.26 while its neighbours sat 5 units apart — which is
      // why the resistor and the coil were crushed together in the middle. The run is now
      // shared evenly: source → resistor → mid → inductor → capacitor.
      // A DIODE ADDS A NODE, so the run has to be re-spaced rather than have the new one fall
      // through to the generic ring. That is exactly the defect this block was written to fix
      // for `rc-mid` — an unplaced node landed on a ring of radius 1.26 while its neighbours sat
      // 3.7 apart, crushing two components together — and adding `rc-anode` reproduced it.
      //
      // Spans are sized by what each component has to DRAW, not shared equally: the resistor
      // has an exposed interior, the inductor is a real winding whose length comes from the coil
      // geometry, and the diode body is small. Widening the whole run to fit the extra node is
      // a LAYOUT change; no physical separation is touched by it.
      const withDiode = posOf.has('rc-anode');
      // ---- THE COMPONENTS STOP MOVING. -------------------------------------------------
      //
      // Every terminal used to sit at its node's VOLTAGE height, so the parts themselves were
      // the potential plot. Under a DC step each node moved once and settled and it read well.
      // Under the alternating source these presets introduced it does not: measured from the
      // trajectory, the source terrace travels 100% of the full plot height and the
      // resistor→diode node 99%, eight times per run — about 2.7 full traversals of the frame
      // every second. The source, resistor and diode fly up and down through everything else.
      // Peter's word was "chaotic", and he was describing exactly this.
      //
      // So the circuit is now a FIXED DECK: bodies, terminals and the wires between them hold
      // still, and the loop can be traced. Potential is drawn separately, by a marker per node
      // riding a shared ruler — see `potentialOf` below.
      const DECK_Y = 0, DECK_Z = -1.2;
      deckBaseY = DECK_Y;
      // WIDER, AND THE CAPACITOR PUSHED CLEAR OF THE COIL. The plates are drawn about the
      // capacitor terminal and are the largest bodies in the scene; at the old spacing they sat
      // over the winding's right-hand end and occluded it. The run uses the width it has.
      if (withDiode) {
        posOf.set('rc-source', new THREE.Vector3(-9.0, DECK_Y, DECK_Z));
        posOf.set('rc-anode', new THREE.Vector3(-5.2, DECK_Y, DECK_Z));
        posOf.set('rc-mid', new THREE.Vector3(-2.0, DECK_Y, DECK_Z));   // 3.2 units for the diode
        posOf.set('rc-cap', new THREE.Vector3(6.1, DECK_Y, DECK_Z));    // real gap, not abutment
      } else {
        posOf.set('rc-source', new THREE.Vector3(-6.2, DECK_Y, DECK_Z));
        posOf.set('rc-mid', new THREE.Vector3(-2.0, DECK_Y, DECK_Z));
        posOf.set('rc-cap', new THREE.Vector3(4.2, DECK_Y, DECK_Z));
      }
      // GROUND IS A RAIL IN FRONT OF THE RUN, not a node tucked behind it.
      //
      // It used to sit behind and to the left, so the load — which runs capacitor → ground —
      // swept diagonally back across the entire scene, crossing the series path it is supposed
      // to be parallel to. Nobody could trace it. Placed in FRONT and under the capacitor end,
      // the load becomes a short forward drop at the right of the run and the source's return
      // comes forward at the left: two clearly separate lanes to one rail, which is how a
      // parallel branch is read.
      // Well forward, so the return and the load read as a lane in FRONT of the run rather than
      // as wires crossing it, and so the load's body is clear of the plates.
      // GROUND SITS BELOW THE DECK, ON ITS OWN RETURN LEVEL.
      //
      // It was at deck height, so the source's branch — which runs ground → source, right across
      // the width of the circuit — was drawn AT the same level as the series run and passed
      // straight through the resistor and the diode. Peter: "the wiring is bad and crimped on
      // that resistor". It was: two conductors sharing one line, meeting the resistor's end caps
      // from behind, with the return cable kinking away out of the middle of it.
      //
      // Dropping it puts the return underneath and in front, the way a board has components on
      // top and a return plane below. Nothing crosses the series run any more, and both returns
      // — the source's and the load's — descend to the same level, which is what makes them read
      // as one node.
      //
      // The ANCHOR moves; the potential does not. Ground's marker still sits at y(0) on the
      // shared ruler, because anchors are layout and markers are voltage. That separation is
      // exactly what lets a layout problem be fixed without touching what is encoded.
      posOf.set('rc-gnd', new THREE.Vector3(withDiode ? 6.1 : 4.2, DECK_Y - 2.1, 6.6));
    } else if (anchored) {
      // THE PAGE PLACED ITS OWN COMPONENTS. Same deck, same rule — anchors are layout, markers
      // are voltage — with the positions authored beside the circuit they describe.
      deckBaseY = 0;
      for (const t of spec.terraces)
        posOf.set(t.id, new THREE.Vector3(t.anchor!.x, t.anchor!.y ?? 0, t.anchor!.z));
    }
    if (deck) {
      // ---- AND POTENTIAL RIDES ONE SHARED RULER. ---------------------------------------
      //
      // The marker for a node sits at `y(V)` — the SAME world height for the same voltage, on
      // the same axis, whichever component it belongs to. It is deliberately NOT an offset from
      // each part's own anchor: that would make every component its own electrical zero, so two
      // nodes at equal potential would draw at different heights and a negative voltage would
      // not read as below zero. Equal volts align; zero is the ruler's zero; negative is below it.
      for (const rep of reps)
        potentialOf.set(rep, new THREE.Vector3(
          posOf.get(rep)!.x, y(dispV(rep)), posOf.get(rep)!.z));
      this.markerPoints = [...potentialOf.values()].map((v) => v.clone());
    }
    const nodeLabelY = (markerY: number): number => y(0) + 0.5 * (markerY - y(0));
    reps.forEach((rep) => {
      const anchor = posOf.get(rep)!;
      const marker = potentialOf.get(rep) ?? anchor;   // generic ring layout: the two coincide
      const v = dispV(rep), p0 = marker, yy = p0.y, xx = p0.x, zz = p0.z;
      // A STEM FROM THE PART TO ITS POTENTIAL, and it must not read as wire. It is drawn thin,
      // dull and unlit, carries no current markers and never animates: it is a measurement,
      // like a leader line on a drawing, not a conductor. A thick bright tube here would say
      // that charge flows from the component up to its own voltage, which is meaningless.
      // UNIT HEIGHT, SCALED: so the stem can follow the marker every frame by changing
      // `scale.y` and its position, instead of being rebuilt with a new geometry.
      let stem: THREE.Mesh | null = null;
      if (potentialOf.has(rep)) {
        stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.018, 1, 6),
          new THREE.MeshBasicMaterial({ color: 0x6b7883, transparent: true, opacity: 0.6 }));
        stem.name = 'measure';
        const h = Math.abs(marker.y - anchor.y);
        stem.scale.y = Math.max(h, 1e-6);
        stem.visible = h > 0.02;
        stem.position.set(anchor.x, (anchor.y + marker.y) / 2, anchor.z);
        this.group.add(stem);
      }
      const isRef = rep === refRep;
      const subordinate = (spec.plates?.length ?? 0) > 0;
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(subordinate ? TERRACE_R * 0.62 : TERRACE_R,
          subordinate ? TERRACE_R * 0.62 : TERRACE_R, 0.11, 44),
        new THREE.MeshStandardMaterial({
          color: isRef ? 0x7d8791 : 0x3a82d8, roughness: 0.45, metalness: 0.15,
          emissive: isRef ? 0x0b0e12 : 0x0f2f55, emissiveIntensity: 0.35,
        }));
      disc.position.set(xx, yy, zz);
      this.group.add(disc);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(subordinate ? TERRACE_R * 0.62 : TERRACE_R, 0.022, 8, 48),
        new THREE.MeshBasicMaterial({ color: isRef ? 0x5f6b76 : 0x2f6fb5 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(xx, yy + 0.07, zz);
      this.group.add(ring);
      // THE TEXT MOVES HALF AS FAR AS THE DISC. The disc, ring and stem carry the voltage at
      // full scale; the label sits at 50% of the marker's excursion from the zero datum, so a
      // swing that takes the disc across the whole ruler moves its reading by half that. Peter
      // found labels riding the full motion jarring to read. A thin unlit leader joins the text
      // to its disc whenever the two part by more than a disc's width, so the reading is never
      // ambiguous about which marker it belongs to. Presentation only: height still means volts.
      const labelY = potentialOf.has(rep) ? nodeLabelY(yy) : yy + 0.42;
      const label = this.addLabel(spec.terraces.find((t) => t.id === rep)?.showValue === false ? railName(rep) : `${railName(rep)}\n${v.toFixed(3)} V${isRef ? '  · displayed 0' : ''}`,
        new THREE.Vector3(xx, labelY, zz), isRef ? 'ref' : 'node');
      label.centred = potentialOf.has(rep);   // a tag on the leader, not a caption over the disc
      let leader: THREE.Mesh | null = null;
      if (potentialOf.has(rep)) {
        leader = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 1, 6),
          new THREE.MeshBasicMaterial({ color: isRef ? 0x5f6b76 : 0x2f6fb5, transparent: true, opacity: 0.55 }));
        leader.name = 'measure';
        placeLeader(leader, xx, yy, zz, labelY);
        this.group.add(leader);
      }
      live.nodes.set(rep, { disc, ring, stem, leader, label, anchor: anchor.clone(), marker: marker.clone(), isRef });
    });

    // ---- THE DISPLAYED ZERO DATUM. A choice, drawn as a choice. -------------
    // Quieter than before: a large, faint plane at the ruler's zero rather than a small grey
    // slab. It still marks where zero IS — that is the point of drawing it — but it no longer
    // reads as a component.
    const datum = new THREE.Mesh(
      new THREE.PlaneGeometry(deck ? 34 : RING_R * 2.25, deck ? 24 : RING_R * 2.25),
      new THREE.MeshBasicMaterial({ color: 0x8fb4d8, transparent: true, opacity: deck ? 0.12 : 0.5,
        side: THREE.DoubleSide, depthWrite: false }));
    datum.name = 'datum';   // excluded from camera framing: it is a backdrop, not data
    datum.rotation.x = -Math.PI / 2;
    datum.position.set(0, y(0), 0);
    this.group.add(datum);
    if (deck) {
      // A FLOOR UNDER THE RETURN LEVEL, with a soft grid, so the circuit stands on something and
      // depth reads. Backdrop, not data: named 'datum' so framing ignores it, unlit, faint.
      const floorY = deckBaseY - 2.6;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 28),
        new THREE.MeshStandardMaterial({ color: 0xe2ddd3, roughness: 0.92, metalness: 0.0 }));
      floor.name = 'datum';
      floor.receiveShadow = true;
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(-1, floorY, 2);
      this.group.add(floor);
      const grid = new THREE.GridHelper(40, 40, 0xc3ccd5, 0xd9dfe6);
      grid.name = 'datum';
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.6;
      grid.position.set(-1, floorY + 0.01, 2);
      this.group.add(grid);
    }

    // ---- BRANCHES. One per component. Nothing else is drawn between terraces.
    // One shared current scale for the whole drawing, so two branches can be
    // compared by eye. Printed in the legend alongside the marker-speed scale.
    const fullI = spec.fixedFullI !== undefined
      ? Math.max(spec.fixedFullI, 1e-12)
      : Math.max(...spec.branches.map((b) => Math.abs(b.current ?? 0)), 1e-12);

    // Two components between the SAME pair of nodes would be drawn on top of each
    // other. They are fanned apart perpendicular to the chord. That offset is
    // LAYOUT ONLY and encodes nothing.
    this.currentMotionScale = deck ? 6 / fullI : UNITS_PER_SEC_PER_AMP;
    this.flowCue = spec.flowCue ?? null;
    this.tightFit = spec.deck?.tightFit === true;
    this.fullCurrent = fullI;
    const pairSeen = new Map<string, number>();
    /**
     * A ROUTED LEAD: straight segments through the waypoints, a joint sphere at each bend, one radius for the whole
     * lead scaled by |I| exactly as a straight tube is (each segment scales its own radius), and a CurvePath the
     * carriers follow. Same materials, same line, same live record as a straight branch.
     */
    const addRoutedBranch = (kind: Branch['kind'], id: string, label: string, pa: THREE.Vector3, pb: THREE.Vector3,
                             waypoints: [number, number][], current: number | null, colour: number, showMarkers: boolean, fullScaleA?: number): void => {
      const y = pa.y + 0.06;
      const pts = [new THREE.Vector3(pa.x, y, pa.z), ...waypoints.map(([x, z]) => new THREE.Vector3(x, y, z)), new THREE.Vector3(pb.x, y, pb.z)];
      const still = current === 0;
      const rad = current === null || still ? TUBE_BASE : TUBE_BASE + TUBE_PER_AMP * Math.min(1.4, Math.abs(current) / Math.max(fullI, 1e-12));
      const tubeMat = new THREE.MeshStandardMaterial({ color: still ? 0x6a737d : colour, roughness: 0.5, metalness: 0.05, transparent: true, opacity: still ? 0.4 : 0.42, emissive: still ? 0x000000 : colour, emissiveIntensity: 0.22 });
      const group = new THREE.Group(); group.name = `${id}-route`; this.group.add(group);
      const path = new THREE.CurvePath<THREE.Vector3>();
      const coreMat = new THREE.MeshStandardMaterial({ color: kind === 'source' ? 0x397b6b : 0x507b96, roughness: 0.28, metalness: 0.5 });
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k], len = a.distanceTo(b); if (len < 1e-6) continue;
        path.add(new THREE.LineCurve3(a, b));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_BASE, TUBE_BASE, len, 12, 1, true), tubeMat);
        seg.scale.set(rad / TUBE_BASE, 1, rad / TUBE_BASE); seg.position.copy(mid); seg.quaternion.copy(q); group.add(seg);
        if (deck) {
          const core = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, len, 20), coreMat); core.position.copy(mid); core.quaternion.copy(q); this.group.add(core);
          if (k < pts.length - 1) { const joint = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), coreMat); joint.position.copy(b); this.group.add(joint); }
        }
      }
      if (deck) for (const end of [pts[0], pts[pts.length - 1]]) {
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.22, 20), new THREE.MeshStandardMaterial({ color: 0xb2c9d1, roughness: 0.24, metalness: 0.7 }));
        collar.position.copy(end); this.group.add(collar);
      }
      const lineMat = new THREE.LineBasicMaterial({ color: still ? 0x6a737d : colour, transparent: true, opacity: still ? 0.55 : 0.85 });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat); this.group.add(line);
      live.tubes.set(id, { tube: group, tubeMat, lineMat, colour });
      const length = path.getLength();
      const electrons = this.electronView && !!this.host.closest('#rc-app');
      let markers: THREE.InstancedMesh | null = null;
      if (showMarkers && current !== null) {
        const n = Math.max(2, Math.min(60, Math.ceil(length / (electrons ? .30 : deck ? .95 : MARKER_SPACING))));
        markers = new THREE.InstancedMesh(electrons ? this.electronGeo : deck ? this.rcMarkerGeo : this.markerGeo, new THREE.MeshBasicMaterial({ color: electrons ? 0x89dbff : deck ? 0xd5fff2 : colour }), n);
        markers.frustumCulled = false; this.group.add(markers);
      }
      const a = pts[0], b = pts[pts.length - 1];
      this.branches.push({ kind, id, label, yA: a.y, yB: b.y, xA: a.x, xB: b.x, zA: a.z, zB: b.z, current, markers, electronCues: electrons, phase: previousPhases.get(id) ?? 0, line, fullScaleA, route: path, routeLength: length });
    };
    const addBranch = (kind: Branch['kind'], id: string, label: string,
                       aRep: string, bRep: string, current: number | null, colour: number, showMarkers = true,
                       fullScaleA?: number, waypoints?: [number, number][], fromOverride?: [number, number], toOverride?: [number, number]): void => {
      const pa0 = posOf.get(aRep)!, pb0 = posOf.get(bRep)!;
      const pa = fromOverride ? new THREE.Vector3(fromOverride[0], pa0.y, fromOverride[1]) : pa0;
      const pb = toOverride ? new THREE.Vector3(toOverride[0], pb0.y, toOverride[1]) : pb0;
      if ((waypoints && waypoints.length) || fromOverride || toOverride) { addRoutedBranch(kind, id, label, pa, pb, waypoints ?? [], current, colour, showMarkers, fullScaleA); return; }
      const key = [aRep, bRep].sort().join('|');
      const seen = pairSeen.get(key) ?? 0;
      pairSeen.set(key, seen + 1);
      const fan = seen === 0 ? 0 : (seen % 2 === 1 ? 1 : -1) * Math.ceil(seen / 2) * 0.55;
      const chord = new THREE.Vector3().subVectors(pb, pa);
      const perp = new THREE.Vector3(-chord.z, 0, chord.x).normalize().multiplyScalar(fan);
      const a = pa.clone().add(perp); a.y += 0.06;
      const b = pb.clone().add(perp); b.y += 0.06;
      const xA = a.x, xB = b.x, yA = a.y, yB = b.y;
      const still = current === 0;
      // A TUBE, whose RADIUS encodes |I| at the shared printed scale, on top of the
      // baseline. A wire (current null) is drawn at the baseline only: this view
      // computes no individual wire current, so its thickness must claim nothing.
      const len = a.distanceTo(b);
      const rad = current === null || still
        ? TUBE_BASE
        : TUBE_BASE + TUBE_PER_AMP * Math.min(1.4, Math.abs(current) / Math.max(fullI, 1e-12));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      // Built at TUBE_BASE and scaled to `rad`, so a later current changes `scale.x/z` on the
      // same mesh rather than replacing its geometry.
      const tubeMat = new THREE.MeshStandardMaterial({
          color: still ? 0x6a737d : colour, roughness: 0.5, metalness: 0.05,
          transparent: true, opacity: still ? 0.4 : 0.42,
          emissive: still ? 0x000000 : colour, emissiveIntensity: 0.22,
        });
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(TUBE_BASE, TUBE_BASE, len, 12, 1, true), tubeMat);
      tube.scale.set(rad / TUBE_BASE, 1, rad / TUBE_BASE);
      tube.position.copy(mid);
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
        new THREE.Vector3().subVectors(b, a).normalize());
      this.group.add(tube);
      if (deck) {
        // A solid, fixed-radius connection stays visible even at zero current.
        // Only the existing outer halo and marker motion encode current.
        const core = new THREE.Mesh(
          new THREE.CylinderGeometry(0.085,0.085,len,20),
          new THREE.MeshStandardMaterial({color:kind==='source'?0x397b6b:0x507b96,roughness:0.28,metalness:0.5}));
        core.position.copy(mid); core.quaternion.copy(tube.quaternion); this.group.add(core);
        for(const end of [a,b]) {
          const collar=new THREE.Mesh(new THREE.CylinderGeometry(0.145,0.145,0.22,20),
            new THREE.MeshStandardMaterial({color:0xb2c9d1,roughness:0.24,metalness:0.7}));
          collar.position.copy(end);collar.quaternion.copy(tube.quaternion);this.group.add(collar);
        }
      }
      const lineMat = new THREE.LineBasicMaterial({ color: still ? 0x6a737d : colour,
          transparent: true, opacity: still ? 0.55 : 0.85 });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat);
      this.group.add(line);
      live.tubes.set(id, { tube, tubeMat, lineMat, colour });

      const electrons = this.electronView && !!this.host.closest('#rc-app');
      let markers: THREE.InstancedMesh | null = null;
      // MARKERS EXIST WHENEVER A CURRENT IS COMPUTED, even if it is zero right now: their
      // visibility follows the current every frame in render(), so a branch that starts at rest
      // and later conducts must already have them. Creating them only for a nonzero current meant
      // a branch built at zero could never show transport until the next full rebuild.
      if (showMarkers && current !== null) {
        const n = Math.max(2, Math.min(60, Math.ceil(len / (electrons ? .30 : deck ? .95 : MARKER_SPACING))));
        markers = new THREE.InstancedMesh(electrons ? this.electronGeo : deck ? this.rcMarkerGeo : this.markerGeo,
          new THREE.MeshBasicMaterial({ color: electrons ? 0x89dbff : deck ? 0xd5fff2 : colour }), n);
        markers.frustumCulled = false;
        this.group.add(markers);
      }
      this.branches.push({ kind, id, label, yA, yB, xA, xB, zA: a.z, zB: b.z, current, markers, electronCues:electrons, phase: previousPhases.get(id) ?? 0, line, fullScaleA });
    };

    // The SOURCE is drawn along the conventional current INSIDE it: from the
    // terminal the current enters to the terminal it leaves. That is a RISE
    // whichever terminal is which, which is why a circuit is a loop, not a slope.
    // IDEAL WIRES carry NO marker: this view computes no individual wire current
    // (D-45 §7). They are drawn FLAT — equal potential, no drop.
    // The load is its OWN kind, not a second 'resistor'. Reusing 'resistor' put it through the
    // exposed-interior treatment — which writes `this.resistorInterior`, so the LAST resistor
    // drawn wins and "Inspect resistor" would have opened the load instead of the series
    // resistor the lens is about. It also labelled the load "· exposed interior".
    const COLOUR = { source: 0x5fd39a, resistor: 0x6fb8ff, wire: 0xc8b273, capacitor: 0xd8a657, inductor: 0xb59be0, diode: 0xffb347, load: 0x7fa3c4,
      mosfet: 0x8fa3b8, lamp: 0xe9b44c, gate: 0x3fae8f, switch: 0x8a5a2b, motor: 0x7f6fd0, pot: 0x6fb8ff, led: 0xe9634c, sensor: 0x5aa88f, comparator: 0x4a6b8a };
    /** The two main terminals of a deck body by kind, at its drawn chord ends (`left` = the branch's `from` side). */
    const mainTerminals = (kind: BranchSpec['kind'], left: THREE.Vector3, right: THREE.Vector3): Record<string, THREE.Vector3> => {
      const names: Record<string, [string, string]> = { diode: ['anode', 'cathode'], led: ['anode', 'cathode'], mosfet: ['drain', 'source'], motor: ['plus', 'minus'], comparator: ['inp', 'out'] };
      const [a, b] = names[kind] ?? ['a', 'b']; return { [a]: left.clone(), [b]: right.clone() };
    };
    /** The body's chord: the two net anchors, or — with an explicit pose — the posed body's own ends. */
    const chordOf = (b: BranchSpec): { a: THREE.Vector3; z: THREE.Vector3 } => {
      const pa = posOf.get(b.from)!, pz = posOf.get(b.to)!;
      if (!b.bodyAt) return { a: pa, z: pz };
      const dir = b.bodyDir ? new THREE.Vector3(b.bodyDir[0], 0, b.bodyDir[1]).normalize() : pz.clone().sub(pa).setY(0).normalize();
      const half = (b.bodyLen ?? 3.6) / 2, c = new THREE.Vector3(b.bodyAt.x, pa.y, b.bodyAt.z);
      return { a: c.clone().addScaledVector(dir, -half), z: c.clone().addScaledVector(dir, half) };
    };
    for (const b of spec.branches) {
      if (deck && !spatialRC && (b.kind === 'capacitor' || b.kind === 'inductor')) {
        // ---- THE DECK CAPACITOR AND INDUCTOR (core-primitives first batch): the SHARED bodies of the two storing
        // elements on an authored deck, posed like every other deck body (`bodyAt/bodyDir/bodyLen`, lead overrides),
        // with their terminals registered at the drawn plate faces / winding ends so the rail kit can validate what
        // is drawn. The capacitor is two plates 0.32 apart about the chord's middle; the plate tint follows the
        // solved charge fraction (q/q_full, signed: the + plate warms, the − plate cools). The inductor is a
        // winding of eight turns about a core between lerp .3 and .7. ILLUSTRATIVE GEOMETRY: the composition
        // gives farads and henries only, so the drawn sizes encode nothing (the RC page's geometry-derived plates
        // and coil are the other path, and are not duplicated here).
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        const [fa, fb] = b.kind === 'capacitor' ? [.42, .58] : [.3, .7];
        const left = a.clone().lerp(z, fa), right = a.clone().lerp(z, fb);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, { plus: left.clone(), minus: right.clone() });
        addBranch(b.kind, `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR[b.kind], false, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch(b.kind, `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR[b.kind], false, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const mid = left.clone().lerp(right, .5);
        if (b.kind === 'capacitor') {
          const plates: THREE.Mesh[] = [];
          for (const [pt, sign] of [[left, -1], [right, 1]] as const) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.055, 0.65), new THREE.MeshStandardMaterial({ color: 0xd8a657, metalness: .35, roughness: .4, emissive: 0x000000 }));
            plate.position.copy(pt).addScaledVector(axis, sign * -0.0275).add(new THREE.Vector3(0, .33, 0)); plate.quaternion.copy(rotation); this.group.add(plate); plates.push(plate);
            const post = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .33, 10), new THREE.MeshStandardMaterial({ color: 0x8ca9bb }));
            post.position.copy(pt).add(new THREE.Vector3(0, .165, 0)); this.group.add(post);   // the lead climbs from the deck to the plate's centre height
          }
          live.bodies.set(b.id, plates);
          live.deckCapacitors.set(b.id, plates);
          tintPlates(plates, b.charge ?? 0, b.chargeFull ?? 0);   // the same tint the update path applies (the bench equivalence probe caught a build without it)
          // No conductor spans the gap: the current markers are on the two leads only.
          this.addLabel('gap', mid.clone().add(new THREE.Vector3(0, .75, 0)), 'axis pin');
        } else {
          const len = left.distanceTo(right); const core = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, len * .96, 16), new THREE.MeshStandardMaterial({ color: 0x4e5560, metalness: .4, roughness: .6 }));
          core.position.copy(mid).add(new THREE.Vector3(0, .4, 0)); core.quaternion.copy(rotation); this.group.add(core);
          const turns: THREE.Mesh[] = [core];
          for (let k = 0; k < 8; k++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(.4, .06, 8, 24), new THREE.MeshStandardMaterial({ color: COLOUR.inductor, metalness: .5, roughness: .35 }));
            ring.position.copy(left).lerp(right, (k + .5) / 8).add(new THREE.Vector3(0, .4, 0)); ring.quaternion.copy(rotation); ring.rotateX(Math.PI / 2); this.group.add(ring); turns.push(ring);
          }
          for (const pt of [left, right]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .4, 10), new THREE.MeshStandardMaterial({ color: 0x8ca9bb })); post.position.copy(pt).add(new THREE.Vector3(0, .2, 0)); this.group.add(post); }
          live.bodies.set(b.id, turns);
          // One carrier overlay across the winding, as the resistor has, so the current is seen to pass through it.
          const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo, new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }), this.electronView ? Math.max(2, Math.ceil(len / .30)) : Math.max(3, Math.floor(len / .95)));
          flow.frustumCulled = false; this.group.add(flow);
          this.branches.push({ kind: 'inductor', id: `${b.id}-flow`, label: b.label, xA: left.x, yA: left.y + .4, zA: left.z, xB: right.x, yB: right.y + .4, zB: right.z, current: b.current, markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        }
        live.componentLabels.set(b.id, this.addLabel(b.label, mid.clone().add(new THREE.Vector3(0, 1.2, -0.6)), 'component'));
        continue;
      }
      if (b.kind === 'capacitor') {
        if (!spatialRC) {
          const a = posOf.get(b.from)!, end = posOf.get(b.to)!;
          const axis = end.clone().sub(a).normalize();
          const mid = a.clone().lerp(end,0.5);
          const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis);
          // Two isolated plates; no conducting mesh or current marker spans their gap.
          for (const [terminal, sign] of [[a,-1],[end,1]] as const) {
            const platePoint = mid.clone().addScaledVector(axis,sign*0.16);
            const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.055,0.65),
              new THREE.MeshStandardMaterial({color:0xd8a657,metalness:0.35,roughness:0.4}));
            plate.position.copy(platePoint);plate.quaternion.copy(rotation);this.group.add(plate);
            const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,terminal.distanceTo(platePoint),10),
              new THREE.MeshStandardMaterial({color:0x8ca9bb}));
            wire.position.copy(terminal).lerp(platePoint,0.5);wire.quaternion.copy(rotation);this.group.add(wire);
          }
          this.addLabel('Capacitor · insulating gap',mid.clone().add(new THREE.Vector3(0,0.6,0)),'component');
        }
        continue;
      }
      if (spatialRC && b.kind === 'source') continue;
      if (spatialRC && b.kind === 'inductor') {
        const { a, z } = chordOf(b);
        const solved = spec.coil;

        // ---- THE WINDING. -------------------------------------------------------------
        //
        // RIGID when the coil is solved. Its length and radius come from the geometry that
        // produced the inductance, scaled by ONE stated factor, so the drawn object is the
        // component the circuit contains. Previously the winding stretched between the two
        // voltage terraces, which made its dimensions a function of the voltages — and left
        // its turns and radius encoding nothing at all while L was authored separately.
        // The LEADS flex to reach the terraces instead; they are layout, and encode nothing.
        const axisDir = z.clone().sub(a).normalize();
        const up = new THREE.Vector3(0, 1, 0).sub(axisDir.clone().multiplyScalar(axisDir.y)).normalize();
        const side = new THREE.Vector3().crossVectors(axisDir, up).normalize();
        // BIASED TOWARD THE INDUCTOR'S OWN END, away from the capacitor. The plates are drawn
        // about the capacitor terminal and are the largest bodies here; centred between the two
        // nodes the winding ran under them and the coil — the thing the field is drawn around —
        // was half hidden. The leads take up the difference; they are layout and encode nothing.
        // Pulling this LEFT is what widens the gap to the plates; pushing the capacitor node
        // right does not, because the winding is centred on the span and travels right with it.
        const centre = a.clone().lerp(z, .20);
        const u = solved ? solved.sceneUnitsPerMetre : 0;
        const coilLen = solved
          ? (solved.turnPositionsM[solved.turnPositionsM.length - 1] - solved.turnPositionsM[0]) * u
          : a.distanceTo(z) * .52;
        const radius = solved ? solved.radiusM * u : .40;
        const left = centre.clone().addScaledVector(axisDir, -coilLen / 2);
        const right = centre.clone().addScaledVector(axisDir, coilLen / 2);
        const axis = axisDir;
        const length = coilLen;

        // One turn per turn. In solved mode the turn count and their spacing are the
        // geometry's, drawn one for one rather than chosen for looks.
        const turns = solved ? solved.turnPositionsM.length : 8;
        const steps = turns * 28;
        const path: THREE.Vector3[] = [a.clone()];
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, ang = t * turns * Math.PI * 2;
          // Unsolved: radius ramps 0 → r → 0 so the helix meets leads that end on the axis.
          // Solved: the winding is a true cylinder and the LEADS do the joining, because a
          // coil whose radius tapers to nothing is not the coil whose field we computed.
          const r = solved ? radius : radius * Math.sin(Math.PI * t);
          // HANDEDNESS. The `−side` is load-bearing. With `+side` this winding turns
          // side → up, and since axis × side = −up that is a rotation right-handed about
          // MINUS axis — the opposite chirality to the one loopFieldUnit assumes, which puts
          // B along +axis for a positive current. The renderer used to hide that mismatch by
          // flipping the arrow direction, so the arrows looked right while the reported flux
          // sign contradicted them. Now the drawn metal matches the computed field: −side → up
          // is right-handed about +axis, because axis × (−side) = +up.
          const p = left.clone().lerp(right, t)
            .addScaledVector(up, Math.sin(ang) * r)
            .addScaledVector(side, -Math.cos(ang) * r);
          if (solved && k === 0) path.push(p.clone());
          path.push(p);
        }
        path.push(z.clone());
        const route = new THREE.CatmullRomCurve3(path);
        // TRUE SCALE. A max(.03, …) floor here would draw the conductor at nearly double
        // size while the page claims one uniform metric for the coil, so the wire is drawn at
        // its actual radius — 2% of the winding radius, which is what 0.8 mm on a 40 mm coil
        // is. Thin, and correctly thin.
        const wireR = solved ? solved.wireRadiusM * u : .07;
        const wireMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: .75, roughness: .3 });
        let drawnPath: THREE.Curve<THREE.Vector3> = route;
        if (solved) {
          // THE WINDING IS ITS OWN BODY. Drawing winding and leads as ONE spline let the lead
          // directions — which follow the node heights, and so the voltages — pull the end
          // turns: measured in the running page, the winding's axial span moved 3.0% and its
          // radius 0.36% across a run, while the page claimed a rigid coil. Splitting them
          // makes the winding depend on nothing but its own geometry.
          const windPts = path.slice(2, path.length - 1);
          const windCurve = new THREE.CatmullRomCurve3(windPts);
          const leadIn = new THREE.LineCurve3(a.clone(), windPts[0]);
          const leadOut = new THREE.LineCurve3(windPts[windPts.length - 1], z.clone());
          this.group.add(new THREE.Mesh(
            new THREE.TubeGeometry(windCurve, steps + 8, wireR, 9, false), wireMat));
          for (const l of [leadIn, leadOut])
            this.group.add(new THREE.Mesh(new THREE.TubeGeometry(l, 8, wireR, 8, false), wireMat));
          // AND THE CUES FOLLOW WHAT IS DRAWN. Splitting the conductor left the markers on the
          // OLD combined spline, whose end tangents differ from the separate pieces — so the
          // charge cues carried exactly the lead-induced distortion the split removed from the
          // wire, and drifted off the visible conductor near the coil ends.
          const composite = new THREE.CurvePath<THREE.Vector3>();
          composite.add(leadIn); composite.add(windCurve); composite.add(leadOut);
          drawnPath = composite;
        } else {
          this.group.add(new THREE.Mesh(
            new THREE.TubeGeometry(route, steps + 24, wireR, 9, false), wireMat));
        }
        // NO CORE IS DRAWN IN SOLVED MODE. The model is an AIR-core solenoid; a metallic
        // cylinder down the bore reads as an iron core, which would imply a permeability, a
        // saturation and an eddy-current response that none of this has. The bore is empty
        // because the physics says it is empty. (The phenomenological coil keeps a faint
        // marker, since it makes no field claim at all.)
        if (!solved) {
          const core = new THREE.Mesh(new THREE.CylinderGeometry(radius * .25, radius * .25, length * .92, 14),
            new THREE.MeshStandardMaterial({ color: MAGNETIC, metalness: .3, roughness: .6,
              transparent: true, opacity: .34 }));
          core.position.copy(centre);
          core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
          this.group.add(core);
        }

        // ---- THE FIELD. ---------------------------------------------------------------
        //
        // SOLVED: meridional field lines integrated through the Biot–Savart field of this
        // winding, revolved to a few azimuths. Their SHAPE is current-independent, because
        // B = i·B_unit and a scalar cannot turn a tangent — so they are computed once per
        // geometry and only their direction and brightness depend on i(t).
        //
        // Visibility is a multiple of √(|i|/peak) with NO floor, so it reaches zero exactly
        // as the current does; at i = 0 nothing is constructed.
        const iNow = b.current ?? 0;
        // CONSTRUCTED WHENEVER THE COIL IS SOLVED, and then DRIVEN by the current: opacity and
        // head size follow √(|i|/peak) every frame, heads flip with the sign, and everything is
        // hidden when i = 0. Constructing only for a nonzero current meant a field that could
        // not appear until the next full rebuild — and the whole point of the update path is
        // that there is no next rebuild while the run plays.
        //
        // One presentation change, stated: the line RADIUS no longer shrinks with the current.
        // With the fixed TubeGeometry used here the radius is baked into the vertex positions;
        // a radius-parameterised tube or a per-frame regenerate would restore it, and neither is
        // done in this pass. Opacity and the arrow heads still carry the √(|i|/peak) map with no
        // floor, and the sign still sets the heads' direction.
        if (solved) {
          // AGAINST THE WINDING'S OWN PEAK, not the shared one. The shared current scale spans
          // every branch the scene draws, including a load that does not pass through the coil;
          // scaling the field cue against that would dim it in proportion to a current the coil
          // never carries. Only the VISIBILITY is scaled here — the field lines' geometry and
          // direction come from the Biot–Savart solution and are not affected by any ruler.
          const strength = Math.min(1, Math.abs(iNow) / (b.fullScaleA ?? fullI));
          const vis = Math.sqrt(strength);
          // +sign now, not −sign: the winding above is right-handed about +axis, so a positive
          // current puts B along +axis, which is the direction the loop points are built in.
          const dirSign = iNow === 0 ? 1 : Math.sign(iNow);
          // EMPHASIS, NOT TRUTH. The lines are the same lines: same Biot–Savart geometry, same
          // count, same direction, same √(|i|/peak) response. Only how loudly they are drawn
          // changes. In the overview they were the brightest thing in the frame and the
          // components had to be found behind them; at a glance the scene has to name the diode,
          // the coil, the capacitor and the load first. Focusing the coil restores full
          // prominence, so nothing is hidden — it is one step away.
          const emphasis = this.fieldEmphasis;
          const lineMat = new THREE.MeshBasicMaterial({ color: MAGNETIC, transparent: true,
            opacity: .92 * vis * emphasis });
          const headMat = new THREE.MeshBasicMaterial({ color: MAGNETIC, transparent: true,
            opacity: .95 * vis * emphasis });
          const headGeo = new THREE.ConeGeometry(.085, .26, 7);   // unit head; scaled by vis
          live.field = { lineMat, headMat, lines: [], heads: [], fullScaleA: b.fullScaleA, lastSign: dirSign };
          for (let q = 0; q < 4; q++) {
            const phi = (q / 4) * Math.PI * 2;
            const perp = up.clone().multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
            for (const fl of solved.fieldLines) {
              // ONLY A LINE THAT ACTUALLY CLOSED IS DRAWN CLOSED. Passing closed = true for
              // every line joined the two ends of a trace that stopped at the domain boundary
              // or ran into the conductor, inventing a segment the field never produced — and
              // undoing the model's explicit refusal to force closure.
              const isClosed = fl.stop === 'closed';
              // Decimation is LOSSY: a spline through fewer points is not the solved polyline.
              // The final point is always kept, or a trace that ended at the conductor would
              // be drawn ending somewhere else.
              const src = displayPolyline(fl.points, 160);
              const pts = src.map(([rM, zM]) =>
                centre.clone().addScaledVector(axis, zM * u).addScaledVector(perp, rM * u));
              if (pts.length < 4) continue;
              const loop = new THREE.CatmullRomCurve3(pts, isClosed);
              const lineMesh = new THREE.Mesh(
                new THREE.TubeGeometry(loop, Math.min(180, pts.length * 2), .028, 6, isClosed),
                lineMat);
              lineMesh.visible = vis > 0;
              lineMesh.name = 'field';     // framed by focusOnCoilAxis, not by the overview
              this.group.add(lineMesh);
              live.field.lines.push(lineMesh);
              for (const uu of [0.1, 0.6]) {
                const head = new THREE.Mesh(headGeo, headMat);
                head.position.copy(loop.getPointAt(uu));
                head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
                  loop.getTangentAt(uu).multiplyScalar(dirSign));
                head.scale.setScalar(Math.max(vis, 1e-6));
                head.visible = vis > 0;
                head.name = 'field';
                this.group.add(head);
                live.field.heads.push({ head, loop, uu });
              }
            }
          }
        }
        // ---- THE PICKUP LOOP. ---------------------------------------------------------
        //
        // Drawn in the COIL'S physical frame at its true separation and orientation, because
        // that pose is what sets the mutual inductance. It carries NO current: no flow cues,
        // no energy vessel, nothing that would suggest it takes anything from the circuit.
        // What it has is a voltage across its gap, and only while the current is changing.
        if (solved && solved.pickup) {
          const pk = solved.pickup;
          // NULL IS NOT ZERO. `known` gates every drawn consequence of the reading.
          const known = pk.terminalV !== null;
          const shown = pk.terminalV ?? 0;
          const centreP = centre.clone().addScaledVector(axis, pk.separationM * u);
          const rP = pk.radiusM * u;
          // 0° faces along the axis; 90° is edge-on; 180° faces the other way. The drawn
          // normal is the reference normal the sign convention is declared against.
          const normal = pk.orientationDeg === 90 ? up.clone()
            : axis.clone().multiplyScalar(pk.orientationDeg === 180 ? -1 : 1);
          // AN OPEN ARC WITH TWO VISIBLE ENDS, not a closed torus with a box in front of it.
          // A closed ring says current can circulate, which is the one thing this loop cannot
          // do; and the box that stood in for a gap only OBSCURED the mesh, so whether the gap
          // read at all depended on the camera. This is genuinely open geometry.
          const GAP = 0.30;                         // radians of arc actually removed
          const wireR = Math.max(.012, solved.wireRadiusM * u);
          const arc = new THREE.Mesh(
            new THREE.TorusGeometry(rP, wireR, 10, 96, Math.PI * 2 - GAP),
            new THREE.MeshStandardMaterial({ color: PICKUP, metalness: .7, roughness: .35 }));
          arc.position.copy(centreP);
          const spin = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1), normal.clone().normalize());
          // Rotate the gap to the top so both ends are visible rather than buried in the coil.
          const toTop = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), Math.PI / 2 + GAP / 2);
          arc.quaternion.copy(spin).multiply(toTop);
          this.group.add(arc);

          // THE SURFACE THE FLUX IS COUNTED THROUGH. Not decoration: it is the disc the
          // mutual inductance is integrated over, and its orientation is the reference normal
          // the sign convention is declared against. Drawing it makes the loop's facing
          // readable — turning it edge-on to the field is what takes the reading to zero — and
          // it gives the world-sign audit a rendered normal to check against, rather than an
          // assumed one. It was lost once in a block edit and the audit could not run.
          const face = new THREE.Mesh(
            new THREE.CircleGeometry(rP, 48),
            new THREE.MeshBasicMaterial({ color: PICKUP, transparent: true, opacity: .10,
              side: THREE.DoubleSide, depthWrite: false }));
          face.position.copy(centreP);
          face.quaternion.copy(spin);
          this.group.add(face);

          // THE TERMINAL PAIR, marked and polarised. The sign convention is declared against
          // the winding's END relative to its START, so those two ends have to be identifiable
          // in the picture or the declaration is unverifiable by eye.
          const inPlane = (ang: number) => {
            const v = new THREE.Vector3(Math.cos(ang) * rP, Math.sin(ang) * rP, 0);
            return v.applyQuaternion(arc.quaternion).add(centreP);
          };
          const endA = inPlane(Math.PI * 2 - GAP), endB = inPlane(0);
          const positiveIsB = shown >= 0;
          const beads: THREE.Mesh[] = [];
          for (const [pos, isPos] of [[endA, !positiveIsB], [endB, positiveIsB]] as const) {
            const bead = new THREE.Mesh(
              new THREE.SphereGeometry(wireR * 2.2, 12, 10),
              new THREE.MeshBasicMaterial({ color: isPos ? 0xffd9a0 : 0x6f8fa8 }));
            bead.position.copy(pos as THREE.Vector3);
            this.group.add(bead);
            beads.push(bead);
          }
          const signB = this.addLabel(!known || shown === 0 ? '±' : (positiveIsB ? '+' : '−'),
            endB.clone().addScaledVector(gapDirection(normal, axis, up), .18), 'pickup');
          const signA = this.addLabel(!known || shown === 0 ? '±' : (positiveIsB ? '−' : '+'),
            endA.clone().addScaledVector(gapDirection(normal, axis, up), .18), 'pickup');

          // A LOCAL MAGNIFIED DIFFERENTIAL INDICATOR. Tens of millivolts against a 10 V height
          // scale is invisible, so this bar has its OWN scale, stated in its label, and shows
          // the signed difference between the two terminals — never an absolute height, which
          // an isolated loop does not have.
          const full = Math.max(Math.abs(shown), 1e-12);
          const barMax = 1.1;
          // Unknown draws NO fill at all, rather than a bar sitting at zero.
          const frac = known ? Math.max(-1, Math.min(1, shown / (pk.indicatorFullScaleV || full))) : 0;
          const barBase = centreP.clone().addScaledVector(up, rP + .55);
          const track = new THREE.Mesh(
            new THREE.BoxGeometry(.055, barMax * 2, .055),
            new THREE.MeshBasicMaterial({ color: 0x2b4a44, transparent: true, opacity: .55 }));
          track.position.copy(barBase);
          this.group.add(track);
          // Unit height, scaled — so the fill follows the reading every frame on one mesh.
          const fill = new THREE.Mesh(
            new THREE.BoxGeometry(.085, 1, .085),
            new THREE.MeshBasicMaterial({ color: PICKUP }));
          {
            const h = Math.abs(frac) * barMax;
            fill.scale.y = Math.max(h, 1e-6);
            fill.visible = frac !== 0;
            fill.position.copy(barBase).addScaledVector(up, Math.sign(frac) * h / 2);
          }
          this.group.add(fill);
          // ONE LINE IN THE SCENE, three in the readouts. This printed the reading, the full
          // scale, the scale's caveat, the linked flux and the mutual inductance as a
          // three-line block floating over the circuit — five facts competing with the
          // components for the same space. None of them is removed: they are in the pickup
          // readout panel, which is where a number is read rather than glanced at. Label text
          // only; nothing about what is drawn or encoded changes.
          const pkLabel = this.addLabel(
            known ? `pickup ${fmtSi(shown, 'V')}` : 'pickup · not yet solved',
            barBase.clone().addScaledVector(up, barMax + .35), 'pickup');
          live.pickup = { beadA: beads[0], beadB: beads[1], signA, signB, fill,
            barBase: barBase.clone(), up: up.clone(), barMax, label: pkLabel };
        }
        // ONE flow, along the conductor, spanning the whole component.
        let flow: THREE.InstancedMesh | null = null;
        const routeLength = drawnPath.getLength();
        {   // always, for a component — see the resistor block
          // Cue count follows the TURNS, not a fixed spacing. A solved winding's path is
          // metres long in scene units — 20 turns of a 40 mm coil is about 100 units — so a
          // fixed .52 spacing put ~190 markers on it and buried the wire completely. A few
          // per turn keeps the transport readable and leaves the coil visible as a coil.
          const perTurn = 2.5;
          const n = solved
            ? Math.max(2, Math.round(turns * perTurn))
            : Math.max(2, Math.ceil(routeLength / .52));
          flow = new THREE.InstancedMesh(
            this.electronView ? this.electronGeo : this.rcMarkerGeo,
            new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }), n);
          flow.frustumCulled = false; this.group.add(flow);
        }
        this.branches.push({ kind: 'inductor', id: `${b.id}-flow`, label: b.label,
          fullScaleA: b.fullScaleA,
          xA: a.x, yA: a.y, zA: a.z, xB: z.x, yB: z.y, zB: z.z, current: b.current,
          markers: flow, electronCues: this.electronView,
          phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null, route: drawnPath, routeLength,
          // The solved winding is thin and the cues are larger than it, so they read as ON the
          // wire when centred on it. No lift is needed and any lift is visible as a gap.
          surfaceLift: solved ? 0 : undefined });
        live.componentLabels.set(b.id,
          this.addLabel(b.label, left.clone().lerp(right, .5).add(new THREE.Vector3(0, .85, 0)), 'component'));
        continue;
      }
      if (deck && b.kind === 'diode') {
        // THE BRANCH RUNS ANODE TO CATHODE, because that is the order the netlist places the
        // terminals in. So the cone below points the way the symbol points, and reversing the
        // device in the form reverses the drawn body — the arrow is not a second decision that
        // could drift from the circuit.
        const { a: a0, z: z0 } = chordOf(b);
        // The optional lane: the body and its carrier overlay move sideways; the legs leave the anchors.
        const laneOff = b.lane ? new THREE.Vector3(-(z0.z - a0.z), 0, z0.x - a0.x).normalize().multiplyScalar(b.lane) : new THREE.Vector3();
        const a = a0.clone().add(laneOff), z = z0.clone().add(laneOff);
        const axis = z.clone().sub(a).normalize();
        const left = a.clone().lerp(z, .30), right = a.clone().lerp(z, .70);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('diode', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.diode, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('diode', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR.diode, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        // One current overlay across the body, as the resistor does, so carriers do not stop
        // dead at the component and resume after it.
        let flow: THREE.InstancedMesh | null = null;
        {   // always, for a component — see the resistor block
          flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
            new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }),
            this.electronView ? Math.max(2, Math.ceil(a.distanceTo(z) / .30))
                              : Math.max(3, Math.floor(a.distanceTo(z) / .95)));
          flow.frustumCulled = false; this.group.add(flow);
        }
        this.branches.push({ kind: 'diode', id: `${b.id}-flow`, label: b.label,
          xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z, current: b.current,
          markers: flow, electronCues: this.electronView,
          phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        const body = new THREE.Group();
        body.position.copy(left).lerp(right, .5); body.position.y += .06;
        // The cone's own axis is +Y, so it is turned onto the anode→cathode direction.
        body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        this.group.add(body);
        live.bodies.set(b.id, [body]);
        // CONDUCTION IS A SEPARATE STATEMENT FROM BIAS. Brightness follows the solved current
        // against the run's own scale; it does NOT follow the sign of the terminal voltage. A
        // diode at +0.2 V is forward-biased and carrying picoamps, and lighting it up because
        // the voltage is positive would draw a conducting device that is doing nothing. Null
        // current — the unsolved reset — is drawn dark and labelled, not dark and unremarked.
        const share = b.current === null ? 0
          : Math.min(1, Math.abs(b.current) / Math.max(fullI, 1e-12));
        const lit = new THREE.MeshStandardMaterial({ color: 0xd9822b, metalness: .45,
          roughness: .35, emissive: 0xff9d3c, emissiveIntensity: share * share * 0.9 });
        const bar = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, metalness: .6, roughness: .3 });
        const len = left.distanceTo(right);
        // ILLUSTRATIVE DISPLAY GEOMETRY, AND ONLY THAT.
        //
        // The coil's and the plates' drawn geometry is DERIVED FROM their model dimensions —
        // through a stated scene scaling, and with the plate gap explicitly magnified (the
        // on-screen note says by how much). Not "drawn at real dimensions" flatly: Astra asked
        // for that qualification and it is the honest form of the claim.
        //
        // THE DIODE HAS NO DIMENSION IN THE MODEL AT ALL: it is IS, N, RS, BV and an
        // orientation, nothing with a length. So its drawn size is derived from nothing, encodes
        // nothing, and is chosen for legibility — which is why it can simply be made bigger. It
        // sits entirely within the lead span already allocated to it, so nothing else moves.
        // Rescaling the coil or the plates this way would break a derivation that exists; this
        // breaks none, and no readout reports a diode dimension anywhere.
        const cone = new THREE.Mesh(new THREE.ConeGeometry(.56, len * .72, 26), lit);
        cone.position.y = -len * .08;
        body.add(cone);
        live.diode = { cone, lit };
        // The cathode bar, at the cone's tip: the flat the symbol blocks against.
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .13, 26), bar);
        plate.position.y = len * .30;
        body.add(plate);
        // CLEAR OF THE BODY AND OF THE CURRENT PATH. The label rides above and toward the
        // viewer, so a taller body cannot grow into it and the carriers running along the branch
        // are not read through it.
        const lift = Math.abs(a.y - z.y) / 2 + 1.55;
        live.componentLabels.set(b.id, this.addLabel(b.label,
          a.clone().lerp(z, .5).add(new THREE.Vector3(0, lift, 0.9)), 'component'));
      } else if (spatialRC && b.kind === 'resistor') {
        const a=posOf.get(b.from)!, z=posOf.get(b.to)!;
        const axis=z.clone().sub(a).normalize();
        const left=a.clone().lerp(z,.22), right=a.clone().lerp(z,.78);
        // Physical leads end at the contacts; one separate current overlay spans the body. No bypass.
        posOf.set(`${b.id}-left`,left); posOf.set(`${b.id}-right`,right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('resistor',`${b.id}-in`,b.label,b.from,`${b.id}-left`,b.current,COLOUR.resistor,false);
        addBranch('resistor',`${b.id}-out`,b.label,`${b.id}-right`,b.to,b.current,COLOUR.resistor,false);
        // One carrier field (or alternate current overlay) crosses both contacts and body; no centre wire.
        // ALWAYS CREATED FOR A COMPONENT. `current === null` here means "not yet solved" — the
        // authored reset, before the trajectory exists — not "no current is computed for this
        // branch", which is what null means for an ideal wire in the generic path. A rebuild at
        // reset (every re-solve) used to leave this branch with no markers at all, and since the
        // update path never allocates, it could not show transport until the next full rebuild.
        // Found by fingerprinting the update path against a forced rebuild: two objects short,
        // both this branch's, at every instant after a rebuild-at-reset. render() hides them
        // while the current is unknown.
        let flow: THREE.InstancedMesh | null = null;
        {
          flow=new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
            new THREE.MeshBasicMaterial({color:this.electronView ? 0x89dbff : 0xd5fff2}),this.electronView ? Math.max(2,Math.ceil(a.distanceTo(z)/.30)) : Math.max(3,Math.floor(a.distanceTo(z)/.95)));
          flow.frustumCulled=false;this.group.add(flow);
        }
        this.branches.push({kind:'resistor',id:`${b.id}-flow`,label:b.label,
          xA:a.x,yA:a.y+.06,zA:a.z,xB:z.x,yB:z.y+.06,zB:z.z,current:b.current,
          markers:flow,electronCues:this.electronView,phase:previousPhases.get(`${b.id}-flow`) ?? 0,line:null});
        const length=left.distanceTo(right);
        const body=new THREE.Group();
        body.position.copy(left).lerp(right,.5); body.position.y+=.06;
        body.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),axis);
        this.group.add(body);
        live.bodies.set(b.id, [body]);
        const fraction=(b.current ?? 0)/fullI;
        const bronze=new THREE.MeshStandardMaterial({color:0x9c7350,metalness:.45,roughness:.4,
          emissive:0xc76b2d,emissiveIntensity:Math.min(1,fraction*fraction)*.65});
        live.resistor = { bronze };
        const box=(x:number,y:number,z:number,w:number,h:number,d:number) => {
          const part=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),bronze);
          part.position.set(x,y,z);body.add(part);
        };
        box(0,-.23,0,length,.10,.85);
        box(0,-.10,-.40,length,.25,.07);
        for(const x of [-length/2,length/2]) box(x,0,0,.14,.58,.85);
        const atoms=new THREE.InstancedMesh(new THREE.SphereGeometry(.065,10,8),
          new THREE.MeshStandardMaterial({color:0xe6b879,metalness:.4,roughness:.3}),24);
        atoms.frustumCulled=false;
        body.add(atoms);
        this.resistorInterior={atoms,length,fraction};
        // Clear the body, not just the midpoint. The resistor is TILTED — its ends sit at
        // different voltages, so it spans |a.y − z.y| vertically — and a fixed .7 lift left
        // the label lying across its own component whenever that drop was large.
        const lift = Math.abs(a.y - z.y) / 2 + .95;
        // The "· exposed interior" suffix belongs to the inspect view, not to every frame of
        // the circuit. Label text only.
        live.componentLabels.set(b.id,
          this.addLabel(b.label,a.clone().lerp(z,.5).add(new THREE.Vector3(0,lift,0)),'component'));
      } else if ((spatialRC || deck) && b.kind === 'load') {
        // THE LOAD IS A RESISTOR AND MUST LOOK LIKE ONE. (On an authored deck too: until the rail-layout kit's
        // renderer-correspondence check asked where the divider resistor's terminals were, a deck 'load' fell
        // through to a bare lane with no body at all — the sensors and controls benches drew their fixed and
        // series resistors as wires. Now every deck load is this banded body.)
        //
        // It was a plain tube with a label floating near it, so at a glance the branch read as a
        // wire — which is to say, as a short across the capacitor. It is the component that lets
        // the capacitor discharge while the diode blocks, and the reason these demonstrations
        // keep moving at all; it has to be identifiable as a part on its own branch.
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        // FURTHER DOWN THE BRANCH, past the plates. At 0.30–0.70 the body sat inside the
        // capacitor's projected outline: the plates extend well forward of the capacitor
        // terminal the branch leaves from, so "on its own branch" was not the same as "where it
        // can be seen". Leads remain visible at BOTH ends, which is what makes it read as a part
        // in a branch rather than a lump on a wire.
        const left = a.clone().lerp(z, .52), right = a.clone().lerp(z, .84);
        posOf.set(`${b.id}-l`, left); posOf.set(`${b.id}-r`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        // Lead overrides honoured like every other deck body (the rail kit's rendered-geometry check found this
        // body's ground lead drawn straight to the net's feed point, diagonally across the deck, because they were not).
        addBranch(b.kind, `${b.id}-in`, b.label, b.from, `${b.id}-l`, b.current, COLOUR.load, false, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch(b.kind, `${b.id}-out`, b.label, `${b.id}-r`, b.to, b.current, COLOUR.load, false, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        // One carrier overlay across the whole branch, as the series resistor has, so charge is
        // not seen to stop at the body and resume after it.
        let lflow: THREE.InstancedMesh | null = null;
        {   // always, for a component — see the resistor block
          lflow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
            new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }),
            this.electronView ? Math.max(2, Math.ceil(a.distanceTo(z) / .30))
                              : Math.max(3, Math.floor(a.distanceTo(z) / .95)));
          lflow.frustumCulled = false; this.group.add(lflow);
        }
        this.branches.push({ kind: 'load', id: `${b.id}-flow`, label: b.label,
          xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z, current: b.current,
          markers: lflow, electronCues: this.electronView,
          phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        // A banded body, in the resistor's own bronze so it is read as the same KIND of part as
        // the series resistor — a different one, on a different branch, doing the same job.
        const body = new THREE.Group();
        body.position.copy(left).lerp(right, .5); body.position.y += .06;
        body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        this.group.add(body);
        live.bodies.set(b.id, [body]);
        const len = left.distanceTo(right);
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, len * .82, 18),
          new THREE.MeshStandardMaterial({ color: 0x9c7350, metalness: .45, roughness: .45 }));
        body.add(shell);
        for (const [t, col] of [[-.22, 0x2b2f36], [0, 0xd8b45a], [.22, 0x2b2f36]] as const) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(.275, .275, len * .1, 18),
            new THREE.MeshStandardMaterial({ color: col, roughness: .6 }));
          band.position.y = t * len; body.add(band);
        }
        live.componentLabels.set(b.id,
          this.addLabel(b.label, body.position.clone().add(new THREE.Vector3(0, .70, 0.5)),
            'component'));
      } else if (deck && b.kind === 'mosfet') {
        // ---- THE TRANSISTOR: three terminals, drawn as three. ---------------------------
        // The drain→source run is the LOAD path and carries `current` (the drain current in, the
        // SOURCE current out — they differ while the gate charges, and the spec states which leg
        // is which). The gate pin is its own short lead from the gate node's anchor to the
        // package, carrying `gateCurrent` on its own printed scale: microamps for a microsecond
        // against half an amp, and the two must not share a ruler or the control path vanishes.
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        const left = a.clone().lerp(z, .32), right = a.clone().lerp(z, .68);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('mosfet', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.mosfet, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('mosfet', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.sourceCurrent ?? b.current, COLOUR.mosfet, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }),
          this.electronView ? Math.max(2, Math.ceil(a.distanceTo(z) / .30)) : Math.max(3, Math.floor(a.distanceTo(z) / .95)));
        flow.frustumCulled = false; this.group.add(flow);
        this.branches.push({ kind: 'mosfet', id: `${b.id}-flow`, label: b.label,
          xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z, current: b.current,
          markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        // ILLUSTRATIVE PACKAGE GEOMETRY. The model has W and L for the channel and nothing else
        // with a size; the drawn body is chosen for legibility and encodes nothing, as the diode's.
        const body = new THREE.Group();
        body.position.copy(left).lerp(right, .5); body.position.y += .06;
        body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        this.group.add(body);
        const len = left.distanceTo(right);
        // NO HEAT TINT. A first version glowed the package with drain-terminal power, and even
        // with the disclaimer on the label a glowing package reads as "hot" — which the model
        // does not know (Astra). The number stays in the readouts; the body stays dark.
        const pkg = new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: .25, roughness: .55 });
        const slab = new THREE.Mesh(new THREE.BoxGeometry(1.15, len * .78, .55), pkg);
        body.add(slab);
        const tab = new THREE.Mesh(new THREE.BoxGeometry(1.15, len * .78, .08),
          new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .8, roughness: .3 }));
        tab.position.z = -.31; body.add(tab);
        live.bodies.set(b.id, [slab, tab]);   // the PACKAGE is the obstacle; the pins below are attachment points
        live.mosfet = { pkg };
        // THREE PINS, NAMED ON THE BODY: drain at the drain end, source at the source end, gate
        // in the middle toward the viewer where its lead arrives. The letters are small axis-style
        // tags, not pills, so they mark the terminals without covering them.
        body.updateMatrixWorld(true);
        for (const [pinName, tt] of [['D', -.36], ['G', 0], ['S', .36]] as const) {
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .5, 8),
            new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .8, roughness: .3 }));
          pin.position.set(0, tt * len, .45); pin.rotation.x = Math.PI / 2; body.add(pin);
          this.addLabel(pinName, body.localToWorld(new THREE.Vector3(0, tt * len, .95)), 'axis pin');
        }
        // THE GATE PIN LEAD, from the gate node's anchor to the package, on its own scale.
        if (b.gateTerrace && posOf.has(b.gateTerrace)) {
          const gAnchor0 = posOf.get(b.gateTerrace)!;
          const gAnchor = b.gateFrom ? new THREE.Vector3(b.gateFrom[0], gAnchor0.y, b.gateFrom[1]) : gAnchor0;
          const pinEnd = body.position.clone().add(new THREE.Vector3(0, 0, .7));
          live.terminals.set(b.id, { ...(live.terminals.get(b.id) ?? {}), gate: pinEnd.clone() });
          cable(gAnchor, pinEnd, COLOUR.gate, 0, `${b.id}-gate`, b.gateCurrent ?? null, b.gateFullScaleA, .45, b.gateLift ?? 0);
        }
        live.componentLabels.set(b.id, this.addLabel(b.label,
          body.position.clone().add(new THREE.Vector3(0, 0.95, -0.9)), 'component'));
      } else if (deck && b.kind === 'lamp') {
        // ---- THE LAMP: a resistive indicator whose GLOW is its dissipation. -------------
        // Brightness = power / fullPower, and `fullPower` is whatever the page declares — the
        // ideal Vdd²/R here, stated on the label. Linear in power, no perceptual curve, no lumens.
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        const left = a.clone().lerp(z, .30), right = a.clone().lerp(z, .70);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('lamp', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.lamp, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('lamp', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR.lamp, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }),
          this.electronView ? Math.max(2, Math.ceil(a.distanceTo(z) / .30)) : Math.max(3, Math.floor(a.distanceTo(z) / .95)));
        flow.frustumCulled = false; this.group.add(flow);
        this.branches.push({ kind: 'lamp', id: `${b.id}-flow`, label: b.label,
          xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z, current: b.current,
          markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        const centre = left.clone().lerp(right, .5); centre.y += .06;
        const bright = b.power !== null && b.power !== undefined && b.fullPower
          ? Math.min(1, Math.max(0, b.power / b.fullPower)) : 0;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, left.distanceTo(right) * .9, 16),
          new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: .7, roughness: .35 }));
        base.position.copy(centre); base.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        this.group.add(base);
        const filament = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: .6,
          emissive: 0xffb347, emissiveIntensity: bright * 6 });
        const glass = new THREE.MeshStandardMaterial({ color: 0xfff3d6, transparent: true,
          opacity: .28 + .22 * bright, roughness: .15, metalness: .05, emissive: 0xffc25e,
          emissiveIntensity: bright * .9, depthWrite: false });
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(.8, 28, 20), glass);
        bulb.position.copy(centre).add(new THREE.Vector3(0, .8, 0));
        bulb.castShadow = false;
        this.group.add(bulb);
        const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(.22, .034, 60, 8, 2, 5), filament);
        coil.position.copy(bulb.position); this.group.add(coil);
        // The glow is a real light on the bench — a lit lamp lights what is near it. No shadow
        // from it: one shadow pass is the budget, and it belongs to the key light.
        const glow = new THREE.PointLight(0xffc25e, bright * 6, 9, 2);
        glow.position.copy(bulb.position); this.group.add(glow);
        live.lamp = { filament, glass, glow };
        live.componentLabels.set(b.id, this.addLabel(b.label,
          bulb.position.clone().add(new THREE.Vector3(0, 1.25, -0.6)), 'component'));
      } else if (deck && b.kind === 'switch') {
        // ---- THE SWITCH: an explicitly ideal switch, drawn as a lever. ---------------------
        // Closed lies along the run; open lifts the far end. The state comes from the solved
        // control programme (`closed`), the current through it from the trajectory. It carries
        // NO transistor iconography: it is the named ideal switch, not the MOSFET.
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        const left = a.clone().lerp(z, .28), right = a.clone().lerp(z, .72);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('switch', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.switch, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('switch', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR.switch, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }),
          this.electronView ? Math.max(2, Math.ceil(a.distanceTo(z) / .30)) : Math.max(3, Math.floor(a.distanceTo(z) / .95)));
        flow.frustumCulled = false; this.group.add(flow);
        this.branches.push({ kind: 'switch', id: `${b.id}-flow`, label: b.label,
          xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z, current: b.current,
          markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        const len = left.distanceTo(right);
        for (const end of [left, right]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .5, 12),
            new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .8, roughness: .3 }));
          post.position.copy(end).add(new THREE.Vector3(0, .25, 0)); this.group.add(post);
        }
        const lever = new THREE.Mesh(new THREE.BoxGeometry(len, .09, .22),
          new THREE.MeshStandardMaterial({ color: 0x8a5a2b, metalness: .5, roughness: .4 }));
        const pivot = new THREE.Group(); pivot.position.copy(left).add(new THREE.Vector3(0, .5, 0));
        const closedQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
        const openQuat = closedQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.55));
        lever.position.set(len / 2, 0, 0); pivot.add(lever); this.group.add(pivot);
        pivot.quaternion.copy(b.closed ? closedQuat : openQuat);
        const lampMat = new THREE.MeshStandardMaterial({ color: 0x556270, emissive: 0x7fe3c0, emissiveIntensity: b.closed ? .9 : 0 });
        const tell = new THREE.Mesh(new THREE.SphereGeometry(.1, 10, 8), lampMat);
        tell.position.copy(left).add(new THREE.Vector3(0, .9, 0)); this.group.add(tell);
        live.switch = { lever: pivot as unknown as THREE.Mesh, closedQuat, openQuat, lamp: lampMat };
        live.componentLabels.set(b.id, this.addLabel(b.label, left.clone().lerp(right, .5).add(new THREE.Vector3(0, 1.3, -0.5)), 'component'));
      } else if (deck && b.kind === 'motor') {
        // ---- THE MOTOR: a can whose AXIS POINTS AT THE VIEWER, so its shaft and the pinion on
        // it are seen face-on and the rotation is visible. The electrical lane runs along the deck
        // into two side posts; the shaft leaves the front face toward the mechanism. The back-EMF
        // is an internal model quantity (K·ω), not a terminal voltage: it is not a terrace on the
        // shared ruler but a bar inside the can, against its own stated full scale.
        const { a, z } = chordOf(b);
        const left = a.clone().lerp(z, .26), right = a.clone().lerp(z, .74);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('motor', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.motor, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('motor', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR.motor, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }),
          this.electronView ? Math.max(2, Math.ceil(a.distanceTo(z) / .30)) : Math.max(3, Math.floor(a.distanceTo(z) / .95)));
        flow.frustumCulled = false; this.group.add(flow);
        this.branches.push({ kind: 'motor', id: `${b.id}-flow`, label: b.label,
          xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z, current: b.current,
          markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        const mid = left.clone().lerp(right, .5);
        const mount = b.mountHeight ?? 0;
        const R = .62, LEN = 1.5, axisY = mid.y + .06 + R + mount;
        if (mount > 0) {   // THE MOUNT: a block under the can, as tall as the raise; the posts climb past it
          const block = new THREE.Mesh(new THREE.BoxGeometry(LEN * .9, mount, R * 1.3), new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: .5, roughness: .5 }));
          block.position.set(mid.x, mid.y + .06 + mount / 2, mid.z); this.group.add(block);
        }
        const centre = new THREE.Vector3(mid.x, axisY, mid.z);
        const metal = new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 });
        const can = new THREE.Mesh(new THREE.CylinderGeometry(R, R, LEN, 32, 1, true),
          new THREE.MeshStandardMaterial({ color: 0x5b6b7a, metalness: .6, roughness: .35, transparent: true, opacity: .55, side: THREE.DoubleSide }));
        can.position.copy(centre); can.rotation.x = Math.PI / 2; this.group.add(can);
        live.bodies.set(b.id, [can]);
        const endcap = new THREE.Mesh(new THREE.CylinderGeometry(R, R, .06, 32), new THREE.MeshStandardMaterial({ color: 0x46545f, metalness: .6, roughness: .4 }));
        endcap.position.copy(centre).add(new THREE.Vector3(0, 0, -LEN / 2)); endcap.rotation.x = Math.PI / 2; this.group.add(endcap);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, LEN * .96, 24),
          new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: .75, roughness: .3 }));
        core.position.copy(centre); core.rotation.x = Math.PI / 2; this.group.add(core);
        for (const p of [left, right]) {   // side posts: the lane's ends climb into the can (past the mount when there is one)
          const post = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, R + .1 + mount, 10), metal);
          post.position.set(p.x, mid.y + .06 + (R + .1 + mount) / 2, p.z); this.group.add(post);
        }
        // The shaft leaves the FRONT face toward the viewer; the mechanism block continues it.
        const shaftExit = centre.clone().add(new THREE.Vector3(0, 0, LEN / 2));
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .5, 12), metal);
        stub.position.copy(shaftExit).add(new THREE.Vector3(0, 0, .25)); stub.rotation.x = Math.PI / 2; this.group.add(stub);
        // The back-EMF bar: unit height, scaled, standing inside the can beside the core.
        const barMax = R * 1.5;
        const barMat = new THREE.MeshStandardMaterial({ color: 0x6b45d6, emissive: 0x6b45d6, emissiveIntensity: .35, roughness: .4 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(.14, 1, .14), barMat);
        const base = centre.clone().add(new THREE.Vector3(R * .55, -R * .75, .2));
        const bemf = b.backEmfVolts ?? 0, full = Math.max(b.backEmfFullVolts ?? 1, 1e-9);
        const bh = Math.min(1, Math.max(0, bemf / full)) * barMax;
        bar.scale.y = Math.max(bh, 1e-6); bar.visible = bh > 0; bar.position.copy(base).add(new THREE.Vector3(0, bh / 2, 0));
        this.group.add(bar);
        live.motor = { bar, barMat, barMax, base, shaftExit };
        live.terminals.set(b.id, { ...(live.terminals.get(b.id) ?? {}), shaft: shaftExit.clone() });
        live.componentLabels.set(b.id, this.addLabel(b.label, centre.clone().add(new THREE.Vector3(0, R + .75, -0.3)), 'component'));
      } else if (deck && b.kind === 'pot') {
        // ---- THE POTENTIOMETER: a resistive track from A to B with a wiper you can see. --------
        // The wiper sits at fraction f along the track (0 at A, 1 at B) and its lead leaves
        // toward the wiper terrace; the knob turns with f. Both legs carry their own solved
        // current (the A leg is `current`, the B leg `legBCurrent`), so the loaded divider is
        // drawn as what it is: two resistors with different currents, not a fixed ratio.
        const { a: a0, z: z0 } = chordOf(b);
        const laneOff = b.lane ? new THREE.Vector3(-(z0.z - a0.z), 0, z0.x - a0.x).normalize().multiplyScalar(b.lane) : new THREE.Vector3();
        const a = a0.clone().add(laneOff), z = z0.clone().add(laneOff);
        const axis = z.clone().sub(a).normalize();
        const trackA = a.clone().lerp(z, .18), trackB = a.clone().lerp(z, .82);
        const f = Math.min(1, Math.max(0, b.wiperFraction ?? 0.5));
        const wiperPt = trackA.clone().lerp(trackB, f);
        posOf.set(`${b.id}-a`, trackA); posOf.set(`${b.id}-b`, trackB); posOf.set(`${b.id}-w`, wiperPt);
        live.terminals.set(b.id, { a: trackA.clone(), b: trackB.clone(), w: wiperPt.clone().add(new THREE.Vector3(0, .6, 0)) });   // the wiper's lead leaves 0.6 above the contact
        addBranch('pot', `${b.id}-in`, b.label, b.from, `${b.id}-a`, b.current, COLOUR.pot, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('pot', `${b.id}-out`, b.label, `${b.id}-b`, b.to, b.legBCurrent ?? null, COLOUR.pot, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        // Two carrier overlays, one per leg, each with its own current.
        for (const [suffix, from, to, cur] of [['-legA', trackA, wiperPt, b.current], ['-legB', wiperPt, trackB, b.legBCurrent ?? null]] as const) {
          const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
            new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }), 8);
          flow.frustumCulled = false; this.group.add(flow);
          this.branches.push({ kind: 'pot', id: `${b.id}${suffix}`, label: b.label, xA: from.x, yA: from.y + .12, zA: from.z, xB: to.x, yB: to.y + .12, zB: to.z,
            current: cur, markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}${suffix}`) ?? 0, line: null });
        }
        const len = trackA.distanceTo(trackB);
        const track = new THREE.Mesh(new THREE.BoxGeometry(len, .14, .36), new THREE.MeshStandardMaterial({ color: 0x9c7350, metalness: .3, roughness: .6 }));
        track.position.copy(trackA).lerp(trackB, .5).add(new THREE.Vector3(0, .07, 0));
        track.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis); this.group.add(track);
        const wiper = new THREE.Group(); wiper.position.copy(wiperPt); this.group.add(wiper);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(.12, .5, .12), new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 }));
        arm.position.y = .38; wiper.add(arm);
        const contact = new THREE.Mesh(new THREE.SphereGeometry(.1, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffd39a, metalness: .6, roughness: .3 }));
        contact.position.y = .16; wiper.add(contact);
        // The knob: a dial beside the track whose angle IS f (0 → 270°), turned by the same value.
        const knob = new THREE.Group(); const knobAxis = new THREE.Vector3(0, 0, 1);
        knob.position.copy(trackA).lerp(trackB, .5).add(new THREE.Vector3(0, .9, -.9)); this.group.add(knob);
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .22, 32), new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: .3, roughness: .5 }));
        dial.rotation.x = Math.PI / 2; knob.add(dial);
        live.bodies.set(b.id, [track, dial]);   // the track and the knob are obstacles; the wiper arm is the wiper pin's post
        const pointer = new THREE.Mesh(new THREE.BoxGeometry(.06, .36, .06), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5 }));
        pointer.position.set(0, .2, .14); knob.add(pointer);
        knob.rotation.z = -f * 1.5 * Math.PI + 0.75 * Math.PI;   // pointer sweeps clockwise from A (upper-left) to B (upper-right)
        // The wiper lead to the wiper terrace, carrying the wiper current.
        if (b.wiperTerrace && posOf.has(b.wiperTerrace)) {
          cable(wiperPt.clone().add(new THREE.Vector3(0, .6, 0)), posOf.get(b.wiperTerrace)!, COLOUR.pot, b.wiperSide ?? 0, `${b.id}-wiper`, b.wiperCurrent ?? null, undefined, b.wiperSide ? 0 : .9);
        }
        live.pot = { wiper, knob, trackA, trackB, knobAxis };
        live.componentLabels.set(b.id, this.addLabel(b.label, track.position.clone().add(new THREE.Vector3(0, 1.6, -0.9)), 'component'));
      } else if (deck && b.kind === 'led') {
        // ---- THE LED: a small dome lit by its emission drive. ----------------------------------
        // `emission` is max(I, 0) / I_max, linear INPUT intensity to the material and the point
        // light; no photometric claim, no floor: zero current is zero light.
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        const left = a.clone().lerp(z, .34), right = a.clone().lerp(z, .66);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('led', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.led, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('led', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR.led, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }), Math.max(3, Math.floor(a.distanceTo(z) / .95)));
        flow.frustumCulled = false; this.group.add(flow);
        this.branches.push({ kind: 'led', id: `${b.id}-flow`, label: b.label, xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z,
          current: b.current, markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        const centre = left.clone().lerp(right, .5); centre.y += .06;
        const em = Math.min(1, Math.max(0, b.emission ?? 0));
        const dome = new THREE.MeshStandardMaterial({ color: 0xd9433a, transparent: true, opacity: .75, roughness: .25, emissive: 0xff3b2e, emissiveIntensity: em * 4 });
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(.34, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2), dome);
        bulb.position.copy(centre).add(new THREE.Vector3(0, .3, 0)); this.group.add(bulb);
        const flat = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .3, 24), new THREE.MeshStandardMaterial({ color: 0xb8352c, roughness: .4 }));
        flat.position.copy(centre).add(new THREE.Vector3(0, .15, 0)); this.group.add(flat);
        for (const p of [left, right]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .3, 8), new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 }));
          leg.position.copy(p).lerp(centre, .5).add(new THREE.Vector3(0, .1, 0)); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis); this.group.add(leg);
        }
        // The cathode's flat: marks orientation, as a real LED's rim does. On the `to` side.
        const mark = new THREE.Mesh(new THREE.BoxGeometry(.06, .3, .4), new THREE.MeshStandardMaterial({ color: 0x5a1d18, roughness: .5 }));
        mark.position.copy(centre).addScaledVector(axis, .35).add(new THREE.Vector3(0, .15, 0)); mark.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis); this.group.add(mark);
        const glow = new THREE.PointLight(0xff4a3c, em * 3, 6, 2); glow.position.copy(bulb.position); this.group.add(glow);
        live.led = { dome, glow };
        live.componentLabels.set(b.id, this.addLabel(b.label, bulb.position.clone().add(new THREE.Vector3(0, .9, -0.4)), 'component'));
      } else if (deck && b.kind === 'sensor' && b.sensor) {
        // ---- A SENSOR: a resistive body whose value follows a PRESCRIBED environment. ---------
        // The cue beside it — a sun for the LDR, a thermometer bar for the NTC — shows that
        // prescribed input at the same playback instant. It is NOT light or heat rendered onto the
        // sensor: no feedback exists in the model, and the drawing must not suggest one.
        const { a, z } = chordOf(b);
        const axis = z.clone().sub(a).normalize();
        const left = a.clone().lerp(z, .3), right = a.clone().lerp(z, .7);
        posOf.set(`${b.id}-left`, left); posOf.set(`${b.id}-right`, right);
        live.terminals.set(b.id, mainTerminals(b.kind, left, right));
        addBranch('sensor', `${b.id}-in`, b.label, b.from, `${b.id}-left`, b.current, COLOUR.sensor, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        addBranch('sensor', `${b.id}-out`, b.label, `${b.id}-right`, b.to, b.current, COLOUR.sensor, !!b.bodyAt, undefined, b.leadRoutes?.out, undefined, b.leadTo);
        const flow = new THREE.InstancedMesh(this.electronView ? this.electronGeo : this.rcMarkerGeo,
          new THREE.MeshBasicMaterial({ color: this.electronView ? 0x89dbff : 0xd5fff2 }), Math.max(3, Math.floor(a.distanceTo(z) / .95)));
        flow.frustumCulled = false; this.group.add(flow);
        this.branches.push({ kind: 'sensor', id: `${b.id}-flow`, label: b.label, xA: a.x, yA: a.y + .06, zA: a.z, xB: z.x, yB: z.y + .06, zB: z.z,
          current: b.current, markers: flow, electronCues: this.electronView, phase: previousPhases.get(`${b.id}-flow`) ?? 0, line: null });
        const centre = left.clone().lerp(right, .5); centre.y += .06;
        const frac = b.sensor.environmentFraction ?? 0;
        let cue: THREE.MeshStandardMaterial, cueLight: THREE.PointLight | null = null, bar: THREE.Mesh | null = null;
        const barBase = centre.clone().add(new THREE.Vector3(0, .2, -1.4)), barMax = 1.4;
        if (b.sensor.kind === 'ldr') {
          // A photoresistor: a flat disc with a serpentine track, facing up.
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .12, 28), new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: .5 }));
          disc.position.copy(centre).add(new THREE.Vector3(0, .1, 0)); this.group.add(disc);
          live.bodies.set(b.id, [disc]);
          for (let k = -2; k <= 2; k++) {
            const seg = new THREE.Mesh(new THREE.BoxGeometry(.6, .03, .06), new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: .6 }));
            seg.position.copy(centre).add(new THREE.Vector3(0, .17, k * .13)); seg.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis); this.group.add(seg);
          }
          // The sun: the prescribed illuminance, as its emissive intensity and a point light.
          cue = new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc23a, emissiveIntensity: frac * 5, roughness: .4 });
          const sun = new THREE.Mesh(new THREE.SphereGeometry(.38, 20, 16), cue);
          sun.position.copy(centre).add(new THREE.Vector3(0, 1.9, -1.2)); sun.castShadow = false; this.group.add(sun);
          cueLight = new THREE.PointLight(0xffd27a, frac * 4, 7, 2); cueLight.position.copy(sun.position); this.group.add(cueLight);
        } else {
          // An NTC bead on two leads, with a thermometer bar for the prescribed temperature.
          const bead = new THREE.Mesh(new THREE.SphereGeometry(.28, 18, 14), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: .5 }));
          bead.position.copy(centre).add(new THREE.Vector3(0, .3, 0)); this.group.add(bead);
          live.bodies.set(b.id, [bead]);
          for (const p of [left, right]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .45, 8), new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 }));
            leg.position.copy(p).lerp(bead.position, .5); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bead.position.clone().sub(p).normalize()); this.group.add(leg);
          }
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, barMax + .3, 14, 1, true),
            new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .35, roughness: .2, side: THREE.DoubleSide }));
          tube.position.copy(barBase).add(new THREE.Vector3(0, (barMax + .3) / 2, 0)); this.group.add(tube);
          cue = new THREE.MeshStandardMaterial({ color: 0xd9433a, emissive: 0xd9433a, emissiveIntensity: .3, roughness: .4 });
          bar = new THREE.Mesh(new THREE.BoxGeometry(.14, 1, .14), cue);
          const h = Math.max(frac, 0) * barMax; bar.scale.y = Math.max(h, 1e-6); bar.visible = h > 0; bar.position.copy(barBase).add(new THREE.Vector3(0, h / 2, 0));
          this.group.add(bar);
        }
        live.sensor = { cue, cueLight, bar, barBase, barMax };
        live.componentLabels.set(b.id, this.addLabel(b.label, centre.clone().add(new THREE.Vector3(0, 1.1, 0.9)), 'component'));
      } else if (deck && b.kind === 'comparator') {
        // ---- THE COMPARATOR: a triangle with + (from), − (ref) and OUT (to); powered from Vcc.
        // The decision is the solver's (`high`); the body shows it as an output lamp only.
        const { a, z } = chordOf(b);
        const centre = a.clone().lerp(z, .5); centre.y += .06;
        const axis = z.clone().sub(a).normalize();
        const body = new THREE.MeshStandardMaterial({ color: 0x4a6b8a, metalness: .3, roughness: .5 });
        const tri = new THREE.Mesh(new THREE.CylinderGeometry(0, .9, .3, 3), body);
        tri.position.copy(centre).add(new THREE.Vector3(0, .15, 0));
        tri.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis); tri.rotateY(Math.PI / 2);
        this.group.add(tri);
        live.bodies.set(b.id, [tri]);
        // Pins are placed BEFORE the leads are drawn to them (the first cut drew the input lead to a
        // pin that did not exist yet and the scene threw on a missing anchor).
        posOf.set(`${b.id}-tip`, centre.clone().addScaledVector(axis, -.7));
        posOf.set(`${b.id}-outp`, centre.clone().addScaledVector(axis, .5));
        live.terminals.set(b.id, { inp: centre.clone().addScaledVector(axis, -.7), out: centre.clone().addScaledVector(axis, .5), inn: centre.clone().addScaledVector(axis, -.7).add(new THREE.Vector3(0, 0, .5)), vcc: centre.clone().add(new THREE.Vector3(0, .4, 0)), gnd: centre.clone().add(new THREE.Vector3(0, .12, -.4)) });
        addBranch('comparator', `${b.id}-in`, b.label, b.from, `${b.id}-tip`, null, COLOUR.comparator, !!b.bodyAt, undefined, b.leadRoutes?.in, b.leadFrom);
        // Three terminals, three currents: the output lead, the Vcc cable and (when a ground terrace is named)
        // the return lead each carry their own figure; each falls back to `current` for callers that give one.
        addBranch('comparator', `${b.id}-out`, b.label, `${b.id}-outp`, b.to, b.outputCurrent ?? b.current, COLOUR.comparator, !!b.bodyAt, b.fullScaleA, b.leadRoutes?.out, undefined, b.leadTo);
        const over = (p: [number, number] | undefined, base: THREE.Vector3): THREE.Vector3 => p ? new THREE.Vector3(p[0], base.y, p[1]) : base;
        if (b.refTerrace && posOf.has(b.refTerrace))
          cable(over(b.refFrom, posOf.get(b.refTerrace)!), centre.clone().addScaledVector(axis, -.7).add(new THREE.Vector3(0, 0, .5)), COLOUR.pot, 0, `${b.id}-ref`, null, undefined, .9, b.refLift ?? 0);
        if (b.supplyTerrace && posOf.has(b.supplyTerrace))
          cable(over(b.supplyFrom, posOf.get(b.supplyTerrace)!), centre.clone().add(new THREE.Vector3(0, .4, 0)), COLOUR.source, 0, `${b.id}-vcc`, b.supplyCurrent ?? b.current, b.fullScaleA, b.supplyFrom ? 0 : -1.2, b.supplyLift ?? 0);
        if (b.groundTerrace && posOf.has(b.groundTerrace))
          cable(centre.clone().add(new THREE.Vector3(0, .12, -.4)), over(b.groundTo, posOf.get(b.groundTerrace)!), COLOUR.wire, 0, `${b.id}-gnd`, b.groundCurrent ?? null, b.fullScaleA, b.groundTo ? 0 : -.9, b.groundLift ?? 0);
        const outLamp = new THREE.MeshStandardMaterial({ color: 0x556270, emissive: 0x7fe3c0, emissiveIntensity: b.high ? .9 : 0 });
        const tell = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), outLamp);
        tell.position.copy(centre).add(new THREE.Vector3(0, .5, .35)); this.group.add(tell);
        for (const [name, off] of [['+', new THREE.Vector3(0, .35, -.35)], ['−', new THREE.Vector3(0, .35, .35)]] as const)
          this.addLabel(name, centre.clone().addScaledVector(axis, -.55).add(off), 'axis pin');
        live.comparator = { body, outLamp };
        live.componentLabels.set(b.id, this.addLabel(b.label, centre.clone().add(new THREE.Vector3(0, 1.2, -0.6)), 'component'));
      } else if (anchored && b.kind === 'source') {
        // A SOURCE ON THE AUTHORED DECK: the run's tube, plus a small box body at its midpoint so
        // it reads as a supply rather than a bare wire. (The RC page draws its own source body.)
        // ROUTED BEHIND THE DECK when both ends sit on it: a straight tube from ground to the
        // supply would run through the switch and the motor. The bow is layout, encodes nothing.
        const { a, z } = chordOf(b);
        const mid = a.clone().lerp(z, .5);
        if (Math.abs(a.y - z.y) < 1e-6 && Math.abs(a.z - z.z) < 1e-6) {
          cable(a, z, COLOUR.source, 0, b.id, b.current, b.fullScaleA, -2.4);
          mid.z -= 2.4 * 1.55;
        } else addBranch('source', b.id, b.label, b.from, b.to, b.current, COLOUR.source, true, b.fullScaleA);
        const box = new THREE.Mesh(new THREE.BoxGeometry(.9, .9, .7),
          new THREE.MeshStandardMaterial({ color: 0x4d6b7a, metalness: .45, roughness: .32 }));
        box.position.copy(mid); this.group.add(box);
        const face = new THREE.Mesh(new THREE.BoxGeometry(.6, .3, .04),
          new THREE.MeshStandardMaterial({ color: 0x79c8b3, emissive: 0x234c3b, emissiveIntensity: .5 }));
        face.position.copy(mid).add(new THREE.Vector3(0, .1, .37)); this.group.add(face);
        live.componentLabels.set(b.id, this.addLabel(b.label, mid.clone().add(new THREE.Vector3(0, .95, 0)), 'component'));
      } else if (deck && b.kind === 'gate') {
        addBranch('gate', b.id, b.label, b.from, b.to, b.current, COLOUR.gate, true, b.fullScaleA);
        live.componentLabels.set(b.id, this.addLabel(b.label,
          posOf.get(b.from)!.clone().lerp(posOf.get(b.to)!, .5).add(new THREE.Vector3(0, .6, 0)), 'component'));
      } else {
        addBranch(b.kind, b.id, b.label, b.from, b.to, b.current, COLOUR[b.kind], true, b.fullScaleA);
      }
    }

    // ---- STORES. A vessel between two terraces, filled to its stored fraction. ---
    // A GAUGE OF FIXED DIMENSIONS, anchored beside its terrace.
    //
    // My first version sized the shell to |yTop - yBot|, and its comment claimed it
    // was constant. Both were wrong, and Astra found what that cost: a fill FRACTION
    // (quadratic in V) times a height PROPORTIONAL TO |V| makes the filled VOLUME go
    // as |V|^3, silently encoding a second voltage factor into a gauge that is
    // supposed to show energy. Worse, with a negative Vc the shell was centred
    // between the terraces while the fill grew upward from the ground terrace, so
    // the fill left the vessel entirely.
    //
    // The gauge is now a FIXED-SIZE vessel whose only variable is its fill fraction.
    // It is independent of terrace separation, so nothing about the height axis can
    // leak into it. Zero shows as ZERO visible fill, with no floor.
    //
    // IN THE SPATIAL SCENE THE VESSELS STAND IN A ROW ON A COMMON BASELINE.
    //
    // They used to be skipped here entirely, so the one thing this experiment exists to show
    // — energy handed between the electric and the magnetic store — was visible only as
    // numbers in a collapsed panel far below the scene.
    //
    // They are NOT anchored to their terraces here. A terrace anchor puts each vessel at its
    // own voltage-dependent height, so both baselines move while both fills move, and the
    // seesaw is unreadable. On one baseline, sharing one joule scale, the exchange is the
    // only thing moving: one empties as the other fills.
    const SPATIAL_STORE_X: Record<string, number> = { 'rc-store': 6.7, 'rlc-magnetic': 7.7, 'rc-thermal': 8.7 };
    // Kept on the node plane. Moving the row toward the camera to dodge the lead also moved
    // it down and out of frame, so the row clears the lead by standing further right instead.
    const SPATIAL_STORE_Z = -1.2;
    for (const st of (spec.drawStores === false ? [] : spec.stores ?? [])) {
      const pTop = posOf.get(st.terrace), pBot = posOf.get(st.base);
      if (anchored && st.anchor) {
        // AUTHORED-DECK VESSELS: where the page puts them, on the deck baseline, with a UNIT-
        // HEIGHT fill scaled per frame so the fast path can move them without a rebuild.
        const cx = st.anchor.x, cz = st.anchor.z, yBase = 0;
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(GAUGE_R, GAUGE_R, GAUGE_H, 22, 1, true),
          new THREE.MeshStandardMaterial({ color: st.colour ?? 0xd8a657, transparent: true, opacity: 0.16, roughness: 0.6, side: THREE.DoubleSide }));
        shell.position.set(cx, yBase + GAUGE_H / 2, cz); this.group.add(shell);
        const reading = st.quantity ? gaugeReading(st.quantity) : null;
        const f = reading ? reading.fill : Math.min(1, Math.max(0, st.fill ?? 0));
        const fh = f * GAUGE_H;
        const fill = new THREE.Mesh(new THREE.CylinderGeometry(GAUGE_R * 0.94, GAUGE_R * 0.94, 1, 22),
          new THREE.MeshStandardMaterial({ color: st.colour ?? 0xd8a657, roughness: 0.4, metalness: 0.05, emissive: st.colour ?? 0xd8a657, emissiveIntensity: 0.25 }));
        fill.scale.y = Math.max(fh, 1e-6); fill.visible = fh > 0; fill.position.set(cx, yBase + fh / 2, cz);
        this.group.add(fill);
        this.stores.push({ spec: st, mesh: fill, shell });
        const label = this.addLabel(st.labelMode === 'identifier' ? st.label : `${st.label}\n${reading?.text ?? ''}\n${st.readout}`,
          new THREE.Vector3(cx, yBase + GAUGE_H + 0.3, cz), 'store');
        live.stores.set(st.id, { fill, label, yBase });
        continue;
      }
      if (!spatialRC && (!pTop || !pBot)) continue;
      const spatialX = SPATIAL_STORE_X[st.id];
      if (spatialRC && spatialX === undefined) continue;
      const cx = spatialRC ? spatialX : pTop!.x + GAUGE_OFFSET;
      const cz = spatialRC ? SPATIAL_STORE_Z : pTop!.z;
      // One baseline for every vessel in the spatial scene; an explicit layout anchor otherwise.
      const yBase = spatialRC ? 0 : Math.min(pTop!.y, pBot!.y);
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(GAUGE_R, GAUGE_R, GAUGE_H, 22, 1, true),
        new THREE.MeshStandardMaterial({ color: st.colour ?? 0xd8a657, transparent: true,
          opacity: 0.16, roughness: 0.6, side: THREE.DoubleSide }));
      shell.position.set(cx, yBase + GAUGE_H / 2, cz);
      this.group.add(shell);
      const reading = st.quantity ? gaugeReading(st.quantity) : null;
      const f = reading ? reading.fill : Math.min(1, Math.max(0, st.fill ?? 0));
      const fh = f * GAUGE_H;                          // f === 0 draws nothing at all
      const fill = new THREE.Mesh(
        new THREE.CylinderGeometry(GAUGE_R * 0.94, GAUGE_R * 0.94, Math.max(fh, 1e-6), 22),
        new THREE.MeshStandardMaterial({ color: st.colour ?? 0xd8a657, roughness: 0.4,
          metalness: 0.05, emissive: st.colour ?? 0xd8a657, emissiveIntensity: 0.25 }));
      fill.visible = fh > 0;
      fill.position.set(cx, yBase + fh / 2, cz);
      this.group.add(fill);
      this.stores.push({ spec: st, mesh: fill, shell });
      this.addLabel(st.labelMode === 'identifier' ? st.label : `${st.label}\n${reading?.text ?? ''}\n${st.readout}`,
        new THREE.Vector3(cx, yBase + GAUGE_H + 0.3, cz), 'store');
    }

    // ---- RAIL BUSES: deliberate bars with local drops; each segment is a routed wire carrying the page's summed current.
    if (anchored && spec.buses) for (const bus of spec.buses) {
      const y = deckBaseY;
      for (let k = 1; k < bus.points.length; k++) {
        const a = new THREE.Vector3(bus.points[k - 1][0], y, bus.points[k - 1][1]), b = new THREE.Vector3(bus.points[k][0], y, bus.points[k][1]);
        addRoutedBranch('wire', `${bus.id}-${k - 1}`, bus.id, a, b, [], bus.currents[k - 1] ?? null, COLOUR.wire, true, bus.fullScaleA);
      }
    }

    // ---- THE MECHANISM: a rack and pinion replaying the solved θ(t). ----------------------
    //
    // ONE COHERENT SCALE. The pinion's drawn radius is r·u and the carriage rises by h·u with
    // the SAME u, so the rack rolls on the pinion without slip at the drawn scale: Δh_drawn =
    // r_drawn·Δθ. A first version floored the drawn radius at 0.3 units for legibility, which
    // made the rack travel a fifth of the rolling circumference — visibly slipping. Astra's
    // catch. Legibility now comes from choosing the preset's pinion, not from a floor.
    //
    // ROTATION ABOUT THE SHAFT. The disc is a child of a spin group; the disc's own rotation.x
    // turns the cylinder's axis onto the world z (toward the viewer), and the GROUP spins about
    // world z by θ. Setting rotation.z on the disc itself, after its rotation.x, would spin it
    // about a different axis (three.js composes Euler XYZ intrinsically) — Astra asked for this
    // to be verified, and the probe measures the spin axis in world space.
    if (anchored && spec.mechanism) {
      const M = spec.mechanism, u = M.sceneUnitsPerMetre;
      const rp = (M.kind === 'rack' ? M.pinionRadiusM : M.bladeRadiusM) * u;
      // The pinion sits on the motor's shaft when there is one: same axis height, continued
      // toward the viewer. Otherwise at the anchor with the axis a pinion-radius above the deck.
      const exit = live.motor?.shaftExit ?? null;
      const centre = new THREE.Vector3(M.anchor.x, exit ? exit.y : rp + .2, M.anchor.z);
      if (exit) {
        // THE TRANSMISSION, drawn: one straight shaft from the can's front face to the pinion.
        // If the page misplaces the anchor the shaft is visibly slanted — no silent gearing.
        const len = exit.distanceTo(centre);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, len, 12),
          new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 }));
        shaft.position.copy(exit).lerp(centre, .5);
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), centre.clone().sub(exit).normalize());
        this.group.add(shaft);
        // Two bearing blocks carry it.
        for (const f of [.35, .85]) {
          const bearing = new THREE.Mesh(new THREE.BoxGeometry(.5, centre.y + .1, .3),
            new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: .5, roughness: .5 }));
          bearing.position.copy(exit).lerp(centre, f); bearing.position.y = (centre.y + .1) / 2 - .05; this.group.add(bearing);
        }
      }
      const spin = new THREE.Group(); spin.name = 'pinion-spin'; spin.position.copy(centre); this.group.add(spin);
      if (M.kind === 'rotor') {
        // ---- THE ROTOR: a hub and N pitched blades on the spin group, a still guard ring around them
        // so the turning is read against something fixed. The blade radius is model metres × u, as
        // the pinion's is. Illustration of a DECLARED inertia + linear-drag load; no air is modelled.
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .5, 20), new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 }));
        hub.rotation.x = Math.PI / 2; spin.add(hub);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3d7ab8, metalness: .2, roughness: .5, side: THREE.DoubleSide });
        const markMat = new THREE.MeshStandardMaterial({ color: 0xe0a030, metalness: .2, roughness: .5, side: THREE.DoubleSide });
        const n = Math.max(2, Math.round(M.blades));
        for (let k = 0; k < n; k++) {
          const arm = new THREE.Group(); arm.rotation.z = (k / n) * Math.PI * 2; spin.add(arm);
          const blade = new THREE.Mesh(new THREE.BoxGeometry(rp * .8, rp * .34, .035), k === 0 ? markMat : bladeMat);
          blade.position.x = .2 + rp * .45; blade.rotation.x = .55;   // pitched about its own radial axis
          arm.add(blade);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(rp + .16, .045, 10, 48), new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: .6, roughness: .45 }));
        ring.position.copy(centre); this.group.add(ring);
        for (const ang of [Math.PI / 2 + .6, Math.PI / 2 - .6]) {   // two struts hold the ring to the bearing below
          const strut = new THREE.Mesh(new THREE.BoxGeometry(.06, centre.y - .05, .06), new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: .6, roughness: .45 }));
          strut.position.set(centre.x + Math.cos(ang + Math.PI) * (rp + .16) * .55, (centre.y - .05) / 2, centre.z); strut.visible = false; this.group.add(strut);
        }
        const label = this.addLabel(M.label, new THREE.Vector3(centre.x, Math.max(.6, centre.y - rp - .3), centre.z + .6), 'component');
        live.mechanism = { spin, carriage: null, label, u, contactY: centre.y };
        live.terminals.set('mechanism', { hub: centre.clone(), radius: new THREE.Vector3(rp, 0, 0) });
        spin.rotation.z = M.thetaRad ?? 0;
      } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(rp, rp, .26, 48),
        new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: .6, roughness: .35 }));
      disc.rotation.x = Math.PI / 2; spin.add(disc);
      for (let k = 0; k < 6; k++) {   // spokes on the face, so the turning is visible
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(rp * 1.7, .05, .05), new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: .6 }));
        spoke.position.z = .15; spoke.rotation.z = (k / 6) * Math.PI; spin.add(spoke);
      }
      // TEETH AT ONE COHERENT PITCH on pinion and rack: N teeth round the pinion, the rack's pitch
      // is the same arc length, so they mate as the pinion turns. ILLUSTRATIVE MESH: the model has
      // no tooth contact — it is a rolling constraint — and no contact is solved; the teeth show
      // which way the drive engages and make the no-slip rolling readable.
      const nTeeth = Math.max(8, Math.round((2 * Math.PI * rp) / .18));
      const pitch = (2 * Math.PI * rp) / nTeeth;
      const toothMat = new THREE.MeshStandardMaterial({ color: 0x6e7880, metalness: .6, roughness: .5 });
      for (let k = 0; k < nTeeth; k++) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(.1, pitch * .45, .28), toothMat);
        const ang = (k / nTeeth) * Math.PI * 2;
        tooth.position.set(Math.cos(ang) * (rp + .05), Math.sin(ang) * (rp + .05), 0);
        tooth.rotation.z = ang; spin.add(tooth);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .4, 12), new THREE.MeshStandardMaterial({ color: 0xc8ced4, metalness: .85, roughness: .25 }));
      hub.rotation.x = Math.PI / 2; spin.add(hub);
      // THE RACK, on the +x side of the pinion: with θ increasing counter-clockwise as seen by the
      // viewer, the contact point on that side moves UP — the rack rises with θ, as the model says.
      const contactY = centre.y, travel = Math.max(M.travelM * u, .3);
      const rackX = centre.x + rp + .13;
      const column = new THREE.Mesh(new THREE.BoxGeometry(.12, travel + rp + 1.4, .12), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: .7, roughness: .35 }));
      column.position.set(rackX + .42, (travel + rp + 1.4) / 2, centre.z); this.group.add(column);
      const carriage = new THREE.Group(); carriage.name = 'rack-carriage'; carriage.position.set(rackX, contactY, centre.z); this.group.add(carriage);
      // THE RACK IS AS LONG AS THE LIFT NEEDS. In the carriage's frame the contact point sits at
      // −h·u, which ranges over [−travel, 0], so the toothed bar spans [−travel − 0.3, +0.3] and
      // the weight rides on its top. A first version hung a rack `travel + rp + 1` long ABOVE the
      // contact, which put the weight two lifts too high and out of the frame.
      const rackLen = travel + .6;
      const rack = new THREE.Mesh(new THREE.BoxGeometry(.2, rackLen, .3), new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: .7, roughness: .4 }));
      rack.position.set(0, -travel / 2, 0); carriage.add(rack);
      for (let k = 0; k < Math.floor(rackLen / pitch); k++) {   // rack teeth at the pinion's pitch, toward it
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(.1, pitch * .45, .28), toothMat);
        tooth.position.set(-.13, -travel - .3 + pitch / 2 + k * pitch, 0); carriage.add(tooth);
      }
      // THE WEIGHT HANGS FROM A BRACKET ON THE RACK — a visible rigid link, so it is seen to be
      // carried rather than floating beside the rack sharing a transform (Astra's catch).
      const side = Math.min(1.1, .45 + .28 * Math.cbrt(Math.max(M.massKg, 1e-3)));
      const bracketMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: .7, roughness: .35 });
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.55 + side / 2, .1, .22), bracketMat);
      arm.position.set((.55 + side / 2) / 2, .35, 0); carriage.add(arm);
      const drop = new THREE.Mesh(new THREE.BoxGeometry(.1, .35, .22), bracketMat);
      drop.position.set(.55 + side / 2, .35 - .175, 0); carriage.add(drop);
      const weight = new THREE.Mesh(new THREE.BoxGeometry(side, side * .8, side * .8), new THREE.MeshStandardMaterial({ color: 0x3e4a56, metalness: .3, roughness: .6 }));
      weight.position.set(.55 + side / 2, .35 - .35 - side * .4, 0); carriage.add(weight);
      const label = this.addLabel(M.label, new THREE.Vector3(rackX + 1.2, travel + rp + 1.6, centre.z), 'component');
      live.mechanism = { spin, carriage, label, u, contactY };
      spin.rotation.z = M.thetaRad ?? 0; carriage.position.y = contactY + (M.heightM ?? 0) * u;
      }
    }

    // THE CLOSE-UP THAT HID EVERYTHING IS GONE.
    //
    // This used to switch OFF every non-plate object, which is why the page showed
    // two small plates in a black void with no source, no resistor and no potential
    // landings. Astra diagnosed it: appending projection guides could never make the
    // circuit legible while this policy stood, because the circuit was hidden.
    //
    // The composition now keeps the whole scene and RANKS it instead: the plates are
    // the subject and are large; the landings and branches are present and readable
    // but subordinate. Nothing is hidden to make the subject dominant.
    if (spatialRC) {
      // THE SOURCE BODY BELONGS BESIDE ITS OWN TERMINAL, and it was nailed to x = −3.1.
      //
      // That constant was chosen when the run started at −5.0. The run now starts at −9.0, so
      // the source box had been left stranded in the MIDDLE of the circuit, sitting under the
      // diode, with its two leads crossing back under the resistor to reach a terminal four
      // units away. That is what "the wiring is bad and crimped on that resistor" was describing:
      // not the resistor's own leads, but two of the source's conductors routed through it.
      //
      // Derived from the source anchor now, so it follows the layout instead of being re-pinned
      // by hand every time the run is re-spaced — which is how it came adrift in the first place.
      const src = posOf.get('rc-source')!;
      const bodyX = src.x, bodyY = deckBaseY + 0.3, bodyZ = src.z + 3.4;
      const body=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.7,1.25),new THREE.MeshStandardMaterial({color:0x315866,metalness:0.45,roughness:0.32}));
      body.position.set(bodyX,bodyY,bodyZ); this.group.add(body);
      this.addLabel('SOURCE',new THREE.Vector3(bodyX,bodyY+1.15,bodyZ),'component');
      // Its two terminals leave from opposite faces: the drive goes back to the run's first
      // node, the return goes forward along the level nothing else uses.
      for (const [start,end,out] of [
        [new THREE.Vector3(bodyX-0.4,bodyY+0.9,bodyZ),src,true],
        [new THREE.Vector3(bodyX+0.4,bodyY+0.9,bodyZ),posOf.get('rc-gnd')!,false]
      ] as [THREE.Vector3, THREE.Vector3, boolean][]) {
        cable(start,end, out ? 0x508e80 : 0x537fa6,-0.35,
          out ? 'source-out' : 'source-return',
          (spec.branches.find(b => b.id === 'rc-V')?.current ?? 0) * (out ? 1 : -1));
      }
      const face=new THREE.Mesh(new THREE.BoxGeometry(1.25,0.65,0.04),new THREE.MeshStandardMaterial({color:0x90d5c0,emissive:0x234c3b,emissiveIntensity:0.5}));
      face.position.set(bodyX,bodyY+0.18,bodyZ+0.65);this.group.add(face);
      // Stable bounds include all authored potential heights and fixed objects.
      this.focusBox=new THREE.Box3(new THREE.Vector3(-5,-0.7,-2.8),new THREE.Vector3(5.1,5.3,4.2));
    }
    if (deck) {
      // THE SHARED RULER, at the page's x: the RC page's constant, or the authored deck's.
      const rulerX = spatialRC ? AXIS_X : spec.deck!.rulerX;
      const ruler=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(rulerX+0.5,0,-1.3),new THREE.Vector3(rulerX+0.5,SPATIAL_PLOT_H,-1.3)]),new THREE.LineBasicMaterial({color:0x83a6b6}));this.group.add(ruler);
      for(let i=0;i<=4;i++) {
        const yy=(i*SPATIAL_PLOT_H)/4;
        const tick=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(rulerX+0.38,yy,-1.3),new THREE.Vector3(rulerX+0.62,yy,-1.3)]),new THREE.LineBasicMaterial({color:0x83a6b6}));this.group.add(tick);
        // SNAP A TICK THAT IS EFFECTIVELY ZERO TO ZERO. Across a symmetric range the middle tick
        // lands on the float residue of lo + (hi−lo)/2 rather than on 0, and printed to three
        // significant figures that reads "8.75e-8 V" — a tick claiming a real voltage where the
        // ruler crosses ground. The threshold is relative to the range, so it can only affect a
        // tick that is negligible against the axis it is on.
        const raw = lo + (hi - lo) * i / 4;
        const shown = Math.abs(raw) < (hi - lo) * 1e-6 ? 0 : Number(raw.toPrecision(3));
        this.addLabel(`${shown} V`,new THREE.Vector3(rulerX,yy,-1.3),'axis');
      }
    }
    // ---- PLATES. Two real objects, with the field between them. -------------
    for (const pl of spec.plates ?? []) {
      const pPlus = posOf.get(pl.plusTerrace), pMinus = posOf.get(pl.minusTerrace);
      if (!pPlus || !pMinus) continue;
      // PLATE PLACEMENT IN THE SPATIAL SCENE IS AN OCCLUSION CONSTRAINT, not taste.
      // The plates are pinned and sit NEARER THE CAMERA than the ring: their slab
      // spans z 0.6…4.0 while the source→capacitor branch carrying the resistor lies
      // at z = −1, with the camera out at z ≈ +14. So any screen-space overlap means
      // the plates DRAW OVER the resistor — and because height is voltage, the whole
      // circuit descends as it discharges, sliding the resistor behind the plates
      // exactly when its interior is most worth watching.
      //
      // Measured, not guessed: the resistor body occupies x −1.96…0.96, and the old
      // centre x = 2.1 put the plates' left edge at 0.4, overlapping it. Moving the
      // centre right clears that edge past the body with margin; easing the slab back
      // in z shortens how far it reaches toward the camera. Neither changes any
      // quantity — plate SIZE, GAP and both terraces are untouched.
      const cx = spatialRC ? 3.05 : (pPlus.x + pMinus.x) / 2, cz = spatialRC ? 1.6 : (pPlus.z + pMinus.z) / 2 - PLATES_OFFSET;
      const yMid = spatialRC ? 0.85 : (pPlus.y + pMinus.y) / 2;
      // Drawn side is a fixed size; the drawn GAP is the real ratio, magnified.
      const drawnSide = PLATES_SIDE;
      // The drawn gap keeps the REAL ratio, magnified, and is then held inside a band
      // that stays legible AND stays visibly a gap. Both the magnification and the
      // real metre values are printed, so nothing here is a hidden number.
      const trueRatio = pl.gap / pl.side;
      const wanted = drawnSide * trueRatio * pl.gapExaggeration;
      const drawnGap = Math.min(drawnSide * 0.85, Math.max(0.30, wanted));
      // THE CLAMP IS A DISPLAY SATURATION AND MUST SAY SO. Below about a 0.011 true
      // ratio the drawn gap stops shrinking, so the same drawn gap then covers a
      // RANGE of real geometries. An undeclared liberty is not a liberty. See
      // GEOMETRIC-CAPACITOR-AMENDMENT-B.
      const gapSaturated = wanted < 0.30 || wanted > drawnSide * 0.85;
      const plate = (dy: number, colour: number): THREE.Mesh => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(drawnSide, PLATE_THICK, drawnSide),
          new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.55,
            emissive: colour, emissiveIntensity: 0.16 }));
        m.position.set(cx, yMid + dy, cz);
        const edge=new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),new THREE.LineBasicMaterial({color:colour,transparent:true,opacity:0.8}));
        m.add(edge);
        this.group.add(m);
        return m;
      };
      const pTop2 = plate(drawnGap / 2, 0xe4685d);    // the positive plate
      const pBot2 = plate(-drawnGap / 2, 0x5d9ae4);   // the negative plate
      // What the camera should frame, with headroom for the label above.
      const fb = new THREE.Box3().setFromObject(pTop2);
      fb.expandByObject(pBot2);
      fb.expandByScalar(drawnSide * 0.12);
      this.focusBox = this.focusBox ? this.focusBox.union(fb) : fb;

      // THE INTERIOR FIELD. Uniform by assumption, so uniformly spaced arrows, drawn
      // ONLY between the plates and never outside them: no fringing is solved, so
      // none is drawn. Exactly zero volts draws NO arrows at all.
      // ---- THE FIELD, on a FIXED scale so charging is VISIBLE. -------------
      // The old version drew nine equally bright arrows for ANY nonzero E, so the
      // picture never changed while the capacitor charged. Count, brightness and
      // length now all scale with |E| against a fixed E_full. The arrows stay
      // EVENLY SPACED AND IDENTICAL TO EACH OTHER, because the field is uniform by
      // assumption and no arrow may differ from its neighbour. See
      // CAPACITOR-VISUAL-MAPPING-v1.
      // ARROWS AND CHARGE MARKS ARE THE PLATES' DYNAMIC PART. They are count-based — one to
      // four arrows a side, one to five marks — so they are redrawn into this one small group
      // when the reading changes, while the plates, leads and label objects persist.
      const dyn = new THREE.Group();
      this.group.add(dyn);
      const drawPlateDynamics = (pl: PlatesSpec): void => {
      const fFrac = Math.min(1, Math.abs(pl.field) / Math.max(pl.fieldFull, 1e-30));
      if (pl.field !== 0 && fFrac > 0) {
        const n = Math.max(1, Math.min(4, Math.ceil(fFrac * 4)));   // 1..4 per side
        const dir = Math.sign(pl.field);
        const half = drawnGap * (0.24 + 0.16 * fFrac);
        const headLen = Math.min(0.16, drawnGap * 0.30);
        const bright = 0.30 + 0.70 * fFrac;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const spread = n === 1 ? 0 : (i / (n - 1) - 0.5);
            const spreadZ = n === 1 ? 0 : (j / (n - 1) - 0.5);
            const fx = cx + spread * drawnSide * 0.58;
            const fz = cz + spreadZ * drawnSide * 0.58;
            const a = new THREE.Vector3(fx, yMid + dir * half, fz);
            const b = new THREE.Vector3(fx, yMid - dir * half, fz);
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([a, b]),
              new THREE.LineBasicMaterial({ color: 0xf0c674, transparent: true, opacity: bright }));
            dyn.add(line);
            const head = new THREE.Mesh(
              new THREE.ConeGeometry(headLen * 0.42, headLen, 8),
              new THREE.MeshBasicMaterial({ color: 0xf0c674, transparent: true, opacity: bright }));
            head.position.copy(b);
            if (dir > 0) head.rotation.z = Math.PI;   // cones point +Y by default
            dyn.add(head);
          }
        }
      }
      // ---- OPPOSING SURFACE CHARGE. Count encodes |Q| on a FIXED scale. ----
      // Evenly spaced, because charge is uniformly distributed by assumption and no
      // symbol marks a location. ZERO DRAWS NOTHING — not faint symbols, none.
      // These are an ENCODING, not counted electrons.
      const qFrac = Math.min(1, Math.abs(pl.charge) / Math.max(pl.chargeFull, 1e-30));
      if (pl.charge !== 0 && qFrac > 0) {
        const m = Math.max(1, Math.min(5, Math.ceil(qFrac * 5)));
        const posUp = pl.charge > 0;      // sign of the UPPER plate
        for (let k = 0; k < m; k++) {
          const t = m === 1 ? 0 : (k / (m - 1) - 0.5);
          const px = cx + t * drawnSide * 0.66;
          const mk = (dy: number, plus: boolean): void => {
            const col = plus ? 0xff8a7a : 0x7ab8ff;
            const bar = (w: number, h: number, rot: number): void => {
              const g = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, h),
                new THREE.MeshBasicMaterial({ color: col }));
              g.position.set(px, yMid + dy, cz);
              g.rotation.y = rot;
              dyn.add(g);
            };
            bar(0.16, 0.03, 0);                       // the horizontal stroke
            if (plus) bar(0.16, 0.03, Math.PI / 2);   // the vertical, for a '+'
          };
          mk(drawnGap / 2 + PLATE_THICK + 0.015, posUp);
          mk(-drawnGap / 2 + PLATE_THICK + 0.015, !posUp);
          // Front-edge signs expose both charges even when the upper plate occludes the lower face.
          for (const [dy, plus] of [[drawnGap / 2, posUp], [-drawnGap / 2, !posUp]] as const) {
            const sign = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.035,0.018),
              new THREE.MeshBasicMaterial({color:plus ? 0xffb3a0 : 0x92ccff}));
            sign.position.set(px,yMid+dy,cz+drawnSide/2+0.025);dyn.add(sign);
            if (plus) { const vertical=sign.clone(); vertical.rotation.z=Math.PI/2;dyn.add(vertical); }
          }
        }
      }
      };   // drawPlateDynamics
      drawPlateDynamics(pl);
      // Solid terminal leads. Their routing is not on the voltage-height scale.
      const leadTopY = yMid + drawnGap / 2 + PLATE_THICK;
      const leadBotY = yMid - drawnGap / 2 - PLATE_THICK;
      // a SHORT physical lead at the object, then the guide to the landing
      const stub = (y: number, dy: number): THREE.Vector3 => {
        const a = new THREE.Vector3(cx + drawnSide * 0.42, y, cz);
        const b = new THREE.Vector3(cx + drawnSide * 0.42, y + dy, cz);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, Math.abs(dy), 8),
          new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.4, metalness: 0.6 }));
        m.position.set(a.x, (a.y + b.y) / 2, a.z);
        this.group.add(m);
        return b;
      };
      const capacitorCurrent = spec.branches.find(b => b.kind === 'capacitor')?.current ?? 0;
      cable(stub(leadTopY, 0.34), pPlus.clone(),0xc07967,0.55,'plate-upper',-capacitorCurrent);
      cable(stub(leadBotY, -0.34), pMinus.clone(),0x568abc,0.95,'plate-lower',capacitorCurrent);

      const qFrac = Math.min(1, Math.abs(pl.charge) / Math.max(pl.chargeFull, 1e-30));
      const qSat = Math.abs(pl.charge) >= pl.chargeFull && pl.chargeFull > 0;
      const fSat = Math.abs(pl.field) >= pl.fieldFull;
      void qFrac;

      // THE DIMENSIONS, ON THE THING ITSELF. Peter asked to SEE size and dimension,
      // so the real metre values live on the plates rather than only in a form.
      const mm = (m: number): string => `${(m * 1000).toPrecision(4)} mm`;
      const plateLabelText = (q: PlatesSpec): string => {
        const qs = Math.abs(q.charge) >= q.chargeFull && q.chargeFull > 0;
        const fs = Math.abs(q.field) >= q.fieldFull;
        return `${mm(q.side)} plates · ${mm(q.gap)} gap\n`
          + `Gap magnified ×${q.gapExaggeration}${gapSaturated ? ' · display limit reached' : ''}`
          + `${qs || fs ? '\nCharge / field at display scale' : ''}`;
      };
      void qSat; void fSat;
      const plateLabel = this.addLabel(plateLabelText(pl),
        new THREE.Vector3(cx, yMid - drawnGap / 2 - 1.0, cz), 'plates');
      live.plates = {
        dyn, label: plateLabel, labelText: plateLabelText,
        redraw: (q: PlatesSpec) => {
          // Dispose what is replaced; these are the only per-frame allocations left in the scene.
          for (const child of [...dyn.children]) {
            const d = child as THREE.Mesh;
            d.geometry?.dispose();
            const mats = Array.isArray(d.material) ? d.material : [d.material];
            for (const mm2 of mats) mm2?.dispose();
          }
          dyn.clear();
          drawPlateDynamics(q);
        },
      };
    }

    // EVERY PHYSICAL BODY CASTS ONTO THE BENCH: components, wires, plates, coil, markers.
    // Not the backdrop, not the field (a field has no shadow) and not the measurement lines
    // (stems and leaders are drawing conventions, not objects).
    this.group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (o.name === 'datum' || o.name === 'field' || o.name === 'measure') return;
      o.castShadow = true;
    });
    this.info = { unitsPerVolt: upv, markerScale: this.currentMotionScale, spanV: span,
      fullI, nodes: reps.length, branches: this.branches.length, empty: false, rejected: null };
    const sig = spec.terraces.map((t) => t.id).join(',') + '|'
      + spec.branches.map((b) => `${b.kind}:${b.id}`).join(',') + '|'
      + (spec.stores ?? []).map((x) => x.id).join(',') + '|plates:' + (spec.plates ?? []).map((x) => x.id).join(',');
    // THE FAST PATH IS ONLY FOR THE LAYOUT IT WAS WRITTEN FOR: the spatial RC scene, with a
    // FIXED display span, and no store vessels drawn. Anywhere else the registry is discarded so
    // applySpec rebuilds every time, as before:
    //   - the generic ring layout puts terraces AT voltage height and runs its tubes between
    //     them, so a value change moves geometry the update path does not touch;
    //   - an 'auto' span re-derives the height mapping from the values, which is a rebuild;
    //   - store vessels build their fill with per-value geometry and are not registered.
    // Stale geometry on an unsupported page would be worse than the rebuild it replaced.
    const storesLive = spec.drawStores === false || !(spec.stores?.length)
      || (anchored && spec.stores!.every((s) => !!s.anchor));   // authored-deck vessels are registered
    this.live = (deck && !!spec.fixedSpan && storesLive) ? live : null;
    // ---- CARRIERS PRESENT, in the electron view. ---------------------------------
    // One layer per branch, positioned once and never animated: these are not transport.
    for (const br of this.branches) {
      if (!br.electronCues || !br.markers) continue;
      const n = br.markers.count;
      // DIM AND DISTINCT ON PURPOSE. This layer must not become a second strong-current cue —
      // that is the complaint being fixed — so it is well below the streaks in brightness and
      // in a different, desaturated colour. It is a schematic mark of charge being present,
      // not a tracked stationary particle.
      const still = new THREE.InstancedMesh(this.electronStillGeo,
        new THREE.MeshBasicMaterial({ color: 0x46617a, transparent: true, opacity: .30 }), n);
      still.frustumCulled = false;
      const pa = new THREE.Vector3(br.xA, br.yA, br.zA), pb = new THREE.Vector3(br.xB, br.yB, br.zB);
      const m = new THREE.Matrix4();
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const at = br.route ? br.route.getPointAt(t) : pa.clone().lerp(pb, t);
        m.makeTranslation(at.x, at.y, at.z);
        still.setMatrixAt(k, m);
      }
      still.instanceMatrix.needsUpdate = true;
      this.group.add(still);
      br.stillMarkers = still;
    }

    if (sig !== this.topology) { this.topology = sig; if (!this.cameraOwnedByViewer) this.frameAll(); }
  }

  /**
   * Frame the WHOLE drawing from the front and a little above, computed from the
   * actual bounds rather than guessed. Two terraces were being cut off the top of
   * the canvas at hand-tuned distances, which is a drawing that hides its own data.
   *
   * Looking down the ring's axis collapses both the loop and the heights — the one
   * view that hides everything this scene is for — so the camera is deliberately
   * offset around and above it.
   */
  /**
   * THE ENTRY POINT THE PAGE SHOULD USE. Rebuilds when the topology signature changes; otherwise
   * updates the existing objects in place. See `LiveHandles` for why.
   */
  /** How often each path ran. Read by probes; costs nothing to keep. */
  readonly stats = { builds: 0, updates: 0 };

  /**
   * SHOW OR HIDE THE ANNOTATIONS — the label pills and axis ticks — and nothing else: bodies,
   * conductors, transport cues and fields stay exactly as drawn. Peter asked for a Labels toggle
   * on every page; fault banners live outside the label host and are never hidden by this.
   */
  setLabelsVisible(visible: boolean): void { this.labelHost.classList.toggle('labels-hidden', !visible); }
  get labelsVisible(): boolean { return !this.labelHost.classList.contains('labels-hidden'); }
  /** The drawn terminal positions of the current build, by spec branch id and port (plus `mechanism.hub` and `mechanism.radius.x`), as plain [x, y, z]. */
  terminals(): Record<string, Record<string, [number, number, number]>> {
    const out: Record<string, Record<string, [number, number, number]>> = {};
    for (const [id, ports] of this.live?.terminals ?? []) out[id] = Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)] as [number, number, number]]));
    return out;
  }
  /**
   * THE RENDERED GEOMETRY a layout validator can be run against: every drawn body's world bounds (by spec branch id) and
   * every conductor's sampled centreline (by branch id, 3D points — routed leads and cables follow their curves), plus the
   * rotor's hub and radius. This is what is actually on screen, not a table that mirrors it.
   */
  geometry(): { bodies: Record<string, { min: [number, number, number]; max: [number, number, number] }[]>; wires: Record<string, [number, number, number][]>; rotor: { hub: [number, number, number]; radius: number } | null } {
    const r4 = (v: THREE.Vector3): [number, number, number] => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
    // One world-aligned box per REGISTERED OBJECT (a part may register several: the MOSFET's slab and tab, the pot's track
    // and knob), so a validator sees the drawn obstacles rather than one envelope around all of them.
    const bodies: Record<string, { min: [number, number, number]; max: [number, number, number] }[]> = {};
    for (const [id, objs] of this.live?.bodies ?? []) for (const o of objs) { const box = new THREE.Box3().expandByObject(o); if (!box.isEmpty()) (bodies[id] ??= []).push({ min: r4(box.min), max: r4(box.max) }); }
    const wires: Record<string, [number, number, number][]> = {};
    for (const br of this.branches) {
      if (br.route) wires[br.id] = br.route.getPoints(24).map((p) => r4(p));
      else wires[br.id] = [[+br.xA.toFixed(4), +br.yA.toFixed(4), +br.zA.toFixed(4)], [+br.xB.toFixed(4), +br.yB.toFixed(4), +br.zB.toFixed(4)]];
    }
    const hub = this.live?.terminals.get('mechanism');
    return { bodies, wires, rotor: hub ? { hub: r4(hub.hub), radius: +hub.radius.x.toFixed(4) } : null };
  }

  applySpec(spec: SceneSpec): void {
    this.flowCue = spec.flowCue ?? null;   // render-time calibration, refreshed on every update
    const sig = sceneSignature(spec, this.electronView);
    if (!this.live || this.live.signature !== sig) { this.stats.builds++; this.buildFromSpec(spec); return; }
    this.stats.updates++;
    this.updateFromSpec(spec);
  }

  /**
   * Refresh every value-dependent thing on the objects that already exist. Nothing here
   * allocates except the plates' small dynamic group, which is redrawn only when its reading
   * changes.
   */
  private updateFromSpec(spec: SceneSpec): void {
    const live = this.live!;
    const y = live.y;
    const fullI = this.fullCurrent;
    const railName = (id: string): string => spec.terraces.find((t) => t.id === id)!.label;

    // ---- POTENTIAL MARKERS: the disc, its ring, its stem and its label follow the voltage.
    const points: THREE.Vector3[] = [];
    for (const t of spec.terraces) {
      const h = live.nodes.get(t.id);
      if (!h) continue;
      const yy = y(t.volts);
      h.marker.y = yy;
      h.disc.position.y = yy;
      h.ring.position.y = yy + 0.07;
      if (h.stem) {
        const len = Math.abs(yy - h.anchor.y);
        h.stem.scale.y = Math.max(len, 1e-6);
        h.stem.visible = len > 0.02;
        h.stem.position.y = (h.anchor.y + yy) / 2;
      }
      const labelY = h.stem ? y(0) + 0.5 * (yy - y(0)) : yy + 0.42;
      h.label.pos.y = labelY;
      if (h.leader) placeLeader(h.leader, h.marker.x, yy, h.marker.z, labelY);
      const text = t.showValue === false ? railName(t.id) : `${railName(t.id)}\n${t.volts.toFixed(3)} V${h.isRef ? '  · displayed 0' : ''}`;
      if (h.label.el.textContent !== text) h.label.el.textContent = text;
      points.push(h.marker.clone());
    }
    if (points.length) this.markerPoints = points;

    // ---- BRANCHES: tube radius and stillness, component label text, and the CURRENT the
    // animated markers read in render(). Ids follow the build: addBranch tubes are `<id>-in`
    // and `<id>-out`, component overlays are `<id>-flow`, generic branches are `<id>`.
    const setCurrent = (id: string, i: number | null): void => {
      const br = this.branches.find((b) => b.id === id);
      if (br) br.current = i;
    };
    for (const b of spec.branches) {
      const label = live.componentLabels.get(b.id);
      if (label && label.el.textContent !== b.label) label.el.textContent = b.label;
      for (const suffix of ['-in', '-out', '']) {
        const t = live.tubes.get(`${b.id}${suffix}`);
        if (!t) continue;
        // THE TRANSISTOR'S SOURCE LEG IS ITS OWN FIGURE here too. The build scales the `-out`
        // tube by `sourceCurrent`; this loop scaled it by the drain current, so through a gate
        // edge the update path and a fresh build disagreed by the gate current — 0.001 in tube
        // scale, caught by the lamp equivalence probe (Astra asked for exactly those states).
        const cur = b.kind === 'mosfet' && suffix === '-out' ? (b.sourceCurrent ?? b.current)
          : b.kind === 'pot' && suffix === '-out' ? (b.legBCurrent ?? null)   // the B leg is its own figure (the pot's equivalence probe caught this)
          : b.kind === 'comparator' && suffix === '-in' ? null                // the input draws nothing: built with null, kept null (the sensors probe caught this)
          : b.kind === 'comparator' && suffix === '-out' ? (b.outputCurrent ?? b.current)   // the output lead is its own figure
          : b.current;
        const still = cur === 0;
        const rad = cur === null || still
          ? TUBE_BASE
          : TUBE_BASE + TUBE_PER_AMP * Math.min(1.4, Math.abs(cur) / Math.max(fullI, 1e-12));
        if (t.tube instanceof THREE.Group) { for (const seg of t.tube.children) seg.scale.set(rad / TUBE_BASE, 1, rad / TUBE_BASE); }
        else t.tube.scale.set(rad / TUBE_BASE, 1, rad / TUBE_BASE);
        t.tubeMat.color.setHex(still ? 0x6a737d : t.colour);
        t.tubeMat.opacity = still ? 0.4 : 0.42;
        t.tubeMat.emissive.setHex(still ? 0x000000 : t.colour);
        t.lineMat.color.setHex(still ? 0x6a737d : t.colour);
        t.lineMat.opacity = still ? 0.55 : 0.85;
      }
      setCurrent(`${b.id}-flow`, b.current);
      setCurrent(`${b.id}-in`, b.current);
      setCurrent(`${b.id}-out`, b.current);
      setCurrent(b.id, b.current);
      if (b.kind === 'mosfet') {
        setCurrent(`${b.id}-gate`, b.gateCurrent ?? null);
        setCurrent(`${b.id}-out`, b.sourceCurrent ?? b.current);   // the source leg is its own figure
      }
      if (b.kind === 'capacitor' && live.deckCapacitors.has(b.id)) tintPlates(live.deckCapacitors.get(b.id)!, b.charge ?? 0, b.chargeFull ?? 0);
      if (b.kind === 'switch' && live.switch) {
        live.switch.lever.quaternion.copy(b.closed ? live.switch.closedQuat : live.switch.openQuat);
        live.switch.lamp.emissiveIntensity = b.closed ? .9 : 0;
      }
      if (b.kind === 'motor' && live.motor) {
        const full = Math.max(b.backEmfFullVolts ?? 1, 1e-9);
        const bh = Math.min(1, Math.max(0, (b.backEmfVolts ?? 0) / full)) * live.motor.barMax;
        live.motor.bar.scale.y = Math.max(bh, 1e-6); live.motor.bar.visible = bh > 0;
        live.motor.bar.position.copy(live.motor.base).add(new THREE.Vector3(0, bh / 2, 0));
      }
      if (b.kind === 'pot' && live.pot) {
        const f = Math.min(1, Math.max(0, b.wiperFraction ?? 0.5));
        const P = live.pot, w = P.trackA.clone().lerp(P.trackB, f);
        P.wiper.position.copy(w);
        P.knob.rotation.z = -f * 1.5 * Math.PI + 0.75 * Math.PI;
        setCurrent(`${b.id}-out`, b.legBCurrent ?? null); setCurrent(`${b.id}-legB`, b.legBCurrent ?? null);
        setCurrent(`${b.id}-legA`, b.current); setCurrent(`${b.id}-wiper`, b.wiperCurrent ?? null);
        // The leg overlays' endpoints move with the wiper.
        for (const br of this.branches) {
          if (br.id === `${b.id}-legA`) { br.xB = w.x; br.zB = w.z; }
          if (br.id === `${b.id}-legB`) { br.xA = w.x; br.zA = w.z; }
        }
      }
      if (b.kind === 'led' && live.led) {
        const em = Math.min(1, Math.max(0, b.emission ?? 0));
        live.led.dome.emissiveIntensity = em * 4; live.led.glow.intensity = em * 3;
      }
      if (b.kind === 'sensor' && live.sensor && b.sensor) {
        const frac = Math.max(0, Math.min(1, b.sensor.environmentFraction ?? 0));
        const S = live.sensor;
        if (b.sensor.kind === 'ldr') { S.cue.emissiveIntensity = frac * 5; if (S.cueLight) S.cueLight.intensity = frac * 4; }
        else if (S.bar) { const h = frac * S.barMax; S.bar.scale.y = Math.max(h, 1e-6); S.bar.visible = h > 0; S.bar.position.copy(S.barBase).add(new THREE.Vector3(0, h / 2, 0)); }
      }
      if (b.kind === 'comparator' && live.comparator) {
        live.comparator.outLamp.emissiveIntensity = b.high ? .9 : 0;
        setCurrent(`${b.id}-vcc`, b.supplyCurrent ?? b.current);
        setCurrent(`${b.id}-out`, b.outputCurrent ?? b.current);
        setCurrent(`${b.id}-gnd`, b.groundCurrent ?? null);
      }
      if (b.kind === 'lamp' && live.lamp) {
        const bright = b.power !== null && b.power !== undefined && b.fullPower
          ? Math.min(1, Math.max(0, b.power / b.fullPower)) : 0;
        live.lamp.filament.emissiveIntensity = bright * 6;
        live.lamp.glass.opacity = .28 + .22 * bright;
        live.lamp.glass.emissiveIntensity = bright * .9;
        live.lamp.glow.intensity = bright * 6;
      }
      if (b.kind === 'diode' && live.diode) {
        const share = b.current === null ? 0
          : Math.min(1, Math.abs(b.current) / Math.max(fullI, 1e-12));
        live.diode.lit.emissiveIntensity = share * share * 0.9;
      }
      if (b.kind === 'resistor' && live.resistor) {
        const fraction = (b.current ?? 0) / fullI;
        live.resistor.bronze.emissiveIntensity = Math.min(1, fraction * fraction) * .65;
        if (this.resistorInterior) this.resistorInterior.fraction = fraction;
      }
      if (b.kind === 'inductor' && live.field) {
        const iNow = b.current ?? 0;
        const f = live.field;
        const strength = Math.min(1, Math.abs(iNow) / (f.fullScaleA ?? fullI));
        const vis = Math.sqrt(strength);
        const emphasis = this.fieldEmphasis;
        f.lineMat.opacity = .92 * vis * emphasis;
        f.headMat.opacity = .95 * vis * emphasis;
        for (const l of f.lines) l.visible = vis > 0;
        const sign = iNow === 0 ? f.lastSign : Math.sign(iNow);
        for (const { head, loop, uu } of f.heads) {
          head.visible = vis > 0;
          head.scale.setScalar(Math.max(vis, 1e-6));
          if (sign !== f.lastSign)
            head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
              loop.getTangentAt(uu).multiplyScalar(sign));
        }
        f.lastSign = sign;
      }
    }
    // Cables drawn outside addBranch carry the source's and the capacitor's currents.
    const srcI = spec.branches.find((b) => b.id === 'rc-V')?.current ?? 0;
    const capI = spec.branches.find((b) => b.kind === 'capacitor')?.current ?? 0;
    setCurrent('source-out', srcI); setCurrent('source-return', -srcI);
    setCurrent('plate-upper', -capI); setCurrent('plate-lower', capI);

    // ---- AUTHORED-DECK VESSELS: fill height and label text.
    for (const st of spec.stores ?? []) {
      const h = live.stores.get(st.id); if (!h) continue;
      const reading = st.quantity ? gaugeReading(st.quantity) : null;
      const f = reading ? reading.fill : Math.min(1, Math.max(0, st.fill ?? 0));
      const fh = f * GAUGE_H;
      h.fill.scale.y = Math.max(fh, 1e-6); h.fill.visible = fh > 0; h.fill.position.y = h.yBase + fh / 2;
      const text = st.labelMode === 'identifier' ? st.label : `${st.label}\n${reading?.text ?? ''}\n${st.readout}`;
      if (h.label.el.textContent !== text) h.label.el.textContent = text;
    }
    // ---- RAIL BUSES: each segment's summed current, thickness and carriers.
    for (const bus of spec.buses ?? []) for (let k = 1; k < bus.points.length; k++) {
      const id = `${bus.id}-${k - 1}`, cur = bus.currents[k - 1] ?? null;
      setCurrent(id, cur);
      const t = live.tubes.get(id); if (!t) continue;
      const still = cur === 0;
      const rad = cur === null || still ? TUBE_BASE : TUBE_BASE + TUBE_PER_AMP * Math.min(1.4, Math.abs(cur) / Math.max(fullI, 1e-12));
      if (t.tube instanceof THREE.Group) for (const seg of t.tube.children) seg.scale.set(rad / TUBE_BASE, 1, rad / TUBE_BASE);
      t.tubeMat.color.setHex(still ? 0x6a737d : t.colour); t.tubeMat.opacity = still ? 0.4 : 0.42; t.tubeMat.emissive.setHex(still ? 0x000000 : t.colour);
      t.lineMat.color.setHex(still ? 0x6a737d : t.colour); t.lineMat.opacity = still ? 0.55 : 0.85;
    }

    // ---- THE MECHANISM: pinion angle and carriage height from the solved θ.
    if (spec.mechanism && live.mechanism) {
      const M = spec.mechanism, m = live.mechanism;
      m.spin.rotation.z = M.thetaRad ?? 0;
      if (M.kind === 'rack' && m.carriage) m.carriage.position.y = m.contactY + (M.heightM ?? 0) * m.u;
      if (m.label.el.textContent !== M.label) m.label.el.textContent = M.label;
    }

    // ---- PICKUP: reading, polarity beads, sign labels and the fill bar.
    const pk = spec.coil?.pickup;
    if (pk && live.pickup) {
      const P = live.pickup;
      const known = pk.terminalV !== null;
      const shown = pk.terminalV ?? 0;
      const positiveIsB = shown >= 0;
      (P.beadA.material as THREE.MeshBasicMaterial).color.setHex(!positiveIsB ? 0xffd9a0 : 0x6f8fa8);
      (P.beadB.material as THREE.MeshBasicMaterial).color.setHex(positiveIsB ? 0xffd9a0 : 0x6f8fa8);
      const sB = !known || shown === 0 ? '±' : (positiveIsB ? '+' : '−');
      const sA = !known || shown === 0 ? '±' : (positiveIsB ? '−' : '+');
      if (P.signB.el.textContent !== sB) P.signB.el.textContent = sB;
      if (P.signA.el.textContent !== sA) P.signA.el.textContent = sA;
      const full = Math.max(Math.abs(shown), 1e-12);
      const frac = known ? Math.max(-1, Math.min(1, shown / (pk.indicatorFullScaleV || full))) : 0;
      const h = Math.abs(frac) * P.barMax;
      P.fill.scale.y = Math.max(h, 1e-6);
      P.fill.visible = frac !== 0;
      P.fill.position.copy(P.barBase).addScaledVector(P.up, Math.sign(frac) * h / 2);
      const text = known ? `pickup ${fmtSi(shown, 'V')}` : 'pickup · not yet solved';
      if (P.label.el.textContent !== text) P.label.el.textContent = text;
    }

    // ---- PLATES: arrows and charge marks are redrawn only when the reading moved.
    const pl = spec.plates?.[0];
    if (pl && live.plates) {
      const key = `${pl.charge}|${pl.field}`;
      if (live.plates.dyn.userData.key !== key) {
        live.plates.redraw(pl);
        live.plates.dyn.userData.key = key;
      }
      const text = live.plates.labelText(pl);
      if (live.plates.label.el.textContent !== text) live.plates.label.el.textContent = text;
    }
  }

  private frameAll(): void {
    // Frame the DATA — terraces and branches — not the backdrop. The datum plane is
    // deliberately wider than the circuit, and including it shrank everything else
    // into the middle third of the canvas.
    // WHEN THERE ARE PLATES, THEY ARE THE SUBJECT. Framing the whole scene made the
    // capacitor a small object off to one side while the terraces dominated, which
    // is the opposite of what this view is for.
    let box = new THREE.Box3();
    // FRAME THE CIRCUIT, which is a NAMED SET of objects, not "everything" and not "the plates".
    //
    // Two wrong versions preceded this. The first read `if (child.name === 'datum' ||
    // this.host.closest('#rc-app')) continue;` — the second test does not depend on `child`, so
    // on this page every child was skipped and the box never grew past the plates: the camera
    // framed the capacitor while the rest of the run sat off to the left, half out of frame.
    // Replacing it with "expand by every child" then swept in the energy gauge vessels, which
    // stand well clear of the loop, and shrank the whole circuit to a corner — worse than what
    // it replaced.
    //
    // `this.branches` IS the circuit: one entry per component and per lead, with both endpoints.
    // Framing those plus the plates keeps the run filling the view no matter how many components
    // it gains, and nothing that is merely NEAR the circuit can drag the camera off it.
    // NOT THE FIELD LINES EITHER. Measured: the four revolved copies of the outermost field
    // loop reach 4.65 units from the coil — to y = ±5 and z = −6.2, BEHIND the deck — and
    // Box3.expandByObject counts them whether or not they are visible (at reset they are not).
    // They alone set the framed box's height and most of its depth, which is why the circuit
    // filled about half the stage: the camera was standing back for a faint loop drawn at 0.3
    // emphasis in the overview. The field has its own framing in focusOnCoilAxis, where it is
    // the subject; the overview frames the circuit and the ruler.
    const growToScene = (target: THREE.Box3): void => {
      for (const child of this.group.children) {
        if (child.name === 'datum' || child.name === 'field') continue;
        target.expandByObject(child);
      }
    };
    for (const b of this.branches) {
      box.expandByPoint(new THREE.Vector3(b.xA, b.yA, b.zA));
      box.expandByPoint(new THREE.Vector3(b.xB, b.yB, b.zB));
    }
    // AND THE POTENTIAL MARKERS, which are not branches. Since the components were anchored to a
    // fixed deck the branch endpoints are all at one height, so framing on them alone would
    // describe a flat circuit and crop the very thing that now carries the voltage.
    for (const p of this.markerPoints) box.expandByPoint(p);
    // THE AUTHORED FOCUS BOX IS NOT THE CIRCUIT. It is a hand-set volume from the plate-centred
    // composition — 10 wide, 6 tall and 7 DEEP — and unioning it made the framed box far larger
    // than anything drawn: measured, the circuit occupied 27% of the stage width and 21% of its
    // height, floating in dead space. The branches and the potential markers already describe
    // the circuit exactly, so on this layout they are the box.
    const anchored = this.markerPoints.length > 0;
    if (!anchored && this.focusBox && !this.focusBox.isEmpty()) box.union(this.focusBox);
    // AND EVERY PHYSICAL BODY. Branch endpoints describe the run's terminals, not the objects
    // hanging off them: the plates extend well past the capacitor's terminal and the field lines
    // well past the coil's, and framing on terminals alone cropped both at the viewport edge.
    // The energy vessels that made "expand by everything" wrong are no longer in this view.
    if (anchored) growToScene(box);
    if (box.isEmpty()) growToScene(box);        // no branches yet: fall back to the scene
    // HEADROOM FOR LABELS, which float above their terraces in screen space and are not in the
    // 3D bounds at all. Fitting the geometry alone clipped the top row of node labels.
    if (!box.isEmpty()) box.expandByVector(new THREE.Vector3(0.6, 1.1, 0.6));
    if (box.isEmpty()) return;
    // FIT THE BOX TO THE VIEWPORT, not its bounding sphere to the narrower field of view.
    //
    // A series circuit is a long horizontal run: its bounding sphere's radius is set by its
    // LENGTH. Fitting that sphere against `min(vFov, hFov)` — the vertical one on a wide stage —
    // sized the view to about 14 units tall and therefore ~32 wide, so a 10-unit circuit filled
    // barely a third of the frame with empty space either side. The sphere also ignores the
    // camera's angle, so it reserved room for an extent that is not actually on screen.
    //
    // Instead: project the box's eight corners into camera space along the viewing direction and
    // ask what distance each one needs to stay inside BOTH fields of view. The largest wins, so
    // the frame is filled by whichever axis actually binds.
    const centre = box.getCenter(new THREE.Vector3());
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const tanV = Math.tan(vFov / 2), tanH = Math.tan(hFov / 2);
    // A FLATTER VIEW ONCE THE COMPONENTS SIT ON A DECK. The old direction looked steeply down,
    // which was right when the parts were scattered up the potential axis and the height WAS the
    // subject. With the circuit on one plane a steep angle only converts the run's depth into
    // required distance, pushing the camera back and shrinking everything.
    // AN AUTHORED DECK MAY CHOOSE ITS ANGLE. The lamp's control lane runs in FRONT of its load
    // lane, and from the RC page's flat angle the two collapse onto each other on screen; a
    // steeper view turns that depth into vertical separation. Layout only.
    const dir = (this.deckView ?? (anchored ? new THREE.Vector3(0.06, 0.30, 1) : new THREE.Vector3(0.18, 0.48, 1)))
      .clone().normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const min = box.min, max = box.max;
    let dist = 0, depth = 0;
    const consider = (p: THREE.Vector3): void => {
      const corner = p.clone().sub(centre);
      // Camera space: +z toward the camera, since the camera sits at centre + dir * dist.
      const z = corner.dot(dir), x = Math.abs(corner.dot(right)), yy = Math.abs(corner.dot(up));
      dist = Math.max(dist, z + x / tanH, z + yy / tanV);
      depth = Math.max(depth, Math.abs(z));
    };
    if (this.tightFit && anchored) {
      // Every drawn thing's OWN bounds (padded as the union box was), the lead ends and the markers with
      // their label headroom — never the union box's phantom corners.
      const pad = new THREE.Vector3(0.6, 1.1, 0.6);
      const eachCorner = (bx: THREE.Box3): void => { for (let c = 0; c < 8; c++) consider(new THREE.Vector3(c & 1 ? bx.max.x : bx.min.x, c & 2 ? bx.max.y : bx.min.y, c & 4 ? bx.max.z : bx.min.z)); };
      for (const child of this.group.children) {
        if (child.name === 'datum' || child.name === 'field') continue;
        const bx = new THREE.Box3().setFromObject(child); if (bx.isEmpty()) continue;
        bx.min.sub(pad); bx.max.add(pad); eachCorner(bx);
      }
      for (const b of this.branches) { consider(new THREE.Vector3(b.xA, b.yA, b.zA)); consider(new THREE.Vector3(b.xB, b.yB, b.zB)); }
      for (const p of this.markerPoints) { consider(p.clone().add(new THREE.Vector3(0, 1.1, 0))); consider(p); }
    } else {
      for (let c = 0; c < 8; c++) consider(new THREE.Vector3(c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z));
    }
    dist = Math.max(dist * 1.06, 1);          // a little air, so labels are not flush to the edge
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.05, dist - depth * 2.5);
    this.camera.far = dist + depth * 4 + 20;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(centre);
    this.controls.update();
  }

  private addLabel(text: string, pos: THREE.Vector3, cls: string): LiveLabel {
    const el = document.createElement('div');
    el.className = `plabel ${cls}`;
    el.textContent = text;
    this.labelHost.appendChild(el);
    const rec = { el, pos };
    this.labels.push(rec);
    return rec;
  }

  /**
   * Advance the markers. `dt` is WALL-CLOCK seconds: this is presentation motion,
   * not simulated time, and it advances nothing in the world.
   */
  private flowCue: SceneSpec['flowCue'] | null = null;
  private tightFit = false;
  /** `dt` is SOLVED seconds (0 when paused); `wallDt` wall seconds, used only by the opt-in flow-cue calibration. */
  render(dt: number, wallDt: number = dt): void {
    const m = new THREE.Matrix4();
    const interior=this.resistorInterior;
    const elapsed=this.reducedMotion.matches ? 0 : dt;
    this.resistorTime+=elapsed;
    if(interior) {
      for(let n=0;n<24;n++) {
        const col=n%8,row=Math.floor(n/8);
        m.makeTranslation((col/7-.5)*(interior.length-.42)+Math.sin(this.resistorTime*(2.7+n*.113)+n)*.009,
          -.02+Math.cos(this.resistorTime*(3.3+n*.079)+n)*.009,(row-1)*.25);
        interior.atoms.setMatrixAt(n,m);
      }
      interior.atoms.instanceMatrix.needsUpdate=true;
    }
    for (const br of this.branches) {
      if (!br.markers) continue;
      if (br.current === null) { br.markers.visible = false; continue; }
      const a = new THREE.Vector3(br.xA, br.yA, br.zA);
      const b = new THREE.Vector3(br.xB, br.yB, br.zB);
      const len = br.routeLength ?? a.distanceTo(b);
      if (len < 1e-9) continue;
      // SPEED encodes |I| at the shared printed scale. DIRECTION encodes the sign.
      const share = Math.min(1, Math.abs(br.current) / Math.max(br.fullScaleA ?? this.fullCurrent, 1e-30));
      const cue = this.flowCue;
      // Under the calibration the travel speed has a floor for ANY nonzero current (readability), and nothing else
      // is thresholded: visibility below goes continuously to zero, so a vanishing current is a vanishing cue.
      const speed = cue
        ? (br.current === 0 ? 0 : cue.floorUnitsPerSecond + (cue.fullUnitsPerSecond - cue.floorUnitsPerSecond) * Math.sqrt(share))
        : Math.abs(br.current) * (br.electronCues ? this.currentMotionScale * .30 : this.currentMotionScale);
      // br.current is signed relative to stored A -> B endpoints, not screen direction.
      // Negative carriers drift opposite that signed conventional current.
      const dir = (br.current >= 0 ? 1 : -1) * (br.electronCues ? -1 : 1);
      const elapsed = this.reducedMotion.matches && (br.electronCues || this.resistorInterior) ? 0 : (cue ? (dt === 0 ? 0 : wallDt) : dt);
      br.phase = (br.phase + dir * speed * elapsed / len) % 1;
      if (br.phase < 0) br.phase += 1;
      // TRANSPORT CUES FADE AND SHORTEN WITH THE CURRENT, against the run's FIXED captured
      // bound. Before this they kept full opacity and full length at any current and only
      // slowed down, so a residual millionth of the peak still read as strong transport that
      // happened to be frozen — Peter saw exactly that. The default map is √(|i|/full): a declared
      // contrast curve with NO floor and no exact-zero special case, since √0 = 0. Under the
      // opt-in flowCue calibration the exponent is the page's (a gentler curve keeps a small
      // driven current readable) — still continuous to zero, still no floor. Neither map touches
      // how fast the cues move.
      const cueVis = cue ? Math.pow(share, cue.visibilityPower) : Math.sqrt(share);
      const mat = br.markers.material as THREE.MeshBasicMaterial;
      mat.transparent = true;
      mat.opacity = cueVis;
      br.markers.visible = cueVis > 0;
      const n = br.markers.count;
      const directional = br.markers.geometry === this.rcMarkerGeo;
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0,1,0), b.clone().sub(a).normalize().multiplyScalar(dir));
      for (let i = 0; i < n; i++) {
        const t = ((i / n) + br.phase) % 1;
        const p = br.route ? br.route.getPointAt(t) : a.clone().lerp(b, t);
        if (br.route) rotation.setFromUnitVectors(new THREE.Vector3(0,1,0),br.route.getTangentAt(t).multiplyScalar(dir));
        // Ride on the visible surface, not buried inside the opaque conductor.
        if (directional) {
          // Lift the overlay to the visible face of the exposed material, blending
          // into the lead surface near each contact. Offset is layout, not a wire.
          const base = br.surfaceLift ?? .12;
          const lift = br.id==='rc-R-flow' ? base+.34*Math.min(1,t/.22,(1-t)/.22) : base;
          p.add(new THREE.Vector3(0,0,lift));
        }
        if(br.electronCues) {
          // Net transport cues follow one coherent path, not thermal trajectories.
          // A tiny fixed path undulation exposes the material without hiding travel.
          const material=br.id==='rc-R-flow' ? Math.max(0,Math.min(1,(t-.18)/.07,(.82-t)/.07)) : 0;
          // The same fixed .12 toward the viewer, and it has the same problem as the other
          // lift: it was sized for the thick drawn conductors. On the solved winding, whose
          // wire is at true scale (.016 units), it left the electron cues .12 clear of the
          // wire — measured in the running page as an exactly (0, 0, .12) offset from the
          // route, i.e. seven wire-radii off a conductor they are supposed to be travelling
          // along. surfaceLift carries the per-branch value; the route itself tracks the
          // winding to .00042, so this offset was the whole discrepancy.
          p.add(new THREE.Vector3(0,.018*Math.sin(t*Math.PI*24)*material,br.surfaceLift ?? .12));
        }
        // Shorten along the travel axis too: a streak is a length of transport, so a
        // vanishing current should not draw a full-length one.
        if (directional || br.electronCues) m.compose(p, rotation, new THREE.Vector3(1, cueVis, 1));
        else m.makeTranslation(p.x, p.y, p.z);
        br.markers.setMatrixAt(i, m);
      }
      br.markers.instanceMatrix.needsUpdate = true;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.positionLabels();
  }

  /**
   * Project the labels, then NUDGE APART any that would overlap on screen.
   *
   * Two terraces at the SAME potential project to the same height — which is the
   * correct encoding and exactly the case the drawing exists to show — so their
   * labels collided into unreadable mush. The label MOVES; the terrace, the ring
   * and the leader all stay where the data puts them, so nothing about the
   * encoding shifts. Same fix as the 2D ladder's, in screen space.
   */
  private positionLabels(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const placed: Array<{ x: number; y: number; hh: number; ww: number }> = [];
    const shown = this.labels
      .map((l) => ({ l, p: l.pos.clone().project(this.camera) }))
      .filter(({ l, p }) => {
        const vis = p.z < 1;
        l.el.style.display = vis ? 'block' : 'none';
        return vis;
      })
      // TOP OF SCREEN FIRST, WHICH IS DESCENDING p.y. This read `a.p.y - b.p.y` under a comment
      // saying "top of screen first" — but `p.y` is normalised device coordinates, where +1 is
      // the TOP, so ascending order processed the BOTTOM of the screen first. Every label was
      // then pushed DOWN into ones that had not been placed yet, and each collision cascaded into
      // the next. With four components and a voltage ruler in one view the result was the axis
      // reading 10, −5, −10, 0, 5 from top to bottom: the ruler itself out of order, on a scene
      // whose whole encoding is height. Peter's word for it was "chaotic".
      .sort((a, b) => b.p.y - a.p.y);

    for (const { l, p } of shown) {
      const x = ((p.x + 1) / 2) * w;
      let y = ((-p.y + 1) / 2) * h;
      const hh = l.el.offsetHeight || 26, ww = l.el.offsetWidth || 90;
      // A CENTRED label is placed so its box straddles the projected point; the bottom-anchored
      // box geometry below is unchanged, only its anchor moves down by half the box height.
      if (l.centred) y += hh / 2;
      // Push down until this label clears every one already placed near it in x.
      // TRUE BOX GEOMETRY, not a centre-distance approximation.
      //
      // These labels are BOTTOM-ANCHORED by `translate(-50%, -100%)`, so a label at
      // `y` occupies [y - h, y] vertically and [x - w/2, x + w/2] horizontally. My
      // first version compared centre distances symmetrically, which is simply the
      // wrong test for boxes anchored that way: it missed a real overlap between a
      // 2-line and a 5-line label BY 0.9 px, because the symmetric threshold of 49 px
      // could not represent a span that reaches 66 px on one side and 26 on the other.
      // Astra reported the collision; the cause was this.
      const hitsAt = (yy: number) => placed.find((q) =>
        Math.abs(q.x - x) < (q.ww + ww) / 2 + 4      // horizontal spans overlap
        && yy > q.y - q.hh - 3 && q.y > yy - hh - 3); // vertical spans overlap
      for (let guard = 0; guard < 32; guard++) {
        const hit = hitsAt(y);
        if (!hit) break;
        y = hit.y + hh + 4;                          // drop clear below that label
      }
      placed.push({ x, y, hh, ww });
      l.el.style.left = `${x}px`;
      l.el.style.top = `${y}px`;
    }
  }

  dispose(): void {
    this.clearDrawing();
    this.markerGeo.dispose(); this.rcMarkerGeo.dispose(); this.electronGeo.dispose(); this.electronStillGeo.dispose();
    for (const l of this.labels) l.el.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
