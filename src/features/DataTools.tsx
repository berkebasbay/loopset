import { interfaceMessages as ui } from '../ui/messages/interface';
import { dataToolsMessages as m } from '../ui/messages/DataTools';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { duplicateProject, mutateProject } from '../model/commands';
import { modelHash } from '../model/identity';
import type { Project, RunResult } from '../model/types';
import { validateProject } from '../model/validate';
import { FILE_LIMIT, downloadText, readLocalText, safeFilename } from '../storage/csv';
import { openProjectJSON, serializeProject } from '../storage/projectFile';
import { scanProjectLibrary, loadProject, rememberOpenedProject, saveProject } from '../storage/projectStore';
import type { ProjectLibraryScan, ProjectLibrarySort } from '../storage/projectStore';
import { inspectSampleCSV, mapSampleCSV, type CSVTimeUnit, type SampleCSVTable, type MappedSampleCSV } from '../storage/csvMapping';
import { fileEaseMessages as f } from '../ui/messages/fileEase';
import { ResultExports, captureDataOperationFocus, type OperationFocusOptions } from './ResultExports';
export { captureDataOperationFocus } from './ResultExports';
import { RunProvenanceDetails } from './RunProvenanceDetails';
import './features.css';

export interface RetainedDraft {
  token: string; key: string; project: Project; bytes: number; context: number;
  state: 'waiting' | 'saving' | 'failed' | 'invalid'; message: string;
}
export type FileTab = 'projects' | 'import' | 'reports';
interface Props {
  initialTab?: FileTab;
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
    instructions: m.repairInstructions,
    project,
  }, recoveryNumber, 2);
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error(m.repairBackupLimitReached);
  return text;
}

/** A reviewed preview is re-read before acceptance. The editing callback may
 * return a different (monotonic) revision; the comparison base remains the DB snapshot. */
export async function openSavedProject(id: string, accept: Props['onImport'], isCurrent: () => boolean = () => true): Promise<Project> {
  const opened = await loadProject(id, { observe: false });
  if (!isCurrent()) throw new Error(f.contextChanged);
  if (!opened) throw new Error(m.thisSavedProjectNoLongerExistsRefreshTheLocal);
  if (accept(opened) === null) throw new Error(m.projectReplacementWasPausedTheCurrentDraftIsStill);
  rememberOpenedProject(opened); return opened;
}

interface CSVWizard {
  kind: 'arrival' | 'service'; filename: string; table: SampleCSVTable; column: number; unit: CSVTimeUnit; targetId: string; projectId: string; projectRevision: number;
}
interface SamplePreview extends MappedSampleCSV { kind: 'arrival' | 'service'; targetId: string; filename: string; projectId: string; projectRevision: number }

export function DataTools({ project, result, latestAttempt = null, onImport, onSave = saveProject, retainedDrafts = [], onRestoreDraft, onRetryDraft, onRemoveDraft, initialTab = 'projects' }: Props) {
  const [tab, setTab] = useState<FileTab>(initialTab); const tabId = useId(); const tabs = useRef<Partial<Record<FileTab, HTMLButtonElement | null>>>({}); const currentTab = useRef(tab); currentTab.current = tab;
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const [query, setQuery] = useState(''); const [sort, setSort] = useState<ProjectLibrarySort>('recent');
  const [wizard, setWizard] = useState<CSVWizard | null>(null);
  const [removeToken, setRemoveToken] = useState<string | null>(null);
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ProjectLibraryScan | null>(null); const [pending, setPending] = useState<Project | null>(null); const [pendingLocalId, setPendingLocalId] = useState<string | null>(null); const [preview, setPreview] = useState<SamplePreview | null>(null);
  const [arrivalTarget, setArrivalTarget] = useState(''); const [serviceTarget, setServiceTarget] = useState('');
  const root = useRef<HTMLDivElement>(null); const saveButton = useRef<HTMLButtonElement>(null);
  const arrivalButton = useRef<HTMLButtonElement>(null); const serviceButton = useRef<HTMLButtonElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null); const arrivalInput = useRef<HTMLInputElement>(null); const serviceInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const current = useRef(project); current.current = project;
  const operationInFlight = useRef(false);
  const operationFocus = useRef<ReturnType<typeof captureDataOperationFocus>>(null);
  const [completedOperation, setCompletedOperation] = useState(0);
  useLayoutEffect(() => {
    if (busy) return;
    const focus = operationFocus.current; operationFocus.current = null; focus?.complete(project.id);
  }, [busy, completedOperation, project.id]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operationFocus.current?.cancel(); }; }, []);
  const sources = project.model.nodes.filter(n => n.kind === 'source'); const services = project.model.nodes.filter(n => n.kind === 'service');
  const actualArrivalTarget = sources.some(n => n.id === arrivalTarget) ? arrivalTarget : sources[0]?.id ?? '';
  const actualServiceTarget = services.some(n => n.id === serviceTarget) ? serviceTarget : services[0]?.id ?? '';
  const stale = result && (result.modelHash !== modelHash(project.model) || result.seed !== project.model.seed);
  const attemptStale = latestAttempt && (latestAttempt.modelHash !== modelHash(project.model) || latestAttempt.seed !== project.model.seed || validateProject(project).some(issue => issue.severity === 'error'));
  function notify(message: string) { if (!mounted.current) return; setStatus(message); setError(''); }
  function applyImport(next: Project) {
    if (!mounted.current) throw new Error(f.contextChanged);
    if (onImport(next) === null) throw new Error(m.projectReplacementWasPausedTheCurrentDraftIsStill);
  }
  async function perform(operation: () => void | Promise<void>, focus: OperationFocusOptions = {}) {
    if (operationInFlight.current || !mounted.current) return;
    operationInFlight.current = true;
    operationFocus.current?.cancel(); operationFocus.current = captureDataOperationFocus(root.current, project.id, { ...focus, fallback: () => {
      const candidate = focus.fallback?.();
      return candidate?.isConnected && !candidate.matches(':disabled') && !candidate.closest('[hidden], [inert]') ? candidate : tabs.current[currentTab.current] ?? null;
    } });
    setBusy(true); setError(''); setStatus('');
    try { await operation(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : m.theFileOperationFailedYourCurrentProjectHasNot); }
    finally { operationInFlight.current = false; if (mounted.current) { setBusy(false); setCompletedOperation(value => value + 1); } }
  }
  async function browse(continueScan = false, nextResults = false) {
    await perform(async () => {
      const request = continueScan && saved ? saved.request : nextResults && saved ? { ...saved.request, after: saved.items.at(-1) ?? null } : { query, sort, after: null };
      const page = await scanProjectLibrary(request, continueScan ? saved : null); setSaved(page);
      notify(f.scanScope(page.scanned, page.matched, page.complete));
    });
  }
  async function reviewLocal(id: string) {
    await perform(async () => {
      const context = { id: project.id, revision: project.revision }; const opened = await loadProject(id, { observe: false });
      if (!mounted.current || current.current.id !== context.id || current.current.revision !== context.revision) throw new Error(f.contextChanged);
      if (!opened) throw new Error(m.thisSavedProjectNoLongerExistsRefreshTheLocal);
      setPending(opened); setPendingLocalId(id); setPreview(null); notify(m.reviewTheSavedProjectBeforeReplacingTheCurrentDraft);
    });
  }
  async function openFile(file?: File) {
    if (!file) return;
    const context = { id: project.id, revision: project.revision };
    await perform(async () => { const opened = openProjectJSON(await readLocalText(file)); if (!mounted.current || current.current.id !== context.id || current.current.revision !== context.revision) throw new Error(f.contextChanged); setPending(opened); setPendingLocalId(null); setPreview(null); notify(m.validatedProject(opened.name)); });
  }
  async function openSamples(kind: 'arrival' | 'service', file?: File) {
    if (!file) return; const targetId = kind === 'arrival' ? actualArrivalTarget : actualServiceTarget; const context = { id: project.id, revision: project.revision };
    await perform(async () => {
      if (!targetId) throw new Error(m.addSampleTarget(kind));
      const table = inspectSampleCSV(await readLocalText(file), kind);
      if (!mounted.current || current.current.id !== context.id || current.current.revision !== context.revision) throw new Error(f.contextChanged);
      const canonical = kind === 'arrival' ? 'arrival_seconds' : 'service_seconds';
      const matched = table.headers.findIndex(header => header.trim() === canonical);
      setWizard({ kind, filename: file.name, table, targetId, projectId: context.id, projectRevision: context.revision, column: matched >= 0 ? matched : table.headers.length === 1 ? 0 : -1, unit: 'seconds' });
      setPreview(null); setPending(null); setPendingLocalId(null); notify(f.csvLoaded);
    });
  }
  function previewSamples() {
    if (!wizard) return;
    void perform(() => {
      if (wizard.projectId !== project.id || wizard.projectRevision !== project.revision) throw new Error(f.contextChanged);
      const mapped = mapSampleCSV(wizard.table, wizard.column, wizard.unit, wizard.kind === 'arrival' ? project.model.horizon : undefined);
      setPreview({ ...mapped, kind: wizard.kind, targetId: wizard.targetId, filename: wizard.filename, projectId: wizard.projectId, projectRevision: wizard.projectRevision });
      notify(m.csvIsValidReviewAndApplyTheReplacementBelow);
    });
  }
  function updateWizard(patch: Partial<CSVWizard>) { if (wizard) setWizard({ ...wizard, ...patch }); setPreview(null); }
  function applySamples() {
    if (!preview) return;
    void perform(() => {
      if (preview.projectId !== project.id || preview.projectRevision !== project.revision) throw new Error(f.contextChanged);
      const node = project.model.nodes.find(n => n.id === preview.targetId);
      if (!node || node.kind !== (preview.kind === 'arrival' ? 'source' : 'service')) throw new Error(m.theTargetStepChangedSelectTheTargetAndImport);
      if (preview.kind === 'arrival' && preview.values.some(v => v >= project.model.horizon)) throw new Error(m.theRunHorizonChangedSomeArrivalsNowLieOutside);
      applyImport(mutateProject(project, copy => {
        const target = copy.model.nodes.find(n => n.id === preview.targetId)!;
        if (target.kind === 'source') target.arrival = { kind: 'schedule', times: [...preview.values] };
        if (target.kind === 'service') target.duration = { kind: 'empirical', values: [...preview.values] };
      }));
      notify(m.appliedSamples(preview.values.length.toLocaleString('en'), preview.kind, node.label)); setPreview(null); setWizard(null);
    }, { fallback: () => preview.kind === 'arrival' ? arrivalButton.current : serviceButton.current });
  }
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const tabNames: Record<FileTab, string> = { projects: f.projects, import: f.importData, reports: f.reports };
  const order: FileTab[] = ['projects', 'import', 'reports'];
  return <div ref={root} className="ql-feature ql-data-tools">
    <p className="ql-help">{f.storageScope(origin)}</p>
    {retainedDrafts.length > 0 && <section className="ql-data-section" aria-label={m.retainedDrafts}><h3>{m.retainedDraftsHeading(retainedDrafts.length)}</h3><p className="ql-help">{m.theseCopiesRemainInThisTabUntilTheirExact}</p><ul className="ql-saved-projects">{retainedDrafts.map(draft => <li key={draft.token}><div><strong>{m.draftRevision(draft.project.name || m.unnamedDraft, draft.project.revision)}</strong><small>{draft.state === 'saving' || draft.state === 'waiting' ? m.savingBeforeReplacement : draft.state === 'invalid' ? m.needsRepairRetainedInThisTab : m.localSaveFailedRetainedInThisTab}</small><p className="ql-help">{draft.message}</p><div className="ql-actions"><button className="ql-button" type="button" onClick={() => onRestoreDraft?.(draft.token)}>{m.restoreForRepair}</button><button className="ql-button" type="button" disabled={draft.state === 'saving' || draft.state === 'waiting' || validateProject(draft.project).some(issue => issue.severity === 'error')} onClick={() => onRetryDraft?.(draft.token)}>{m.retryLocalSave}</button><button className="ql-button" type="button" onClick={() => void perform(() => { downloadText(serializeDraftRecovery(draft.project), safeFilename(`${draft.project.name}-unvalidated-repair`, 'json'), 'application/json;charset=utf-8'); notify(m.repairBackupDownloadRequestedItIsNotValidatedProject); })}>{m.requestRepairBackup}</button><button className="ql-button ql-danger" type="button" disabled={draft.state === 'saving' || draft.state === 'waiting'} onClick={() => setRemoveToken(draft.token)}>{m.removeRetainedCopy}</button></div>{removeToken === draft.token && <div className="ql-delete-review"><p>{m.thisMayBeTheOnlyCopyOfThisDraft}</p><div className="ql-actions"><button className="ql-button ql-danger" type="button" onClick={() => { onRemoveDraft?.(draft.token); setRemoveToken(null); }}>{m.removeThisRetainedCopy}</button><button className="ql-button" type="button" onClick={() => setRemoveToken(null)}>{m.keepCopy}</button></div></div>}</div></li>)}</ul></section>}
    <div className="ql-toolbar" role="tablist" aria-label={f.tabs}>{order.map(key => <button key={key} ref={element => { tabs.current[key] = element; }} id={`${tabId}-tab-${key}`} role="tab" type="button" className={`ql-tab ${tab === key ? 'ql-active' : ''}`} aria-controls={`${tabId}-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => {
      const index = order.indexOf(key);
      const next = event.key === 'ArrowRight' ? order[(index + 1) % order.length] : event.key === 'ArrowLeft' ? order[(index + order.length - 1) % order.length] : event.key === 'Home' ? order[0] : event.key === 'End' ? order.at(-1)! : null;
      if (next) { event.preventDefault(); setTab(next); tabs.current[next]?.focus(); }
    }}>{tabNames[key]}</button>)}</div>

    <div role="tabpanel" id={`${tabId}-panel-projects`} aria-labelledby={`${tabId}-tab-projects`} hidden={tab !== 'projects'}>
      <section className="ql-data-section" aria-label={m.projectFiles}>
        <h3>{m.projectFiles}</h3><p className="ql-help">{ui.fileSummary}</p>
        <div className="ql-actions file-actions">
          <button ref={saveButton} className="ql-button ql-primary" disabled={busy} type="button" onClick={() => void perform(async () => {
            const snapshot = structuredClone(project); const ack = await onSave(snapshot);
            notify(m.savedProject(snapshot.name, ack.revision, new Date(ack.savedAt).toLocaleTimeString(), current.current.id !== ack.projectId || current.current.revision !== ack.revision));
          })}>{m.saveInThisBrowser}</button>
          <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => {
            downloadText(serializeProject(project), safeFilename(project.name, 'json'), 'application/json;charset=utf-8'); notify(m.projectDownloadRequested(project.revision));
          })}>{m.downloadProjectJson}</button>
          <button className="ql-button" disabled={busy} type="button" onClick={() => jsonInput.current?.click()}>{m.openProjectJson}</button>
          <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { serializeProject(project); applyImport(duplicateProject(project)); notify(m.createdANewLocalProjectIdentityYourPreviousSaved); }, { allowProjectChange: true })}>{m.duplicateProject}</button>
          <button className="ql-button" disabled={busy} type="button" onClick={() => void browse()}>{m.browseLocalProjects}</button>
        </div>
        <details className="file-format"><summary>{ui.fileFormat}</summary><p className="ql-help">{m.portableProjectHelp}</p></details>
        <input ref={jsonInput} hidden type="file" accept=".json,application/json" aria-label={m.openProjectJsonFile} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void openFile(file); }} />
        <details className="ql-advanced" open={validateProject(project).some(issue => issue.severity === 'error') || undefined}>
          <summary>{f.repairTools}</summary>
          <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(serializeDraftRecovery(project), safeFilename(`${project.name}-unvalidated-repair`, 'json'), 'application/json;charset=utf-8'); notify(m.repairBackupRequested); })}>{m.requestDraftRepairBackup}</button>
        </details>
      </section>

      <section className="ql-data-section" aria-label={m.browseLocalProjects}>
        <h3>{m.browseLocalProjects}</h3><p className="ql-help">{f.metadataOnly}</p>
        <form onSubmit={event => { event.preventDefault(); void browse(); }}>
          <div className="ql-grid">
            <div className="ql-field"><label htmlFor={`${tabId}-library-query`}>{f.librarySearch}</label><input id={`${tabId}-library-query`} type="search" value={query} maxLength={160} onChange={event => setQuery(event.currentTarget.value)} /></div>
            <div className="ql-field"><label htmlFor={`${tabId}-library-sort`}>{f.librarySort}</label><select id={`${tabId}-library-sort`} value={sort} onChange={event => setSort(event.currentTarget.value as ProjectLibrarySort)}><option value="recent">{f.recent}</option><option value="oldest">{f.oldest}</option><option value="name">{f.byName}</option></select></div>
          </div><button type="submit" className="ql-button" disabled={busy}>{f.search}</button>
        </form>
        {saved && <>
          <p className="ql-help">{f.queryScope(saved.request.query)} {f.scanScope(saved.scanned, saved.matched, saved.complete)}</p>
          {saved.unlistedRecords > 0 && <p role="alert" className="ql-notice">{m.unlistedSavedRecords(saved.unlistedRecords)}</p>}
          {!saved.items.length && <p className="ql-help">{saved.complete ? f.noMatches : m.noReadableProjectMetadata}</p>}
          <ul className="ql-saved-projects">{saved.items.map(item => <li key={item.id}>
            <div><strong>{item.name ?? m.savedProjectIdentity(item.id)}</strong><small>{item.revision === undefined ? m.savedTime(Number.isFinite(Date.parse(item.savedAt)) ? new Date(item.savedAt).toLocaleString() : m.unknownSaveTime) : m.savedRevision(item.revision, new Date(item.savedAt).toLocaleString())}</small></div>
            <button className="ql-button" disabled={busy} type="button" onClick={() => void reviewLocal(item.id)}>{m.reviewOpen}</button>
          </li>)}</ul>
          <div className="ql-actions">
            {!saved.complete && <button className="ql-button" disabled={busy} type="button" onClick={() => void browse(true)}>{f.continueScan}</button>}
            {saved.hasMoreResults && <button className="ql-button" disabled={busy} type="button" onClick={() => void browse(false, true)}>{f.nextResults}</button>}
            {saved.request.after && <button className="ql-button" disabled={busy} type="button" onClick={() => void browse()}>{f.firstResults}</button>}
            <button className="ql-button" disabled={busy} type="button" onClick={() => void browse()}>{m.refreshSavedProjects}</button>
          </div>
        </>}
        {pending && <div className="ql-import-preview">
          <h4>{m.openProjectQuestion(pending.name)}</h4><p>{m.projectPreview(pending.model.nodes.length, pending.model.resources.length, pending.model.horizon.toLocaleString('en'), pending.revision)}</p>
          <p>{m.thisReplacesTheCurrentDraftDownloadItFirstIf}</p><div className="ql-actions">
            <button type="button" className="ql-button ql-primary" disabled={busy} onClick={() => void perform(async () => {
              if (pendingLocalId) {
                const expected = { id: current.current.id, revision: current.current.revision };
                await openSavedProject(pendingLocalId, onImport, () => mounted.current && current.current.id === expected.id && current.current.revision === expected.revision);
              } else applyImport(structuredClone(pending));
              if (mounted.current) { setPending(null); setPendingLocalId(null); notify(m.projectOpenedRunItToCalculateResultsFromIts); }
            }, { fallback: () => tab === 'projects' ? saveButton.current : tabs.current[tab] ?? null, allowProjectChange: true })}>{m.openThisProject}</button>
            <button type="button" className="ql-button" disabled={busy} onClick={() => { setPending(null); setPendingLocalId(null); }}>{m.cancel}</button>
          </div>
        </div>}
      </section>
    </div>

    <div role="tabpanel" id={`${tabId}-panel-import`} aria-labelledby={`${tabId}-tab-import`} hidden={tab !== 'import'}>
      <section className="ql-data-section" aria-label={m.csvInputs}>
        <h3>{f.chooseCsvFile}</h3><p className="ql-help">{f.conversionNotice}</p>
        <div className="ql-import-grid">
          <div><label className="ql-direct-label" htmlFor="ql-arrival-source">{m.arrivalSource}</label><select id="ql-arrival-source" value={actualArrivalTarget} onChange={event => setArrivalTarget(event.currentTarget.value)} disabled={busy || !sources.length}>{!sources.length && <option value="">{m.addASourceFirst}</option>}{sources.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
            <p className="ql-help"><code>arrival_seconds</code><br />{m.arrivalSampleScope(project.model.horizon)}</p><div className="ql-actions">
              <button ref={arrivalButton} type="button" className="ql-button" disabled={busy || !sources.length} onClick={() => arrivalInput.current?.click()}>{m.importArrivalsCsv}</button>
              <button type="button" className="ql-text-button" onClick={() => downloadText('arrival_seconds\r\n0\r\n12.5\r\n30\r\n', 'arrival-template.csv', 'text/csv;charset=utf-8')}>{m.downloadTemplate}</button>
            </div>
          </div>
          <div><label className="ql-direct-label" htmlFor="ql-service-target">{m.serviceStation}</label><select id="ql-service-target" value={actualServiceTarget} onChange={event => setServiceTarget(event.currentTarget.value)} disabled={busy || !services.length}>{!services.length && <option value="">{m.addAServiceFirst}</option>}{services.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
            <p className="ql-help"><code>service_seconds</code><br />{m.serviceSampleLimits}</p><div className="ql-actions">
              <button ref={serviceButton} type="button" className="ql-button" disabled={busy || !services.length} onClick={() => serviceInput.current?.click()}>{m.importServiceCsv}</button>
              <button type="button" className="ql-text-button" onClick={() => downloadText('service_seconds\r\n15\r\n22.5\r\n30\r\n', 'service-template.csv', 'text/csv;charset=utf-8')}>{m.downloadTemplate}</button>
            </div>
          </div>
        </div>
        <input ref={arrivalInput} hidden type="file" accept=".csv,text/csv" aria-label={m.arrivalCsvFile} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void openSamples('arrival', file); }} />
        <input ref={serviceInput} hidden type="file" accept=".csv,text/csv" aria-label={m.serviceCsvFile} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void openSamples('service', file); }} />
        {wizard && <div className="ql-import-preview">
          <h4>{f.mapping}</h4><p>{f.csvFile}: {wizard.filename} · {wizard.kind === 'arrival' ? f.arrivals : f.service}</p>
          <p>{f.rawRows(wizard.table.rows.length, wizard.table.headers.length)}</p>
          <div className="ql-grid">
            <div className="ql-field"><label htmlFor={`${tabId}-csv-column`}>{f.csvColumn}</label><select id={`${tabId}-csv-column`} value={wizard.column} disabled={busy} onChange={event => updateWizard({ column: Number(event.currentTarget.value) })}><option value="-1">{f.chooseColumn}</option>{wizard.table.headers.map((header, index) => <option key={index} value={index}>{f.selectedColumn(header, index)}</option>)}</select></div>
            <div className="ql-field"><label htmlFor={`${tabId}-csv-unit`}>{f.sourceUnit}</label><select id={`${tabId}-csv-unit`} value={wizard.unit} disabled={busy} onChange={event => updateWizard({ unit: event.currentTarget.value as CSVTimeUnit })}>{(['seconds', 'minutes', 'hours'] as const).map(unit => <option key={unit} value={unit}>{f.units[unit]}</option>)}</select></div>
            <div className="ql-field"><label htmlFor={`${tabId}-csv-target`}>{f.targetStep}</label><select id={`${tabId}-csv-target`} value={wizard.targetId} disabled={busy} onChange={event => updateWizard({ targetId: event.currentTarget.value })}>{(wizard.kind === 'arrival' ? sources : services).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></div>
          </div>
          <div className="ql-actions"><button type="button" className="ql-button ql-primary" disabled={busy || wizard.column < 0} onClick={previewSamples}>{f.previewCsv}</button><button type="button" className="ql-button" disabled={busy} onClick={() => { setWizard(null); setPreview(null); }}>{f.cancelCsv}</button></div>
        </div>}
        {preview && wizard && <div className="ql-import-preview">
          <h4>{f.reviewCsv}</h4>
          <p>{f.mappingSummary(wizard.table.headers[preview.column], f.units[preview.unit], project.model.nodes.find(node => node.id === preview.targetId)?.label ?? m.missingStep)}</p>
          <p>{m.samplePreview(preview.values.length.toLocaleString('en'), preview.filename, project.model.nodes.find(node => node.id === preview.targetId)?.label ?? m.missingStep, preview.values.reduce((min, value) => Math.min(min, value), Infinity), preview.values.reduce((max, value) => Math.max(max, value), -Infinity))}</p>
          <p>{f.sampleRows(preview.previewRows.length, preview.values.length)}</p>
          <table style={{ width: '100%', textAlign: 'left', tableLayout: 'fixed', overflowWrap: 'anywhere' }}>
            <thead><tr><th style={{ width: '20%' }}>{f.row}</th><th>{f.sourceValue}</th><th>{f.secondsValue}</th></tr></thead>
            <tbody>{preview.previewRows.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.original.length > 160 ? `${row.original.slice(0, 160)}…` : row.original}</td><td>{row.seconds}</td></tr>)}</tbody>
          </table>
          <p>{m.sampleReplacementNote(preview.kind === 'arrival' ? m.theSourceWillUseTheseExactTimestampsInsteadOf : m.serviceReplacementDescription)}</p>
          <div className="ql-actions"><button className="ql-button ql-primary" disabled={busy} type="button" onClick={applySamples}>{m.applyRows(preview.values.length.toLocaleString('en'))}</button><button className="ql-button" disabled={busy} type="button" onClick={() => { setPreview(null); setWizard(null); }}>{f.cancelCsv}</button></div>
        </div>}
      </section>
    </div>

    <div role="tabpanel" id={`${tabId}-panel-reports`} aria-labelledby={`${tabId}-tab-reports`} hidden={tab !== 'reports'}>
      <section className="ql-data-section" aria-label={m.resultExports}>
        <h3>{m.resultsReport}</h3>{result ? <>
          <p className="ql-result-identity"><strong>{result.status === 'completed' ? m.completedRun : m.incompleteRun(result.status)}</strong>{m.seedAndEngine(result.seed, result.engineVersion)}<br />{m.runIdentity(result.id, result.modelHash)}<br />{m.observationScope(result.simulatedUntil, result.model.horizon, result.trace.complete, result.trace.until)}</p>
          <RunProvenanceDetails run={result} />
          <ResultExports result={result} stale={Boolean(stale)} disabled={busy} perform={perform} onStatus={notify} onError={setError} />
          <p className="ql-help">{m.theResultImageIncludesTheRunNameMetricsAnd}</p><p className="ql-help">{m.summaryWaitAndJourneyTimesUseCompletedEntitiesFrom}</p>
        </> : <p className="ql-help">{m.runAModelToExportItsObservedResultsNo}</p>}
      </section>
      {latestAttempt && latestAttempt.status !== 'completed' && <section className="ql-data-section" aria-label={m.latestIncompleteAttempt}>
        <h3>{m.latestIncompleteAttempt}</h3>
        <p className="ql-result-identity"><strong>{m.attemptHeading(latestAttempt.status)}</strong>{m.seedAndEngine(latestAttempt.seed, latestAttempt.engineVersion)}<br />{m.runIdentity(latestAttempt.id, latestAttempt.modelHash)}<br />{m.observationScope(latestAttempt.simulatedUntil, latestAttempt.model.horizon, latestAttempt.trace.complete, latestAttempt.trace.until)}</p>
        <RunProvenanceDetails run={latestAttempt} summary={m.incompleteRunSettingsIdentity} />
        <p className="ql-notice">{m.partialAttemptNote(latestAttempt.reason ?? m.theRequestedHorizonWasNotFullyProcessed, result ? m.yourLastCompletedResultIsPreservedInResultsReport : '')}</p>
        <ResultExports result={latestAttempt} stale={Boolean(attemptStale)} disabled={busy} perform={perform} onStatus={notify} onError={setError} />
        <p className="ql-help">{m.onlyTheLatestIncompleteAttemptIsHeldInThis}</p>
      </section>}
    </div>

    <div className="ql-operation-status" aria-live="polite" aria-atomic="true">{busy && <p>{m.workingWithLocalData}</p>}{status && <p role="status">{status}</p>}{error && <p role="alert" className="ql-error">{error}</p>}</div>
  </div>;
}
