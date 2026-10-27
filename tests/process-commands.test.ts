import {describe,expect,it} from 'vitest';
import {createExample} from '../src/examples';
import {duplicateStep,changeSelectedSteps,connectionChoices,connectDraftNext} from '../src/features/processCommands';
import {validateProject} from '../src/model/validate';
import {commitEdit,emptyHistory,undoEdit} from '../src/features/editorHistory';
import {openProjectJSON,serializeProject} from '../src/storage/projectFile';
describe('explicit process commands',()=>{
 it('copies processing settings with newidentities and a real after splice, preserving resources and oneUndo',()=>{
  const p=createExample('factory'),before=structuredClone(p),node=p.model.nodes.find(n=>n.kind==='service')!;
  const copy=duplicateStep(p,node.id,'after'),created=copy.project.model.nodes.find(n=>n.id===copy.id)!;
  expect(created.kind).toBe('service');expect(created.samplingId).not.toBe(node.samplingId);expect(created).toMatchObject({duration:node.duration,resources:node.resources,servers:node.servers,next:node.next});
  expect(copy.project.model.nodes.find(n=>n.id===node.id)).toMatchObject({next:copy.id});expect(copy.project.model.resources).toEqual(before.model.resources);expect(validateProject(copy.project)).toEqual([]);
  const committed=commitEdit(emptyHistory(),p,copy.project);expect(committed.history.past).toHaveLength(1);expect(undoEdit(committed.history,committed.project).project.model).toEqual(p.model);expect(openProjectJSON(serializeProject(copy.project)).model).toEqual(copy.project.model);expect(p).toEqual(before);
 });
 it('copies long Unicode names without splitting an emoji or breaking file portability',()=>{
  const p=createExample('factory'),node=p.model.nodes.find(n=>n.kind==='service')!;node.label='a'.repeat(153)+'😀';const copy=duplicateStep(p,node.id,'detached');expect(openProjectJSON(serializeProject(copy.project)).model).toEqual(copy.project.model);expect(copy.project.model.nodes.find(n=>n.id===copy.id)!.label.length).toBeLessThanOrEqual(160);
 });
 it('copies a queue with its own service and leaves existing incoming links untouched',()=>{
  const p=createExample('factory'),q=p.model.nodes.find(n=>n.kind==='queue')!,result=duplicateStep(p,q.id,'detached');
  expect(result.project.model.nodes.length).toBe(p.model.nodes.length+2);expect(result.project.model.nodes.filter(n=>n.kind==='queue'&&n.next===q.next)).toHaveLength(1);expect(validateProject(result.project)).toEqual([]);
  expect(new Set(result.project.model.nodes.map(n=>n.samplingId)).size).toBe(result.project.model.nodes.length);expect(()=>duplicateStep(p,q.id,'after')).toThrow('Only a processing');
 });
 it('applies a compatible bulk command atomically and refuses mixed selections',()=>{
  const p=createExample('factory'),ids=p.model.nodes.filter(n=>n.kind==='service').map(n=>n.id);
  const changed=changeSelectedSteps(p,ids,{kind:'servers',value:4});expect(changed.model.nodes.filter(n=>n.kind==='service').every(n=>n.servers===4)).toBe(true);expect(changed.model.resources).toEqual(p.model.resources);
  const c=commitEdit(emptyHistory(),p,changed);expect(c.history.past).toHaveLength(1);expect(undoEdit(c.history,c.project).project.model).toEqual(p.model);
  expect(()=>changeSelectedSteps(p,[ids[0],p.model.nodes.find(n=>n.kind==='source')!.id],{kind:'servers',value:4})).toThrow('compatible');expect(()=>changeSelectedSteps(p,ids,{kind:'servers',value:4.5})).toThrow('whole');
 });
 it('repairs two broken links one at a time without discarding the remaining draft',()=>{
  const p=createExample('factory'),steps=p.model.nodes.filter(n=>n.kind==='service');const targets=steps.map(n=>n.next);steps[0].next='missing-a';steps[1].next='missing-b';
  const one=connectDraftNext(p,steps[0].id,targets[0]);expect(one.model.nodes.find(n=>n.id===steps[0].id)).toMatchObject({next:targets[0]});expect(validateProject(one).some(i=>i.message.includes('existing step'))).toBe(true);
  const two=connectDraftNext(one,steps[1].id,targets[1]);expect(validateProject(two)).toEqual([]);expect(p.model.nodes.find(n=>n.id===steps[0].id)).toMatchObject({next:'missing-a'});
 });
 it('explains invalid source and queue destinations and a possiblezero loop before applying',()=>{
  const p=createExample('factory'),q=p.model.nodes.find(n=>n.kind==='queue')!,source=p.model.nodes.find(n=>n.kind==='source')!;
  const choices=connectionChoices(p,q.id);expect(choices.find(c=>c.id===source.id)).toMatchObject({valid:false,reason:'Arrival sources cannot receive incoming work.'});expect(choices.find(c=>c.id===q.next)?.valid).toBe(true);
  const delay={id:'delay',samplingId:'delay',label:'Delay',kind:'delay' as const,next:'out',duration:{kind:'constant' as const,value:0}};p.model.nodes.push(delay);expect(connectionChoices(p,delay.id).find(c=>c.id===delay.id)).toMatchObject({valid:false});
  delay.duration.value=1;expect(connectionChoices(p,delay.id).find(c=>c.id===delay.id)?.valid).toBe(true);
 });
});
