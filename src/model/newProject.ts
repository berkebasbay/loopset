import type{Project,World}from'./types';import{SCHEMA_VERSION}from'./types';import{newModelMessages as m}from'../ui/messages/newModel';
/** Fresh document and sampling identities; no owner/example payload is copied. */
export function createNewProject(world:World='factory'):Project{
 const nonce=crypto.randomUUID(),key=nonce.slice(0,8),source=`input-${key}`,queue=`waiting-${key}`,service=`work-${key}`,sink=`done-${key}`,pool=`team-${key}`;
 return{schemaVersion:SCHEMA_VERSION,id:`project-${nonce}`,name:m.project,world,revision:0,description:m.description,layout:{[source]:{x:-6,z:0},[queue]:{x:-2,z:0},[service]:{x:2,z:0},[sink]:{x:6,z:0}},model:{id:`model-${nonce}`,name:m.model,horizon:3600,warmup:0,seed:4207,slaSeconds:300,currency:'USD',nodes:[
 {id:source,samplingId:`sample-${source}`,label:m.source,kind:'source',next:queue,arrival:{kind:'fixed',perHour:60},classes:[{id:'standard',label:m.class,priority:0,probability:1}]},
 {id:queue,samplingId:`sample-${queue}`,label:m.queue,kind:'queue',next:service,capacity:null,discipline:'fifo',patience:null},
 {id:service,samplingId:`sample-${service}`,label:m.service,kind:'service',next:sink,duration:{kind:'constant',value:30},servers:1,resources:[{poolId:pool,units:1}]},
 {id:sink,samplingId:`sample-${sink}`,label:m.sink,kind:'sink'}],resources:[{id:pool,label:m.team,installedCapacity:4,capacity:1,calendar:[],costPerHour:20,overtimeCostPerHour:30}]}};
}
