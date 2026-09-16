import type { Construction, ThermalDesc } from './construction';
import type { EnergyBudget } from './energy';
import { totalElectricalRouted, totalResistorEnergy, type ElectricalState } from './circuit';
export interface ThermalBody { id: string; heat: number; backflowCount: number; }
export interface ThermalState {
  bodies: ThermalBody[];
  /** DAMPER routing ledger, keyed by SPRING id. Signed: negative values are numerical backflow. */
  routed: Array<{springId:string; heat:number}>;
  exportedHeat:number;
  /**
   * BATCH 4 — the ELECTRICAL routing ledger, keyed by COMPONENT id, in ITS OWN
   * ARRAY. Source identities are therefore DISTINCT ACROSS DOMAINS: one shared
   * receiver can take a damper transfer and a resistor transfer without either
   * overwriting or duplicating the other, even if a spring and a resistor were
   * somehow given the same id. OPTIONAL, and its ABSENCE IS MEANINGFUL: it means
   * no resistor heat was ever routed, which is what every pre-circuit state means.
   * Unlike the damper ledger these entries are NON-NEGATIVE — see routeResistorHeat.
   */
  routedElectrical?: Array<{componentId:string; heat:number}>;
}
export function validateThermal(c: Construction): void {
  for (const e of c.entities) if ('thermal' in e) {
    const t=e.thermal;
    if (!t || typeof t!=='object' || Array.isArray(t) || Object.keys(t).sort().join(',')!=='heatCapacity,initialTemperature'
      || !Number.isFinite(t.heatCapacity) || t.heatCapacity<1e-6 || t.heatCapacity>1e9
      || !Number.isFinite(t.initialTemperature) || t.initialTemperature<=0 || t.initialTemperature>1e6)
      throw new Error('Thermal inputs: total heat capacity 1e-6–1e9 J/K and starting temperature >0–1e6 K; finite values only');
  }
  for(const s of c.springs) if ('heatReceiver' in s && (typeof s.heatReceiver!=='string' || !c.entities.some(e=>e.id===s.heatReceiver && e.thermal)))
    throw new Error('Damper heat receiver must name a body with explicit thermal parameters');
}
export function newThermalState(c:Construction):ThermalState {
  return {bodies:c.entities.filter(e=>e.thermal).map(e=>({id:e.id,heat:0,backflowCount:0})),routed:[],exportedHeat:0};
}
/** Signed measured removal; negative values are numerical backflow, never clipped. */
export function routeDamperHeat(state:ThermalState,springId:string,receiver:string|undefined,heat:number):void {
  if(receiver===undefined)return;
  const b=state.bodies.find(x=>x.id===receiver);if(!b)throw new Error('Missing thermal receiver');
  b.heat+=heat;if(heat<0)b.backflowCount++;
  let ledger=state.routed.find(x=>x.springId===springId);
  if(!ledger){ledger={springId,heat:0};state.routed.push(ledger);}ledger.heat+=heat;
}
/**
 * BATCH 4 — ROUTE RESISTOR JOULE HEAT. 100% of one resistor's dissipation into one
 * named receiver.
 *
 *   *** PASSIVE RESISTOR POWER IS NON-NEGATIVE. ***
 * The damper's signed backflow semantics above are CORRECT FOR THE DAMPER — that
 * estimator can legitimately return a negative increment, and clipping it would
 * hide a numerical anomaly. THEY ARE NOT COPIED HERE. Negative Joule heat is not
 * physical, so a negative increment is REFUSED rather than booked as backflow.
 */
export function routeResistorHeat(state:ThermalState,componentId:string,receiver:string|undefined,heat:number):void {
  if(!Number.isFinite(heat)||heat<0)throw new Error('Resistor Joule heat must be finite and non-negative; passive dissipation is never negative and is not numerical backflow');
  if(receiver===undefined)return;
  const b=state.bodies.find(x=>x.id===receiver);if(!b)throw new Error('Missing thermal receiver');
  b.heat+=heat;
  if(!state.routedElectrical)state.routedElectrical=[];
  let ledger=state.routedElectrical.find(x=>x.componentId===componentId);
  if(!ledger){ledger={componentId,heat:0};state.routedElectrical.push(ledger);}ledger.heat+=heat;
}
export const totalHeat=(s:ThermalState):number=>s.exportedHeat+s.bodies.reduce((a,b)=>a+b.heat,0);
/** J. DAMPER-routed work only. Kept separate so the two domains stay identifiable. */
export const totalDamperRouted=(s:ThermalState):number=>s.routed.reduce((a,b)=>a+b.heat,0);
/** J. RESISTOR-routed Joule heat only. */
export const totalResistorRouted=(s:ThermalState):number=>(s.routedElectrical??[]).reduce((a,b)=>a+b.heat,0);
/** J. The COMBINED routed total the integrity rule is stated against: damper-routed + resistor-routed. */
export const totalRouted=(s:ThermalState):number=>totalDamperRouted(s)+totalResistorRouted(s);
/**
 * COMBINED ROUTING INTEGRITY: Q (including exported receiver heat) = damper-routed
 * + resistor-routed. With NO electrical routing present the tolerance is the
 * existing exact 1e-12 J, so nothing about the damper-only behaviour changes; with
 * electrical routing the two sides accumulate in different orders and the declared
 * scale-aware bound max(1e-12 J, 1e-9 x sum|routed|) applies.
 */
export function assertThermalRouting(s:ThermalState,tolerance?:number):void {
  const tol=tolerance??((s.routedElectrical?.length)?Math.max(1e-12,1e-9*Math.abs(totalRouted(s))):1e-12);
  if(!Number.isFinite(totalHeat(s))||!Number.isFinite(totalRouted(s))||Math.abs(totalHeat(s)-totalRouted(s))>tol)
    throw new Error('Thermal routing integrity failed: receiver heat is not routed damper work plus routed resistor heat');
}
export const temperature=(t:ThermalDesc,q:number):number=>t.initialTemperature+q/t.heatCapacity;
export const supportedTemperature=(t:number):boolean=>Number.isFinite(t)&&t>0&&t<=1e6;
/** Old mechanical residual + Q - routed outgoing loss: no double counting. */
export const extendedResidual=(b:EnergyBudget,s:ThermalState):number=>b.unattributed+totalHeat(s)-totalRouted(s);

/**
 * ===========================================================================
 * BATCH 4 — THE EXTENDED-SYSTEM BALANCE, DERIVED SEPARATELY.
 * ===========================================================================
 * This is NOT `extendedResidual` with resistor Q added on. It is written from the
 * boundary outwards, over the system that encloses THE MECHANICAL WORLD AND THE
 * THERMAL RECEIVERS:
 *
 *   IN     = E_mech(0) + interventions + external hand work + ELECTRICAL SUPPLIED
 *   STORED = E_mech(now) + total receiver Q (including heat exported with a
 *                          removed receiver)
 *   OUT    = (owned mechanical dissipation - damper-routed)      outgoing, unmodelled
 *          + (resistor dissipation        - resistor-routed)     outgoing, unmodelled
 *   residual = IN - STORED - OUT
 *
 * JOULE POWER APPEARS EXACTLY ONCE. It enters as `resistor dissipation`, and that
 * term is then split: the ROUTED part is inside STORED as receiver Q, the UNROUTED
 * part is inside OUT as an explicitly outgoing loss. It is never also added to
 * STORED as a second copy.
 *
 * `ELECTRICAL SUPPLIED` is accumulated from SOURCE power, independently of the
 * resistor accumulation, so `supplied - resistor dissipation` is a real checkable
 * term rather than an identity — and it is energy crossing the boundary FROM AN
 * IDEAL EXTERNAL SOURCE, never energy created inside the world.
 */
export interface ExtendedBalance {
  inBaseline:number; inInterventions:number; inHandWork:number; inElectricalSupplied:number;
  storedMechanical:number; storedReceiverHeat:number;
  outMechanicalUnrouted:number; outElectricalUnrouted:number;
  /** J. IN - STORED - OUT. */
  residual:number;
  /** J. supplied - resistor dissipation. Zero for an accepted static DC solve. */
  sourceGap:number;
  /** J. receiver Q - (damper-routed + resistor-routed). Zero when routing integrity holds. */
  routingGap:number;
  /** J. The OLD mechanical remainder, unchanged, carried through for comparison. */
  mechanicalUnattributed:number;
}
export function extendedSystemBalance(b:EnergyBudget,s:ThermalState,e:ElectricalState|undefined):ExtendedBalance {
  const supplied=e?e.suppliedEnergy:0;
  const resistorDissipation=e?totalResistorEnergy(e):0;
  const resistorRouted=e?totalElectricalRouted(e):0;
  const inBaseline=b.baselineTotal, inInterventions=b.interventionsTotal, inHandWork=b.handWorkExternal;
  const storedMechanical=b.current.total, storedReceiverHeat=totalHeat(s);
  const outMechanicalUnrouted=(b.dissipatedDrag+b.dissipatedSpringDamper)-totalDamperRouted(s);
  const outElectricalUnrouted=resistorDissipation-resistorRouted;
  return {
    inBaseline,inInterventions,inHandWork,inElectricalSupplied:supplied,
    storedMechanical,storedReceiverHeat,outMechanicalUnrouted,outElectricalUnrouted,
    residual:(inBaseline+inInterventions+inHandWork+supplied)
      -(storedMechanical+storedReceiverHeat)-(outMechanicalUnrouted+outElectricalUnrouted),
    sourceGap:supplied-resistorDissipation,
    routingGap:storedReceiverHeat-totalRouted(s),
    mechanicalUnattributed:b.unattributed,
  };
}
export function removeThermalBody(s:ThermalState,id:string):void {
  s.exportedHeat+=s.bodies.find(b=>b.id===id)?.heat??0;s.bodies=s.bodies.filter(b=>b.id!==id);
}

/** Checkpoint state cannot silently reset a heated construction. */
export function validateThermalCheckpoint(c:Construction,state:ThermalState|undefined):void {
 validateThermal(c);
 if(!state){if(c.entities.some(e=>e.thermal))throw new Error('Thermal checkpoint is missing evolved state');return;}
 const ids=c.entities.filter(e=>e.thermal).map(e=>e.id).sort();
 if(!Array.isArray(state.bodies)||!Array.isArray(state.routed)||!Number.isFinite(state.exportedHeat)
   ||JSON.stringify(state.bodies.map(b=>b.id).sort())!==JSON.stringify(ids)
   ||state.bodies.some(b=>!Number.isFinite(b.heat)||!Number.isSafeInteger(b.backflowCount)||b.backflowCount<0)
   ||state.routed.some(b=>typeof b.springId!=='string'||!Number.isFinite(b.heat))
   ||new Set(state.routed.map(b=>b.springId)).size!==state.routed.length
   ||(state.routedElectrical!==undefined&&(!Array.isArray(state.routedElectrical)
     ||state.routedElectrical.some(b=>typeof b.componentId!=='string'||!Number.isFinite(b.heat)||b.heat<0)
     ||new Set(state.routedElectrical.map(b=>b.componentId)).size!==state.routedElectrical.length)))
   throw new Error('Malformed thermal checkpoint');
 assertThermalRouting(state,1e-9*Math.max(1,Math.abs(totalRouted(state))));
}
