import {describe,expect,it} from 'vitest';import {createExample}from'../src/examples';import{modelDifferences,bottleneckCandidate}from'../src/model/modelDiff';import{simulate}from'../src/engine';
describe('immutable input differences',()=>{
 it('ignores project/model/step/resource/class names and array order when numerical identity matches',()=>{
  const a=createExample('factory').model,b=structuredClone(a);b.name='Another name';b.nodes.reverse();b.resources.reverse();b.nodes.forEach(n=>{n.label='Newlabel';if(n.kind==='source')n.classes.forEach(c=>{c.label='Newclass';});});b.resources.forEach(p=>p.label='Newteam');expect(modelDifferences(a,b)).toEqual([]);
 });
 it('reports exact station/resource and seed/horizon changes without rewriting either snapshot',()=>{
  const a=createExample('factory').model,b=structuredClone(a),original=structuredClone(a);const n=b.nodes.find(n=>n.kind==='service')!;n.servers=4;b.resources[0].capacity=2;b.seed++;b.horizon=7200;
  const rows=modelDifferences(a,b);expect(rows.some(r=>r.label.includes('Parallel stations')&&r.before==='1'&&r.after==='4')).toBe(true);expect(rows.some(r=>r.label.includes('Base available units')&&r.before==='1'&&r.after==='2')).toBe(true);expect(rows.map(r=>r.key)).toContain('seed');expect(a).toEqual(original);
 });
 it('ignores duplicate-destination route ordering alongside another genuine change',()=>{
  const a=createExample('factory').model,sink=a.nodes.find(n=>n.kind==='sink')!;a.nodes.push({id:'decision',samplingId:'decision',label:'Decision',kind:'route',branches:[{to:sink.id,probability:.2},{to:sink.id,probability:.8}]});const b=structuredClone(a),route=b.nodes.find(n=>n.kind==='route')!;route.branches.reverse();b.horizon=7200;expect(modelDifferences(a,b).map(r=>r.key)).toEqual(['horizon']);
 });
 it('bases a bottleneck candidate on recorded queue observations, not invented improvement',()=>{
  const run=simulate(createExample('factory').model),candidate=bottleneckCandidate(run);expect(candidate?.averageQueue).toBe(Math.max(...run.stations.map(s=>s.averageQueue)));expect(bottleneckCandidate({...run,status:'limited'})).toBeNull();
 });
});
