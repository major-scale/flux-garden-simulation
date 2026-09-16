import { canonical, copy, decode, encode, requireRecordingBase, validateAuthored } from './authoring';
import { constructionSubsteps, type Construction } from './construction';
import { Meter, quantity, type MeasureRef, type Sample } from './measure';
import { SI } from './units';
import { SimWorld } from '../sim/world';
import { applyEvent, type InputRecord } from '../sim/record';
export interface Capture {
  format:'fg-capture'; version:1; label:string;
  construction:Construction; identity:string; input:InputRecord;
  profile:{substeps:number; dt:number};
  quantity:string; unit:string; ref:MeasureRef; samples:Sample[];
  throughTick:number; truncated:boolean;
}
export function validateCapture(c:Capture):void {
  canonical(c);
  if(c.format!=='fg-capture'||c.version!==1||typeof c.label!=='string')throw new Error('Unsupported capture');
  validateAuthored(c.construction);
  if(c.identity!==canonical(c.construction))throw new Error('Capture construction identity mismatch');
  requireRecordingBase(c.input,c.construction);
  if(c.profile.dt!==SI.DT||c.profile.substeps!==constructionSubsteps(c.construction))throw new Error('Capture numerical profile mismatch');
  if(!Number.isSafeInteger(c.throughTick)||c.throughTick<0||typeof c.truncated!=='boolean')throw new Error('Invalid capture interval');
  if(c.unit!==quantity(c.quantity).unit)throw new Error('Quantity / SI unit mismatch');
  const ref=c.ref;
  if (c.quantity.startsWith('E.') && ref.kind !== 'world') throw new Error('World energy requires a world reference');
  if(!['world','body','bodyRelativeToPoint','bodyAlongAxis','worldAlongAxis'].includes(ref.kind))throw new Error('Unknown measurement reference');
  if('entityId' in ref && !c.construction.entities.some(e=>e.id===ref.entityId))throw new Error('Trace body absent from its own authored construction');
  if('point' in ref && !['x','y','z'].every(k=>Number.isFinite(ref.point[k as 'x'])))throw new Error('Invalid reference point');
  if('axis' in ref && Math.abs(Math.hypot(ref.axis.x,ref.axis.y,ref.axis.z)-1)>1e-6)throw new Error('Invalid reference axis');
  // Resolve through the existing closed quantity catalogue, never against the active world.
  const probe=new SimWorld();try{probe.build(c.construction);if(quantity(c.quantity).read(probe,ref)===null)throw new Error('Quantity incompatible with reference');}finally{probe.rapier?.free();}
  if(!Array.isArray(c.samples)||c.samples.length<2||c.samples.length>1800)throw new Error('Capture needs 2–1800 samples');
  let last=-1;
  for(const s of c.samples){if(!Number.isSafeInteger(s.tick)||s.tick<=last||s.tick>c.throughTick||s.t!==s.tick*SI.DT||!Number.isFinite(s.value))throw new Error('Malformed capture samples');last=s.tick;}
  if(!Number.isSafeInteger(c.input.checkpointEvery)||c.input.checkpointEvery<1)throw new Error('Invalid recording checkpoint interval');
  if(!Array.isArray(c.input.events))throw new Error('Missing input record');
  let prevTick=-1,prevSeq=-1;
  for(const e of c.input.events){
    if(!Number.isSafeInteger(e.tick)||e.tick<0||e.tick>c.throughTick||!Number.isSafeInteger(e.seq)||e.seq<0||e.tick<prevTick||(e.tick===prevTick&&e.seq<=prevSeq))throw new Error('Malformed input ordering');
    if(!['push','setMass','setStiffness','setDamping','setEnvironment','setGravity','addBlock','removeBlock','grabBegin','grabMove','grabEnd'].includes(e.kind))throw new Error('Unknown recorded input');
    if(typeof e.target!=='string')throw new Error('Invalid event target');
    const vector=(v:unknown)=>{if(!v||typeof v!=='object'||!['x','y','z'].every(k=>typeof (v as Record<string,unknown>)[k]==='number'&&Number.isFinite((v as Record<string,number>)[k])))throw new Error('Malformed event vector');};
    switch(e.kind){
      case 'push':vector(e.impulse);if(e.point)vector(e.point);break;
      case 'grabBegin':vector(e.localPoint);vector(e.worldTarget);break;
      case 'grabMove':vector(e.worldTarget);break;
      case 'setGravity':vector(e.gravity);break;
      case 'setMass':if(!(e.mass>0))throw new Error('Invalid mass input');break;
      case 'setStiffness':if(!(e.stiffness>=0))throw new Error('Invalid stiffness input');break;
      case 'setDamping':if(!(e.damping>=0))throw new Error('Invalid damping input');break;
      case 'setEnvironment':if(!['air','vacuum'].includes(e.medium))throw new Error('Invalid medium input');break;
    }
    prevTick=e.tick;prevSeq=e.seq;
  }
  const inputProbe=new SimWorld();try{inputProbe.build(c.construction);for(const e of c.input.events){const refusal=applyEvent(inputProbe,e);if(refusal)throw new Error(`Recorded input refused: ${refusal}`);}}finally{inputProbe.rapier?.free();}
}
export function captureRun(label:string,construction:Construction,input:InputRecord,meter:Meter,throughTick:number):Capture {
 const c:Capture={format:'fg-capture',version:1,label,construction:copy(construction),identity:canonical(construction),input:copy(input),profile:{substeps:constructionSubsteps(construction),dt:SI.DT},quantity:meter.quantityKey,unit:meter.unit,ref:copy(meter.ref),samples:copy(meter.samples),throughTick,truncated:(meter.samples[0]?.tick??0)>1};
 validateCapture(c);return c;
}
export function compatible(a:Capture,b:Capture):void {
 if(a.quantity!==b.quantity||a.unit!==b.unit||canonical(a.ref)!==canonical(b.ref))throw new Error('Overlay refused: select the same observable, SI unit and authored reference in both runs');
 // Same ID with a different shape/kinematics is not silently treated as the same measured object.
 if('entityId' in a.ref && 'entityId' in b.ref){const aid=a.ref.entityId,bid=b.ref.entityId;const x=a.construction.entities.find(e=>e.id===aid),y=b.construction.entities.find(e=>e.id===bid);if(!x||!y||canonical(x.shape)!==canonical(y.shape)||x.kinematics!==y.kinematics)throw new Error('Measured body definitions are not comparable');}
}
export function differences(a:unknown,b:unknown,path='scene'):string[] {
 if(canonical(a)===canonical(b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
  return [...new Set([...Object.keys(x),...Object.keys(y)])].flatMap(k=>!(k in x)||!(k in y)?[`${path}.${k}: ${k in x?'removed':'added'}`]:differences(x[k],y[k],`${path}.${k}`));
 }
 return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}
export class ComparisonStore {
 private slots: [Capture|null,Capture|null]=[null,null];
 get(index:0|1):Capture|null{return copy(this.slots[index]);}
 set(index:0|1,c:Capture):void {validateCapture(c);const other=this.slots[index===0?1:0];if(other)compatible(index===0?c:other,index===0?other:c);this.slots[index]=copy(c);}
 clear():void{this.slots=[null,null];}
 save():string{return encode({format:'fg-comparisons',version:1,slots:this.slots});}
 load(json:string):void {
  const v=decode(json) as {format:string;version:number;slots:[Capture|null,Capture|null]};
  if(v.format!=='fg-comparisons'||v.version!==1||!Array.isArray(v.slots)||v.slots.length!==2)throw new Error('Unsupported comparison store');
  const next=new ComparisonStore();v.slots.forEach((c,i)=>{if(c)next.set(i as 0|1,c);});this.slots=next.slots;
 }
}
