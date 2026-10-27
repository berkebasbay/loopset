import type{RunResult}from'../model/types';
/** Full-horizon arrivals, including warm-up. Never infer per-source totals from a replay prefix. */
export function actualArrivalDisplay(result:RunResult|null|undefined,sourceId:string):{count:number;scope:'source'|'allSources'}|null{
 if(!result||result.status!=='completed')return null;
 const sources=result.model.nodes.filter(node=>node.kind==='source');if(!sources.some(node=>node.id===sourceId))return null;
 if(sources.length===1)return{count:result.diagnostics.totalArrivals,scope:'source'};
 if(result.trace.complete)return{count:result.entities.filter(entity=>entity.sourceId===sourceId).length,scope:'source'};
 return{count:result.diagnostics.totalArrivals,scope:'allSources'};
}
