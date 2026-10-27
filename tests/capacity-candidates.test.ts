import{describe,expect,it}from'vitest';import{capacityRange,capacityList,capacitySearchNotes}from'../src/lab/capacityCandidates';import{prepareExperiment}from'../src/lab/experimentPlan';import{createExample}from'../src/examples';
describe('explicit capacity candidates',()=>{
 it('makes range and list plans identical, including actual seeds and held-out budget',()=>{
  const p=createExample('factory');p.model.resources[0].installedCapacity=10;
  expect(capacityRange(1,4,1)).toEqual([1,2,3,4]);expect(capacityRange(1,4,2)).toEqual([1,3]);expect(capacityList('1, 2, 3, 4')).toEqual(capacityRange(1,4,1));
  const settings={kind:'search'as const,model:p.model,baseline:null,count:2,firstSeed:4207,poolId:p.model.resources[0].id,target:'0',maxWait:''};
  const a=prepareExperiment({...settings,capacities:capacityRange(1,4,1).join(',')}),b=prepareExperiment({...settings,capacities:'1,2,3,4'});expect(a).toEqual(b);expect(a.budget.minimumRuns).toBe(8);expect(a.budget.maximumRuns).toBe(10);
 });
 it('rejects reversed, fractional, duplicate or over-budget candidate inputs',()=>{
  for(const args of [[5,1,1],[0,1000,1],[1,5,0],[1.5,4,1],[0,1001,100]]as const)expect(()=>capacityRange(args[0],args[1],args[2])).toThrow();
  for(const text of ['1,,2','1,1','1.5','-1','1001',''])expect(()=>capacityList(text)).toThrow();
 });
 it('explains unused resources and whole-run calendar overrides without predicting improvements',()=>{
  const p=createExample('factory'),pool=p.model.resources[0];pool.calendar=[{start:0,end:p.model.horizon,capacity:1}];expect(capacitySearchNotes(p.model,pool.id,[1,2,3]).join(' ')).toContain('maximum simultaneous requirement of 1');expect(capacitySearchNotes(p.model,pool.id).join(' ')).toContain('never used');p.model.nodes.forEach(n=>{if(n.kind==='service')n.resources=n.resources.filter(req=>req.poolId!==pool.id);});expect(capacitySearchNotes(p.model,pool.id).join(' ')).toContain('No processing step');
 });
});
