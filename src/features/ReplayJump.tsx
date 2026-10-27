import {useEffect,useRef,useState} from 'react';
import {TimeField} from './EditFields';
import {easeMessages} from '../ui/messages/ease';
import {replayEaseMessages as m} from '../ui/messages/replayEase';
export function ReplayJump({until,runKey,onSeek}:{until:number;runKey?:string;onSeek:(time:number)=>void}){
 const [target,setTarget]=useState(0),[error,setError]=useState('');const root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{setTarget(0);setError('');},[runKey,until]);
 function seek(time:number){if(!Number.isFinite(time)||time<0||time>until){setError(m.invalidTime);return;}setError('');setTarget(time);onSeek(time);}
 return <details ref={root} className="studio-replay-details ease-replay-jump" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();if(root.current)root.current.open=false;root.current?.querySelector('summary')?.focus();}}}><summary>{m.jump}</summary><div><strong>{m.coverage(easeMessages.duration(until))}</strong><TimeField label={m.targetTime} contextKey={`${runKey}:replay-jump`} value={target} onChange={setTarget} min={0} max={until} defaultUnit="minutes" trackPending={false}/><button type="button" className="ease-button" onClick={()=>{if(root.current?.querySelector('[data-pending="true"]')){setError(m.invalidTime);return;}seek(target);}}>{m.go}</button><button type="button" className="ease-link" onClick={()=>seek(0)}>{m.start}</button><button type="button" className="ease-link" onClick={()=>seek(until)}>{m.end}</button>{error&&<p role="alert" className="ease-error">{error}</p>}</div></details>;
}
