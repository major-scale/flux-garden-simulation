import { beforeAll, describe, expect, test } from 'vitest';
import { defaultConstruction, type Construction, type EntityDesc } from './construction';
import { SimWorld } from '../sim/world';
import { Recorder, applyEvent } from '../sim/record';
import { AuthoringSession, canonical, copy, decode, deleteBody, encode, loadAuthored, requireRecordingBase, saveAuthored } from './authoring';
import { qaxisAngle, qconj, qinvrot, qmul, type Quat } from './units';
import type { FixedJointDesc } from './joints';

beforeAll(() => SimWorld.initEngine());
function fixture(): Construction {
  const c = defaultConstruction(); c.numerics = { substeps: 4 }; c.joints = [];
  const e = c.entities.find(x => x.kinematics === 'dynamic')!;
  e.material.dragCd = 1.05;
  for (const [id,shape] of [['sphere', {kind:'sphere',radius:0.2}],['capsule',{kind:'capsule',radius:0.2,halfHeight:0.3}]] as const) {
    c.entities.push({...copy(e), id, shape, translation:{x:3,y:4,z:0}} as EntityDesc);
  }
  c.joints.push({id:'j1',kind:'hinge',bodyA:e.id,bodyB:'sphere',anchorA:{x:0,y:0,z:0},anchorB:{x:0,y:0,z:0},axis:{x:0,y:0,z:1}});
  c.joints.push({id:'j2',kind:'slider',bodyA:e.id,bodyB:'capsule',anchorA:{x:0,y:0,z:0},anchorB:{x:0,y:0,z:0},axis:{x:0,y:0,z:1}});
  // BB2 — the two NEW variants, both ALIGNED, so the misalignment gate lets them through
  // and the matrix tests the SCHEMA rather than the gate. `sphere` and `capsule` share a
  // position and an identity rotation, so equal local anchors are coincident in world.
  c.joints.push({id:'ball0',kind:'ball',bodyA:'sphere',bodyB:'capsule',anchorA:{x:0.1,y:0.2,z:0.3},anchorB:{x:0.1,y:0.2,z:0.3}});
  // A FIXED connection with a genuinely NON-IDENTITY relative pose, so its two frames carry
  // real information and could not be replaced by an axis.
  const fxRot: Quat = qaxisAngle({x:0,y:0,z:1}, 0.4);
  for (const [id,rot] of [['fx1',{x:0,y:0,z:0,w:1} as Quat],['fx2',fxRot]] as const) {
    c.entities.push({...copy(e), id, shape:{kind:'box',hx:0.2,hy:0.2,hz:0.2}, translation:{x:5,y:4,z:0}, rotation:{...rot}} as EntityDesc);
  }
  c.joints.push({
    id:'fixed0', kind:'fixed', bodyA:'fx1', bodyB:'fx2',
    anchorA:{x:0.2,y:0,z:0}, anchorB:qinvrot(fxRot,{x:0.2,y:0,z:0}),
    frameA:{x:0,y:0,z:0,w:1}, frameB:qconj(fxRot),
  });
  // Both endpoint variants at both positions; these are persistence fixtures, not fidelity claims.
  c.springs.push({id:'reverse',a:{kind:'body',entityId:e.id,localPoint:{x:0,y:0,z:0}},b:{kind:'world',point:{x:0,y:2,z:0}},restLength:1,stiffness:10,damping:1});
  return c;
}
type Mutation = { name: string; change: (c: Construction) => void };
const cases: Mutation[] = [];
function path(name: string, p: (string|number)[]): void {
  cases.push({name,change:c=>{
    let target = c as unknown as Record<string|number, unknown>;
    for(const k of p.slice(0,-1)) target = target[k] as Record<string|number, unknown>;
    const key=p[p.length-1], value=target[key];
    target[key] = typeof value==='number' ? value+0.125 : `${String(value)}_changed`;
  }});
}
for(const k of ['format','formatVersion','name','nextSerial']) path(k,[k]);
for(const k of ['numerics','joints']) cases.push({name:`${k} presence`,change:c=>{delete (c as unknown as Record<string,unknown>)[k];}});
path('numerics.substeps',['numerics','substeps']);
path('environment.medium',['environment','medium']);
for(const k of ['x','y','z']) path(`gravity.${k}`,['environment','gravity',k]);
const source = fixture(); const ei=source.entities.findIndex(e=>e.kinematics==='dynamic');
for(const k of ['id','label','kinematics','colour']) path(`entity.${k}`,['entities',ei,k]);
for(const k of ['mass','restitution','friction','dragCd']) path(`material.${k}`,['entities',ei,'material',k]);
cases.push({name:'dragCd presence',change:c=>{delete c.entities[ei].material.dragCd;}});
for(const v of ['translation','rotation','linvel','angvel']) for(const k of v==='rotation'?['x','y','z','w']:['x','y','z']) path(`${v}.${k}`,['entities',ei,v,k]);
path('shape.kind',['entities',ei,'shape','kind']);
for(const [kind,dims] of [['box',['hx','hy','hz']],['sphere',['radius']],['capsule',['halfHeight','radius']]] as const) {
 const index=source.entities.findIndex(e=>e.shape.kind===kind);
 for(const d of dims) path(`${kind}.${d}`,['entities',index,'shape',d]);
}
for(const k of ['id','restLength','stiffness','damping']) path(`spring.${k}`,['springs',0,k]);
for(const ep of ['a','b'] as const) {
 path(`${ep}.kind`,['springs',0,ep,'kind']);
 for(const variant of ['world','body'] as const) {
  const index=source.springs.findIndex(s=>s[ep].kind===variant);
  if(variant==='body') path(`${ep}.entityId`,['springs',index,ep,'entityId']);
  for(const k of ['x','y','z']) path(`${ep}.${variant}.${k}`,['springs',index,ep,variant==='world'?'point':'localPoint',k]);
 }
}
for(const k of ['id','kind','bodyA','bodyB']) path(`joint.${k}`,['joints',0,k]);
for(const v of ['anchorA','anchorB','axis']) for(const k of ['x','y','z']) path(`joint.${v}.${k}`,['joints',0,v,k]);
// ---------------------------------------------------------------------------
// BB2 — THE 34 NEW OBLIGATIONS, enumerated in EXPECTATIONS-BB2-CONNECTIONS.md PART 5
// BEFORE they were written. 79 + 34 = 113.
// ---------------------------------------------------------------------------
const BALL_I = source.joints!.findIndex(j=>j.kind==='ball');
const FIXED_I = source.joints!.findIndex(j=>j.kind==='fixed');
const HINGE_I = source.joints!.findIndex(j=>j.kind==='hinge');
// (a),(c) identity fields of each new variant
for(const k of ['id','kind','bodyA','bodyB']) path(`ball.${k}`,['joints',BALL_I,k]);
for(const k of ['id','kind','bodyA','bodyB']) path(`fixed.${k}`,['joints',FIXED_I,k]);
// (b),(d) both anchors of each new variant, all three components
for(const v of ['anchorA','anchorB']) for(const k of ['x','y','z']) path(`ball.${v}.${k}`,['joints',BALL_I,v,k]);
for(const v of ['anchorA','anchorB']) for(const k of ['x','y','z']) path(`fixed.${v}.${k}`,['joints',FIXED_I,v,k]);
// (e) BOTH connection frames, all four components each
for(const v of ['frameA','frameB']) for(const k of ['x','y','z','w']) path(`fixed.${v}.${k}`,['joints',FIXED_I,v,k]);
// (f) a NORM-PRESERVING, ALIGNMENT-PRESERVING re-framing of BOTH frames together. This one
// must be DETECTED, not refused: it is the proof that the frames are inside canonical
// identity rather than merely surviving a unit-norm check.
cases.push({name:'fixed frames re-framed together (norm- and alignment-preserving) — must be DETECTED',change:c=>{
  const j=c.joints![FIXED_I] as FixedJointDesc; const S=qaxisAngle({x:1,y:1,z:1},0.3);
  j.frameA=qmul(j.frameA,S); j.frameB=qmul(j.frameB,S);
}});
// (g)..(k) HONEST VARIANT SEMANTICS: a field that does not belong to the variant, or one it
// requires and does not have, must be REFUSED — never ignored and never defaulted.
cases.push({name:'ball given an axis field — REFUSED',change:c=>{(c.joints![BALL_I] as unknown as Record<string,unknown>).axis={x:0,y:0,z:1};}});
cases.push({name:'fixed given an axis field — REFUSED',change:c=>{(c.joints![FIXED_I] as unknown as Record<string,unknown>).axis={x:0,y:0,z:1};}});
cases.push({name:'hinge with axis removed — REFUSED',change:c=>{delete (c.joints![HINGE_I] as unknown as Record<string,unknown>).axis;}});
cases.push({name:'fixed with frameB removed — REFUSED',change:c=>{delete (c.joints![FIXED_I] as unknown as Record<string,unknown>).frameB;}});
cases.push({name:'ball kind changed to fixed with NO frames supplied — REFUSED',change:c=>{(c.joints![BALL_I] as unknown as Record<string,unknown>).kind='fixed';}});

for(const collection of ['entities','springs','joints'] as const) {
 cases.push({name:`${collection} membership`,change:c=>{c[collection]!.pop();}});
 cases.push({name:`${collection} order`,change:c=>{c[collection]!.reverse();}});
}

describe('Authored construction: frozen 113-obligation inventory (79 + BB2\'s 34)',()=>{
 test('valid complete schema and all variants round-trip; -0 and optional absence preserved',()=>{
  for(const c of [fixture(),defaultConstruction()]) {
   c.entities[0].translation.x=-0;
   expect(canonical(loadAuthored(saveAuthored(c)))).toBe(canonical(c));
  }
 });
 test('113/113 independent mutations detected or refused; valid controls above prevent vacuous rejection',()=>{
  expect(cases).toHaveLength(113); let detected=0,refused=0;
  const original=canonical(source);
  for(const m of cases) {
   const changed=copy(source); m.change(changed);
   const raw=encode({format:'fg-authored',version:1,construction:changed});
   try { expect(canonical(loadAuthored(raw)),m.name).not.toBe(original); detected++; }
   catch(err) { if(String(err).includes('AssertionError')) throw err; refused++; }
  }
  console.log(`AUTHORED MUTATIONS ${detected+refused}/113 (${detected} compared, ${refused} validation refusals)\n${cases.map(c=>c.name).join('\n')}`);
  expect(detected+refused).toBe(113);
 });
 test('unknown fields / nonfinite / dangling joint explicitly refused',()=>{
  const c=fixture(); (c as unknown as Record<string,unknown>).hidden=1;
  expect(()=>saveAuthored(c)).toThrow('Unknown field');
  const d=fixture(); d.entities[0].translation.x=Infinity; expect(()=>saveAuthored(d)).toThrow('Nonfinite');
  const j=fixture(); j.joints![0].bodyB='gone'; expect(()=>saveAuthored(j)).toThrow('no entity');
 });
});

describe('Authoring/run/checkpoint boundary',()=>{
 test('save after evolution AND mass intervention saves starting scene, never runtime descriptors',()=>{
  const a=new AuthoringSession(defaultConstruction()), sim=new SimWorld(), rec=new Recorder(); a.start(sim,rec);
  const original=a.identity; for(let i=0;i<30;i++)sim.tickOnce();
  expect(applyEvent(sim,{kind:'setMass',target:'loose0',mass:2,tick:sim.tick,seq:0,wallClockMs:0})).toBeNull();
  expect(canonical(loadAuthored(a.save()))).toBe(original);
  expect(canonical(sim.construction)).not.toBe(original);
  expect(sim.body('loose0').translation().y).not.toBe(a.authored.entities.find(e=>e.id==='loose0')!.translation.y);
  sim.rapier.free();
 });
 test('edit commits a distinct energy audit, terminates recording; new run clears old work and hand',()=>{
  const a=new AuthoringSession(defaultConstruction()), sim=new SimWorld(), rec=new Recorder(); a.start(sim,rec); rec.begin(a.authored);
  sim.beginGrab('loose0',{x:0,y:0,z:0},{x:2,y:3,z:0}); sim.tickOnce();
  a.edit(c=>{c.entities.find(e=>e.id==='loose0')!.translation.y+=1;},'raise');
  expect(a.audit).toHaveLength(1); expect(a.audit[0].deltaInitialEnergy).toBeCloseTo(1.5*9.81,4);
  a.start(sim,rec); expect(sim.tick).toBe(0); expect(sim.hand.active).toBe(false);
  expect(sim.budget.interventionsTotal).toBe(0); expect(sim.budget.handWorkExternal).toBe(0); expect(rec.recording).toBe(false);expect(rec.events).toHaveLength(0);
  const identity=a.identity; expect(()=>a.edit(c=>{c.entities[0].rotation.w=7;},'invalid')).toThrow();expect(a.identity).toBe(identity);expect(a.audit).toHaveLength(1);
  sim.rapier.free();
 });
 test('delete connected body leaves file and rebuilt world coherent',()=>{
  const a=new AuthoringSession(defaultConstruction());a.edit(c=>deleteBody(c,'platform'),'delete');
  const c=loadAuthored(a.save());expect(c.springs).toHaveLength(0);expect(c.entities.some(e=>e.id==='platform')).toBe(false);
  const sim=new SimWorld();sim.build(c);expect(sim.entities.has('platform')).toBe(false);sim.rapier.free();
 });
 test('mismatched active replay refused; explicit load-base permitted',()=>{
  const a=defaultConstruction(), rec=new Recorder();rec.begin(a);const record=rec.toRecord(a);const b=copy(a);b.name='different';
  expect(()=>requireRecordingBase(record,b)).toThrow('different authored');
  expect(()=>requireRecordingBase(record,copy(record.construction))).not.toThrow();
  expect((decode(saveAuthored(a)) as {format:string}).format).toBe('fg-authored');
 });
});

test('saved authored base remains separate when checkpoint resumes an evolved, held world', async()=>{
 const {takeCheckpoint,restoreCheckpoint,extrasFrom}=await import('../sim/record');
 const a=new AuthoringSession(defaultConstruction()),sim=new SimWorld(),rec=new Recorder();a.start(sim,rec);rec.begin(a.authored);
 sim.beginGrab('loose0',{x:0,y:0,z:0},{x:2,y:3,z:0});for(let i=0;i<10;i++)sim.tickOnce();
 const checkpoint=takeCheckpoint(sim,extrasFrom(rec,{pendingEvents:[],selectedId:'loose0',paused:true}));
 const envelope=encode({authored:a.save(),checkpoint});
 const saved=decode(envelope) as {authored:string;checkpoint:typeof checkpoint};
 const fresh=new SimWorld();fresh.build(defaultConstruction());const restored=new AuthoringSession(loadAuthored(saved.authored));restoreCheckpoint(fresh,saved.checkpoint);
 expect(restored.identity).toBe(a.identity);expect(fresh.hand.active).toBe(true);expect(fresh.tick).toBe(10);
 expect(fresh.body('loose0').translation().y).toBe(sim.body('loose0').translation().y);
 expect(canonical(loadAuthored(restored.save()))).toBe(canonical(defaultConstruction()));sim.rapier.free();fresh.rapier.free();
});

test('new spring local endpoints survive exact save and a refused spring edit is atomic',()=>{
 const a=new AuthoringSession(defaultConstruction());
 a.edit(c=>c.springs.push({id:'auth-spring',a:{kind:'body',entityId:'ground',localPoint:{x:1,y:4,z:0}},b:{kind:'body',entityId:'loose0',localPoint:{x:0.1,y:0,z:0}},stiffness:50,damping:1,restLength:1}),'connect');
 const identity=a.identity;expect(canonical(loadAuthored(a.save()))).toBe(identity);
 expect(()=>a.edit(c=>{c.springs.at(-1)!.restLength=-1;},'invalid')).toThrow('Rest length');expect(a.identity).toBe(identity);
 a.edit(c=>deleteBody(c,'loose0'),'delete');expect(loadAuthored(a.save()).springs.some(s=>s.id==='auth-spring')).toBe(false);
});
