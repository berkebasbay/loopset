import { useState } from 'react';
import type { Project } from '../model/types';
import { mutateProject } from '../model/commands';
import { shellEaseMessages as m } from '../ui/messages/shellEase';
import { usePendingEdit } from './EditFields';
export function ProjectRename({ project, onChange, onDone }: {project: Project; onChange:(project:Project,label?:string)=>void;onDone:()=>void}) {
  const [name,setName]=useState(project.name),[error,setError]=useState('');
  usePendingEdit(`${project.id}:rename`,name!==project.name);
  return <form className="ease-rename" onSubmit={event=>{event.preventDefault();const value=name.trim();if(!value||value.length>160){setError(m.validName);return;}onChange(mutateProject(project,copy=>{copy.name=value;}),m.renameProject);onDone();}}><label className="ease-select-label">{m.projectName}<input autoFocus value={name} maxLength={160} onChange={event=>{setName(event.currentTarget.value);setError('');}} /></label><p className="ease-help">{m.renameScope}</p><button className="ease-button ease-primary" type="submit">{m.rename}</button>{error&&<p role="alert" className="ease-error">{error}</p>}</form>;
}
