import { expect, it } from 'vitest';
import { FAN_COMPOSITION } from '../model/fan';
import { railInputFrom, railLayout, structuralHash, validateRailLayout, checkGeometry3D } from './rail-layout';

const groups: Record<string, string> = {s:'sensing',rb:'sensing',p:'sensing',c:'control',q:'control',m:'power',fw:'power'};
const fresh = () => railLayout(railInputFrom(FAN_COMPOSITION, p => groups[p.name] ?? 'control', ['sensing','control','power']), structuralHash(FAN_COMPOSITION));

it('review: long wire cannot tunnel through a box between fixed sample points', () => {
  const r = checkGeometry3D([{id:'long',owner:'wire',kind:'lead',net:'n',points:[[0,0,0],[100,0,0]]}],
    [{id:'box',kind:'box',min:[0.8,-0.2,-0.2],max:[1.2,0.2,0.2]}],[],null,{});
  expect(r.diagnostics.some(d => d.cause === 'clearance' && d.severity === 'error')).toBe(true);
});

it('review: a cable attached to a pin cannot traverse its entire package', () => {
  const r = checkGeometry3D([{id:'cable',owner:'chip',kind:'cable',net:'n',points:[[-1,0,0],[3,0,0]]}],
    [{id:'chip',kind:'box',min:[-1,-1,-1],max:[1,1,1]}],
    [{part:'chip',port:'pin',net:'n',at:[-1,0,0],out:[-1,0]}],null,{n:['chip.pin']});
  expect(r.diagnostics.some(d => d.cause === 'clearance' && d.severity === 'error')).toBe(true);
});

it('review: missing all wires cannot pass with an unchanged structural stamp', () => {
  const l = fresh(); l.wires = [];
  expect(validateRailLayout(l, FAN_COMPOSITION).ok).toBe(false);
});

it('review: nonfinite wire geometry cannot pass', () => {
  const l = fresh();
  l.wires.push({owner:'invalid',kind:'lead',net:'vdd',points:[[NaN,NaN],[NaN,NaN]]});
  expect(validateRailLayout(l, FAN_COMPOSITION).ok).toBe(false);
});

it('review: same owner does not permit different nets to touch away from a terminal', () => {
  const l = fresh();
  l.wires.push({owner:'c',kind:'cable',net:'vdd',points:[[100,100],[101,100]]});
  l.wires.push({owner:'c',kind:'cable',net:'0',points:[[101,100],[102,100]]});
  expect(validateRailLayout(l, FAN_COMPOSITION).ok).toBe(false);
});
