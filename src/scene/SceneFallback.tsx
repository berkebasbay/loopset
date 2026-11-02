import { Component, type ReactNode } from 'react';
import type { Project } from '../model/types';
import type { SelectionIntent } from '../features/editorSelection';
import { stepKindLabels } from '../ui/messages/labels';
import { worldSceneMessages as m } from '../ui/messages/WorldScene';
import './sceneFallback.css';

export function SceneFallback({ project, selected, onSelect }: { project: Project; selected: string | null; onSelect: (id: string, intent?: SelectionIntent) => void }) {
  return <section className="scene-text-fallback" aria-label={m.fallbackSteps}><h3>{m.fallbackTitle}</h3><p>{project.workspaceMode === 'layout' ? m.fallbackLayout : m.fallbackHelp}</p>
    {project.workspaceMode !== 'layout' && <ol>{project.model.nodes.map(node => <li key={node.id}><button type="button" data-station-id={node.id} aria-label={m.select(node.label, stepKindLabels[node.kind])} aria-pressed={selected === node.id} onClick={() => onSelect(node.id, 'single')}><strong>{node.label}</strong><span>{stepKindLabels[node.kind]}</span></button></li>)}</ol>}
  </section>;
}

// A failed graphics chunk must not take the editor, calculation or saves down.
export class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
