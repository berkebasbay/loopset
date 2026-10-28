import { Activity, Box, ChevronRight, Layers3, List, Workflow } from 'lucide-react';
import { facilityMessages as m } from '../ui/messages/facility';
import { shellEaseMessages as s } from '../ui/messages/shellEase';
import { appMessages as a } from '../ui/messages/App';
import type { LibraryTab } from './FacilityLibrary';

interface Props {
  tab: LibraryTab; open: boolean; objects: number; steps: number; inert: boolean;
  onBuild: (element: HTMLButtonElement, tab: LibraryTab) => void;
  onResults: (element: HTMLButtonElement) => void;
  onTools: () => void; onView: (element: HTMLButtonElement) => void;
}
export function FacilityWorkflow(props: Props) {
  return <nav className="facility-workflow" aria-label={m.workflow} inert={props.inert}>
    <div className="facility-workflow-steps">
      <button type="button" data-build-opener="" aria-expanded={props.open} aria-controls="process-blocks" aria-current={props.tab === 'objects' ? 'step' : undefined} onClick={event => props.onBuild(event.currentTarget, 'objects')}><span>01</span><Box size={17} /><strong>{m.layoutWorkspace}</strong></button>
      <ChevronRight size={14} aria-hidden="true" />
      <button type="button" aria-current={props.tab !== 'objects' ? 'step' : undefined} onClick={event => props.onBuild(event.currentTarget, 'cells')}><span>02</span><Workflow size={17} /><strong>{m.processWorkspace}</strong></button>
      <ChevronRight size={14} aria-hidden="true" />
      <button type="button" data-panel-opener="insights" onClick={event => props.onResults(event.currentTarget)}><span>03</span><Activity size={17} /><strong>{m.resultsWorkspace}</strong></button>
    </div>
    <span className="facility-project-count">{m.inProject(props.objects, props.steps)}</span>
    <div className="facility-workflow-tools"><button type="button" aria-label={s.view} data-panel-opener="view" onClick={event => props.onView(event.currentTarget)}><Layers3 size={17} />{s.view}</button><button type="button" data-tools-opener="" onClick={props.onTools}><List size={17} />{a.toolsTool}</button></div>
  </nav>;
}
