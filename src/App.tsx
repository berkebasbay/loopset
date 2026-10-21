import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Check, ChevronRight, CircleHelp, Copy, Factory, FileUp, FlaskConical, Focus, GitCompareArrows, Globe2, History, Layers3, Leaf, Link2, List, LoaderCircle, Minus, MousePointer2, Move, Pause, Play, Plus, Redo2, ShieldCheck, SkipBack, Sparkles, Undo2, Users, X } from 'lucide-react';
import { createExample, WORLD_INFO } from './examples';
import { meanDuration, mutateProject, serviceNodes, setCapacity } from './model/commands';
import { modelHash } from './model/identity';
import { validateProject } from './model/validate';
import type { Point, Project, RunResult, ServiceNode, World } from './model/types';
import { frameAt, replayManifest } from './playback';
const WorldScene = lazy(() => import('./scene/WorldScene').then(module => ({ default: module.WorldScene })));
import { useSimulation } from './worker/useSimulation';
import { ModelEditor } from './features/ModelEditor';
import { ActionHistory } from './features/ActionHistory';
import { commitEdit, emptyHistory, redoEdit, undoEdit } from './features/editorHistory';
import { emptySelection, pruneSelection, reconcileSelection, selectStep, type EditorSelection, type SelectionIntent } from './features/editorSelection';
import { translateSelection } from './features/layoutCommands';
import { connectNext } from './features/modelEdits';
import { DataTools, recoveryProjectKey, serializeDraftRecovery, type RetainedDraft } from './features/DataTools';
import { CouplingDetails } from './features/CouplingDetails';
import { CalculationBudget } from './features/CalculationBudget';
import { replayTimeFromRange } from './features/replayRange';
import { calculationBudget } from './model/workBudget';
import { buildCouplingManifest } from './engine/provenance';
import { ExperimentsPanel } from './lab/ExperimentsPanel';
import { SavedScenarios } from './lab/SavedScenarios';
import { RunInsights } from './lab/RunInsights';
import { loadLastProject, saveProject } from './storage/projectStore';
import { openProjectJSON, serializeProject } from './storage/projectFile';
import { downloadText, readLocalText, safeFilename } from './storage/csv';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}
const clock = (s: number) => !Number.isFinite(s) ? '—' : `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const wait = (s: number) => !Number.isFinite(s) ? '—' : s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} sec`;
const money = (n: number, currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const number = (n: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n);
type Panel = 'worlds' | 'model' | 'compare' | 'data' | 'experiments' | 'insights' | 'budget' | 'history' | 'help' | null;

export default function App() {
  const [project, setProject] = useState<Project>(() => createExample('factory'));
  const [history, setHistory] = useState(emptyHistory); const historyRef = useRef(history); historyRef.current = history;
  const [selection, setSelection] = useState<EditorSelection>({ ids: ['station-c'], primary: 'station-c' });
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const selected = selection.primary, undoAction = history.past.at(-1), redoAction = history.future[0];
  const [result, setResult] = useState<RunResult | null>(null); const [baseline, setBaseline] = useState<RunResult | null>(null);
  // Keep at most one incomplete snapshot, separate from completed results and comparisons.
  const [latestAttempt, setLatestAttempt] = useState<RunResult | null>(null);
  const [time, setTime] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(60);
  const [panel, setPanelState] = useState<Panel>(null);
  const currentPanel = useRef<Panel>(null); const panelGeneration = useRef(0);
  const dialogOrigin = useRef<{ element: HTMLElement | null; panel: Exclude<Panel, null> } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [moving, setMoving] = useState(false); const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [toast, setToast] = useState<string | null>(null); const [backupRequestedRevision, setBackupRequestedRevision] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [localRevision, setLocalRevision] = useState<number | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [retainedDrafts, setRetainedDrafts] = useState<RetainedDraft[]>([]);
  const retained = useRef<RetainedDraft[]>([]); const recoverySequence = useRef(0);
  const acknowledgedContent = useRef(new Map<string, string>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(new Map<string, ReturnType<typeof saveProject>>());
  const storageGate = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!storageGate.current) {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    storageGate.current = { promise, resolve };
  }

  const sim = useSimulation(); const initialized = useRef(false); const requestGeneration = useRef(0); const manualClock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null); const live = useRef({ project, result, latestAttempt, time, playing, speed, selected, selectedIds: selection.ids, running: sim.running, canReplay: false, replayUntil: 0 });

  const issues = useMemo(() => validateProject(project), [project]);
  const hasErrors = issues.some(i => i.severity === 'error');
  const normalBudget = useMemo(() => hasErrors ? null : calculationBudget([{ label: 'Current draft', model: project.model, runs: 1 }]), [project.model, hasErrors]);
  const lastValidProject = useRef(project);
  if (!hasErrors) lastValidProject.current = project;
  const visualProject = lastValidProject.current;
  const currentHash = useMemo(() => modelHash(project.model), [project.model]);
  const stale = Boolean(result && (result.modelHash !== currentHash || result.seed !== project.model.seed));
  const attemptMatchesDraft = Boolean(latestAttempt && latestAttempt.modelHash === currentHash && latestAttempt.seed === project.model.seed && !hasErrors);
  const shownResult = stale || hasErrors ? null : result;
  const replay = useMemo(() => shownResult ? replayManifest(shownResult) : null, [shownResult]);
  // The current engine retains one continuous safe prefix or no interval.
  const canReplay = Boolean(replay?.coverage.length);
  const replayUntil = replay?.coverage.at(-1)?.end ?? 0;
  live.current = { project, result, latestAttempt, time, playing, speed, selected, selectedIds: selection.ids, running: sim.running, canReplay, replayUntil };
  const singleCoupling = useMemo(() => baseline && shownResult && baseline.provenance && shownResult.provenance ? buildCouplingManifest(baseline, shownResult) : null, [baseline, shownResult]);
  const singlePaired = Boolean(baseline && shownResult && singleCoupling?.compatibility.sameExternalDemand && singleCoupling.compatibility.sameMeasurementPolicies && baseline.demandHash === shownResult.demandHash);
  const frame = useMemo(() => frameAt(visualProject, shownResult, time), [visualProject, shownResult, time]);
  const station = project.model.nodes.find((n): n is ServiceNode => n.id === selected && n.kind === 'service');
  const selectedStep = project.model.nodes.find(n => n.id === selected);
  const stations = serviceNodes(project); const worldInfo = WORLD_INFO[project.world];
  const stationMetrics = shownResult?.stations.find(n => n.nodeId === selected);
  const source = project.model.nodes.find(n => n.kind === 'source');

  function updateSelection(next: EditorSelection) {
    selectionRef.current = next; setSelection(next);
    live.current = { ...live.current, selected: next.primary, selectedIds: next.ids };
  }
  function setSelected(id: string | null, intent: SelectionIntent = 'single') {
    updateSelection(pruneSelection(selectStep(selectionRef.current, id, intent), live.current.project.model.nodes));
  }

  function setPanel(next: Panel, opener?: HTMLElement | null) {
    if (next === currentPanel.current) return;
    // Pointer activation need not focus a button in WebKit. Retain the explicit
    // outside opener once; changing panels inside the dialog keeps that origin.
    if (next && !currentPanel.current) {
      const active = document.activeElement;
      dialogOrigin.current = { element: opener ?? (active instanceof HTMLElement && active !== document.body && !active.closest('[role=dialog]') ? active : null), panel: next };
    }
    currentPanel.current = next; ++panelGeneration.current; setPanelState(next);
  }

  async function compute(p: Project, establishBaseline = false) {
    const generation = ++requestGeneration.current; setPlaying(false); setLatestAttempt(null);
    if (!establishBaseline) setToast(null);
    try {
      const r = await sim.run(p.model);
      if (generation !== requestGeneration.current) return;
      if (r.status !== 'completed') { setLatestAttempt(r); setToast(r.reason ?? `Run ${r.status}. No completed comparison was produced.`); return; }
      setLatestAttempt(null);
      setResult(r); if (establishBaseline || !baseline) setBaseline(r);
      const coverage = replayManifest(r).coverage;
      setTime(establishBaseline ? Math.min(p.model.horizon * .38, coverage.at(-1)?.end ?? 0) : 0);
      setPlaying(establishBaseline && coverage.length > 0); manualClock.current = false;
    } catch (e) { if (generation === requestGeneration.current) setToast(e instanceof Error ? e.message : 'The run could not finish.'); }
  }
  useEffect(() => {
    if (initialized.current) return; initialized.current = true;
    let alive = true;
    const timer = setTimeout(() => {
      void loadLastProject().then(saved => {
        if (!alive) return;
        // A slow IndexedDB load must never replace a newer user action.
        const untouched = live.current.project.id === project.id && live.current.project.revision === project.revision;
        const initial = untouched ? saved ?? project : live.current.project;
        if (saved) acknowledgedContent.current.set(saved.id, recoveryProjectKey(saved));
        if (saved && untouched) { setProject(saved); live.current = { ...live.current, project: saved }; setLocalRevision(saved.revision); setSelected(serviceNodes(saved)[0]?.id ?? null); }
        storageGate.current!.resolve(); setStorageReady(true);
        if (!validateProject(initial).some(issue => issue.severity === 'error')) void compute(initial, true);
      }).catch(error => {
        if (!alive) return;
        setStorageError(error instanceof Error ? error.message : 'Browser storage is unavailable. Keep a downloaded backup.');
        storageGate.current!.resolve(); setStorageReady(true);
        if (!validateProject(live.current.project).some(issue => issue.severity === 'error')) void compute(live.current.project, true);
      });
    }, 50);
    return () => { alive = false; clearTimeout(timer); initialized.current = false; };
  }, []);
  useEffect(() => {
    if (!storageReady || issues.some(i => i.severity === 'error')) return;
    const snapshot = project;
    const timer = setTimeout(() => { void persistProject(snapshot).catch(() => { /* Retained and surfaced by persistProject. */ }); }, 800);
    return () => clearTimeout(timer);
  }, [project, storageReady]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = live.current.project;
      if (!retained.current.length && acknowledgedContent.current.get(current.id) === recoveryProjectKey(current)) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let handle = 0; let previous = performance.now();
    const tick = (now: number) => {
      handle = 0;
      if (document.hidden || manualClock.current) return;
      const elapsed = Math.min((now - previous) / 1000, .1); previous = now;
      const state = live.current;
      if (state.playing && state.result && state.canReplay && !manualClock.current) {
        const end = state.replayUntil;
        setTime(t => { const next = Math.min(end, t + elapsed * state.speed); if (next >= end) setPlaying(false); return next; });
      }
      if (live.current.playing) handle = requestAnimationFrame(tick);
    };
    const visible = () => { cancelAnimationFrame(handle); handle = 0; previous = performance.now(); if (!document.hidden && !manualClock.current) handle = requestAnimationFrame(tick); };
    document.addEventListener('visibilitychange', visible); visible();
    return () => { cancelAnimationFrame(handle); document.removeEventListener('visibilitychange', visible); };
  }, [playing]);
  useEffect(() => {
    window.render_game_to_text = () => {
      const s = live.current; const valid = s.result?.modelHash === modelHash(s.project.model) && s.result.seed === s.project.model.seed && !validateProject(s.project).some(i => i.severity === 'error') ? s.result : null;
      return JSON.stringify({ mode: panel ?? 'playground', revision: s.project.revision, world: s.project.world, selected: s.selected, selectedIds: s.selectedIds, running: s.running, playing: s.playing, time: s.time, speed: s.speed,
        coordinates: 'Illustrative world coordinates: x horizontal, z depth; layout does not model travel time.',
        frame: frameAt(s.project, valid, s.time), model: s.project.model.nodes.filter(n => n.kind === 'service').map(n => ({ id: n.id, label: n.label, servers: n.servers })),
        result: s.result ? { status: s.result.status, hash: s.result.modelHash, stale: !valid, summary: s.result.summary } : null,
        latestAttempt: s.latestAttempt ? { id: s.latestAttempt.id, status: s.latestAttempt.status, reason: s.latestAttempt.reason, hash: s.latestAttempt.modelHash, seed: s.latestAttempt.seed, simulatedUntil: s.latestAttempt.simulatedUntil, horizon: s.latestAttempt.model.horizon, stale: s.latestAttempt.modelHash !== modelHash(s.project.model) || s.latestAttempt.seed !== s.project.model.seed || validateProject(s.project).some(i => i.severity === 'error'), summary: s.latestAttempt.summary } : null });
    };
    window.advanceTime = ms => {
      manualClock.current = true; const s = live.current;
      if (s.playing && s.result && s.canReplay) setTime(t => Math.min(s.replayUntil, t + ms / 1000 * s.speed));
    };
    return () => { delete window.render_game_to_text; delete window.advanceTime; };
  }, [panel]);
  useEffect(() => {
    let alive = true; let handle = 0;
    const generation = panelGeneration.current;
    const current = () => alive && generation === panelGeneration.current && currentPanel.current === panel;
    if (panel) { setPlaying(false); setLinkFrom(null); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:cancel-move')); }
    if (panel) {
      const focusDialog = () => {
        if (!current()) return;
        handle = requestAnimationFrame(() => {
          if (!current()) return;
          const dialog = document.querySelector<HTMLElement>('[role=dialog]');
          const active = document.activeElement;
          // Preserve a focus choice already made inside the newly opened dialog.
          if (active instanceof HTMLElement && active !== dialog && dialog?.contains(active) && !active.matches(':disabled') && !active.closest('[hidden],[inert]') && active.checkVisibility({ visibilityProperty: true })) return;
          dialog?.querySelector<HTMLElement>('button')?.focus();
        });
      };
      if (document.fullscreenElement) void document.exitFullscreen().then(focusDialog, focusDialog); else focusDialog();
    } else {
      const origin = dialogOrigin.current; dialogOrigin.current = null;
      if (origin) handle = requestAnimationFrame(() => {
        if (!current()) return;
        const canFocus = (element: HTMLElement | null): element is HTMLElement => Boolean(element?.isConnected && element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert],[role=dialog]') && element.checkVisibility({ visibilityProperty: true }));
        // A user may already have chosen another control before this frame.
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && active.isConnected && !active.matches(':disabled') && !active.closest('[hidden],[inert],[role=dialog]') && active.checkVisibility({ visibilityProperty: true })) return;
        const fallback = document.querySelector<HTMLElement>(`[data-panel-opener="${origin.panel}"]`);
        const canvas = document.querySelector<HTMLElement>('[data-testid="world-canvas"]');
        const target = [origin.element, fallback, canvas].find(canFocus);
        target?.focus({ preventScroll: true });
      });
    }
    return () => { alive = false; cancelAnimationFrame(handle); };
  }, [panel]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editable = Boolean(target?.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !editable && !panel && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault(); if (event.key.toLowerCase() === 'y' || event.shiftKey) redo(); else undo(); return;
      }
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && linkFrom && !panel) { event.preventDefault(); setLinkFrom(null); return; }
      if (event.key === 'Escape' && panel) { event.preventDefault(); setPanel(null); return; }
      if (event.key === 'Escape' && !editable && !panel && target?.closest('.world-workspace')) {
        if (moving) { event.preventDefault(); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:cancel-move')); setMoving(false); return; }
        if (selectionRef.current.ids.length) { event.preventDefault(); setSelected(null); return; }
      }
      if (event.key === 'Tab' && panel && !event.ctrlKey && !event.metaKey) {
        const dialog = document.querySelector<HTMLElement>('[role=dialog]');
        if (!dialog) return;
        const elements = [...dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex],[contenteditable="true"]')].filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert]') && element.checkVisibility({ visibilityProperty: true }));
        // macOS can omit buttons from native Tab order. Own the entire dialog sequence
        // so plain Tab reaches every control and cannot escape into the inert workspace.
        event.preventDefault();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        const next = index < 0 ? event.shiftKey ? elements.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
        if (elements.length) elements[next].focus();
        return;
      }
      if (panel || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(event.target instanceof Element) || !event.target.closest('.world-workspace') || (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName))) return;
      if (event.code === 'Space' && live.current.canReplay && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); manualClock.current = false; setPlaying(p => !p); }
      if (event.key.toLowerCase() === 'g') { event.preventDefault(); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:focus')); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (document.fullscreenElement) void document.exitFullscreen(); else void document.querySelector<HTMLElement>('.world-workspace')?.requestFullscreen?.().catch(() => setToast('Full screen is unavailable in this browser.')); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); };
  }, [panel, linkFrom, moving]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);

  function updateRetained(next: RetainedDraft[]) { retained.current = next; setRetainedDrafts(next); }
  function retainDraft(snapshot: Project, state: RetainedDraft['state'], message: string): RetainedDraft | null {
    const key = recoveryProjectKey(snapshot);
    const existing = retained.current.find(draft => draft.key === key);
    if (existing) {
      const updated = { ...existing, state, message };
      updateRetained(retained.current.map(draft => draft.token === existing.token ? updated : draft)); return updated;
    }
    let bytes: number;
    try { bytes = new TextEncoder().encode(serializeDraftRecovery(snapshot)).length; }
    catch (error) { setStorageError(error instanceof Error ? error.message : 'Keep this draft open until you can make a backup.'); return null; }
    if (retained.current.length >= 12 || retained.current.reduce((total, draft) => total + draft.bytes, 0) + bytes > 20_000_000) {
      setStorageError('The retained-draft limit (12 copies / 20 MB) is full. Save, back up and explicitly remove an older retained copy before replacing this draft.'); return null;
    }
    const draft: RetainedDraft = { token: `draft-${++recoverySequence.current}`, key, project: structuredClone(snapshot), bytes, state, message };
    updateRetained([...retained.current, draft]); return draft;
  }
  /** All project writes, including the manual DataTools button, share a FIFO after startup restore. */
  function persistProject(snapshot: Project): ReturnType<typeof saveProject> {
    snapshot = structuredClone(snapshot);
    const key = recoveryProjectKey(snapshot);
    const pending = pendingSaves.current.get(key); if (pending) return pending;
    try { serializeProject(snapshot); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Repair this draft before saving.';
      retainDraft(snapshot, 'invalid', message); setStorageError(message); return Promise.reject(error);
    }
    const task = saveQueue.current.then(async () => {
      await storageGate.current!.promise;
      updateRetained(retained.current.map(draft => draft.key === key ? { ...draft, state: 'saving', message: 'Waiting for the IndexedDB transaction acknowledgment.' } : draft));
      try {
        const ack = await saveProject(snapshot);
        acknowledgedContent.current.set(snapshot.id, key);
        // This is only an acknowledgment cache; dropping old cache entries only causes a safe repeat save.
        if (acknowledgedContent.current.size > 64) acknowledgedContent.current.delete(acknowledgedContent.current.keys().next().value!);
        updateRetained(retained.current.filter(draft => draft.key !== key));
        if (live.current.project.id === ack.projectId && recoveryProjectKey(live.current.project) === key) { setLocalRevision(ack.revision); setStorageError(null); }
        return ack;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Local save failed. Keep this tab open and verify a downloaded backup.';
        retainDraft(snapshot, 'failed', message);
        if (live.current.project.id === snapshot.id && recoveryProjectKey(live.current.project) === key) setStorageError(message);
        throw error;
      }
    });
    pendingSaves.current.set(key, task);
    saveQueue.current = task.then(() => undefined, () => undefined);
    void task.finally(() => { if (pendingSaves.current.get(key) === task) pendingSaves.current.delete(key); }).catch(() => {});
    return task;
  }
  function preserveOutgoing(snapshot: Project): boolean {
    if (acknowledgedContent.current.get(snapshot.id) === recoveryProjectKey(snapshot)) return true;
    let invalid = false; let message = 'Saving the outgoing project before replacement.';
    try { serializeProject(snapshot); }
    catch (error) { invalid = true; message = error instanceof Error ? error.message : 'Repair this draft before saving.'; }
    const draft = retainDraft(snapshot, invalid ? 'invalid' : 'waiting', message);
    if (!draft) { setPanel('data'); setToast('This draft is still open. Review retained copies or reduce data before switching projects.'); return false; }
    if (!invalid) void persistProject(snapshot).catch(() => {});
    return true;
  }
  function edit(next: Project, label?: string) {
    const previous = live.current.project;
    const committed = commitEdit(historyRef.current, previous, next, label);
    if (!committed.entry) return;
    setLinkFrom(null); next = committed.project;
    historyRef.current = committed.history; setHistory(committed.history);
    updateSelection(reconcileSelection(selectionRef.current, previous.model.nodes, next.model.nodes));
    setProject(next); live.current = { ...live.current, project: next }; setPlaying(false);
  }
  function restoreHistory(direction: 'undo' | 'redo') {
    const before = live.current.project;
    const restored = (direction === 'undo' ? undoEdit : redoEdit)(historyRef.current, before); if (!restored.entry) return;
    setLinkFrom(null); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:cancel-move'));
    historyRef.current = restored.history; setHistory(restored.history);
    updateSelection(reconcileSelection(selectionRef.current, before.model.nodes, restored.project.model.nodes));
    setProject(restored.project); live.current = { ...live.current, project: restored.project }; setPlaying(false);
  }
  function undo() { restoreHistory('undo'); }
  function redo() { restoreHistory('redo'); }
  function moveSelected(ids: string[], delta: Point) {
    try { const previous = live.current.project; edit(translateSelection(previous, ids, delta)); }
    catch (error) { setToast(error instanceof Error ? error.message : 'These visual positions could not be moved.'); }
  }
  function selectFromWorld(id: string | null, intent: SelectionIntent = 'single') {
    if (linkFrom) {
      if (!id) return;
      try {
        edit(connectNext(live.current.project, linkFrom, id), `Connect ${project.model.nodes.find(node => node.id === linkFrom)?.label ?? 'step'} to ${project.model.nodes.find(node => node.id === id)?.label ?? 'step'}`);
        setToast('Connection updated. Run the changed plan to calculate its results.'); setLinkFrom(null);
      } catch (error) { setToast(error instanceof Error ? error.message : 'Choose a valid next step.'); }
      return;
    }
    if (id && !live.current.project.model.nodes.some(node => node.id === id)) return;
    setSelected(id, intent);
    if (id && intent === 'single' && !moving && project.model.nodes.find(node => node.id === id)?.kind !== 'service') setPanel('model', document.querySelector<HTMLElement>(`[data-station-id="${CSS.escape(id)}"]`) ?? document.querySelector<HTMLElement>('[data-testid="world-canvas"]'));
  }
  function acceptProject(next: Project, label = 'Open project file'): Project | null {
    const previous = live.current.project;
    setLinkFrom(null);
    if (next.id === previous.id) { ++requestGeneration.current; sim.cancel(); setLatestAttempt(null); edit(next, label); return live.current.project; }
    if (!preserveOutgoing(previous)) return null;
    ++requestGeneration.current; sim.cancel(); setLatestAttempt(null);
    setProject(next); live.current = { ...live.current, project: next }; const cleared = emptyHistory(); historyRef.current = cleared; setHistory(cleared); updateSelection(emptySelection()); setResult(null); setBaseline(null); setSelected(serviceNodes(next)[0]?.id ?? null); setBackupRequestedRevision(null); setLocalRevision(null); setStorageError(null);
    if (!validateProject(next).some(issue => issue.severity === 'error')) void compute(next, true);
    return next;
  }
  function chooseWorld(world: World) {
    const next = acceptProject(createExample(world));
    if (next) { setSelected('station-c'); setPanel(null); }
  }
  function downloadProject() {
    const snapshot = live.current.project;
    try {
      let text: string; let repair = false;
      try { text = serializeProject({ ...snapshot, savedAt: new Date().toISOString() }); }
      catch { repair = true; text = serializeDraftRecovery(snapshot); }
      downloadText(text, safeFilename(`${snapshot.world}-queuelab${repair ? '-unvalidated-repair' : ''}`, 'json'), 'application/json;charset=utf-8');
      setBackupRequestedRevision(snapshot.revision); setToast(`${repair ? 'Unvalidated repair backup' : 'Project file'} download requested. Verify the saved file; a request does not confirm a backup.`);
    } catch (e) { setToast(e instanceof Error ? e.message : 'Could not prepare a backup. Keep this draft open.'); }
  }
  async function importProject(file: File | undefined) {
    setLinkFrom(null);
    if (!file) return;
    try {
      const next = openProjectJSON(await readLocalText(file));
      const sameDocument = next.id === live.current.project.id;
      const accepted = acceptProject(next);
      if (!accepted) return;
      if (sameDocument) void compute(accepted, true);
      setBackupRequestedRevision(null);
    } catch (e) { setToast(e instanceof Error ? e.message : 'Could not open this project.'); }
  }
  function restoreDraft(token: string) {
    const draft = retained.current.find(item => item.token === token); if (!draft) return;
    const restored = acceptProject(structuredClone(draft.project), 'Restore retained draft for repair');
    if (restored) { setPanel('model'); setToast('Retained draft restored for repair. Its retained copy stays available until saved or explicitly removed.'); }
  }
  function updateDuration(seconds: number) {
    if (!station) return;
    edit(mutateProject(project, p => { const n = p.model.nodes.find(n => n.id === station.id); if (n?.kind === 'service') n.duration = { kind: 'constant', value: seconds }; }), `Change ${station.label} processing time`);
  }

  return <div className="app-shell">
    <aside className="sidebar" inert={Boolean(panel)}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPanel(null); }} aria-label="QueueLab playground"><span className="brand-mark"><Box size={24} strokeWidth={1.9} /></span>QueueLab<span className="brand-dot">.</span></a>
      <div className="sidebar-section-label">YOUR LITTLE LAB</div>
      <nav aria-label="Main navigation">
        <button className={!panel ? 'nav-item active' : 'nav-item'} onClick={() => setPanel(null)}><Layers3 size={18} />Playground<span className="nav-shortcut">01</span></button>
        <button data-panel-opener="worlds" className={panel === 'worlds' ? 'nav-item active' : 'nav-item'} onClick={event => setPanel('worlds', event.currentTarget)}><Globe2 size={18} />Explore worlds</button>
        <button data-panel-opener="model" className={panel === 'model' ? 'nav-item active' : 'nav-item'} onClick={event => setPanel('model', event.currentTarget)}><List size={18} />Model editor</button>
        <button data-panel-opener="compare" className={panel === 'compare' ? 'nav-item active' : 'nav-item'} onClick={event => setPanel('compare', event.currentTarget)}><GitCompareArrows size={18} />Compare plans</button>
        <button data-panel-opener="insights" className={panel === 'insights' ? 'nav-item active' : 'nav-item'} onClick={event => setPanel('insights', event.currentTarget)}><Activity size={18} />Run insights</button>
        <button data-panel-opener="experiments" className={panel === 'experiments' ? 'nav-item active' : 'nav-item'} onClick={event => setPanel('experiments', event.currentTarget)}><FlaskConical size={18} />Experiments</button>
        <button data-panel-opener="data" className={panel === 'data' ? 'nav-item active' : 'nav-item'} onClick={event => setPanel('data', event.currentTarget)}><ArrowDownToLine size={18} />Data & reports</button>
      </nav>
      <div className="sidebar-rule" /><div className="sidebar-section-label">IN THIS WORLD</div>
      <div className="process-list">{stations.map((n, i) => <button key={n.id} className={`process-item ${selection.ids.includes(n.id) ? 'selected' : ''}`} aria-pressed={selection.ids.includes(n.id)} onClick={event => { selectFromWorld(n.id, event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'single'); setPanel(null); }}><span className="process-index">{String(i + 1).padStart(2, '0')}</span><span>{n.label}</span><span className="process-dot" /></button>)}</div>
      <button className="side-add" onClick={event => setPanel('model', event.currentTarget)}><Plus size={15} />Edit process</button>
      <div className="sidebar-bottom"><div className="local-note"><span className="status-dot" />Your world stays on your device<ShieldCheck size={15} /></div><button className="nav-item" data-panel-opener="help" onClick={event => setPanel('help', event.currentTarget)}><CircleHelp size={18} />A little guidance<ArrowUpRight size={15} /></button><div className="sidebar-foot">FREE & OPEN SOURCE <span>EARLY BUILD</span></div></div>
    </aside>
    <main className="main-shell" inert={Boolean(panel)}>
      <header className="topbar"><div className="breadcrumb">Playground<ChevronRight size={14} /><span>{project.name}</span><span className="synthetic-label">SYNTHETIC EXAMPLE</span></div><div className="top-actions"><button className="icon-button" title="Open project" aria-label="Open project" onClick={() => fileInput.current?.click()}><FileUp size={17} /></button><button className="text-button save-button" onClick={downloadProject}><ArrowDownToLine size={16} />Save project</button><span className="version-tag">LAB / 001</span></div></header>
      <div className="workspace-heading"><div><div className="eyebrow"><span />A PLAYGROUND FOR BETTER DECISIONS</div><h1>{project.name}<span className="title-period">.</span></h1><p>{worldInfo.subtitle}. What would you change?</p><button className="budget-opener" onClick={event => setPanel("budget", event.currentTarget)}>Calculation work & limits<ChevronRight size={12} /></button></div><div className="heading-actions"><button className="secondary-button" onClick={event => setPanel('compare', event.currentTarget)}><GitCompareArrows size={16} />Compare plans</button><button className="primary-button" disabled={sim.running || issues.some(i => i.severity === 'error')} onClick={() => void compute(project)}>{sim.running ? <LoaderCircle size={17} className="spin" /> : <Play size={16} fill="currentColor" />}{sim.running ? `${Math.round(sim.progress * 100)}% calculating` : 'Run simulation'}</button></div></div>
      <div className="workspace-body">
        <section className="world-workspace" aria-label="Simulation workspace">
          <div className="world-toolbar"><div className="world-tabs">{(['factory', 'festival', 'service'] as const).map(w => <button key={w} className={project.world === w ? 'selected' : ''} onClick={() => chooseWorld(w)}>{w === 'factory' ? <Factory size={14} /> : w === 'festival' ? <Users size={14} /> : <Leaf size={14} />}{w === 'factory' ? 'Factory' : w === 'festival' ? 'Festival' : 'Service'}</button>)}</div><div className="world-tools"><button className="icon-button" disabled={!undoAction} title={undoAction ? `Undo: ${undoAction.label}` : 'Undo'} aria-label={undoAction ? `Undo ${undoAction.label}` : 'Undo'} onClick={undo}><Undo2 size={16} /></button><button className="icon-button" disabled={!redoAction} title={redoAction ? `Redo: ${redoAction.label}` : 'Redo'} aria-label={redoAction ? `Redo ${redoAction.label}` : 'Redo'} onClick={redo}><Redo2 size={16} /></button><button className="icon-button history-opener" data-panel-opener="history" aria-label="Action history" title="Action history" onClick={event => setPanel('history', event.currentTarget)}><History size={16} /></button><span className="history-action-name" aria-hidden="true">{undoAction?.label ?? 'No edits yet'}</span><span className="tool-divider" /><button className={`icon-button ${linkFrom ? 'selected' : ''}`} aria-label="Connect selected step" aria-pressed={Boolean(linkFrom)} disabled={!project.model.nodes.some(n => n.id === selected && 'next' in n)} onClick={() => { setMoving(false); setLinkFrom(linkFrom ? null : selected); }}><Link2 size={16} /></button><button className={`icon-button ${moving ? 'selected' : ''}`} aria-label="Move stations" title="Move selected steps together; Shift-click to select several" aria-pressed={moving} disabled={hasErrors} onClick={() => { setLinkFrom(null); setMoving(!moving); }}><Move size={16} /></button><button className="icon-button" aria-label="Focus selected station" disabled={!selected} onClick={() => document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:focus'))}><MousePointer2 size={16} /></button><button className="icon-button" aria-label="Fit world" onClick={() => document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:fit'))}><Focus size={16} /></button></div></div>
          {selection.ids.length > 1 && <div className="selection-summary" aria-label="World selection"><span>{selection.ids.length} selected · Inspecting {selectedStep?.label ?? 'step'}</span><button onClick={event => setPanel('model', event.currentTarget)}>Move or edit selection</button><button onClick={() => setSelected(null)}>Clear selection</button></div>}<div className="scene-area"><div className="scene-topline"><span className="live-label"><span className={sim.running ? 'status-dot orange' : 'status-dot'} />{sim.running ? 'CALCULATING' : stale ? 'DRAFT · RUN TO PREVIEW' : shownResult ? shownResult.trace.complete ? 'REPLAY' : 'LIMITED REPLAY' : 'YOUR MODEL'}</span><span className="scene-unit">{worldInfo.unit.toUpperCase()} / {Number.isFinite(project.model.horizon) ? `${Math.round(project.model.horizon / 60)} MIN` : 'CHECK MODEL'}</span></div>
            <Suspense fallback={<div className="scene-fallback" role="status"><p>Building your little world…</p></div>}><WorldScene project={visualProject} quality={quality} frame={frame} selected={selected} selectedIds={selection.ids} reducedMotion={reducedMotion} moving={moving && !hasErrors} onSelect={selectFromWorld} onMove={moveSelected} /></Suspense>
            {(stale || hasErrors || latestAttempt) && <div className="draft-banner"><Sparkles size={16} /><span>{hasErrors ? 'Your draft has issues to repair before running.' : latestAttempt ? attemptMatchesDraft ? `Latest run ${latestAttempt.status}. Only partial results are available.` : 'An incomplete attempt belongs to an earlier draft.' : 'Your plan has changed. Run it to see what happens.'}</span><button onClick={event => hasErrors ? setPanel('model', event.currentTarget) : latestAttempt ? setPanel('data', event.currentTarget) : void compute(project)}>{hasErrors ? 'Review model' : latestAttempt ? 'Review incomplete run' : 'Run this plan'}<ArrowRight size={14} /></button></div>}
            <div className={`scene-caption ${linkFrom || (shownResult && !shownResult.trace.complete) || frame.aggregated || (visualProject.model.nodes.length > 30 && selectedStep) || moving ? 'has-status' : ''}`}><MousePointer2 size={13} />{linkFrom ? `Connect ${project.model.nodes.find(n => n.id === linkFrom)?.label ?? 'step'}: choose its next step. Escape cancels.` : shownResult && !shownResult.trace.complete ? canReplay ? `Replay coverage: 00:00–${clock(replayUntil)}. Full-run statistics are shown below.` : 'No detailed replay was retained. Full-run numerical results are available.' : frame.aggregated ? `Showing ${frame.actors.length} representative ${worldInfo.unit} of ${frame.inSystem}. Queue counts remain exact.` : visualProject.model.nodes.length > 30 && selectedStep ? 'Selected step connections are highlighted.' : moving ? 'Drag a selected step to move the group · Shift-click toggles selection · Escape cancels' : <>Click to inspect · Shift-click selects several<span />Drag to pan · scroll to zoom</>}</div>
            <div className="world-compass"><span>N</span><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4L24 25L16 20L8 25Z" fill="#9aaa94"/><path d="M16 4V20L8 25Z" fill="#496354"/></svg></div>
          </div>
          {selectedStep && <div className="mobile-selection"><span>{selection.ids.length > 1 ? `${selection.ids.length} selected · ` : ''}{selectedStep.label}</span><div className="mobile-selection-actions"><button type="button" onClick={event => setPanel('model', event.currentTarget)}>Edit selected step<ArrowUpRight size={14} /></button><button type="button" aria-label="Clear selection" onClick={() => setSelected(null)}><X size={14} /></button></div></div>}
          <div className="playback-bar"><button className="icon-button" aria-label="Restart replay" onClick={() => setTime(0)} disabled={!canReplay}><SkipBack size={16} /></button><button className="play-toggle" aria-label={playing ? 'Pause replay' : 'Play replay'} disabled={!canReplay} onClick={() => { manualClock.current = false; if (time >= replayUntil) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="playback-time">{clock(shownResult ? frame.time : 0)}</span><input aria-label="Replay time" type="range" min="0" max={shownResult ? replayUntil : Number.isFinite(project.model.horizon) ? project.model.horizon : 1} step="any" value={shownResult ? frame.time : 0} disabled={!canReplay} onChange={e => { setPlaying(false); setTime(replayTimeFromRange(e.currentTarget, replayUntil)); }} /><span className="playback-end">{clock(shownResult ? replayUntil : project.model.horizon)}</span><select aria-label="Replay speed" value={speed} onChange={e => setSpeed(+e.target.value)}><option value="15">15×</option><option value="30">30×</option><option value="60">60×</option><option value="120">120×</option></select></div>
          <div className="metrics-strip"><div><span className="metric-label"><span className="tiny-square green" />{project.world === 'factory' ? 'Ready to ship' : 'Completed'}</span><strong>{canReplay ? number(frame.completed) : '—'}<small>{worldInfo.unit}</small></strong><span className="metric-foot">{canReplay ? `At ${clock(frame.time)} in the replay` : 'No replay observation'}</span></div><div><span className="metric-label"><span className="tiny-square amber" />In progress</span><strong>{canReplay ? number(frame.inSystem) : '—'}<small>{worldInfo.unit}</small></strong><span className="metric-foot">{canReplay ? 'Waiting + being processed' : 'No replay observation'}</span></div><div><span className="metric-label"><span className="tiny-square orange" />Average wait</span><strong>{shownResult?.summary.waitSampleSize ? wait(shownResult.summary.meanWait) : '—'}</strong><span className="metric-foot">Completed jobs · full run</span></div><div><span className="metric-label"><span className="tiny-square grey" />Resource cost</span><strong>{shownResult ? money(shownResult.summary.cost, shownResult.model.currency) : '—'}</strong><span className="metric-foot">Full run · {project.model.currency}</span></div></div>
        </section>
        <aside className="inspector" aria-label="Station inspector"><div className="inspector-eyebrow">INSPECTED STEP<button className="clear-selection" aria-label="Clear selection" disabled={!selected} onClick={() => setSelected(null)}><X size={14} /></button></div>{station ? <><div className="station-title"><span className="large-station-number">{String(stations.findIndex(n => n.id === station.id) + 1).padStart(2, '0')}</span><div><h2>{station.label}</h2><span>{project.world === 'factory' ? 'Processing station' : 'Service station'}</span></div></div><div className="inspector-divider" /><div className="field-heading"><label htmlFor="capacity">Parallel stations</label><span className="field-help" title="A dedicated resource pool is scaled with this quick control. Shared pools are managed in the model editor.">?</span></div><div className="stepper"><button aria-label="Remove one station" disabled={station.servers <= 1} onClick={() => edit(setCapacity(project, station.id, station.servers - 1))}><Minus size={15} /></button><output id="capacity">{Number.isFinite(station.servers) ? station.servers : '—'}</output><button aria-label="Add one station" disabled={station.servers >= 12} onClick={() => edit(setCapacity(project, station.id, station.servers + 1))}><Plus size={15} /></button></div><p className="field-description">{station.resources.some(req => project.model.nodes.filter(n => n.kind === 'service' && n.resources.some(r => r.poolId === req.poolId)).length > 1) ? 'This station shares a resource pool. Adjust the shared team in Model editor to change that limit.' : 'More capacity here may move the bottleneck elsewhere.'}</p><label className="input-label" htmlFor="process-time">{station.duration.kind === 'constant' ? 'Processing time' : 'Mean processing time'}</label><div className="input-with-unit"><input id="process-time" type="number" min="0" step="any" max="604800" value={Number.isFinite(meanDuration(station.duration)) ? station.duration.kind === 'constant' ? station.duration.value : Number(meanDuration(station.duration).toPrecision(5)) : ''} onChange={e => { if (e.target.value && +e.target.value > 0) updateDuration(+e.target.value); }} /><span>sec / {project.world === 'factory' ? 'item' : 'request'}</span></div><div className="distribution-note">{station.duration.kind === 'triangular' ? 'Variable · triangular distribution' : station.duration.kind === 'constant' ? 'Fixed processing time' : `${station.duration.kind} distribution`}</div><button className="subtle-link" onClick={event => setPanel('model', event.currentTarget)}>Advanced settings<ArrowUpRight size={13} /></button><div className="inspector-divider" /><div className="inspector-section-title">THIS RUN<span>{stale ? 'OUT OF DATE' : 'FULL RUN'}</span></div><dl className="station-stats"><div><dt>Finished here</dt><dd>{stationMetrics ? number(stationMetrics.finished) : '—'}</dd></div><div><dt>Avg. waiting time</dt><dd>{stationMetrics?.finished ? wait(stationMetrics.averageWait) : '—'}</dd></div><div><dt>Utilization</dt><dd>{stationMetrics?.utilization != null ? `${Math.round(stationMetrics.utilization * 100)}%` : '—'}</dd></div></dl><div className="inspector-tip"><FlaskConical size={19} /><p><b>A little experiment</b>Try one more station. Compare the same arrivals, then check both waiting time and cost.</p></div><button className="inspector-compare" onClick={event => setPanel('compare', event.currentTarget)}>Compare with baseline<ArrowRight size={15} /></button></> : <p>{selectedStep ? `Inspecting ${selectedStep.label}. Open Model editor for this ${selectedStep.kind}.` : 'Select a station in the world or the list.'}</p>}<div className="inspector-bottom"><ShieldCheck size={13} />Layout is illustrative. Timing comes from your model.</div></aside>
      </div>
      <footer className="workspace-footer"><span><span className="status-dot" />{storageError ? 'Local save failed · download a backup' : !storageReady ? 'Opening local project…' : issues.some(i => i.severity === 'error') ? 'Draft has issues · repair before saving' : localRevision === project.revision ? 'Saved in this browser' : 'Saving locally…'}{backupRequestedRevision === project.revision ? ' · backup requested, verify file' : ''}{retainedDrafts.length > 0 && <button onClick={event => setPanel('data', event.currentTarget)}>{retainedDrafts.length} retained draft{retainedDrafts.length === 1 ? '' : 's'} · review recovery</button>}</span><span>Seed {Number.isFinite(project.model.seed) ? project.model.seed : 'CHECK'}<span className="footer-separator" />{source?.kind === 'source' ? 'Variable demand' : 'Custom model'}<span className="footer-separator" /><button onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? 'Reduced motion on' : 'Motion on'}</button></span></footer>
    </main>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { void importProject(e.target.files?.[0]); e.target.value = ''; }} />
    {storageError && <button className="storage-warning" onClick={event => { setToast(storageError); setPanel('data', event.currentTarget); }}>Local save needs attention — download a backup</button>}
    {(toast || sim.error) && <div role="status" className="toast"><span>{toast ?? sim.error}</span><button aria-label="Dismiss notification" onClick={() => { setToast(null); sim.clearError(); }}><X size={15} /></button></div>}
    {sim.running && <button className="cancel-run" disabled={sim.cancelling} onClick={sim.cancel}>{sim.cancelling ? 'Stopping calculation…' : 'Cancel calculation'}<X size={14} /></button>}
    {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className={`modal ${panel === 'model' || panel === 'data' || panel === 'experiments' || panel === 'insights' ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">QUEUELAB / {panel.toUpperCase()}</span><h2 id="modal-title">{panel === 'worlds' ? 'Choose your little world.' : panel === 'compare' ? 'A better plan starts here.' : panel === 'model' ? 'Inside your model.' : panel === 'data' ? 'Keep your work. Share your findings.' : panel === 'experiments' ? 'Run experiments.' : panel === 'insights' ? 'Your run, in detail.' : panel === 'budget' ? 'Before you calculate.' : panel === 'history' ? 'Your recent actions.' : 'A little guidance.'}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setPanel(null)}><X size={20} /></button></div>
      {panel === 'history' && <ActionHistory history={history} revision={project.revision} onUndo={undo} onRedo={redo} />}
      {panel === 'budget' && (normalBudget ? <CalculationBudget budget={normalBudget} /> : <p className="modal-intro">Repair your model to see the workload estimate. The run stays disabled until validation passes.</p>)}
      {panel === 'worlds' && <div className="world-gallery">{(['factory', 'festival', 'service'] as const).map(w => <button key={w} onClick={() => chooseWorld(w)}><span className={`world-mini ${w}`}><img src={`/previews/${w}.jpg`} alt="" loading="lazy" width="640" height="360" /></span><h3>{WORLD_INFO[w].name}<ArrowUpRight size={18} /></h3><p>{WORLD_INFO[w].subtitle}</p><span className="gallery-foot">SYNTHETIC MODEL · OPEN & EDIT</span></button>)}</div>}
      {panel === 'compare' && <><p className="modal-intro">Keep your original plan. Change a station, run it, and compare the same modeled demand.</p><div className="comparison-table"><div className="comparison-row table-header"><span>FULL RUN</span><span>Baseline</span><span>Current plan</span></div>{[['Completed', baseline?.summary.completed, shownResult?.summary.completed, ''], ['Average wait', baseline?.summary.waitSampleSize ? baseline.summary.meanWait : null, shownResult?.summary.waitSampleSize ? shownResult.summary.meanWait : null, 'wait'], ['95th percentile wait', baseline?.summary.waitSampleSize ? baseline.summary.p95Wait : null, shownResult?.summary.waitSampleSize ? shownResult.summary.p95Wait : null, 'wait'], ['Resource cost', baseline?.summary.cost, shownResult?.summary.cost, 'cost']].map(([label, a, b, kind]) => <div className="comparison-row" key={String(label)}><span>{label}</span><strong>{typeof a === 'number' ? kind === 'wait' ? wait(a) : kind === 'cost' ? money(a, baseline?.model.currency ?? project.model.currency) : number(a) : '—'}</strong><strong>{typeof b === 'number' ? kind === 'wait' ? wait(b) : kind === 'cost' ? money(b, shownResult?.model.currency ?? project.model.currency) : number(b) : shownResult ? '—' : 'Run your plan'}</strong></div>)}</div><div className="comparison-note"><ShieldCheck size={16} />{singlePaired ? `Same external demand, seed ${shownResult?.seed}.` : !shownResult ? 'Run the current draft to compare it with the baseline.' : !singleCoupling ? 'Matching scope was not recorded in this older run. A new calculation records it.' : 'Demand, seed or measurement policies differ. These are separate runs, not a paired comparison.'} Repeated experiments are required to assess sampling uncertainty.</div>{baseline && shownResult && singleCoupling && <CouplingDetails manifest={singleCoupling} baseline={baseline} candidate={shownResult} />}<button className="secondary-button" disabled={!shownResult} onClick={() => { if (shownResult) { setBaseline(shownResult); setToast('Current run is now your baseline.'); } }}><Copy size={16} />Use current run as baseline</button><SavedScenarios project={project} baseline={baseline} busy={sim.running} onChange={edit} onBaseline={async snapshot => { const generation = ++requestGeneration.current; setLatestAttempt(null); const computed = await sim.run(snapshot.model); if (generation !== requestGeneration.current) throw new Error('Superseded by a newer run.'); if (computed.status !== 'completed') { setLatestAttempt(computed); throw new Error(computed.reason ?? 'Baseline run did not complete.'); } setLatestAttempt(null); setBaseline(computed); }} /></>}
      {panel === 'model' && <ModelEditor project={project} onChange={edit} selectedId={selected} selectedIds={selection.ids} onSelect={setSelected} onMove={moveSelected} />}
      {panel === 'insights' && <RunInsights result={result} draft={project.model} onReport={() => setPanel('data')} onExperiments={() => setPanel('experiments')} />}
      {panel === 'experiments' && <ExperimentsPanel project={project} baseline={baseline} onApplyCapacity={(poolId, capacity) => { edit(mutateProject(project, p => { const pool = p.model.resources.find(r => r.id === poolId); if (pool) pool.capacity = capacity; })); setPanel(null); setToast('Applied the verified pool capacity to your draft. Run it to calculate results.'); }} />}
      {panel === 'data' && <DataTools project={project} result={result} latestAttempt={latestAttempt} onImport={acceptProject} onSave={persistProject} retainedDrafts={retainedDrafts} onRestoreDraft={restoreDraft} onRetryDraft={token => { const draft = retained.current.find(item => item.token === token); if (draft) void persistProject(draft.project).catch(() => {}); }} onRemoveDraft={token => updateRetained(retained.current.filter(draft => draft.token !== token))} />}
      {panel === 'help' && <div className="help-content"><p>Every world is a small, editable process simulation. Jobs arrive, wait for limited resources, move through stations and leave.</p><ol><li><b>Watch the queue.</b> Select a station to inspect its capacity and processing time.</li><li><b>Try another plan.</b> Make a change, then run the model. The original result stays as your baseline.</li><li><b>Compare the trade-off.</b> Check completed work, waiting and resource cost together.</li><li><b>Keep your world.</b> Download the project file and reopen it later.</li></ol><p className="quiet-copy">With the world focused: Space to play or pause · F for full screen · G to focus the inspected station · Shift-click to toggle selection · Escape to cancel a tool, then clear selection. Undo/Redo: Cmd/Ctrl+Z and Shift+Z outside text fields. Action history lists retained edits.</p><p className="quiet-copy">The engine uses a reproducible seed. The visual layout does not determine travel time or simulate physical collisions. These are synthetic examples, not validated forecasts of a real business.</p><button className="secondary-button" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>3D quality: {quality === 'high' ? 'detailed' : 'low power'}</button><button className="secondary-button" onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? <Check size={15} /> : <Pause size={15} />}Reduced motion: {reducedMotion ? 'on' : 'off'}</button></div>}
    </section></div>}
  </div>;
}
