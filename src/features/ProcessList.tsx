import { useId, useState } from 'react';
import type { Project } from '../model/types';
import type { SelectionIntent } from './editorSelection';
import { stepKindLabels } from '../ui/messages/labels';
import { easeMessages as m } from '../ui/messages/ease';

interface Props {
  project: Project; selectedId?: string | null; selectedIds: string[];
  onSelect: (id: string | null, intent?: SelectionIntent) => void;
}
export function ProcessList({ project, selectedId, selectedIds, onSelect }: Props) {
  const [search, setSearch] = useState(''); const id = useId();
  const query = search.trim().toLocaleLowerCase('en');
  const nodes = project.model.nodes.filter(node => `${node.label} ${stepKindLabels[node.kind]}`.toLocaleLowerCase('en').includes(query));
  return <section className="ease-process-list" aria-label={m.processSteps}>
    <div className="ease-field"><label htmlFor={id}>{m.searchSteps}</label><input id={id} type="search" value={search} onChange={event => setSearch(event.currentTarget.value)} /></div>
    <p className="ease-process-count"><span>{m.stepsCount(nodes.length, project.model.nodes.length)}</span><span>{m.selectionCount(selectedIds.length)}</span></p>
    <ul>{nodes.map(node => <li key={node.id} className={selectedIds.includes(node.id) ? 'is-selected' : ''}>
      <input type="checkbox" aria-label={m.selectForGroup(node.label)} checked={selectedIds.includes(node.id)} onChange={() => onSelect(node.id, 'toggle')} />
      <button type="button" data-learning-target={`step-${node.id}`} aria-label={m.selectStep(node.label)} aria-current={selectedId === node.id ? 'step' : undefined} onClick={() => onSelect(node.id, 'single')}><strong>{node.label}</strong><small>{stepKindLabels[node.kind]}</small></button>
    </li>)}</ul>
    {!nodes.length && <p className="ease-help">{m.noMatchingSteps}</p>}
    {search && <button type="button" className="ease-link" onClick={() => setSearch('')}>{m.clearSearch}</button>}
  </section>;
}
