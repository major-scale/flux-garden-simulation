import { beforeAll, expect, test } from 'vitest';
import { SimWorld } from '../sim/world';
import { Recorder } from '../sim/record';
import { defaultConstruction } from './construction';
import { Meter } from './measure';
import { AuthoringSession, canonical, copy, deleteBody } from './authoring';
import { captureRun, ComparisonStore, differences, validateCapture } from './comparison';
beforeAll(()=>SimWorld.initEngine());
function fixture(){const c=defaultConstruction(),s=new SimWorld();s.build(c);const m=new Meter('pos.y',{kind:'body',entityId:'loose0'});for(let i=0;i<4;i++){s.tickOnce();m.sample(s);}const r=new Recorder().toRecord(c);const capture=captureRun('A',c,r,m,s.tick);s.rapier.free();return capture;}
test('two immutable captures survive scene replacement/deletion, resolve only in their own base',()=>{
 const a=fixture(),store=new ComparisonStore();store.set(0,a);const b=copy(a);b.label='B';b.construction.entities.find(e=>e.id==='loose0')!.material.mass=2;b.identity=canonical(b.construction);b.input.construction=copy(b.construction);store.set(1,b);
 expect(differences(a.construction,b.construction).join(' ')).toContain('material.mass: 1.5 → 2');
 const session=new AuthoringSession(a.construction);session.edit(c=>deleteBody(c,'loose0'),'delete');
 expect(store.get(0)!.construction.entities.some(e=>e.id==='loose0')).toBe(true);
 a.samples[0].value=999;expect(store.get(0)!.samples[0].value).not.toBe(999);
 const reopened=new ComparisonStore();reopened.load(store.save());expect(canonical(reopened.get(0))).toBe(canonical(store.get(0)));
 const out=reopened.get(0)!;out.label='mutated copy';expect(reopened.get(0)!.label).toBe('A');
});
test('wrong unit, stale ID, bad axis, profile/base mismatch and bad samples explicitly refused',()=>{
 const a=fixture();const mutations=[(c:typeof a)=>{c.unit='cm';},(c:typeof a)=>{c.ref={kind:'body',entityId:'missing'};},(c:typeof a)=>{c.ref={kind:'bodyAlongAxis',entityId:'loose0',point:{x:0,y:0,z:0},axis:{x:0,y:0,z:0}};},(c:typeof a)=>{c.profile.substeps=128;},(c:typeof a)=>{c.input.construction.name='wrong';},(c:typeof a)=>{c.samples[1].tick=c.samples[0].tick;},(c:typeof a)=>{c.samples[0].t+=1;},(c:typeof a)=>{c.quantity='nonexistent';}];
 for(const mutate of mutations){const c=copy(a);mutate(c);expect(()=>validateCapture(c)).toThrow();}
});
test('same-unit unrelated quantity overlay refused and failed replace atomic',()=>{
 const a=fixture(),store=new ComparisonStore();store.set(0,a);const b=copy(a);b.quantity='pos.x';expect(()=>store.set(1,b)).toThrow('Overlay refused');expect(store.get(1)).toBeNull();
 const before=store.save();expect(()=>store.load('{"format":"bad"}')).toThrow();expect(store.save()).toBe(before);
});

test('captured input refuses malformed vectors and unresolved event targets before replay',()=>{
 const a=fixture();
 a.input.events=[{kind:'push',target:'loose0',tick:0,seq:0,wallClockMs:0,impulse:{x:1,y:0,z:0}}];
 expect(()=>validateCapture(a)).not.toThrow();
 const b=copy(a);delete (b.input.events[0] as unknown as Record<string,unknown>).impulse;expect(()=>validateCapture(b)).toThrow('Malformed event vector');
 const c=copy(a);c.input.events[0].target='missing';expect(()=>validateCapture(c)).toThrow('no entity');
 const d=copy(a);d.input.formatVersion=99 as 1;expect(()=>validateCapture(d)).toThrow('recording format');
});
