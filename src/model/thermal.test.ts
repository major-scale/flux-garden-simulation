import {beforeAll,expect,test} from 'vitest';
import {SimWorld,canonicalSimState} from '../sim/world';
import type {Construction} from './construction';
import {AuthoringSession,canonical,copy,deleteBody,saveAuthored,loadAuthored,validateAuthored} from './authoring';
import {assertThermalRouting,totalHeat,totalRouted,temperature,routeDamperHeat} from './thermal';
import {captureRun,differences} from './comparison';
import {Meter} from './measure';
import {Recorder} from '../sim/record';
import {takeCheckpoint,restoreCheckpoint,replay,type InputRecord} from '../sim/record';
beforeAll(async()=>{await SimWorld.initEngine();});
export function fixture(M=4,damping=.4,thermal=true):Construction {
 return {format:'fp1-construction',formatVersion:1,name:'Declared thermal oscillator',nextSerial:2,numerics:{substeps:M},environment:{medium:'vacuum',gravity:{x:0,y:0,z:0}},entities:[{
 id:'housing',label:'Damper housing',kinematics:'dynamic',shape:{kind:'sphere',radius:.1},material:{mass:1,friction:0,restitution:0},translation:{x:1.2,y:0,z:0},rotation:{x:0,y:0,z:0,w:1},linvel:{x:0,y:0,z:0},angvel:{x:0,y:0,z:0},colour:0xffaa22,...(thermal?{thermal:{heatCapacity:2,initialTemperature:300}}:{})
 }],springs:[{id:'damper',a:{kind:'world',point:{x:0,y:0,z:0}},b:{kind:'body',entityId:'housing',localPoint:{x:0,y:0,z:0}},restLength:1,stiffness:4,damping,...(thermal?{heatReceiver:'housing'}:{})}]};
}
const run=(s:SimWorld,n:number)=>{for(let i=0;i<n;i++)s.tickOnce();};
const reference=(t:number)=>{const a=.2,w=Math.sqrt(4-a*a),u=.2*Math.exp(-a*t)*(Math.cos(w*t)+a/w*Math.sin(w*t)),v=-.2*Math.exp(-a*t)*4/w*Math.sin(w*t);return {x:1+u,Q:.08-(.5*v*v+2*u*u)};};
test('declared independent oscillator, total-energy bound and refinement',()=>{
 const errors:number[]=[];
 for(const M of [4,16,64]){
  const s=new SimWorld();s.build(fixture(M));let xErr=0,qErr=0,balance=0;
  for(let i=0;i<=600;i++){
   const ref=reference(i/60),Q=totalHeat(s.thermal);
   xErr=Math.max(xErr,Math.abs(s.body('housing').translation().x-ref.x)/.2);
   qErr=Math.max(qErr,Math.abs(Q-ref.Q)/.08);
   balance=Math.max(balance,Math.abs(s.budget.current.total+Q-.08)/.08);
   assertThermalRouting(s.thermal);
   let contacts=0;s.rapier.contactPairsWith(s.body('housing').collider(0),()=>contacts++);expect(contacts).toBe(0);
   if(i<600)s.tickOnce();
  }
  console.log('THERMAL reference', {M,xErr,qErr,balance,Q:totalHeat(s.thermal)});
  if(M===64){expect(xErr).toBeLessThanOrEqual(.01);expect(qErr).toBeLessThanOrEqual(.01);expect(balance).toBeLessThanOrEqual(.01);}
  expect(totalHeat(s.thermal)).toBeGreaterThan(0);errors.push(qErr);s.rapier.free();
 }
 expect(errors[2]).toBeLessThan(.6*errors[0]);
});
test('routing does not change any mechanical state or budget, every tick',()=>{
 const a=new SimWorld(),b=new SimWorld();a.build(fixture());b.build(fixture(4,.4,false));
 for(let i=0;i<600;i++){a.tickOnce();b.tickOnce();expect(a.budget).toEqual(b.budget);expect(a.body('housing').translation()).toEqual(b.body('housing').translation());expect(a.body('housing').linvel()).toEqual(b.body('housing').linvel());expect(a.body('housing').rotation()).toEqual(b.body('housing').rotation());expect(a.body('housing').angvel()).toEqual(b.body('housing').angvel());}
 a.rapier.free();b.rapier.free();
});
test('undamped storage gives zero heat despite integration residual; residual-injection mutant is rejected',()=>{
 const s=new SimWorld();s.build(fixture(4,0));let residual=0;
 for(let i=0;i<600;i++){s.tickOnce();expect(totalHeat(s.thermal)).toBe(0);expect(temperature(s.runtime('housing').desc.thermal!,totalHeat(s.thermal))).toBe(300);residual=Math.max(residual,Math.abs(s.budget.unattributed));}
 expect(residual).toBeGreaterThan(1e-8);
 const mutant=copy(s.thermal);mutant.bodies[0].heat-=s.budget.unattributed;
 expect(Math.abs(s.budget.unattributed+totalHeat(mutant)-totalRouted(mutant))).toBe(0);
 expect(()=>assertThermalRouting(mutant)).toThrow('routing integrity failed');
 console.log('Executed residual-injection mutant: routing assertion RED as required',residual);s.rapier.free();
});
test('signed backflow is retained and counted, never clamped',()=>{
 const state={bodies:[{id:'housing',heat:0,backflowCount:0}],routed:[],exportedHeat:0};routeDamperHeat(state,'damper','housing',-.25);
 expect(state.bodies[0]).toEqual({id:'housing',heat:-.25,backflowCount:1});assertThermalRouting(state);
});
test('new schema fields mutation/roundtrip and refusal matrix',()=>{
 const base=fixture();const rows:Array<[string,(c:Construction)=>void,boolean]>=[
 ['capacity value',c=>c.entities[0].thermal!.heatCapacity=3,true],['temperature value',c=>c.entities[0].thermal!.initialTemperature=301,true],
 ['receiver absence',c=>delete c.springs[0].heatReceiver,true],['thermal absence and routing absence',c=>{delete c.springs[0].heatReceiver;delete c.entities[0].thermal;},true],
 ['capacity zero',c=>c.entities[0].thermal!.heatCapacity=0,false],['capacity NaN',c=>c.entities[0].thermal!.heatCapacity=NaN,false],['capacity overflow',c=>c.entities[0].thermal!.heatCapacity=1e10,false],
 ['temperature zero',c=>c.entities[0].thermal!.initialTemperature=0,false],['temperature infinity',c=>c.entities[0].thermal!.initialTemperature=Infinity,false],['temperature overflow',c=>c.entities[0].thermal!.initialTemperature=1e7,false],
 ['missing C',c=>delete (c.entities[0].thermal as any).heatCapacity,false],['missing T0',c=>delete (c.entities[0].thermal as any).initialTemperature,false],['unknown thermal field',c=>(c.entities[0].thermal as any).mass=1,false],
 ['dangling receiver',c=>c.springs[0].heatReceiver='missing',false],['unconfigured receiver',c=>delete c.entities[0].thermal,false],['null receiver',c=>(c.springs[0] as any).heatReceiver=null,false]
 ];
 for(const [name,change,valid] of rows){const c=copy(base);change(c);if(valid){validateAuthored(c);expect(canonical(loadAuthored(saveAuthored(c))),name).toBe(canonical(c));expect(canonical(c),name).not.toBe(canonical(base));}else expect(()=>validateAuthored(c),name).toThrow();}
 console.log('THERMAL mutation matrix',rows.length,'of',rows.length);
});
test('authored save, checkpoint continuation, record replay and deletion retain thermal boundaries',()=>{
 const c=fixture(),session=new AuthoringSession(c),s=new SimWorld();s.build(c);run(s,90);
 expect(totalHeat(s.thermal)).toBeGreaterThan(0);expect(loadAuthored(session.save())).toEqual(c);
 const cp=takeCheckpoint(s,{pendingEvents:[],selectedId:'housing',settings:{paused:true,recording:false},seqCounter:0,recordedEvents:[],recordingBase:c});
 const t=new SimWorld();restoreCheckpoint(t,cp);expect(canonicalSimState(t)).toBe(canonicalSimState(s));run(t,30);run(s,30);expect(canonicalSimState(t)).toBe(canonicalSimState(s));
 const rec:InputRecord={format:'fp1-record',formatVersion:1,engine:`@dimforge/rapier3d-compat@${SimWorld.engineVersion()}`,construction:c,events:[],checkpointEvery:60};
 const r=new SimWorld();replay(r,rec,120);expect(canonicalSimState(r)).toBe(canonicalSimState(s));
 const removed=copy(c);deleteBody(removed,'housing');expect(removed.springs).toEqual([]);validateAuthored(removed);
 s.removeEntity('housing');expect(s.thermal.bodies).toEqual([]);expect(s.thermal.exportedHeat).toBeGreaterThan(0);assertThermalRouting(s.thermal);
 for(const x of [s,t,r])x.rapier.free();
});
test('receiver value/presence, isolated capacity changes, provenance and captured-base replay',()=>{
 const a=fixture();const other=copy(a.entities[0]);other.id='other';other.translation={x:20,y:0,z:0};other.kinematics='fixed';a.entities.push(other);
 const b=copy(a);b.springs[0].heatReceiver='other';expect(canonical(loadAuthored(saveAuthored(b)))).toBe(canonical(b));expect(canonical(b)).not.toBe(canonical(a));
 const s=new SimWorld();s.build(b);run(s,120);expect(s.thermal.bodies.find(b=>b.id==='housing')!.heat).toBe(0);expect(s.thermal.bodies.find(b=>b.id==='other')!.heat).toBeGreaterThan(0);
 deleteBody(b,'other');expect(b.springs[0].heatReceiver).toBeUndefined();validateAuthored(b);
 s.removeEntity('other');expect(s.springs[0].heatReceiver).toBeUndefined();assertThermalRouting(s.thermal);s.rapier.free();
 const make=(C:number)=>{const c=fixture();c.entities[0].thermal!.heatCapacity=C;const w=new SimWorld();w.build(c);const m=new Meter('pos.x',{kind:'body',entityId:'housing'});m.sample(w);for(let i=0;i<120;i++){w.tickOnce();m.sample(w);}const capture=captureRun('test',c,new Recorder().toRecord(c),m,w.tick);w.rapier.free();return capture;};
 const x=make(2),y=make(4);expect(differences(x.construction,y.construction,'scene')).toEqual(['scene.entities.0.thermal.heatCapacity: 2 → 4']);
 const replayed=new SimWorld();replay(replayed,x.input,120);expect(totalHeat(replayed.thermal)).toBeGreaterThan(0);expect(replayed.runtime('housing').desc.thermal!.heatCapacity).toBe(2);replayed.rapier.free();
 console.log('Additional mutation obligations: receiver value and configured receiver presence roundtrip 2/2');
});
