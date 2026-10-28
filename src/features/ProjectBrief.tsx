import { ArrowRight, RotateCcw } from 'lucide-react';
import type { Project } from '../model/types';
import { modelDifferences } from '../model/modelDiff';
import { InputDifferences } from './InputDifferences';
import { starterMessages as m } from '../ui/messages/starterTemplates';

export function ProjectBrief({ project, blocked, onApply, onCompare }: { project: Project; blocked: boolean; onApply: (id: string) => void; onCompare: () => void }) {
  const plans = [...(project.scenarios ?? [])].sort((a, b) => Number(a.name === m.original) - Number(b.name === m.original));
  return <div className="project-brief">
    <p className="modal-intro">{m.briefIntro}</p>
    <div className="project-brief-facts"><span>{m.duration(project.model.horizon / 60)}</span><span>{m.steps(project.model.nodes.length)}</span></div>
    <p className="project-brief-summary">{project.description.split(/\n\s*\n/)[0]}</p>
    <details className="project-brief-notes"><summary>{m.notes}</summary><div className="project-brief-description">{project.description}</div><p className="project-brief-scope">{m.briefScope}</p></details>
    <h3 className="project-brief-plans-title">{m.plans}</h3>
    <div className="project-brief-plans">{plans.map(scenario => {
      const changes = modelDifferences(project.model, scenario.model);
      return <section className="project-brief-plan" key={scenario.id}><div><h3>{scenario.name}</h3><p>{changes.length ? changes.slice(0, 3).map(change => change.label).join(' · ') : m.sameInputs}</p><p>{m.restoresLayout}</p>{changes.length > 0 && <details><summary>{m.exactChanges}</summary><InputDifferences before={project.model} after={scenario.model} compact /></details>}</div><button className="ql-button" disabled={blocked} onClick={() => onApply(scenario.id)}><RotateCcw size={14} />{m.apply}</button></section>;
    })}</div>
    {!project.scenarios?.length && <p className="modal-intro">{m.briefEmpty}</p>}
    <button className="ql-button project-brief-compare" onClick={onCompare}>{m.compare}<ArrowRight size={14} /></button>
  </div>;
}
