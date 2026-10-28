import { savedScenariosMessages as m } from '../ui/messages/SavedScenarios';
import { useState } from 'react';
import { ArrowRight, BookmarkPlus, RotateCcw, Trash2 } from 'lucide-react';
import type { Project, RunResult, ScenarioSnapshot } from '../model/types';
import { removeScenario, restoreScenario, saveScenario, type PresentationSnapshot } from '../model/scenarios';
import { modelHash } from '../model/identity';
import { validateProject } from '../model/validate';

interface Props {
  project: Project; baseline: RunResult | null; busy: boolean;
  baselinePresentation?: PresentationSnapshot;
  onChange: (p: Project) => void; onBaseline: (s: ScenarioSnapshot) => Promise<void>;
}
export function SavedScenarios({ project, baseline, baselinePresentation, busy, onChange, onBaseline }: Props) {
  const [name, setName] = useState('Original plan'); const [error, setError] = useState('');
  const [status, setStatus] = useState(''); const [pending, setPending] = useState(false);
  const valid = !validateProject(project).some(i => i.severity === 'error');
  function save(useBaseline = false) {
    try {
      onChange(saveScenario(project, name, useBaseline && baseline ? baseline.model : project.model, useBaseline ? baselinePresentation : project));
      setStatus(m.savedAModelSnapshotItIsIncludedInProject); setError('');
      setName(`Plan ${(project.scenarios?.length ?? 0) + 2}`);
    } catch (e) { setError(e instanceof Error ? e.message : m.couldNotSaveThisScenario); }
  }
  return <section className="saved-scenarios" aria-label={m.savedScenarios}>
    <div className="saved-scenarios-heading"><div><h3>{m.keepAFewPossibilities}</h3><p>{m.namedModelSnapshotsTravelWithYourProjectRestoreOne}</p></div><span>{project.scenarios?.length ?? 0} / 20</span></div>
    <div className="scenario-save-row"><label>{m.scenarioName}<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label><button className="secondary-button" disabled={busy || !valid} onClick={() => save(false)}><BookmarkPlus size={15} />{m.saveCurrentPlan}</button>{baseline && <button className="secondary-button" disabled={busy || !valid || !baselinePresentation} title={!baselinePresentation ? m.baselineLayoutUnavailable : undefined} onClick={() => save(true)}>{m.saveBaseline}</button>}</div>
    {project.scenarios?.length ? <ul className="scenario-list">{project.scenarios.map(snapshot => <li key={snapshot.id}><div><strong>{snapshot.name}</strong><span>{m.snapshotIdentity(snapshot.model.seed, Math.round(snapshot.model.horizon / 60), modelHash(snapshot.model).slice(0, 8))}</span></div><div className="scenario-actions"><button disabled={busy || pending} onClick={() => { onChange(restoreScenario(project, snapshot.id)); setStatus(m.restoredScenario(snapshot.name)); }}><RotateCcw size={13} />{m.restore}</button><button disabled={busy || pending} onClick={async () => { setPending(true); setError(''); try { await onBaseline(snapshot); setStatus(m.baselineCalculatedFrom(snapshot.name)); } catch (e) { setError(e instanceof Error ? e.message : m.couldNotCalculateThisBaseline); } finally { setPending(false); } }}>{m.useAsBaseline}<ArrowRight size={13} /></button><button disabled={busy || pending} aria-label={m.removeScenario(snapshot.name)} title={m.removeSavedScenarioUndoCanRestoreIt} onClick={() => { onChange(removeScenario(project, snapshot.id)); setStatus(m.removedTheSavedSnapshotUndoInTheWorkspaceCan); }}><Trash2 size={13} /></button></div></li>)}</ul> : <p className="scenario-empty">{m.noNamedScenariosYetSaveTheOriginalBeforeExploring}</p>}
    {status && <p className="lab-small" role="status">{status}</p>}{error && <p className="lab-error" role="alert">{error}</p>}
  </section>;
}
