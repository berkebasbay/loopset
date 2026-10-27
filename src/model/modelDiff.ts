import type {RunResult,SimulationModel} from './types';
import {canonical,fingerprint,modelHash} from './identity';
import {modelDiffMessages as m} from '../ui/messages/modelDiff';
export interface InputDifference {key:string;label:string;before:string;after:string}
const cleaned=(value:unknown):unknown=>Array.isArray(value)?value.map(cleaned):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='label').map(([key,value])=>[key,cleaned(value)])):value;
const normalize=(key:string,value:unknown)=>Array.isArray(value)&&['classes','branches','resources'].includes(key)?[...value].sort((a,b)=>String(a.id??a.to??a.poolId).localeCompare(String(b.id??b.to??b.poolId),'en')||(key==='branches'?a.probability-b.probability:0)):value;
const show=(value:unknown):string=>value===undefined?'—':value===null?m.unlimited:typeof value==='number'?value.toLocaleString('en',{maximumFractionDigits:8}):typeof value==='string'?value:typeof value==='boolean'?String(value):(()=>{const text=JSON.stringify(cleaned(value));return text.length<=420?text:`${text.slice(0,360)}… · ${fingerprint(cleaned(value)).slice(0,8)}`;})();
/** Snapshot-to-snapshot semantic changes. Presentation-only edits never create rows. */
export function modelDifferences(before:SimulationModel,after:SimulationModel):InputDifference[]{
 if(modelHash(before)===modelHash(after)&&before.seed===after.seed)return[];
 const rows:InputDifference[]=[];
 const add=(key:string,label:string,a:unknown,b:unknown)=>{if((a===undefined)!==(b===undefined)||canonical(cleaned(a))!==canonical(cleaned(b)))rows.push({key,label,before:show(a),after:show(b)});};
 for(const key of ['horizon','warmup','seed','slaSeconds','currency']as const)add(key,m[key],before[key],after[key]);
 const old=new Map(before.nodes.map(n=>[n.samplingId,n])),fresh=new Map(after.nodes.map(n=>[n.samplingId,n]));
 for(const id of new Set([...old.keys(),...fresh.keys()])){
  const a=old.get(id),b=fresh.get(id),name=b?.label??a?.label??id;
  if(!a||!b){rows.push({key:`node:${id}`,label:name,before:a?`${a.kind} · ${a.id}`:m.added,after:b?`${b.kind} · ${b.id}`:m.removed});continue;}
  const av=a as unknown as Record<string,unknown>,bv=b as unknown as Record<string,unknown>;
  for(const key of new Set([...Object.keys(av),...Object.keys(bv)]))if(!['label','samplingId'].includes(key))add(`node:${id}:${key}`,`${name} · ${key in m?m[key as keyof typeof m]:key}`,normalize(key,av[key]),normalize(key,bv[key]));
 }
 const oldPools=new Map(before.resources.map(p=>[p.id,p])),newPools=new Map(after.resources.map(p=>[p.id,p]));
 for(const id of new Set([...oldPools.keys(),...newPools.keys()])){
  const a=oldPools.get(id),b=newPools.get(id),name=b?.label??a?.label??id;
  if(!a||!b){rows.push({key:`pool:${id}`,label:name,before:a?show(cleaned(a)):m.added,after:b?show(cleaned(b)):m.removed});continue;}
  for(const key of ['installedCapacity','capacity','calendar','costPerHour','overtimeCostPerHour']as const)add(`pool:${id}:${key}`,`${name} · ${key==='capacity'?m.base:m[key]}`,a[key],b[key]);
 }
 return rows;
}
export function bottleneckCandidate(run:RunResult){
 if(run.status!=='completed')return null;
 const stations=run.stations.filter(s=>s.averageQueue>0||s.queueAtEnd>0).sort((a,b)=>b.averageQueue-a.averageQueue||b.queueAtEnd-a.queueAtEnd||b.averageWait-a.averageWait||a.nodeId.localeCompare(b.nodeId,'en'));
 return stations[0]??null;
}
