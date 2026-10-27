import { useState, useEffect, useRef } from 'react';
import { shellEaseMessages as m } from '../ui/messages/shellEase';
export type WorkspaceCommand = keyof typeof m.commands;
export function CommandSearch({onCommand}:{onCommand:(command:WorkspaceCommand)=>void}) {
 const [query,setQuery]=useState('');
 const commands=(Object.entries(m.commands) as [WorkspaceCommand,typeof m.commands[WorkspaceCommand]][]).filter(([,command])=>`${command.label} ${command.keywords}`.toLocaleLowerCase('en').includes(query.trim().toLocaleLowerCase('en')));
 return <div className="ease-command-search"><label className="ease-select-label">{m.search}<input autoFocus type="search" value={query} onChange={event=>setQuery(event.currentTarget.value)} /></label><p className="ease-help">{m.commandScope}</p><ul>{commands.map(([key,command])=><li key={key}><button type="button" className="ease-command" onClick={()=>onCommand(key)}>{command.label}<span aria-hidden="true">↗</span></button></li>)}</ul>{!commands.length&&<p>{m.noCommands}</p>}</div>;
}
export function QuickGuide({onTarget,onClose,index,onIndexChange:setIndex}:{onTarget:(target:string)=>void;onClose:()=>void;index:number;onIndexChange:(index:number)=>void}) {
 const heading=useRef<HTMLHeadingElement>(null);const step=m.guideSteps[index];
 useEffect(()=>{heading.current?.focus();},[index]);
 return <section className="ease-guide"><p className="ease-eyebrow">{index+1} / {m.guideSteps.length}</p><h3 tabIndex={-1} ref={heading}>{step.title}</h3><p>{step.text}</p><button className="ease-button" onClick={()=>onTarget(step.target)}>{m.reviewInputs}</button><div className="ease-actions"><button className="ease-button" disabled={index===0} onClick={()=>setIndex(index-1)}>{m.guidePrevious}</button><button className="ease-button ease-primary" onClick={()=>index===m.guideSteps.length-1?onClose():setIndex(index+1)}>{index===m.guideSteps.length-1?m.guideDone:m.guideNext}</button><button className="ease-link" onClick={onClose}>{m.guideClose}</button></div></section>;
}
