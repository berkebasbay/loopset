import type {ServiceNode,SimulationModel} from '../model/types';
import {experimentsEaseMessages as m} from '../ui/messages/experimentsEase';
export function capacityRange(start:number,end:number,step:number):number[]{
 if(![start,end,step].every(Number.isSafeInteger)||start<0||end>1000||end<start||step<=0)throw new Error(m.invalidRange);
 const count=Math.floor((end-start)/step)+1;if(count>32)throw new Error(m.rangeLimit);
 return Array.from({length:count},(_,i)=>start+i*step);
}
export function capacityList(text:string):number[]{
 if(!text.trim()||text.split(',').some(part=>!part.trim()))throw new Error(m.invalidList);
 const values=text.split(',').map(part=>Number(part.trim()));
 if(!values.length||values.length>32||new Set(values).size!==values.length||values.some(value=>!Number.isSafeInteger(value)||value<0||value>1000))throw new Error(m.invalidList);
 return values;
}
export function capacitySearchNotes(model:SimulationModel,poolId:string,capacities:readonly number[] = []):string[]{
 const pool=model.resources.find(pool=>pool.id===poolId);if(!pool)return[];
 const consumers=model.nodes.filter((node):node is ServiceNode=>node.kind==='service'&&node.resources.some(req=>req.poolId===poolId));
 const notes=[m.searchVariables(pool.label,pool.capacity,pool.installedCapacity)];
 if(!consumers.length)notes.push(m.unusedPool);
 else notes.push(m.consumers(consumers.map(node=>`${node.label} (${node.servers})`).join(', ')));
 const upper=consumers.reduce((sum,node)=>sum+node.servers*(node.resources.find(req=>req.poolId===poolId)?.units??0),0),above=capacities.filter(capacity=>capacity>upper);
 if(upper>0&&above.length)notes.push(m.aboveDemand(above.join(', '),upper));
 if(pool.calendar.length){notes.push(m.calendarOverrides(pool.calendar.length));if(pool.calendar[0].start===0&&pool.calendar.at(-1)!.end===model.horizon&&pool.calendar.every((period,i)=>i===0||period.start===pool.calendar[i-1].end))notes.push(m.fullyCoveredCalendar);}
 return notes;
}
