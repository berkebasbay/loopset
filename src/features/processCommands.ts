import type { Distribution, ModelNode, Project } from '../model/types';
import { mutateProject } from '../model/commands';
import { scaleDistribution } from '../model/easeCommands';
import { validateProject } from '../model/validate';
import { uniqueIdentity } from './modelEdits';
import { processEaseMessages as m } from '../ui/messages/modelEdits';
export type BulkSetting = {kind:'servers'|'mean';value:number}|{kind:'queueCapacity';value:number|null};
function checked(project:Project){const issue=validateProject(project).find(i=>i.severity==='error');if(issue)throw new Error(issue.message);return project;}
export function changeSelectedSteps(project:Project,ids:readonly string[],setting:BulkSetting):Project {
 const wanted=new Set(ids),nodes=project.model.nodes.filter(n=>wanted.has(n.id));
 if(!wanted.size||nodes.length!==wanted.size)throw new Error(m.bulkMissing);
 if(nodes.some(n=>setting.kind==='servers'?n.kind!=='service':setting.kind==='mean'?n.kind!=='service'&&n.kind!=='delay':n.kind!=='queue'))throw new Error(m.incompatibleBulk);
 if(setting.kind==='servers'&&(!Number.isInteger(setting.value)||setting.value<1||setting.value>1000))throw new Error(m.badCapacity);
 return checked(mutateProject(project,copy=>{for(const node of copy.model.nodes)if(wanted.has(node.id)){
  if(setting.kind==='servers'&&node.kind==='service')node.servers=setting.value;
  if(setting.kind==='mean'&&(node.kind==='service'||node.kind==='delay'))node.duration=scaleDistribution(node.duration,setting.value);
  if(setting.kind==='queueCapacity'&&node.kind==='queue')node.capacity=setting.value;
 }}));
}
export function duplicateStep(project:Project,id:string,mode:'detached'|'after'):{project:Project;id:string} {
 const original=project.model.nodes.find(n=>n.id===id);if(!original)throw new Error(m.duplicateMissing);
 if(mode==='after'&&original.kind!=='service'&&original.kind!=='delay')throw new Error(m.insertUnsupported);
 const count=original.kind==='queue'?2:1;if(project.model.nodes.length+count>100)throw new Error(m.duplicateLimit);
 let createdId='';
 const next=mutateProject(project,copy=>{
  const clone=(node:ModelNode)=>{const cloned=structuredClone(node);let prefix='';for(const character of node.label){if(prefix.length+character.length>154)break;prefix+=character;}cloned.id=uniqueIdentity(node.kind,copy.model.nodes.map(n=>n.id));cloned.samplingId=uniqueIdentity(`sample-${node.kind}`,copy.model.nodes.map(n=>n.samplingId));cloned.label=`${prefix} copy`;copy.model.nodes.push(cloned);const p=copy.layout[node.id]??{x:0,z:0};copy.layout[cloned.id]={x:p.x>94?p.x-4:p.x+4,z:p.z};return cloned;};
  const created=clone(original);createdId=created.id;
  if(created.kind==='queue'&&original.kind==='queue'){
   const service=project.model.nodes.find(n=>n.id===original.next);if(service?.kind!=='service')throw new Error(m.missingQueueService);
   created.next=clone(service).id;
  }
  if(mode==='after'&&'next'in created){const previous=copy.model.nodes.find(n=>n.id===id)!;if('next'in previous){created.next=previous.next;previous.next=created.id;}}
 });
 return {id:createdId,project:checked(next)};
}
const zeroDuration=(d:Distribution)=>d.kind==='constant'?d.value===0:d.kind==='triangular'?d.min===0:d.kind==='empirical'?d.values.includes(0):false;
const canBeZero=(n:ModelNode)=>n.kind==='service'||n.kind==='sink'?false:n.kind==='delay'?zeroDuration(n.duration):true;
export function connectionChoices(project:Project,fromId:string):{id:string;label:string;valid:boolean;reason:string}[]{
 const from=project.model.nodes.find(n=>n.id===fromId),map=new Map(project.model.nodes.map(n=>[n.id,n]));
 return project.model.nodes.map(target=>{
  let reason='';
  if(!from||!('next'in from))reason=m.noOutgoing;
  else if(target.kind==='source')reason=m.sourceTarget;
  else if(from.kind==='queue'&&target.kind!=='service')reason=m.queueTarget;
  else if(from.kind==='queue'&&project.model.nodes.some(n=>n.kind==='queue'&&n.id!==fromId&&n.next===target.id))reason=m.queueOccupied;
  else if(canBeZero(from)){
   const stack=[target.id],seen=new Set<string>();
   while(stack.length){const id=stack.pop()!;if(id===fromId){reason=m.zeroLoop;break;}if(seen.has(id))continue;seen.add(id);const n=map.get(id);if(!n||!canBeZero(n))continue;if(n.kind==='route')stack.push(...n.branches.map(b=>b.to));else if('next'in n)stack.push(n.next);}
  }
  return {id:target.id,label:target.label,valid:!reason,reason:reason||('next'in(from??{})&&(from as {next:string}).next===target.id?m.currentConnection:m.validConnection)};
 });
}

/** Repair one locally valid edge while preserving other recoverable draft errors. */
export function connectDraftNext(project:Project,fromId:string,toId:string):Project {
 const choice=connectionChoices(project,fromId).find(choice=>choice.id===toId);
 if(!choice?.valid)throw new Error(choice?.reason??m.missingTarget);
 return mutateProject(project,copy=>{const node=copy.model.nodes.find(node=>node.id===fromId);if(!node||!('next'in node))throw new Error(m.noOutgoing);node.next=toId;});
}
