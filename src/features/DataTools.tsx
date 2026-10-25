import { dataToolsMessages as m } from '../ui/messages/DataTools';
import { useLayoutEffect, useRef, useState } from 'react';
import { duplicateProject, mutateProject } from '../model/commands';
import { modelHash } from '../model/identity';
import type { Project, RunResult } from '../model/types';
import { validateProject } from '../model/validate';
import { FILE_LIMIT, downloadText, parseSampleCSV, readLocalText, safeFilename } from '../storage/csv';
import { openProjectJSON, serializeProject } from '../storage/projectFile';
import { listProjectPage, loadProject, rememberOpenedProject, saveProject } from '../storage/projectStore';
import type { ProjectPage, ProjectPageCursor } from '../storage/projectStore';
import { printResult, resultCSV, resultReportHTML } from '../storage/report';
import { downloadResultPNG } from '../storage/resultCard';
import { RunProvenanceDetails } from './RunProvenanceDetails';
import './features.css';

export interface RetainedDraft {
  token: string; key: string; project: Project; bytes: number; context: number;
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
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error(m.repairBackupLimitReached);
  return text;
}

/** A reviewed preview is re-read before acceptance. The editing callback may
 * return a different (monotonic) revision; the comparison base remains the DB snapshot. */
export async function openSavedProject(id: string, accept: Props['onImport']): Promise<Project> {
  const opened = await loadProject(id, { observe: false });
  if (!opened) throw new Error(m.thisSavedProjectNoLongerExistsRefreshTheLocal);
  if (accept(opened) === null) throw new Error(m.projectReplacementWasPausedTheCurrentDraftIsStill);
  rememberOpenedProject(opened); return opened;
}

interface SamplePreview { kind: 'arrival' | 'service'; values: number[]; targetId: string; filename: string }
interface OperationFocusOptions { fallback?: () => HTMLElement | null; allowProjectChange?: boolean }

/** Disabled native buttons lose focus while an operation is pending. Restore only
 * that loss, never a focus change made by the user or another document context. */
export function captureDataOperationFocus(root: HTMLElement | null, projectId: string, options: OperationFocusOptions = {}) {
  if (!root) return null;
  const doc = root.ownerDocument; const trigger = doc.activeElement as HTMLElement | null;
  if (!trigger || !root.contains(trigger) || typeof trigger.focus !== 'function') return null;
  let interrupted = false; let finished = false;
  const onFocus = (event: Event) => {
    if (event.target !== trigger && event.target !== doc.body && event.target !== doc.documentElement) interrupted = true;
  };
  const onPointer = (event: Event) => { if (event.target !== trigger && !trigger.contains(event.target as Node | null)) interrupted = true; };
  const onBlur = () => { interrupted = true; };
  doc.addEventListener('focusin', onFocus, true); doc.addEventListener('pointerdown', onPointer, true);
  doc.defaultView?.addEventListener('blur', onBlur);
  const detach = () => {
    doc.removeEventListener('focusin', onFocus, true); doc.removeEventListener('pointerdown', onPointer, true);
    doc.defaultView?.removeEventListener('blur', onBlur);
  };
  return { cancel() { finished = true; detach(); }, complete(currentProjectId: string) {
    if (finished) return;
    finished = true; detach();
    const active = doc.activeElement;
    if (interrupted || !root.isConnected || (!options.allowProjectChange && currentProjectId !== projectId)
      || (active !== trigger && active !== doc.body && active !== doc.documentElement)) return;
    const target = trigger.isConnected && root.contains(trigger) ? trigger : options.fallback?.();
    if (target?.isConnected && root.contains(target) && !target.matches(':disabled') && !target.closest('[hidden], [inert]')) target.focus();
  } };
}
export function DataTools({ project, result, latestAttempt = null, onImport, onSave = saveProject, retainedDrafts = [], onRestoreDraft, onRetryDraft, onRemoveDraft }: Props) {
  const [removeToken, setRemoveToken] = useState<string | null>(null);
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ProjectPage | null>(null); const [pending, setPending] = useState<Project | null>(null); const [pendingLocalId, setPendingLocalId] = useState<string | null>(null); const [preview, setPreview] = useState<SamplePreview | null>(null);
  const [arrivalTarget, setArrivalTarget] = useState(''); const [serviceTarget, setServiceTarget] = useState('');
  const root = useRef<HTMLDivElement>(null); const saveButton = useRef<HTMLButtonElement>(null);
  const arrivalButton = useRef<HTMLButtonElement>(null); const serviceButton = useRef<HTMLButtonElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null); const arrivalInput = useRef<HTMLInputElement>(null); const serviceInput = useRef<HTMLInputElement>(null);
  const current = useRef(project); current.current = project;
  const operationInFlight = useRef(false);
  const operationFocus = useRef<ReturnType<typeof captureDataOperationFocus>>(null);
  const [completedOperation, setCompletedOperation] = useState(0);
  useLayoutEffect(() => {
    if (busy) return;
    const focus = operationFocus.current; operationFocus.current = null; focus?.complete(project.id);
  }, [busy, completedOperation, project.id]);
  useLayoutEffect(() => () => { operationFocus.current?.cancel(); }, []);
  const sources = project.model.nodes.filter(n => n.kind === 'source'); const services = project.model.nodes.filter(n => n.kind === 'service');
  const actualArrivalTarget = sources.some(n => n.id === arrivalTarget) ? arrivalTarget : sources[0]?.id ?? '';
  const actualServiceTarget = services.some(n => n.id === serviceTarget) ? serviceTarget : services[0]?.id ?? '';
  const stale = result && (result.modelHash !== modelHash(project.model) || result.seed !== project.model.seed);
  const attemptStale = latestAttempt && (latestAttempt.modelHash !== modelHash(project.model) || latestAttempt.seed !== project.model.seed || validateProject(project).some(issue => issue.severity === 'error'));
  function notify(message: string) { setStatus(message); setError(''); }
  function applyImport(next: Project) {
    if (onImport(next) === null) throw new Error(m.projectReplacementWasPausedTheCurrentDraftIsStill);
  }
  async function perform(operation: () => void | Promise<void>, focus: OperationFocusOptions = {}) {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    operationFocus.current?.cancel(); operationFocus.current = captureDataOperationFocus(root.current, project.id, focus);
    setBusy(true); setError(''); setStatus('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : m.theFileOperationFailedYourCurrentProjectHasNot); }
    finally { operationInFlight.current = false; setBusy(false); setCompletedOperation(value => value + 1); }
  }
  async function browse(after: ProjectPageCursor | null = null) {
    await perform(async () => {
      const page = await listProjectPage(after); setSaved(page);
      notify(page.items.length ? m.savedPageCount(page.items.length, Boolean(page.next)) : page.unlistedRecords ? m.noReadableProjectMetadata : m.noProjectsAreSavedInThisBrowserYet);
    });
  }
  async function reviewLocal(id: string) {
    await perform(async () => {
      const opened = await loadProject(id, { observe: false });
      if (!opened) throw new Error(m.thisSavedProjectNoLongerExistsRefreshTheLocal);
      setPending(opened); setPendingLocalId(id); setPreview(null); notify(m.reviewTheSavedProjectBeforeReplacingTheCurrentDraft);
    });
  }
  async function openFile(file?: File) {
    if (!file) return;
    await perform(async () => { const opened = openProjectJSON(await readLocalText(file)); setPending(opened); setPendingLocalId(null); setPreview(null); notify(m.validatedProject(opened.name)); });
  }
  async function openSamples(kind: 'arrival' | 'service', file?: File) {
    if (!file) return; const targetId = kind === 'arrival' ? actualArrivalTarget : actualServiceTarget;
    await perform(async () => {
      if (!targetId) throw new Error(m.addSampleTarget(kind));
      const values = parseSampleCSV(await readLocalText(file), kind, kind === 'arrival' ? project.model.horizon : undefined);
      setPreview({ kind, values, targetId, filename: file.name }); setPending(null); notify(m.csvIsValidReviewAndApplyTheReplacementBelow);
    });
  }
  function applySamples() {
    if (!preview) return;
    void perform(() => {
      const node = project.model.nodes.find(n => n.id === preview.targetId);
      if (!node || node.kind !== (preview.kind === 'arrival' ? 'source' : 'service')) throw new Error(m.theTargetStepChangedSelectTheTargetAndImport);
      if (preview.kind === 'arrival' && preview.values.some(v => v >= project.model.horizon)) throw new Error(m.theRunHorizonChangedSomeArrivalsNowLieOutside);
      applyImport(mutateProject(project, copy => {
        const target = copy.model.nodes.find(n => n.id === preview.targetId)!;
        if (target.kind === 'source') target.arrival = { kind: 'schedule', times: [...preview.values] };
        if (target.kind === 'service') target.duration = { kind: 'empirical', values: [...preview.values] };
      }));
      notify(m.appliedSamples(preview.values.length.toLocaleString('en'), preview.kind, node.label)); setPreview(null);
    }, { fallback: () => preview.kind === 'arrival' ? arrivalButton.current : serviceButton.current });
  }
  return <div ref={root} className="ql-feature ql-data-tools">
    <p className="ql-help">{m.projectsAndImportsStayInThisBrowserKeepDownloaded}</p>
    {retainedDrafts.length > 0 && <section className="ql-data-section" aria-label={m.retainedDrafts}><h3>{m.retainedDraftsHeading(retainedDrafts.length)}</h3><p className="ql-help">{m.theseCopiesRemainInThisTabUntilTheirExact}</p><ul className="ql-saved-projects">{retainedDrafts.map(draft => <li key={draft.token}><div><strong>{m.draftRevision(draft.project.name || m.unnamedDraft, draft.project.revision)}</strong><small>{draft.state === 'saving' || draft.state === 'waiting' ? m.savingBeforeReplacement : draft.state === 'invalid' ? m.needsRepairRetainedInThisTab : m.localSaveFailedRetainedInThisTab}</small><p className="ql-help">{draft.message}</p><div className="ql-actions"><button className="ql-button" type="button" onClick={() => onRestoreDraft?.(draft.token)}>{m.restoreForRepair}</button><button className="ql-button" type="button" disabled={draft.state === 'saving' || draft.state === 'waiting' || validateProject(draft.project).some(issue => issue.severity === 'error')} onClick={() => onRetryDraft?.(draft.token)}>{m.retryLocalSave}</button><button className="ql-button" type="button" onClick={() => void perform(() => { downloadText(serializeDraftRecovery(draft.project), safeFilename(`${draft.project.name}-unvalidated-repair`, 'json'), 'application/json;charset=utf-8'); notify(m.repairBackupDownloadRequestedItIsNotValidatedProject); })}>{m.requestRepairBackup}</button><button className="ql-button ql-danger" type="button" disabled={draft.state === 'saving' || draft.state === 'waiting'} onClick={() => setRemoveToken(draft.token)}>{m.removeRetainedCopy}</button></div>{removeToken === draft.token && <div className="ql-delete-review"><p>{m.thisMayBeTheOnlyCopyOfThisDraft}</p><div className="ql-actions"><button className="ql-button ql-danger" type="button" onClick={() => { onRemoveDraft?.(draft.token); setRemoveToken(null); }}>{m.removeThisRetainedCopy}</button><button className="ql-button" type="button" onClick={() => setRemoveToken(null)}>{m.keepCopy}</button></div></div>}</div></li>)}</ul></section>}
    <section className="ql-data-section" aria-label={m.projectFiles}><h3>{m.projectFiles}</h3><p className="ql-help">{m.portableProjectHelp}</p><div className="ql-actions"><button ref={saveButton} className="ql-button ql-primary" disabled={busy} type="button" onClick={() => void perform(async () => { const snapshot = structuredClone(project); const ack = await onSave(snapshot); notify(m.savedProject(snapshot.name, ack.revision, new Date(ack.savedAt).toLocaleTimeString(), current.current.id !== ack.projectId || current.current.revision !== ack.revision)); })}>{m.saveInThisBrowser}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(serializeProject(project), safeFilename(project.name, 'json'), 'application/json;charset=utf-8'); notify(m.projectDownloadRequested(project.revision)); })}>{m.downloadProjectJson}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(serializeDraftRecovery(project), safeFilename(`${project.name}-unvalidated-repair`, 'json'), 'application/json;charset=utf-8'); notify(m.repairBackupRequested); })}>{m.requestDraftRepairBackup}</button><button className="ql-button" disabled={busy} type="button" onClick={() => jsonInput.current?.click()}>{m.openProjectJson}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { serializeProject(project); applyImport(duplicateProject(project)); notify(m.createdANewLocalProjectIdentityYourPreviousSaved); }, { allowProjectChange: true })}>{m.duplicateProject}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void browse()}>{m.browseLocalProjects}</button></div><input ref={jsonInput} hidden type="file" accept=".json,application/json" aria-label={m.openProjectJsonFile} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void openFile(file); }} />
      {saved && <><p className="ql-help">{m.savedPageHelp(saved.items.length, Boolean(saved.next))}</p>{saved.unlistedRecords > 0 && <p role="alert" className="ql-notice">{m.unlistedSavedRecords(saved.unlistedRecords)}</p>}<ul className="ql-saved-projects">{saved.items.map(item => <li key={item.id}><div><strong>{item.name ?? m.savedProjectIdentity(item.id)}</strong><small>{item.revision === undefined ? m.savedTime(Number.isFinite(Date.parse(item.savedAt)) ? new Date(item.savedAt).toLocaleString() : m.unknownSaveTime) : m.savedRevision(item.revision, new Date(item.savedAt).toLocaleString())}</small></div><button className="ql-button" disabled={busy} type="button" onClick={() => void reviewLocal(item.id)}>{m.reviewOpen}</button></li>)}</ul><div className="ql-actions">{saved.next && <button className="ql-button" disabled={busy} type="button" onClick={() => void browse(saved.next)}>{m.moreSavedProjects}</button>}<button className="ql-button" disabled={busy} type="button" onClick={() => void browse()}>{m.refreshSavedProjects}</button></div></>}
      {pending && <div className="ql-import-preview"><h4>{m.openProjectQuestion(pending.name)}</h4><p>{m.projectPreview(pending.model.nodes.length, pending.model.resources.length, pending.model.horizon.toLocaleString('en'), pending.revision)}</p><p>{m.thisReplacesTheCurrentDraftDownloadItFirstIf}</p><div className="ql-actions"><button type="button" className="ql-button ql-primary" disabled={busy} onClick={() => void perform(async () => { if (pendingLocalId) await openSavedProject(pendingLocalId, onImport); else applyImport(structuredClone(pending)); setPending(null); setPendingLocalId(null); notify(m.projectOpenedRunItToCalculateResultsFromIts); }, { fallback: () => saveButton.current, allowProjectChange: true })}>{m.openThisProject}</button><button type="button" className="ql-button" onClick={() => setPending(null)}>{m.cancel}</button></div></div>}
    </section>
    <section className="ql-data-section" aria-label={m.csvInputs}><h3>{m.importTimeData}</h3><p className="ql-help">{m.oneNamedColumnSecondsUseADecimalPointComma}</p><div className="ql-import-grid"><div><label className="ql-direct-label" htmlFor="ql-arrival-source">{m.arrivalSource}</label><select id="ql-arrival-source" value={actualArrivalTarget} onChange={e => setArrivalTarget(e.target.value)} disabled={busy || !sources.length}>{!sources.length && <option value="">{m.addASourceFirst}</option>}{sources.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><p className="ql-help"><code>arrival_seconds</code><br />{m.arrivalSampleScope(project.model.horizon)}</p><div className="ql-actions"><button ref={arrivalButton} type="button" className="ql-button" disabled={busy || !sources.length} onClick={() => arrivalInput.current?.click()}>{m.importArrivalsCsv}</button><button type="button" className="ql-text-button" onClick={() => downloadText('arrival_seconds\r\n0\r\n12.5\r\n30\r\n', 'arrival-template.csv', 'text/csv;charset=utf-8')}>{m.downloadTemplate}</button></div></div><div><label className="ql-direct-label" htmlFor="ql-service-target">{m.serviceStation}</label><select id="ql-service-target" value={actualServiceTarget} onChange={e => setServiceTarget(e.target.value)} disabled={busy || !services.length}>{!services.length && <option value="">{m.addAServiceFirst}</option>}{services.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><p className="ql-help"><code>service_seconds</code><br />{m.serviceSampleLimits}</p><div className="ql-actions"><button ref={serviceButton} type="button" className="ql-button" disabled={busy || !services.length} onClick={() => serviceInput.current?.click()}>{m.importServiceCsv}</button><button type="button" className="ql-text-button" onClick={() => downloadText('service_seconds\r\n15\r\n22.5\r\n30\r\n', 'service-template.csv', 'text/csv;charset=utf-8')}>{m.downloadTemplate}</button></div></div></div><input ref={arrivalInput} hidden type="file" accept=".csv,text/csv" aria-label={m.arrivalCsvFile} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void openSamples('arrival', file); }} /><input ref={serviceInput} hidden type="file" accept=".csv,text/csv" aria-label={m.serviceCsvFile} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void openSamples('service', file); }} />
      {preview && <div className="ql-import-preview"><h4>{m.replaceSamplesQuestion(preview.kind === 'arrival' ? m.arrivalPattern : m.serviceDistribution)}</h4><p>{m.samplePreview(preview.values.length.toLocaleString('en'), preview.filename, project.model.nodes.find(n => n.id === preview.targetId)?.label ?? m.missingStep, preview.values.reduce((min, value) => Math.min(min, value), Infinity), preview.values.reduce((max, value) => Math.max(max, value), -Infinity))}</p><p>{m.sampleReplacementNote(preview.kind === 'arrival' ? m.theSourceWillUseTheseExactTimestampsInsteadOf : m.serviceReplacementDescription)}</p><div className="ql-actions"><button className="ql-button ql-primary" disabled={busy} type="button" onClick={applySamples}>{m.applyRows(preview.values.length.toLocaleString('en'))}</button><button className="ql-button" type="button" onClick={() => setPreview(null)}>{m.cancel}</button></div></div>}
    </section>
    <section className="ql-data-section" aria-label={m.resultExports}><h3>{m.resultsReport}</h3>{result ? <><p className="ql-result-identity"><strong>{result.status === 'completed' ? m.completedRun : m.incompleteRun(result.status)}</strong>{m.seedAndEngine(result.seed, result.engineVersion)}<br />{m.runIdentity(result.id, result.modelHash)}<br />{m.observationScope(result.simulatedUntil, result.model.horizon, result.trace.complete, result.trace.until)}</p>{stale && <p className="ql-notice">{m.thisResultBelongsToAnEarlierModelSnapshotExports}</p>}<RunProvenanceDetails run={result} />{result.status !== 'completed' && <p className="ql-notice">{m.incompleteResultNote(result.reason ?? m.theRequestedHorizonWasNotFullyProcessed)}</p>}<div className="ql-actions"><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultCSV(result), safeFilename(`${result.model.name}-${result.status}-results`, 'csv'), 'text/csv;charset=utf-8'); notify(m.resultsDownloadRequestedVerifyThatTheBrowserSavedThe); })}>{m.downloadResultsCsv}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(async () => { await downloadResultPNG(result); notify(m.resultPngDownloadRequestedReviewTheImageAndVerify); })}>{m.downloadResultPng}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => printResult(result))}>{m.printSaveAsPdf}</button><button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultReportHTML(result), safeFilename(`${result.model.name}-${result.status}-report`, 'html'), 'text/html;charset=utf-8'); notify(m.reportDownloadRequestedVerifyThatTheBrowserSavedThe); })}>{m.downloadReportHtml}</button></div><p className="ql-help">{m.theResultImageIncludesTheRunNameMetricsAnd}</p><p className="ql-help">{m.summaryWaitAndJourneyTimesUseCompletedEntitiesFrom}</p></> : <p className="ql-help">{m.runAModelToExportItsObservedResultsNo}</p>}</section>
    {latestAttempt && latestAttempt.status !== 'completed' && <section className="ql-data-section" aria-label={m.latestIncompleteAttempt}>
      <h3>{m.latestIncompleteAttempt}</h3>
      <p className="ql-result-identity"><strong>{m.attemptHeading(latestAttempt.status)}</strong>{m.seedAndEngine(latestAttempt.seed, latestAttempt.engineVersion)}<br />{m.runIdentity(latestAttempt.id, latestAttempt.modelHash)}<br />{m.observationScope(latestAttempt.simulatedUntil, latestAttempt.model.horizon, latestAttempt.trace.complete, latestAttempt.trace.until)}</p>
      <RunProvenanceDetails run={latestAttempt} summary={m.incompleteRunSettingsIdentity} />
      <p className="ql-notice">{m.partialAttemptNote(latestAttempt.reason ?? m.theRequestedHorizonWasNotFullyProcessed, result ? m.yourLastCompletedResultIsPreservedInResultsReport : '')}</p>
      {attemptStale && <p className="ql-notice">{m.thisAttemptBelongsToAnEarlierModelSnapshotOr}</p>}
      <div className="ql-actions">
        <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(async () => { await downloadResultPNG(latestAttempt); notify(m.incompletePngDownloadRequestedReviewItsPartialRunLabel); })}>{m.downloadIncompletePng}</button>
        <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultCSV(latestAttempt), safeFilename(`${latestAttempt.model.name}-incomplete-${latestAttempt.status}-results`, 'csv'), 'text/csv;charset=utf-8'); notify(m.incompleteCsvRequested); })}>{m.downloadIncompleteCsv}</button>
        <button className="ql-button" disabled={busy} type="button" onClick={() => void perform(() => { downloadText(resultReportHTML(latestAttempt), safeFilename(`${latestAttempt.model.name}-incomplete-${latestAttempt.status}-report`, 'html'), 'text/html;charset=utf-8'); notify(m.incompleteReportRequested); })}>{m.downloadIncompleteReportHtml}</button>
      </div>
      <p className="ql-help">{m.onlyTheLatestIncompleteAttemptIsHeldInThis}</p>
    </section>}
    <div className="ql-operation-status" aria-live="polite" aria-atomic="true">{busy && <p>{m.workingWithLocalData}</p>}{status && <p role="status">{status}</p>}{error && <p role="alert" className="ql-error">{error}</p>}</div>
  </div>;
}
