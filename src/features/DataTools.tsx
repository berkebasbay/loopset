import { useRef, useState } from 'react';
import { duplicateProject, mutateProject } from '../model/commands';
import { modelHash } from '../model/identity';
import type { Project, RunResult } from '../model/types';
import { validateProject } from '../model/validate';
import { FILE_LIMIT, downloadText, parseSampleCSV, readLocalText, safeFilename } from '../storage/csv';
import { openProjectJSON, serializeProject } from '../storage/projectFile';
import { listProjects, loadProject, saveProject } from '../storage/projectStore';
import { printResult, resultCSV, resultReportHTML } from '../storage/report';
import { downloadResultPNG } from '../storage/resultCard';
import './features.css';

export interface RetainedDraft {
  token: string; key: string; project: Project; bytes: number;
  state: 'waiting' | 'saving' | 'failed' | 'invalid'; message: string;
}
interface Props {
  project: Project; result: RunResult | null; latestAttempt?: RunResult | null; onImport: (project: Project) => Project | null | void;
  onSave?: typeof saveProject; retainedDrafts?: RetainedDraft[];
  onRestoreDraft?: (token: string) => void; onRetryDraft?: (token: string) => void;
  onRemoveDraft?: (token: string) => void;
}
const recoveryNumber = (_key: string, value: unknown) => typeof value === 'number' && !Number.isFinite(value) ? { queuelabNonFinite: String(value) } : value;
/** Exact draft identity, including NaN/Infinity; presentation save timestamps are excluded. */
export function recoveryProjectKey(project: Project): string {
  const { savedAt: _savedAt, ...content } = project;
  return JSON.stringify(content, recoveryNumber);
}
/** Unvalidated repair artifact, deliberately separate from portable project JSON. Never import it directly into a run. */
export function serializeDraftRecovery(project: Project): string {
  const text = JSON.stringify({
    format: 'queuelab-unvalidated-draft', recoveryVersion: 1,
    instructions: 'Raw repair backup, not a portable QueueLab project. Non-finite numbers use queuelabNonFinite markers. To repair manually, replace markers with valid numbers, repair validation errors, then extract the project object and open it through strict project import. In this tab, use Restore for repair.',
    project,
  }, recoveryNumber, 2);
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error('This repair backup exceeds 5 MB. Keep this tab open and reduce sample data before replacing the project.');
  return text;
}

interface SamplePreview { kind: 'arrival' | 'service'; values: number[]; targetId: string; filename: string }
export function DataTools({ project, result, latestAttempt = null, onImport, onSave = saveProject, retainedDrafts = [], onRestoreDraft, onRetryDraft, onRemoveDraft }: Props) {
  const [removeToken, setRemoveToken] = useState<string | null>(null);
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Project[] | null>(null); const [pending, setPending] = useState<Project | null>(null); const [pendingLocalId, setPendingLocalId] = useState<string | null>(null); const [preview, setPreview] = useState<SamplePreview | null>(null);
  const [arrivalTarget, setArrivalTarget] = useState(''); const [serviceTarget, setServiceTarget] = useState('');
  const jsonInput = useRef<HTMLInputElement>(null); const arrivalInput = useRef<HTMLInputElement>(null); const serviceInput = useRef<HTMLInputElement>(null);
  const current = useRef(project); current.current = project;
  const operationInFlight = useRef(false);
  const sources = project.model.nodes.filter(n => n.kind === 'source'); const services = project.model.nodes.filter(n => n.kind === 'service');
  const actualArrivalTarget = sources.some(n => n.id === arrivalTarget) ? arrivalTarget : sources[0]?.id ?? '';
  const actualServiceTarget = services.some(n => n.id === serviceTarget) ? serviceTarget : services[0]?.id ?? '';
  const stale = result && (result.modelHash !== modelHash(project.model) || result.seed !== project.model.seed);
  const attemptStale = latestAttempt && (latestAttempt.modelHash !== modelHash(project.model) || latestAttempt.seed !== project.model.seed || validateProject(project).some(issue => issue.severity === 'error'));
  function notify(message: string) { setStatus(message); setError(''); }
  function applyImport(next: Project) {
    if (onImport(next) === null) throw new Error('Project replacement was paused. The current draft is still open; review retained drafts before trying again.');
  }
  async function perform(operation: () => void | Promise<void>) {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true); setError(''); setStatus('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : 'The file operation failed. Your current project has not been replaced.'); }
    finally { operationInFlight.current = false; setBusy(false); }
  }
  async function openFile(file?: File) {
    if (!file) return;
    await perform(async () => { const opened = openProjectJSON(await readLocalText(file)); setPending(opened); setPendingLocalId(null); setPreview(null); notify(`Validated “${opened.name}”. Review the project below before opening it.`); });
  }
  async function openSamples(kind: 'arrival' | 'service', file?: File) {
    if (!file) return; const targetId = kind === 'arrival' ? actualArrivalTarget : actualServiceTarget;
    await perform(async () => {
      if (!targetId) throw new Error(`Add a ${kind === 'arrival' ? 'source' : 'service'} step before importing samples.`);
      const values = parseSampleCSV(await readLocalText(file), kind, kind === 'arrival' ? project.model.horizon : undefined);
      setPreview({ kind, values, targetId, filename: file.name }); setPending(null); notify('CSV is valid. Review and apply the replacement below.');
    });
  }
  function applySamples() {
    if (!preview) return;
    void perform(() => {
      const node = project.model.nodes.find(n => n.id === preview.targetId);
      if (!node || node.kind !== (preview.kind === 'arrival' ? 'source' : 'service')) throw new Error('The target step changed. Select the target and import the CSV again.');
      if (preview.kind === 'arrival' && preview.values.some(v => v >= project.model.horizon)) throw new Error('The run horizon changed. Some arrivals now lie outside it. Import the CSV again after adjusting the run.');
      applyImport(mutateProject(project, copy => {
        const target = copy.model.nodes.find(n => n.id === preview.targetId)!;
        if (target.kind === 'source') target.arrival = { kind: 'schedule', times: [...preview.values] };
        if (target.kind === 'service') target.duration = { kind: 'empirical', values: [...preview.values] };
      }));
      notify(`Applied ${preview.values.length.toLocaleString('en')} ${preview.kind === 'arrival' ? 'arrival timestamps' : 'service samples'} to “${node.label}”. Run the model again to calculate results.`); setPreview(null);
    });
  }
  return <div className="ql-feature ql-data-tools">
    <p className="ql-help">Projects and imports stay in this browser. Keep downloaded JSON backups; browser storage can be cleared by the browser or device owner.</p>
    {retainedDrafts.length > 0 && <section className="ql-data-section" aria-label="Retained drafts"><h3>Retained drafts ({retainedDrafts.length})</h3><p className="ql-help">These copies remain in this tab until their exact content is saved in IndexedDB or you explicitly remove them. A requested download does not clear a copy. Keep this tab open until you have verified a backup.</p><ul className="ql-saved-projects">{retainedDrafts.map(draft => <li key={draft.token}><div><strong>{draft.project.name || 'Unnamed draft'} · revision {draft.project.revision}</strong><small>{draft.state === 'saving' || draft.state === 'waiting' ? 'Saving before replacement…' : draft.state === 'invalid' ? 'Needs repair · retained in this tab' : 'Local save failed · retained in this tab'}</small><p className="ql-help">{draft.message}</p><div className="ql-actions"><button className="ql-button" type="button" onClick={() => onRestoreDraft?.(draft.token)}>Restore for repair</button><button className="ql-button" type="button" disabled={draft.state === 'saving' || draft.state === 'waiting' || validateProject(draft.project).some(issue => issue.severity === 'error')} onClick={() => onRetryDraft?.(draft.token)}>Retry local save</button><button className="ql-button" type="button" onClick={() => void perform(() => { downloadText(serializeDraftRecovery(draft.project), safeFilename(`${draft.project.name}-unvalidated-repair`, 'json'), 'application/json;charset=utf-8'); notify('Repair backup download requested. It is not validated project JSON. Verify the saved file; this retained copy has not been removed.'); })}>Request repair backup</button><button className="ql-button ql-danger" type="button" disabled={draft.state === 'saving' || draft.state === 'waiting'} onClick={() => setRemoveToken(draft.token)}>Remove retained copy…</button></div>{removeToken === draft.token && <div className="ql-delete-review"><p>This may be the only copy of this draft. A download request does not prove the file was saved. Remove it only after checking a backup or deciding to discard these edits.</p><div className="ql-actions"><button className="ql-button ql-danger" type="button" onClick={() => { onRemoveDraft?.(draft.token); setRemoveToken(null); }}>Remove this retained copy</button><button className="ql-button" type="button" onClick={() => setRemoveToken(null)}>Keep copy</button></div></div>}</div></li>)}</ul></section>}
    <section className="ql-data-section" aria-label="Project files"><h3>Project files</h3><p className="ql-help">Portable schema v1 · UTF-8 JSON · up to 5 MB. Invalid and unsupported files leave the current project in place. Duplicate creates a new document when you want to preserve an existing local version.</p><div className="ql-actions"><button className="ql-button ql-primary" disabled={busy} type="button" onClick={() => void perform(async () => { const snapshot = structuredClone(project); const ack = await onSave(snapshot); notify(`Saved “${snapshot.name}”, revision ${ack.revision}, at ${new Date(ack.savedAt).toLocaleTimeString()}.${current.current.id !== ack.projectId || current.current.revision !== ack.revision ? ' A newer draft is still unsaved.' : ''}`); })}>Save in this browser</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(serializeProject(project), safeFilename(project.name, 'json'), 'application/json;charset=utf-8'); notify(`Download requested for project revision ${project.revision}. Verify that the browser saved the file; this is not a storage acknowledgment.`); })}>Download project JSON</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(serializeDraftRecovery(project), safeFilename(`${project.name}-unvalidated-repair`, 'json'), 'application/json;charset=utf-8'); notify('Unvalidated repair backup download requested. Verify the saved file. Repair backups are separate from portable project JSON.'); })}>Request draft repair backup</button><button className="ql-button" disabled={busy} type="button" onClick={() => jsonInput.current?.click()}>Open project JSON</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { serializeProject(project); applyImport(duplicateProject(project)); notify('Created a new local project identity. Your previous saved document is preserved.'); })}>Duplicate project</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(async () => { const projects = await listProjects(); setSaved(projects); notify(projects.length ? `${projects.length} project(s) saved in this browser.` : 'No projects are saved in this browser yet.'); })}>Browse local projects</button></div><input ref={jsonInput} hidden type="file" accept=".json,application/json" aria-label="Open project JSON file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void openFile(file); }} />
      {saved && <ul className="ql-saved-projects">{saved.map(item => <li key={item.id}><div><strong>{item.name}</strong><small>Revision {item.revision} · {item.savedAt ? new Date(item.savedAt).toLocaleString() : 'unknown save time'}</small></div><button className="ql-button" disabled={busy} type="button" onClick={() => { setPending(item); setPendingLocalId(item.id); setPreview(null); notify('Review the saved project before replacing the current draft.'); }}>Review & open</button></li>)}</ul>}
      {pending && <div className="ql-import-preview"><h4>Open “{pending.name}”?</h4><p>{pending.model.nodes.length} steps · {pending.model.resources.length} resource pools · {pending.model.horizon.toLocaleString('en')} seconds · revision {pending.revision}</p><p>This replaces the current draft. Download it first if you want a separate backup.</p><div className="ql-actions"><button type="button" className="ql-button ql-primary" disabled={busy} onClick={() => void perform(async () => { const opened = pendingLocalId ? await loadProject(pendingLocalId) : structuredClone(pending); if (!opened) throw new Error('This saved project no longer exists. Refresh the local list.'); applyImport(opened); setPending(null); setPendingLocalId(null); notify('Project opened. Run it to calculate results from its model.'); })}>Open this project</button><button type="button" className="ql-button" onClick={() => setPending(null)}>Cancel</button></div></div>}
    </section>
    <section className="ql-data-section" aria-label="CSV inputs"><h3>Import time data</h3><p className="ql-help">One named column. Seconds use a decimal point. Comma-delimited CSV, UTF-8, quoted cells supported; no silent sorting, locale conversion or skipped bad rows.</p><div className="ql-import-grid"><div><label className="ql-direct-label" htmlFor="ql-arrival-source">Arrival source</label><select id="ql-arrival-source" value={actualArrivalTarget} onChange={e => setArrivalTarget(e.target.value)} disabled={busy || !sources.length}>{!sources.length && <option value="">Add a source first</option>}{sources.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><p className="ql-help"><code>arrival_seconds</code><br />0 ≤ timestamp &lt; {project.model.horizon} seconds. Ordered rows; duplicates are allowed. At most 100,000 arrivals.</p><div className="ql-actions"><button type="button" className="ql-button" disabled={busy || !sources.length} onClick={() => arrivalInput.current?.click()}>Import arrivals CSV</button><button type="button" className="ql-text-button" onClick={() => downloadText('arrival_seconds\r\n0\r\n12.5\r\n30\r\n', 'arrival-template.csv', 'text/csv;charset=utf-8')}>Download template</button></div></div><div><label className="ql-direct-label" htmlFor="ql-service-target">Service station</label><select id="ql-service-target" value={actualServiceTarget} onChange={e => setServiceTarget(e.target.value)} disabled={busy || !services.length}>{!services.length && <option value="">Add a service first</option>}{services.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><p className="ql-help"><code>service_seconds</code><br />Positive samples, at most 604,800 seconds each. At most 10,000 samples, sampled with replacement.</p><div className="ql-actions"><button type="button" className="ql-button" disabled={busy || !services.length} onClick={() => serviceInput.current?.click()}>Import service CSV</button><button type="button" className="ql-text-button" onClick={() => downloadText('service_seconds\r\n15\r\n22.5\r\n30\r\n', 'service-template.csv', 'text/csv;charset=utf-8')}>Download template</button></div></div></div><input ref={arrivalInput} hidden type="file" accept=".csv,text/csv" aria-label="Arrival CSV file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void openSamples('arrival', file); }} /><input ref={serviceInput} hidden type="file" accept=".csv,text/csv" aria-label="Service CSV file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void openSamples('service', file); }} />
      {preview && <div className="ql-import-preview"><h4>Replace {preview.kind === 'arrival' ? 'arrival pattern' : 'service distribution'}?</h4><p>{preview.values.length.toLocaleString('en')} rows from “{preview.filename}” for “{project.model.nodes.find(n => n.id === preview.targetId)?.label ?? 'Missing step'}”. Range: {preview.values.reduce((min, value) => Math.min(min, value), Infinity)}–{preview.values.reduce((max, value) => Math.max(max, value), -Infinity)} seconds.</p><p>{preview.kind === 'arrival' ? 'The source will use these exact timestamps instead of its current arrival pattern.' : 'The station will sample these durations with replacement instead of its current distribution.'} Other settings remain as entered.</p><div className="ql-actions"><button className="ql-button ql-primary" disabled={busy} type="button" onClick={applySamples}>Apply {preview.values.length.toLocaleString('en')} rows</button><button className="ql-button" type="button" onClick={() => setPreview(null)}>Cancel</button></div></div>}
    </section>
    <section className="ql-data-section" aria-label="Result exports"><h3>Results & report</h3>{result ? <><p className="ql-result-identity"><strong>{result.status === 'completed' ? 'Completed run' : `Incomplete run: ${result.status}`}</strong> · seed {result.seed} · engine {result.engineVersion}<br />Run {result.id} · snapshot {result.modelHash}<br />Observed through {result.simulatedUntil} / {result.model.horizon} seconds · trace {result.trace.complete ? 'complete' : `limited to ${result.trace.until} seconds`}</p>{stale && <p className="ql-notice">This result belongs to an earlier model snapshot. Exports below preserve that run; they do not describe the current draft.</p>}{result.status !== 'completed' && <p className="ql-notice">{result.reason ?? 'The requested horizon was not fully processed.'} Exports are labeled incomplete and must not be used as a full-run comparison.</p>}<div className="ql-actions"><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultCSV(result), safeFilename(`${result.model.name}-${result.status}-results`, 'csv'), 'text/csv;charset=utf-8'); notify('Results download requested. Verify that the browser saved the file.'); })}>Download results CSV</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(async () => { await downloadResultPNG(result); notify('Result PNG download requested. Review the image and verify that the browser saved it; this is not a storage acknowledgment.'); })}>Download result PNG</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => printResult(result))}>Print / save as PDF</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultReportHTML(result), safeFilename(`${result.model.name}-${result.status}-report`, 'html'), 'text/html;charset=utf-8'); notify('Report download requested. Verify that the browser saved the file.'); })}>Download report HTML</button></div><p className="ql-help">The result image includes the run name, metrics and seed. Review it before sharing; it preserves this run snapshot.</p><p className="ql-help">Summary wait and journey times use completed entities from arrivals in [warm-up, horizon). Unfinished and abandoned work is shown separately. Reports include the exact model snapshot; a single run does not estimate sampling uncertainty.</p></> : <p className="ql-help">Run a model to export its observed results. No calculated forecast is available yet.</p>}</section>
    {latestAttempt && latestAttempt.status !== 'completed' && <section className="ql-data-section" aria-label="Latest incomplete attempt">
      <h3>Latest incomplete attempt</h3>
      <p className="ql-result-identity"><strong>Incomplete run: {latestAttempt.status}</strong> · seed {latestAttempt.seed} · engine {latestAttempt.engineVersion}<br />Run {latestAttempt.id} · snapshot {latestAttempt.modelHash}<br />Observed through {latestAttempt.simulatedUntil} / {latestAttempt.model.horizon} seconds · trace {latestAttempt.trace.complete ? 'complete' : `limited to ${latestAttempt.trace.until} seconds`}</p>
      <p className="ql-notice">{latestAttempt.reason ?? 'The requested horizon was not fully processed.'} These are partial observations, never a full-run forecast, baseline or comparison.{result ? ' Your last completed result is preserved in Results & report above.' : ''}</p>
      {attemptStale && <p className="ql-notice">This attempt belongs to an earlier model snapshot or seed. Its exports preserve that attempted run; they do not describe the current draft.</p>}
      <div className="ql-actions">
        <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(async () => { await downloadResultPNG(latestAttempt); notify('Incomplete PNG download requested. Review its partial-run label and verify that the browser saved the file; this is not a storage acknowledgment.'); })}>Download incomplete PNG</button>
        <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultCSV(latestAttempt), safeFilename(`${latestAttempt.model.name}-incomplete-${latestAttempt.status}-results`, 'csv'), 'text/csv;charset=utf-8'); notify('Incomplete CSV download requested. Verify that the browser saved the file.'); })}>Download incomplete CSV</button>
        <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultReportHTML(latestAttempt), safeFilename(`${latestAttempt.model.name}-incomplete-${latestAttempt.status}-report`, 'html'), 'text/html;charset=utf-8'); notify('Incomplete report download requested. Verify that the browser saved the file.'); })}>Download incomplete report HTML</button>
      </div>
      <p className="ql-help">Only the latest incomplete attempt is held in this tab. A new calculation or project replacement clears it. Download it before retrying if you need to keep these observations. Unfinished waits remain censored, not zero.</p>
    </section>}
    <div className="ql-operation-status" aria-live="polite" aria-atomic="true">{busy && <p>Working with local data…</p>}{status && <p role="status">{status}</p>}{error && <p role="alert" className="ql-error">{error}</p>}</div>
  </div>;
}
