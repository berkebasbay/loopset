import { useState } from 'react';
import { ArrowRight, BookmarkPlus, RotateCcw, Trash2 } from 'lucide-react';
import type { Project, RunResult, ScenarioSnapshot } from '../model/types';
import { removeScenario, restoreScenario, saveScenario } from '../model/scenarios';
import { modelHash } from '../model/identity';
import { validateProject } from '../model/validate';

interface Props {
  project: Project; baseline: RunResult | null; busy: boolean;
  onChange: (p: Project) => void; onBaseline: (s: ScenarioSnapshot) => Promise<void>;
}
export function SavedScenarios({ project, baseline, busy, onChange, onBaseline }: Props) {
  const [name, setName] = useState('Original plan'); const [error, setError] = useState('');
  const [status, setStatus] = useState(''); const [pending, setPending] = useState(false);
  const valid = !validateProject(project).some(i => i.severity === 'error');
  function save(useBaseline = false) {
    try {
      onChange(saveScenario(project, name, useBaseline && baseline ? baseline.model : project.model));
      setStatus('Saved a model snapshot. It is included in project files and local storage.'); setError('');
      setName(`Plan ${(project.scenarios?.length ?? 0) + 2}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this scenario.'); }
  }
  return <section className="saved-scenarios" aria-label="Saved scenarios">
    <div className="saved-scenarios-heading"><div><h3>Keep a few possibilities.</h3><p>Named model snapshots travel with your project. Restore one, change it, and run another experiment.</p></div><span>{project.scenarios?.length ?? 0} / 20</span></div>
    <div className="scenario-save-row"><label>Scenario name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label><button className="secondary-button" disabled={busy || !valid} onClick={() => save(false)}><BookmarkPlus size={15} />Save current plan</button>{baseline && <button className="secondary-button" disabled={busy || !valid} onClick={() => save(true)}>Save baseline</button>}</div>
    {project.scenarios?.length ? <ul className="scenario-list">{project.scenarios.map(snapshot => <li key={snapshot.id}><div><strong>{snapshot.name}</strong><span>Seed {snapshot.model.seed} · {Math.round(snapshot.model.horizon / 60)} min · {modelHash(snapshot.model).slice(0, 8)}</span></div><div className="scenario-actions"><button disabled={busy || pending} onClick={() => { onChange(restoreScenario(project, snapshot.id)); setStatus(`Restored “${snapshot.name}”. Calculate the draft to get a new result.`); }}><RotateCcw size={13} />Restore</button><button disabled={busy || pending} onClick={async () => { setPending(true); setError(''); try { await onBaseline(snapshot); setStatus(`Baseline calculated from “${snapshot.name}”.`); } catch (e) { setError(e instanceof Error ? e.message : 'Could not calculate this baseline.'); } finally { setPending(false); } }}>Use as baseline<ArrowRight size={13} /></button><button disabled={busy || pending} aria-label={`Remove scenario ${snapshot.name}`} title="Remove saved scenario. Undo can restore it." onClick={() => { onChange(removeScenario(project, snapshot.id)); setStatus('Removed the saved snapshot. Undo in the workspace can restore it.'); }}><Trash2 size={13} /></button></div></li>)}</ul> : <p className="scenario-empty">No named scenarios yet. Save the original before exploring another setup.</p>}
    {status && <p className="lab-small" role="status">{status}</p>}{error && <p className="lab-error" role="alert">{error}</p>}
  </section>;
}
