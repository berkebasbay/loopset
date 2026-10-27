import { appMessages as m } from './ui/messages/App';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Check, ChevronRight, CircleHelp, Copy, FileUp, FlaskConical, Focus, GitCompareArrows, Globe2, History, Layers3, Link2, List, LoaderCircle, MousePointer2, Move, Pause, Play, Plus, Redo2, Search, ShieldCheck, SkipBack, Undo2, X } from 'lucide-react';
import { WORLD_INFO } from './examples';
import { createStudioExample as createExample } from './examples/studio';
import { duplicateProject, MAX_PARALLEL_STATIONS, mutateProject, serviceNodes } from './model/commands';
import { InputDifferences } from './features/InputDifferences';
import { createNewProject } from './model/newProject';
import { modelDifferences } from './model/modelDiff';
import { modelHash } from './model/identity';
import { validateProject } from './model/validate';
import type { ModelNode, Point, Project, RunResult, ServiceNode, World } from './model/types';
import { frameAt, replayManifest } from './playback';
import { FlowGuide } from './scene/FlowGuide';
import { flowTopology, possibleFlow, sharedPositionLinks } from './scene/flowPresentation';
import { sceneLayout } from './scene/graph';
import { flowGuideMessages } from './ui/messages/FlowGuide';
const WorldScene = lazy(() => import('./scene/WorldScene').then(module => ({ default: module.WorldScene })));
import { useSimulation } from './worker/useSimulation';
import { ModelEditor } from './features/ModelEditor';
import { ActionHistory } from './features/ActionHistory';
import { commitEdit, emptyHistory, redoEdit, undoEdit } from './features/editorHistory';
import { emptySelection, pruneSelection, reconcileSelection, selectStep, type EditorSelection, type SelectionIntent } from './features/editorSelection';
import { translateSelection } from './features/layoutCommands';
import { addNode, connectNext } from './features/modelEdits';
import { ScenarioSettings } from './features/ScenarioSettings';
import { QuickProperties } from './features/QuickProperties';
import { ProcessList } from './features/ProcessList';
import { NumericDraftProvider } from './features/EditFields';
import { ReplayJump } from './features/ReplayJump';
import { replayEaseMessages as rx } from './ui/messages/replayEase';
import { processEaseMessages } from './ui/messages/modelEdits';
import { ConnectionPicker } from './features/ProcessActions';
import { ProjectRename } from './features/ProjectRename';
import { CommandSearch, QuickGuide, type WorkspaceCommand } from './features/WorkspaceNavigation';
import { shellEaseMessages as sx } from './ui/messages/shellEase';
import { easeMessages as ease } from './ui/messages/ease';
import './features/shellEase.css';
import { BuildTray, type BuildPrefab } from './features/BuildTray';
import './features/workspace.css';
import { DataTools, recoveryProjectKey, serializeDraftRecovery, type RetainedDraft, type FileTab } from './features/DataTools';
import { CouplingDetails } from './features/CouplingDetails';
import { CalculationBudget } from './features/CalculationBudget';
import { CalculationStatus, completedSimulationNotice, sameNumericalSnapshot, useCalculationAnnouncement } from './ui/CalculationAnnouncement';
import { replayTimeFromRange } from './features/replayRange';
import { calculationBudget } from './model/workBudget';
import { buildCouplingManifest } from './engine/provenance';
import { ExperimentsPanel } from './lab/ExperimentsPanel';
import { SavedScenarios } from './lab/SavedScenarios';
import { RunInsights } from './lab/RunInsights';
import { captureSaveContext, loadLastProject, rememberOpenedProject, saveProject } from './storage/projectStore';
import { BoundedCache } from './storage/boundedCache';
import { ProjectSaveQueue, type SaveInput } from './storage/projectSaveQueue';
import { openProjectJSON, serializeProject } from './storage/projectFile';
import { downloadText, safeFilename } from './storage/csv';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}
const clock = (s: number) => !Number.isFinite(s) ? '—' : `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const wait = (s: number) => !Number.isFinite(s) ? '—' : s >= 60 ? m.minutes((s / 60).toFixed(1)) : m.seconds(Math.round(s));
const money = (n: number, currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const number = (n: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n);
type Panel = 'worlds' | 'model' | 'compare' | 'data' | 'experiments' | 'insights' | 'budget' | 'history' | 'help' | 'scenario' | 'view' | 'rename' | 'search' | 'guide' | null;

export default function App() {
  const [pendingEdits, setPendingEdits] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [project, setProject] = useState<Project>(() => createExample('factory'));
  const [history, setHistory] = useState(emptyHistory); const historyRef = useRef(history); historyRef.current = history;
  const [selection, setSelection] = useState<EditorSelection>({ ids: ['station-c'], primary: 'station-c' });
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const selected = selection.primary, undoAction = history.past.at(-1), redoAction = history.future[0];
  const [result, setResult] = useState<RunResult | null>(null); const [baseline, setBaseline] = useState<RunResult | null>(null);
  // Keep at most one incomplete snapshot, separate from completed results and comparisons.
  const runDisplayNames = useRef(new WeakMap<RunResult, string>());
  const [experimentContext, setExperimentContext] = useState<{project:Project;baseline:RunResult|null}|null>(null);
  const [latestAttempt, setLatestAttempt] = useState<RunResult | null>(null);
  const [time, setTime] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(15);
  const [visualSeekEpoch, setVisualSeekEpoch] = useState(0);
  const [panel, setPanelState] = useState<Panel>(null);
  const [dataInitialTab, setDataInitialTab] = useState<FileTab>('projects');
  const currentPanel = useRef<Panel>(null); const panelGeneration = useRef(0);
  const dialogOrigin = useRef<{ element: HTMLElement | null; panel: Exclude<Panel, null> } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ owner: string; from: string; to: string } | null>(null);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [moving, setMoving] = useState(true); const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [objectDetailsOpen, setObjectDetailsOpen] = useState(() => !matchMedia('(max-width:740px)').matches);
  const [inspectorTab, setInspectorTab] = useState<'object' | 'tools' | 'steps'>('object');
  const [buildTrayOpen, setBuildTrayOpen] = useState(false);
  const buildTrayOrigin = useRef<HTMLElement | null>(null);
  const objectDetailsOrigin = useRef<HTMLElement | null>(null);
  const [flowState, setFlowState] = useState({ key: '', open: false, cursor: 0 });
  const [toast, setToast] = useState<string | null>(null); const [backupRequestedRevision, setBackupRequestedRevision] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [localRevision, setLocalRevision] = useState<number | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [retainedDrafts, setRetainedDrafts] = useState<RetainedDraft[]>([]);
  const retained = useRef<RetainedDraft[]>([]); const recoverySequence = useRef(0);
  const acknowledgedContent = useRef(new BoundedCache<string>(64, 20_000_000, (value, key) => 2 * (value.length + key.length)));
  const saveQueue = useRef<ProjectSaveQueue<Awaited<ReturnType<typeof saveProject>>> | null>(null);
  if (!saveQueue.current) saveQueue.current = new ProjectSaveQueue(writeProject);
  const storageGate = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!storageGate.current) {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    storageGate.current = { promise, resolve };
  }

  const sim = useSimulation(); const initialized = useRef(false); const requestGeneration = useRef(0); const manualClock = useRef(false);
  const calculationStatus = useCalculationAnnouncement();
  const live = useRef({ project, result, latestAttempt, time, playing, speed, selected, selectedIds: selection.ids, running: sim.running, canReplay: false, replayUntil: 0 });

  const issues = useMemo(() => validateProject(project), [project]);
  const hasErrors = issues.some(i => i.severity === 'error');
  const revisionExhausted = project.revision >= Number.MAX_SAFE_INTEGER;
  const firstError = issues.find(issue => issue.severity === 'error');
  const errorNodeIndex = firstError?.path.match(/(?:^|\.)nodes\.(\d+)/)?.[1];
  const errorNode = errorNodeIndex === undefined ? undefined : project.model.nodes[Number(errorNodeIndex)];
  const normalBudget = useMemo(() => hasErrors ? null : calculationBudget([{ label: m.currentDraft, model: project.model, runs: 1 }]), [project.model, hasErrors]);
  const lastValidProject = useRef(project);
  if (!hasErrors) lastValidProject.current = project;
  const visualProject = lastValidProject.current;
  const currentHash = useMemo(() => modelHash(project.model), [project.model]);
  const stale = Boolean(result && (result.modelHash !== currentHash || result.seed !== project.model.seed));
  const staleChanges = useMemo(() => result && stale ? modelDifferences(result.model, project.model) : [], [result, stale, project.model]);
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
  const selectedStep = project.model.nodes.find(n => n.id === selected);
  const worldInfo = WORLD_INFO[project.world];
  const source = project.model.nodes.find(n => n.kind === 'source');
  const topologySignature = useMemo(() => JSON.stringify(visualProject.model.nodes.map(node => ({ id: node.id, kind: node.kind,
    next: 'next' in node ? node.next : undefined, branches: node.kind === 'route' ? node.branches : undefined }))), [visualProject.model.nodes]);
  // Capacity, labels and replay frames do not rebuild connectivity or the walk.
  // Current user-authored labels are read separately by the paper disclosure.
  const topology = useMemo(() => flowTopology(visualProject.model.nodes), [topologySignature]);
  const flowNodes = useMemo(() => new Map(visualProject.model.nodes.map(node => [node.id, node])), [visualProject.model.nodes]);
  const flowLayout = useMemo(() => sceneLayout(visualProject), [visualProject.layout, topology]);
  const flowWalk = useMemo(() => possibleFlow(topology, selected), [topology, selected]);
  const sharedConnections = useMemo(() => sharedPositionLinks(topology, flowLayout), [topology, flowLayout]);
  const flowKey = useMemo(() => JSON.stringify([visualProject.id, selected, topologySignature]), [visualProject.id, selected, topologySignature]);
  const flowOpen = flowState.key === flowKey && flowState.open;
  const flowCursor = Math.max(0, Math.min(flowState.cursor, (flowWalk?.links.length ?? 1) - 1));
  const flowSuspended = Boolean(linkFrom || moving || panel);
  const sceneFlow = useMemo(() => {
    if (panel || hasErrors) return null;
    if (buildTrayOpen) {
      const anchor = insertionAnchor(visualProject), walk = anchor && possibleFlow(topology, anchor.id);
      if (walk && anchor) return { walk, cursor: Math.max(0, walk.links.findIndex(link => link.from === anchor.id && link.to === anchor.next)) };
    }
    if (connectionPreview) {
      const nodes = visualProject.model.nodes.map(node => node.id === connectionPreview.from && 'next' in node ? { ...node, next: connectionPreview.to } : node);
      const previewWalk = possibleFlow(flowTopology(nodes), connectionPreview.from);
      if (previewWalk) return { walk: previewWalk, cursor: Math.max(0, previewWalk.links.findIndex(link => link.from === connectionPreview.from && link.to === connectionPreview.to)) };
    }
    return flowOpen && !flowSuspended && flowWalk ? { walk: flowWalk, cursor: flowCursor } : null;
  }, [panel, hasErrors, connectionPreview, buildTrayOpen, visualProject, selected, topology, flowOpen, flowSuspended, flowWalk, flowCursor]);
  function showFlowConnection(index: number) {
    if (hasErrors || flowSuspended) return;
    document.querySelector('.world-scene')?.dispatchEvent(new CustomEvent('queuelab:show-connection', { detail: index }));
  }

  function updateSelection(next: EditorSelection) {
    selectionRef.current = next; setSelection(next);
    live.current = { ...live.current, selected: next.primary, selectedIds: next.ids };
  }
  function setSelected(id: string | null, intent: SelectionIntent = 'single') {
    updateSelection(pruneSelection(selectStep(selectionRef.current, id, intent), live.current.project.model.nodes));
  }

  function setPanel(next: Panel, opener?: HTMLElement | null, keepExperimentContext = false) {
    if (next === 'experiments' && !keepExperimentContext) setExperimentContext(null);
    if (next === currentPanel.current) return;
    // Pointer activation need not focus a button in WebKit. Retain the explicit
    // outside opener once; changing panels inside the dialog keeps that origin.
    if (next && !currentPanel.current) {
      const active = document.activeElement;
      dialogOrigin.current = { element: opener ?? (active instanceof HTMLElement && active !== document.body && !active.closest('[role=dialog]') ? active : null), panel: next };
    }
    currentPanel.current = next; ++panelGeneration.current; setPanelState(next);
  }

  function openFiles(tab: FileTab = 'projects', opener?: HTMLElement | null) { setDataInitialTab(tab); setPanel('data', opener); }

  async function compute(p: Project, establishBaseline = false) {
    const generation = ++requestGeneration.current; setPlaying(false); setLatestAttempt(null);
    const announcementId = String(generation);
    calculationStatus.controller.begin(announcementId, m.calculationStarted(p.model.name), panelGeneration.current);
    if (!establishBaseline) setToast(null);
    try {
      const r = await sim.run(p.model);
      if (generation !== requestGeneration.current) return;
      if (r.status !== 'completed') { calculationStatus.controller.finish(announcementId, '', panelGeneration.current); setLatestAttempt(r); setToast(r.reason ?? m.incompleteRunNotice(r.status)); return; }
      setLatestAttempt(null);
      runDisplayNames.current.set(r, p.name);
      setResult(r); if (establishBaseline || !baseline) setBaseline(r);
      const coverage = replayManifest(r).coverage;
      setTime(establishBaseline ? Math.min(p.model.horizon * .38, coverage.at(-1)?.end ?? 0) : 0);
      setPlaying(establishBaseline && coverage.length > 0); manualClock.current = false;
      const current = live.current.project;
      const earlier = !sameNumericalSnapshot(
        { projectId: p.id, modelHash: r.modelHash, seed: r.seed, valid: true },
        { projectId: current.id, modelHash: modelHash(current.model), seed: current.model.seed, valid: !validateProject(current).some(issue => issue.severity === 'error') },
      );
      calculationStatus.controller.finish(announcementId, completedSimulationNotice({ status: r.status, name: r.model.name, completed: r.summary.completed, unfinished: r.summary.inSystem, earlier }, m.calculationCompleted), panelGeneration.current);
      return r;
    } catch (e) { if (generation === requestGeneration.current) { calculationStatus.controller.finish(announcementId, '', panelGeneration.current); setToast(e instanceof Error ? e.message : m.theRunCouldNotFinish); } }
  }
  async function runAndCompare(opener: HTMLElement) {
    const snapshot = live.current.project;
    const surface = panelGeneration.current;
    const completed = await compute(snapshot);
    const current = live.current.project;
    if (!completed || surface !== panelGeneration.current || current.id !== snapshot.id ||
      !sameNumericalSnapshot(
        { projectId: snapshot.id, modelHash: completed.modelHash, seed: completed.seed, valid: true },
        { projectId: current.id, modelHash: modelHash(current.model), seed: current.model.seed, valid: !validateProject(current).some(issue => issue.severity === 'error') },
      )) return;
    setPanel('compare', opener);
  }
  function cancelCalculation() {
    calculationStatus.controller.stopping(String(requestGeneration.current), m.stoppingCalculation, panelGeneration.current);
    sim.cancel();
  }
  useEffect(() => {
    if (initialized.current) return; initialized.current = true;
    let alive = true;
    const timer = setTimeout(() => {
      void loadLastProject({ observe: false }).then(saved => {
        if (!alive) return;
        // A slow IndexedDB load must never replace a newer user action.
        const untouched = live.current.project.id === project.id && live.current.project.revision === project.revision;
        const initial = untouched ? saved ?? project : live.current.project;
        if (saved) acknowledgedContent.current.set(saved.id, recoveryProjectKey(saved));
        if (saved && untouched) { rememberOpenedProject(saved); setProject(saved); live.current = { ...live.current, project: saved }; setLocalRevision(saved.revision); setSelected(serviceNodes(saved)[0]?.id ?? null); }
        storageGate.current!.resolve(); setStorageReady(true);
        if (!validateProject(initial).some(issue => issue.severity === 'error')) void compute(initial, true);
      }).catch(error => {
        if (!alive) return;
        setStorageError(error instanceof Error ? error.message : m.browserStorageIsUnavailableKeepADownloadedBackup);
        storageGate.current!.resolve(); setStorageReady(true);
        if (!validateProject(live.current.project).some(issue => issue.severity === 'error')) void compute(live.current.project, true);
      });
    }, 50);
    return () => { alive = false; clearTimeout(timer); initialized.current = false; };
  }, []);
  useEffect(() => {
    if (!storageReady || issues.some(i => i.severity === 'error')) return;
    const snapshot = project, context = captureSaveContext(project.id);
    const timer = setTimeout(() => { void persistProject(snapshot, true, context).catch(() => { /* Retained and surfaced by persistProject. */ }); }, 800);
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
      manualClock.current = true; setVisualSeekEpoch(value => value + 1); const s = live.current;
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
      if (event.key === 'Escape' && buildTrayOpen && target?.closest('.build-tray')) { event.preventDefault(); closeBuildTray(); return; }
      if (event.key === 'Escape' && objectDetailsOpen && !panel && target?.closest('.inspector')) { event.preventDefault(); closeObjectDetails(); return; }
      if (event.key === 'Escape' && panel) { event.preventDefault(); setPanel(null); return; }
      // WebKit pointer buttons can leave focus on BODY. Tool cancellation must
      // still work there; a scene drag consumes its own first Escape above us.
      if (event.key === 'Escape' && !editable && !panel && moving) { event.preventDefault(); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:cancel-move')); setMoving(false); return; }
      if (event.key === 'Escape' && !editable && !panel && target?.closest('.world-workspace')) {
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
      if (panel || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(event.target instanceof Element) || !event.target.closest('.world-workspace') || (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'A'].includes(event.target.tagName))) return;
      if (event.code === 'Space' && live.current.canReplay && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); manualClock.current = false; setPlaying(p => !p); }
      if (event.key.toLowerCase() === 'g') { event.preventDefault(); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:focus')); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (document.fullscreenElement) void document.exitFullscreen(); else void document.querySelector<HTMLElement>('.world-workspace')?.requestFullscreen?.().catch(() => setToast(m.fullScreenIsUnavailableInThisBrowser)); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); };
  }, [panel, linkFrom, moving, objectDetailsOpen, buildTrayOpen]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);
  // Adopt a document's inspector before it can receive input. A deferred reset
  // can otherwise overwrite a Tools choice made just after the new world appears.
  useLayoutEffect(() => { setObjectDetailsOpen(!matchMedia('(max-width:740px)').matches); setInspectorTab('object'); }, [project.id]);


  function updateRetained(next: RetainedDraft[]) { retained.current = next; setRetainedDrafts(next); }
  function retainDraft(snapshot: Project, state: RetainedDraft['state'], message: string, context: number): RetainedDraft | null {
    const key = recoveryProjectKey(snapshot);
    const existing = retained.current.find(draft => draft.key === key && draft.context === context);
    if (existing) {
      const updated = { ...existing, state, message };
      updateRetained(retained.current.map(draft => draft.token === existing.token ? updated : draft)); return updated;
    }
    let bytes: number;
    try { bytes = new TextEncoder().encode(serializeDraftRecovery(snapshot)).length; }
    catch (error) { setStorageError(error instanceof Error ? error.message : m.keepThisDraftOpenUntilYouCanMakeA); return null; }
    if (retained.current.length >= 12 || retained.current.reduce((total, draft) => total + draft.bytes, 0) + bytes > 20_000_000) {
      setStorageError(m.retainedDraftLimitReached); return null;
    }
    const draft: RetainedDraft = { token: `draft-${++recoverySequence.current}`, key, project: structuredClone(snapshot), bytes, state, message, context };
    updateRetained([...retained.current, draft]); return draft;
  }
  /** Explicit saves remain FIFO; only unstarted autosaves may yield to a newer
   * autosave. Pending jobs retain bounded strings, not cloned Project trees. */
  function persistProject(snapshot: Project): ReturnType<typeof saveProject>;
  function persistProject(snapshot: Project, autosave: true, context?: number): Promise<Awaited<ReturnType<typeof saveProject>> | undefined>;
  function persistProject(snapshot: Project, autosave: false, context: number): ReturnType<typeof saveProject>;
  function persistProject(snapshot: Project, autosave = false, context = captureSaveContext(snapshot.id)): Promise<Awaited<ReturnType<typeof saveProject>> | undefined> {
    let serialized: string;
    try { serialized = serializeProject(snapshot); }
    catch (error) {
      const message = error instanceof Error ? error.message : m.repairThisDraftBeforeSaving;
      retainDraft(snapshot, 'invalid', message, context); setStorageError(message); return Promise.reject(error);
    }
    try {
      const input = { id: snapshot.id, revision: snapshot.revision, contentKey: recoveryProjectKey(snapshot), serialized, context };
      return autosave ? saveQueue.current!.enqueue(input, 'auto') : saveQueue.current!.enqueue(input, 'explicit');
    } catch (error) {
      // Admission can fail without a write starting. A retained outgoing draft
      // must become retryable rather than stay indefinitely marked "waiting".
      const message = error instanceof Error ? error.message : m.localSaveFailedKeepThisTabOpenAndVerify;
      retainDraft(snapshot, 'failed', message, context); setStorageError(message); return Promise.reject(error);
    }
  }
  async function writeProject(input: SaveInput): ReturnType<typeof saveProject> {
    await storageGate.current!.promise;
    const snapshot = openProjectJSON(input.serialized), key = input.contentKey, context = input.context!;
    updateRetained(retained.current.map(draft => draft.key === key && draft.context === context ? { ...draft, state: 'saving', message: m.waitingForTheIndexedDBTransactionAcknowledgment } : draft));
    try {
      const ack = await saveProject(snapshot, { context: input.context });
      // Eviction affects only acknowledgment reuse; it never deletes local work.
      acknowledgedContent.current.set(snapshot.id, key);
      updateRetained(retained.current.filter(draft => draft.key !== key || draft.context !== context));
      if (live.current.project.id === ack.projectId && recoveryProjectKey(live.current.project) === key) { setLocalRevision(ack.revision); setStorageError(null); }
      return ack;
    } catch (error) {
      const message = error instanceof Error ? error.message : m.localSaveFailedKeepThisTabOpenAndVerify;
      retainDraft(snapshot, 'failed', message, context);
      if (live.current.project.id === snapshot.id && recoveryProjectKey(live.current.project) === key) setStorageError(message);
      throw error;
    }
  }
  function preserveOutgoing(snapshot: Project): boolean {
    if (acknowledgedContent.current.get(snapshot.id) === recoveryProjectKey(snapshot)) return true;
    let invalid = false; let message: string = m.savingTheOutgoingProjectBeforeReplacement;
    try { serializeProject(snapshot); }
    catch (error) { invalid = true; message = error instanceof Error ? error.message : m.repairThisDraftBeforeSaving; }
    const context = captureSaveContext(snapshot.id);
    const draft = retainDraft(snapshot, invalid ? 'invalid' : 'waiting', message, context);
    if (!draft) { setPanel('data'); setToast(m.thisDraftIsStillOpenReviewRetainedCopiesOr); return false; }
    if (!invalid) void persistProject(snapshot, false, context).catch(() => {});
    return true;
  }
  function canEditProject() {
    if (live.current.project.revision < Number.MAX_SAFE_INTEGER) return true;
    setToast(m.revisionLimitReached); return false;
  }
  function edit(next: Project, label?: string) {
    if (!canEditProject()) return false;
    const previous = live.current.project;
    if (next.id !== previous.id) return false;
    const committed = commitEdit(historyRef.current, previous, next, label);
    if (!committed.entry) return true;
    setLinkFrom(null); next = committed.project;
    historyRef.current = committed.history; setHistory(committed.history);
    updateSelection(reconcileSelection(selectionRef.current, previous.model.nodes, next.model.nodes));
    setProject(next); live.current = { ...live.current, project: next }; setPlaying(false); return true;
  }
  function restoreHistory(direction: 'undo' | 'redo') {
    if (!canEditProject()) return;
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
    catch (error) { setToast(error instanceof Error ? error.message : m.theseVisualPositionsCouldNotBeMoved); }
  }
  function changeCapacity(id: string, delta: number) {
    if (!canEditProject()) return;
    const current = live.current.project;
    if (validateProject(current).some(issue => issue.severity === 'error')) { setToast(m.repairYourModelFirst); return; }
    const node = current.model.nodes.find((item): item is ServiceNode => item.id === id && item.kind === 'service');
    if (!node || !Number.isFinite(node.servers)) return;
    const next = node.servers + delta;
    if (!Number.isInteger(next) || next < 1 || (delta > 0 && next > MAX_PARALLEL_STATIONS)) return;
    if (next !== node.servers) edit(mutateProject(current, copy => { const target = copy.model.nodes.find(n => n.id === id); if (target?.kind === 'service') target.servers = next; }), ease.stationChanged(node.label));
  }
  function showBuildTray(origin: HTMLElement) {
    buildTrayOrigin.current = origin;
    setBuildTrayOpen(true); setLinkFrom(null);
    requestAnimationFrame(() => {
      const tray = document.querySelector<HTMLElement>('.build-tray');
      tray?.scrollIntoView({ block: 'nearest' });
      tray?.querySelector<HTMLElement>('select:not(:disabled),.build-prefab:not(:disabled),.tray-close')?.focus({ preventScroll: true });
    });
  }
  function closeBuildTray() {
    setBuildTrayOpen(false);
    requestAnimationFrame(() => {
      const origin = buildTrayOrigin.current;
      if (origin?.isConnected && origin.checkVisibility({ visibilityProperty: true })) origin.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('[data-build-opener]')?.focus({ preventScroll: true });
    });
  }
  function revealNarrowSection(selector: string, focusSelector: string) {
    if (!matchMedia('(max-width:740px)').matches) return;
    requestAnimationFrame(() => {
      if (currentPanel.current) return;
      const section = document.querySelector<HTMLElement>(selector);
      if (!section) return;
      section.scrollIntoView({ block: 'start' });
      section.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
    });
  }
  function editSceneNode(id: string) {
    setSelected(id);
    const active = document.activeElement;
    objectDetailsOrigin.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setInspectorTab('object');
    setObjectDetailsOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-object-details-close]')?.focus({ preventScroll: true }));
    revealNarrowSection('#object-properties', '[data-object-details-close]');
  }
  function closeObjectDetails() {
    setObjectDetailsOpen(false);
    requestAnimationFrame(() => {
      const origin = objectDetailsOrigin.current;
      const target = origin?.isConnected && !origin.closest('.inspector') ? origin : document.querySelector<HTMLElement>('[data-testid="world-canvas"]');
      target?.focus({ preventScroll: true });
    });
  }
  function openTools() {
    const active = document.activeElement;
    objectDetailsOrigin.current = active instanceof HTMLElement ? active : null;
    setInspectorTab('tools'); setObjectDetailsOpen(true);
    revealNarrowSection('#object-properties', '[data-object-details-close]');
  }
  function insertionAnchor(current: Project): Extract<ModelNode, { next: string }> | undefined {
    const chosen = current.model.nodes.find(node => node.id === selectionRef.current.primary);
    if (chosen && 'next' in chosen) return chosen;
    const exits = new Set(current.model.nodes.filter(node => node.kind === 'sink').map(node => node.id));
    return current.model.nodes.find((node): node is Extract<ModelNode, { next: string }> => 'next' in node && exits.has(node.next));
  }
  function addProcess(prefab: BuildPrefab) {
    const current = live.current.project;
    if (validateProject(current).some(issue => issue.severity === 'error')) { setToast(m.repairYourModelFirst); return; }
    const anchor = insertionAnchor(current);
    if (!anchor || !('next' in anchor)) { setToast(m.selectInsertionPoint); return; }
    try {
      const added = addNode(current, prefab.kind), following = anchor.next;
      const position = sceneLayout(current)[anchor.id] ?? { x: 0, z: 0 };
      const next = mutateProject(added.project, copy => {
        const previous = copy.model.nodes.find(node => node.id === anchor.id);
        const created = copy.model.nodes.find(node => node.id === added.id);
        if (!previous || !('next' in previous) || !created || !('next' in created)) throw new Error(m.selectInsertionPoint);
        previous.next = created.id; created.next = following; created.label = prefab.label;
        copy.layout[created.id] = { x: position.x + 3.8, z: position.z + 2.6 };
      });
      const problem = validateProject(next).find(issue => issue.severity === 'error');
      if (problem) throw new Error(problem.message);
      edit(next, m.addProcessLabel(prefab.label)); setSelected(added.id);
      setInspectorTab('object'); setObjectDetailsOpen(true); setMoving(true); setLinkFrom(null);
      revealNarrowSection('#object-properties', '[data-object-details-close]');
      setToast(m.addedAfter(prefab.label, anchor.label));
    } catch (error) { setToast(error instanceof Error ? error.message : m.couldNotAddProcess); }
  }
  function selectFromWorld(id: string | null, intent: SelectionIntent = 'single') {
    if (linkFrom) {
      if (!id) return;
      try {
        edit(connectNext(live.current.project, linkFrom, id), m.connectSteps(project.model.nodes.find(node => node.id === linkFrom)?.label ?? m.step, project.model.nodes.find(node => node.id === id)?.label ?? m.step));
        setToast(m.connectionUpdatedRunTheChangedPlanToCalculateIts); setLinkFrom(null);
      } catch (error) { setToast(error instanceof Error ? error.message : m.chooseAValidNextStep); }
      return;
    }
    if (id && !live.current.project.model.nodes.some(node => node.id === id)) return;
    setSelected(id, intent);
    if (id) { setInspectorTab('object'); setObjectDetailsOpen(true); }
  }
  function acceptProject(next: Project, label: string = m.openProjectFile): Project | null {
    const previous = live.current.project;
    setLinkFrom(null);
    if (next.id === previous.id) { ++requestGeneration.current; calculationStatus.controller.invalidate(panelGeneration.current); sim.cancel(); setLatestAttempt(null); if (!edit(next, label)) return null; return live.current.project; }
    if (!preserveOutgoing(previous)) return null;
    ++requestGeneration.current; calculationStatus.controller.invalidate(panelGeneration.current); sim.cancel(); setLatestAttempt(null);
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
      downloadText(text, safeFilename(`${snapshot.name}-queuelab${repair ? '-unvalidated-repair' : ''}`, 'json'), 'application/json;charset=utf-8');
      setBackupRequestedRevision(snapshot.revision); setToast(m.backupDownloadRequested(repair));
    } catch (e) { setToast(e instanceof Error ? e.message : m.couldNotPrepareABackupKeepThisDraftOpen); }
  }
  function restoreDraft(token: string) {
    const draft = retained.current.find(item => item.token === token); if (!draft) return;
    const restored = acceptProject(structuredClone(draft.project), m.restoreRetainedDraftForRepair);
    if (restored) { setPanel('model'); setToast(m.retainedDraftRestoredForRepairItsRetainedCopyStays); }
  }
  function openStepList() { setInspectorTab('steps'); setObjectDetailsOpen(true); revealNarrowSection('#object-properties', 'input[type=search]'); }
  function createProcess() { if (acceptProject(createNewProject(project.world))) { setPanel(null); setInspectorTab('object'); setObjectDetailsOpen(true); } }
  function navigateCommand(command: WorkspaceCommand) {
    if (command === 'newModel') { createProcess(); return; }
    if (command === 'steps') { setPanel(null); openStepList(); return; }
    if (command === 'data') { openFiles('projects'); return; }
    if (command === 'download') { downloadProject(); setPanel(null); return; }
    if (command === 'demand' || command === 'team') {
      const node = live.current.project.model.nodes.find(node => node.kind === (command === 'demand' ? 'source' : 'service'));
      setPanel(null); if (node) editSceneNode(node.id); return;
    }
    setPanel(command);
  }
  function guideTarget(target: string) {
    if (target === 'scenario' || target === 'compare') { setPanel(target); return; }
    setPanel(null);
    if (target === 'steps') { openStepList(); return; }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(target === 'download' ? '.studio-save' : '.studio-command-actions .studio-primary')?.focus());
  }
  const panelTitle = (surface: Exclude<Panel, null>) => ({ worlds: m.chooseYourLittleWorld, compare: m.aBetterPlanStartsHere, model: m.insideYourModel, data: m.keepYourWorkShareYourFindings, experiments: m.runExperiments, insights: m.yourRunInDetail, budget: m.beforeYouCalculate, history: m.yourRecentActions, help: m.helpHeading, scenario: sx.scenario, view: sx.view, rename: sx.renameProject, search: sx.search, guide: sx.guide }[surface]);
  const draftSummary = normalBudget ? sx.quickSummary(ease.duration(project.model.horizon), number(normalBudget.groups[0].arrivalsPerRun), normalBudget.groups[0].stochastic, project.model.resources.length) : sx.reviewInputs;
  return <NumericDraftProvider onPendingChange={setPendingEdits}><div className="app-shell studio-shell">
    <header className="studio-header" inert={Boolean(panel)}>
      <a className="studio-brand" href="#" aria-label={m.queueLabPlayground} onClick={event => { event.preventDefault(); setPanel(null); }}><Box size={23} /><span>QueueLab<span className="studio-brand-dot">.</span></span></a>
      <div className="studio-project"><h1><button className="studio-project-name" data-panel-opener="rename" aria-label={sx.renameProject} onClick={event => setPanel('rename', event.currentTarget)}>{project.name}</button></h1><span><span className="status-dot" />{m.syntheticExample}</span></div>
      <label className="studio-world-picker"><span>{m.chooseWorld}</span><select aria-label={m.chooseWorld} value={project.world} onChange={event => chooseWorld(event.currentTarget.value as World)}><option value="factory">{m.factory}</option><option value="festival">{m.festival}</option><option value="service">{m.service}</option></select></label>
      <div className="studio-command-actions">
        <button className="studio-icon-button" title={m.openProject} aria-label={m.openProject} onClick={event => openFiles('projects', event.currentTarget)}><FileUp size={17} /></button>
        <button className="studio-save" aria-label={m.saveProject} onClick={downloadProject}><ArrowDownToLine size={16} /><span>{m.saveProject}</span></button>
        <button className="studio-icon-button ease-search-opener" data-panel-opener="search" aria-label={sx.search} title={sx.search} onClick={event => setPanel('search', event.currentTarget)}><Search size={17} /></button><span className="studio-command-divider" />
        <button className="studio-button" aria-label={m.comparePlans} onClick={event => setPanel('compare', event.currentTarget)}><GitCompareArrows size={16} />{m.compareTool}</button>
        <button className="studio-button ease-scenario-opener" data-panel-opener="scenario" aria-label={sx.scenario} onClick={event => setPanel('scenario', event.currentTarget)}><span>{sx.scenario}</span><small>{draftSummary}</small></button><button className="studio-button studio-primary" disabled={sim.running || hasErrors || pendingEdits} onClick={event => { if (stale && baseline) void runAndCompare(event.currentTarget); else void compute(project); }}>{sim.running ? <LoaderCircle size={16} className="spin" /> : <Play size={15} fill="currentColor" />}{sim.running ? m.calculationProgress(Math.round(sim.progress * 100)) : stale && baseline ? m.runAndCompare : m.runSimulation}</button>
      </div>
    </header>
    <div className="studio-body" inert={Boolean(panel)}>
      <aside className="studio-rail" aria-label={m.studioTools}>
        <div className="studio-rail-group">
          <button data-build-opener="" className={buildTrayOpen ? 'is-active' : ''} aria-expanded={buildTrayOpen} aria-controls="process-blocks" aria-pressed={buildTrayOpen} onClick={event => { if (buildTrayOpen) closeBuildTray(); else showBuildTray(event.currentTarget); }}><Plus size={20} /><span>{m.build}</span></button>
          <button className={!moving && !linkFrom ? 'is-active' : ''} aria-pressed={!moving && !linkFrom} onClick={() => { setMoving(false); setLinkFrom(null); }}><MousePointer2 size={19} /><span>{m.selectTool}</span></button>
          <button className={moving && !linkFrom ? 'is-active' : ''} aria-label={m.moveStations} aria-pressed={moving && !linkFrom} disabled={hasErrors} onClick={() => { setMoving(true); setLinkFrom(null); }}><Move size={19} /><span>{m.moveTool}</span></button>
          <button className={linkFrom ? 'is-active' : ''} aria-label={m.connectSelectedStep} aria-pressed={Boolean(linkFrom)} disabled={hasErrors || !selectedStep || !('next' in selectedStep)} onClick={() => { setBuildTrayOpen(false); setMoving(false); setLinkFrom(linkFrom ? null : selected); }}><Link2 size={19} /><span>{m.connectTool}</span></button>
        </div>
        <div className="studio-rail-group">
          <button data-panel-opener="insights" onClick={event => setPanel('insights', event.currentTarget)}><Activity size={19} /><span>{m.resultsTool}</span></button>
          <button data-panel-opener="compare" onClick={event => setPanel('compare', event.currentTarget)}><GitCompareArrows size={19} /><span>{m.compareTool}</span></button>
          <button data-panel-opener="data" onClick={event => openFiles('projects', event.currentTarget)}><ArrowDownToLine size={19} /><span>{m.filesTool}</span></button>
        </div>
        <div className="studio-rail-group studio-rail-bottom"><button aria-label={sx.steps} className={objectDetailsOpen && inspectorTab === 'steps' ? 'is-active' : ''} onClick={openStepList}><List size={19} /><span>{sx.steps}</span></button><button data-panel-opener="view" aria-label={sx.view} onClick={event => setPanel('view', event.currentTarget)}><Layers3 size={19} /><span>{sx.view}</span></button>
          <button className={objectDetailsOpen && inspectorTab === 'object' ? 'is-active' : ''} aria-expanded={objectDetailsOpen && inspectorTab === 'object'} onClick={event => { objectDetailsOrigin.current = event.currentTarget; if (objectDetailsOpen && inspectorTab === 'object' && !matchMedia('(max-width:740px)').matches) closeObjectDetails(); else { setInspectorTab('object'); setObjectDetailsOpen(true); revealNarrowSection('#object-properties', '[data-object-details-close]'); } }}><List size={19} /><span>{m.properties}</span></button>
          <button className={objectDetailsOpen && inspectorTab === 'tools' ? 'is-active' : ''} onClick={openTools}><Layers3 size={19} /><span>{m.toolsTool}</span></button>
          <button title={m.fitWorld} aria-label={m.fitWorld} onClick={() => document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:fit'))}><Focus size={19} /><span>{m.fitWorld}</span></button>
        </div>
      </aside>
      <main className="main-shell studio-main">
        <CalculationStatus announcement={calculationStatus.announcement} active={!panel && calculationStatus.announcement.surface === panelGeneration.current} label={m.calculationStatus} />
        {pendingEdits && <p className="ease-pending-banner" role="status">{sx.pendingEdits}</p>}
        {revisionExhausted && <div className="studio-selection-summary" role="status"><span>{m.revisionLimitReached}</span><button onClick={() => acceptProject(duplicateProject(live.current.project))}>{m.duplicateToEdit}</button></div>}
        <section className="world-workspace studio-world" aria-label={m.simulationWorkspace}>
          <div className={`studio-context ${hasErrors ? 'is-error' : ''}`}>
            <div className="studio-context-copy"><span className="studio-status"><span className={sim.running || stale || hasErrors ? 'status-dot orange' : 'status-dot'} />{sim.running ? m.calculatingStatus : hasErrors ? m.modelIssue : stale ? m.currentDraft : m.playground}</span><span className="studio-context-hint">{hasErrors ? <>{errorNode && <b>{errorNode.label}: </b>}{firstError?.message}</> : linkFrom ? m.connectionHint(selectedStep?.label ?? m.step) : latestAttempt ? attemptMatchesDraft ? m.incompleteAttemptStatus(latestAttempt.status) : m.anIncompleteAttemptBelongsToAnEarlierDraft : stale ? `${m.changedPlanHint} ${staleChanges.slice(0, 2).map(change => change.label).join('; ')}` : shownResult && !shownResult.trace.complete ? canReplay ? m.replayCoverageCaption(clock(replayUntil)) : m.noDetailedReplayWasRetainedFullRunNumericalResults : frame.aggregated ? m.representativeActors(frame.actors.length, worldInfo.unit, frame.inSystem) : selectedStep ? m.selectedObjectHint(selectedStep.label) : m.workspaceHint}</span></div>
            {hasErrors ? <button onClick={event => { if (errorNode) setSelected(errorNode.id); setPanel('model', event.currentTarget); }}>{m.repairModel}<ArrowRight size={13} /></button> : latestAttempt ? <><button onClick={event => openFiles('reports', event.currentTarget)}>{m.reviewIncompleteRun}<ArrowRight size={13} /></button><button onClick={event => setPanel('scenario', event.currentTarget)}>{sx.editSettings}</button></> : null}
            <div className="studio-edit-history"><button aria-label={undoAction ? m.undoLabel(undoAction.label) : m.undo} title={undoAction ? m.undoTitle(undoAction.label) : m.undo} disabled={!undoAction || revisionExhausted} onClick={undo}><Undo2 size={15} /><kbd>{/Mac/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z'}</kbd></button><button aria-label={redoAction ? m.redoLabel(redoAction.label) : m.redo} title={redoAction ? m.redoTitle(redoAction.label) : m.redo} disabled={!redoAction || revisionExhausted} onClick={redo}><Redo2 size={15} /><kbd>{/Mac/.test(navigator.platform) ? '⇧⌘Z' : 'Ctrl+Y'}</kbd></button></div>
          </div>
          {selection.ids.length > 1 && <div className="studio-selection-summary"><span>{m.selectionSummary(selection.ids.length, selectedStep?.label ?? m.step)}</span><button onClick={event => setPanel('model', event.currentTarget)}>{m.moveOrEditSelection}</button><button onClick={() => setSelected(null)}>{m.clearSelection}</button></div>}
          {linkFrom && selectedStep && <div className="ease-connect-review"><ConnectionPicker project={project} node={project.model.nodes.find(node => node.id === linkFrom) ?? selectedStep} onChange={(next,label) => { edit(next,label); setLinkFrom(null); setConnectionPreview(null); }} onPreview={to => setConnectionPreview(previous => to ? { owner: 'tool', from: linkFrom, to } : previous?.owner === 'tool' ? null : previous)} /></div>}
          <div className="scene-area studio-canvas">
            <Suspense fallback={<div className="scene-fallback" role="status"><p>{m.buildingYourLittleWorld}</p></div>}><WorldScene playing={playing} playbackSpeed={speed} replayUntil={replayUntil} runKey={shownResult?.id} seekEpoch={visualSeekEpoch} result={shownResult} onMoveStart={() => setPlaying(false)} project={visualProject} quality={quality} frame={frame} selected={selected} selectedIds={selection.ids} reducedMotion={reducedMotion} moving={moving && !hasErrors && !revisionExhausted} editable={!hasErrors && !revisionExhausted} flow={sceneFlow} onSelect={selectFromWorld} onMove={moveSelected} onCapacityChange={changeCapacity} onEditNode={editSceneNode} /></Suspense>
          </div>
          <div className="studio-control-deck">
            <div className="studio-replay-row"><span className="studio-replay-label">{m.replayLabel}</span><div className="playback-bar"><button className="icon-button" aria-label={m.restartReplay} onClick={() => { setVisualSeekEpoch(value => value + 1); setTime(0); }} disabled={!canReplay}><SkipBack size={16} /></button><button className="play-toggle" aria-label={playing ? m.pauseReplay : m.playReplay} aria-keyshortcuts="Space" title={rx.replayShortcut} disabled={!canReplay} onClick={() => { manualClock.current = false; if (time >= replayUntil) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><kbd className="ease-replay-shortcut">{rx.replayShortcut}</kbd><span className="playback-time">{clock(shownResult ? frame.time : 0)}</span><input aria-label={m.replayTime} type="range" min="0" max={shownResult ? replayUntil : Number.isFinite(project.model.horizon) ? project.model.horizon : 1} step="any" value={shownResult ? frame.time : 0} disabled={!canReplay} onChange={e => { setVisualSeekEpoch(value => value + 1); setPlaying(false); setTime(replayTimeFromRange(e.currentTarget, replayUntil)); }} /><span className="playback-end">{clock(shownResult ? replayUntil : project.model.horizon)}</span><select aria-label={m.replaySpeed} value={speed} onChange={e => setSpeed(+e.target.value)}><option value="15">15×</option><option value="30">30×</option><option value="60">60×</option><option value="120">120×</option></select>{canReplay && <ReplayJump until={replayUntil} runKey={shownResult?.id} onSeek={value => { setVisualSeekEpoch(epoch => epoch + 1); setPlaying(false); setTime(value); }} />}{canReplay && <details className="studio-replay-details" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label={m.replayCounts}>{m.replayDetails}</summary><div><strong>{m.replayObservationTime(clock(frame.time))}</strong><dl><div><dt>{m.arrivedInReplay}</dt><dd>{number(frame.arrivals)}</dd></div><div><dt>{m.completed}</dt><dd>{number(frame.completed)}</dd></div><div><dt>{m.inProgress}</dt><dd>{number(frame.inSystem)}</dd></div><div><dt>{m.leftInReplay}</dt><dd>{number(frame.abandoned)}</dd></div></dl><p>{m.replayCountsScope}</p></div></details>}</div></div>
            <div className="metrics-strip"><div><span className="metric-label"><span className="tiny-square green" />{m.completedByEnd}</span><strong>{shownResult ? number(shownResult.summary.completed) : '—'}<small>{worldInfo.unit}</small></strong><span className="metric-foot">{shownResult ? m.fullRunDuration(wait(shownResult.model.horizon)) : m.runToSeeResults}</span></div><div><span className="metric-label"><span className="tiny-square amber" />{m.unfinishedByEnd}</span><strong>{shownResult ? number(shownResult.summary.inSystem) : '—'}<small>{worldInfo.unit}</small></strong><span className="metric-foot">{m.waitingOrWorkingAtEnd}</span></div><div><span className="metric-label"><span className="tiny-square orange" />{m.averageWait}</span><strong>{shownResult?.summary.waitSampleSize ? wait(shownResult.summary.meanWait) : '—'}</strong><span className="metric-foot">{m.completedJobsFullRun}</span></div><div><span className="metric-label"><span className="tiny-square grey" />{m.resourceCost}</span><strong>{shownResult ? money(shownResult.summary.cost, shownResult.model.currency) : '—'}</strong><span className="metric-foot">{m.runCurrency(project.model.currency)}</span></div></div>
          </div>
          <div className="studio-flow-disclosure"><FlowGuide nodes={flowNodes} walk={flowWalk} shared={sharedConnections} open={flowOpen} cursor={flowCursor}
            unavailable={hasErrors ? flowGuideMessages.unavailableDraft : linkFrom ? flowGuideMessages.unavailableTool : undefined} suspended={flowSuspended}
            onOpen={() => { setMoving(false); setFlowState({ key: flowKey, open: true, cursor: flowState.key === flowKey ? flowCursor : 0 }); }}
            onClose={() => setFlowState(state => ({ ...state, open: false }))}
            onCursor={cursor => setFlowState({ key: flowKey, open: true, cursor })} onShow={showFlowConnection} /></div>
        </section>
        {buildTrayOpen && <BuildTray world={project.world} serviceCount={serviceNodes(project).length} insertionLabel={insertionAnchor(project)?.label} insertionId={insertionAnchor(project)?.id} followingLabel={project.model.nodes.find(node => node.id === insertionAnchor(project)?.next)?.label} insertionOptions={project.model.nodes.filter(node => 'next' in node).map(node => ({ id: node.id, label: node.label }))} onInsertionChange={id => setSelected(id)} disabled={hasErrors || revisionExhausted || sim.running || project.model.nodes.length >= 100} disabledReason={hasErrors ? m.repairYourModelFirst : revisionExhausted ? m.revisionLimitReached : sim.running ? m.addingWhileRunning : project.model.nodes.length >= 100 ? m.stepLimitReached : undefined} onAdd={addProcess} onClose={closeBuildTray} />}
        <footer className="workspace-footer"><span title={sx.storageScope(window.location.origin)}><span className="status-dot" />{storageError ? m.localSaveFailedDownloadABackup : !storageReady ? m.openingLocalProject : issues.some(i => i.severity === 'error') ? m.draftHasIssuesRepairBeforeSaving : localRevision === project.revision ? m.savedInThisBrowser : m.savingLocally}{backupRequestedRevision === project.revision ? m.backupRequestedVerifyFile : ''}<small className="ease-storage-origin">{window.location.host}</small>{retainedDrafts.length > 0 && <button onClick={event => setPanel('data', event.currentTarget)}>{m.retainedDraftRecovery(retainedDrafts.length)}</button>}</span><span>{m.seedLabel(Number.isFinite(project.model.seed) ? project.model.seed : m.check)}<span className="footer-separator" />{source?.kind === 'source' ? m.variableDemand : m.customModel}<span className="footer-separator" /><button onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? m.reducedMotionOn : m.motionOn}</button></span></footer>
      </main>
      {objectDetailsOpen && <aside id="object-properties" className="inspector studio-inspector" aria-label={inspectorTab === 'tools' ? m.studioTools : m.stationInspector}>
        <div className="studio-inspector-tabs"><button className={inspectorTab === 'steps' ? 'selected' : ''} onClick={() => setInspectorTab('steps')}>{sx.steps}</button><button className={inspectorTab === 'object' ? 'selected' : ''} onClick={() => setInspectorTab('object')}>{m.properties}</button><button className={inspectorTab === 'tools' ? 'selected' : ''} onClick={() => setInspectorTab('tools')}>{m.toolsTool}</button><button className="studio-inspector-close" data-object-details-close="" aria-label={m.closeObjectDetails} onClick={closeObjectDetails}><X size={16} /></button></div>
        {inspectorTab === 'tools' ? <div className="studio-tool-list"><h2>{m.processTools}</h2><p>{m.everyWorldIsASmallEditableProcessSimulationJobs}</p><button data-panel-opener="model" onClick={event => setPanel('model', event.currentTarget)}><List size={17} /><span>{m.processEditor}</span><ChevronRight size={14} /></button><button data-panel-opener="experiments" onClick={event => setPanel('experiments', event.currentTarget)}><FlaskConical size={17} /><span>{m.experiments}</span><ChevronRight size={14} /></button><button data-panel-opener="budget" onClick={event => setPanel('budget', event.currentTarget)}><ShieldCheck size={17} /><span>{m.runLimits}</span><ChevronRight size={14} /></button><button data-panel-opener="history" onClick={event => setPanel('history', event.currentTarget)}><History size={17} /><span>{m.actionHistory}</span><ChevronRight size={14} /></button><button data-panel-opener="worlds" onClick={event => setPanel('worlds', event.currentTarget)}><Globe2 size={17} /><span>{m.exploreWorlds}</span><ChevronRight size={14} /></button><button data-panel-opener="help" onClick={event => setPanel('help', event.currentTarget)}><CircleHelp size={17} /><span>{m.aLittleGuidance}</span><ChevronRight size={14} /></button><div className="studio-tool-note"><ShieldCheck size={15} />{m.yourWorldStaysOnYourDevice}</div></div> : inspectorTab === 'steps' ? <ProcessList project={project} selectedId={selected} selectedIds={selection.ids} onSelect={(id, intent) => { if (intent === 'toggle') setSelected(id, intent); else if (id) editSceneNode(id); }} /> : selectedStep ? <fieldset className="studio-properties" aria-label={m.properties} disabled={revisionExhausted}>{!('next' in selectedStep) && <p className="ease-help">{processEaseMessages.noOutgoing}</p>}<QuickProperties key={`${project.id}:${selectedStep.id}`} project={project} node={selectedStep} result={shownResult} onChange={edit} onAdvanced={() => setPanel('model')} onPreviewConnection={to => { if (to) setBuildTrayOpen(false); setConnectionPreview(previous => to ? { owner: 'quick', from: selectedStep.id, to } : previous?.owner === 'quick' ? null : previous); }} /></fieldset> : <div className="studio-empty-properties"><MousePointer2 size={26} /><h2>{m.properties}</h2><p>{m.selectionEmpty}</p><button className="studio-button" onClick={event => showBuildTray(event.currentTarget)}><Plus size={15} />{m.processBlocks}</button></div>}
      </aside>}
    </div>
    {storageError && <button className="storage-warning" onClick={event => { setToast(storageError); setPanel('data', event.currentTarget); }}>{m.localSaveNeedsAttentionDownloadABackup}</button>}
    {(toast || sim.error) && <div role="status" className="toast"><span>{toast ?? sim.error}</span><button aria-label={m.dismissNotification} onClick={() => { setToast(null); sim.clearError(); }}><X size={15} /></button></div>}
    {sim.running && <button className="cancel-run" disabled={sim.cancelling} onClick={cancelCalculation}>{sim.cancelling ? m.stoppingCalculation : m.cancelCalculation}<X size={14} /></button>}
    {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className={`modal ${panel === 'model' || panel === 'data' || panel === 'experiments' || panel === 'insights' ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">{m.modalEyebrow(m.modalSection(panel))}</span><h2 id="modal-title">{panelTitle(panel)}</h2></div><button className="icon-button" aria-label={m.closeDialog} onClick={() => setPanel(null)}><X size={20} /></button></div>
      <div key={panel} className="modal-body">
      <CalculationStatus announcement={calculationStatus.announcement} active={calculationStatus.announcement.surface === panelGeneration.current} label={m.calculationStatus} />
      {panel === 'scenario' && <ScenarioSettings project={project} onChange={edit} onBudget={() => setPanel('budget')} />}
      {panel === 'rename' && <ProjectRename key={project.id} project={project} onChange={edit} onDone={() => setPanel(null)} />}
      {panel === 'search' && <CommandSearch onCommand={navigateCommand} />}
      {panel === 'guide' && <QuickGuide index={guideIndex} onIndexChange={setGuideIndex} onTarget={guideTarget} onClose={() => setPanel(null)} />}
      {panel === 'view' && <div className="ease-view"><p>{sx.viewScope}</p><label className="ease-select-label">{sx.detail}<select value={quality} onChange={event => setQuality(event.currentTarget.value as 'high' | 'low')}><option value="high">{sx.high}</option><option value="low">{sx.low}</option></select></label><label className="ease-checkbox"><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.currentTarget.checked)} />{sx.reducedMotion}</label><div className="ease-actions"><button className="ease-button" onClick={() => { setPanel(null); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:focus')); }}>{rx.focus}<kbd>G</kbd></button><button className="ease-button" onClick={() => { setPanel(null); requestAnimationFrame(() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.querySelector<HTMLElement>('.world-workspace')?.requestFullscreen?.().catch(() => setToast(m.fullScreenIsUnavailableInThisBrowser)); }); }}>{rx.fullscreen}<kbd>F</kbd></button></div><p>{sx.shortcuts}</p><p>{sx.inputHelp}</p></div>}
      {panel === 'history' && <ActionHistory history={history} revision={project.revision} onUndo={undo} onRedo={redo} />}
      {panel === 'budget' && (normalBudget ? <CalculationBudget budget={normalBudget} /> : <p className="modal-intro">{m.repairYourModelToSeeTheWorkloadEstimateThe}</p>)}
      {panel === 'worlds' && <div className="world-gallery"><button className="ease-new-model" onClick={createProcess}><Plus size={28} /><h3>{sx.newModel}</h3><p>{sx.newModelScope}</p><span className="gallery-foot">{sx.startFlow}</span></button>{(['factory', 'festival', 'service'] as const).map(w => <button key={w} onClick={() => chooseWorld(w)}><span className={`world-mini ${w}`}><img src={`/previews/${w}.png`} alt="" loading="lazy" width="640" height="360" /></span><h3>{WORLD_INFO[w].name}<ArrowUpRight size={18} /></h3><p>{WORLD_INFO[w].subtitle}</p><span className="gallery-foot">{m.syntheticModelOpenEdit}</span></button>)}</div>}
      {panel === 'compare' && <><p className="modal-intro">{m.keepYourOriginalPlanChangeAStationRunIt}</p>
        {singlePaired && baseline && shownResult && <section className="comparison-summary" aria-label={m.whatChanged}>
          <span className="eyebrow">{m.whatChanged}</span>
          <h3>{m.completedOutcome(shownResult.summary.completed - baseline.summary.completed, worldInfo.unit)}</h3>
          <p>{shownResult.summary.waitSampleSize && baseline.summary.waitSampleSize ? m.waitingOutcome(shownResult.summary.meanWait - baseline.summary.meanWait, wait(Math.abs(shownResult.summary.meanWait - baseline.summary.meanWait))) : m.noComparableWaitSamples} {shownResult.model.currency === baseline.model.currency ? m.costOutcome(shownResult.summary.cost - baseline.summary.cost, money(Math.abs(shownResult.summary.cost - baseline.summary.cost), shownResult.model.currency)) : m.differentCostCurrencies}</p>
          <small>{m.compareScope}</small>
        </section>}
        {stale && <button className="primary-button comparison-run" disabled={hasErrors || sim.running} onClick={event => void runAndCompare(event.currentTarget)}>{sim.running ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{m.runAndCompare}</button>}<InputDifferences before={baseline?.model ?? project.model} after={shownResult?.model ?? project.model} /><div className="comparison-table"><div className="comparison-row table-header"><span>{m.fullRunHeading}</span><span>{m.baseline}<strong className="ease-plan-name">{baseline ? runDisplayNames.current.get(baseline) ?? baseline.model.name : '—'}</strong>{baseline && <small>{ease.duration(baseline.model.horizon)} · {baseline.id.slice(0,8)}</small>}</span><span>{m.currentPlan}<strong className="ease-plan-name">{shownResult ? runDisplayNames.current.get(shownResult) ?? shownResult.model.name : project.name}</strong><small>{ease.duration(shownResult?.model.horizon ?? project.model.horizon)}{shownResult ? ` · ${shownResult.id.slice(0,8)}` : ''}</small></span></div>{[[m.completed, baseline?.summary.completed, shownResult?.summary.completed, ''], [m.averageWait, baseline?.summary.waitSampleSize ? baseline.summary.meanWait : null, shownResult?.summary.waitSampleSize ? shownResult.summary.meanWait : null, 'wait'], [m.label95thPercentileWait, baseline?.summary.waitSampleSize ? baseline.summary.p95Wait : null, shownResult?.summary.waitSampleSize ? shownResult.summary.p95Wait : null, 'wait'], [m.resourceCost, baseline?.summary.cost, shownResult?.summary.cost, 'cost']].map(([label, a, b, kind]) => <div className="comparison-row" key={String(label)}><span>{label}</span><strong>{typeof a === 'number' ? kind === 'wait' ? wait(a) : kind === 'cost' ? money(a, baseline?.model.currency ?? project.model.currency) : number(a) : '—'}</strong><strong>{typeof b === 'number' ? kind === 'wait' ? wait(b) : kind === 'cost' ? money(b, shownResult?.model.currency ?? project.model.currency) : number(b) : shownResult ? '—' : m.runYourPlan}</strong></div>)}</div><div className="comparison-note"><ShieldCheck size={16} />{singlePaired ? m.sameExternalDemandSeed(shownResult?.seed) : !shownResult ? m.runTheCurrentDraftToCompareItWithThe : !singleCoupling ? m.matchingScopeWasNotRecordedInThisOlderRun : m.demandSeedOrMeasurementPoliciesDifferTheseAreSeparate}{m.samplingUncertaintyNote}</div>{baseline && shownResult && singleCoupling && <details className="comparison-disclosure"><summary>{m.comparisonDetails}</summary><CouplingDetails manifest={singleCoupling} baseline={baseline} candidate={shownResult} /></details>}<button className="secondary-button" disabled={!shownResult} onClick={() => { if (shownResult) { setBaseline(shownResult); setToast(m.currentRunIsNowYourBaseline); } }}><Copy size={16} />{m.useCurrentRunAsBaseline}</button><SavedScenarios project={project} baseline={baseline} busy={sim.running} onChange={edit} onBaseline={async snapshot => { const generation = ++requestGeneration.current; calculationStatus.controller.invalidate(panelGeneration.current); setLatestAttempt(null); const computed = await sim.run(snapshot.model); if (generation !== requestGeneration.current) throw new Error(m.supersededByANewerRun); if (computed.status !== 'completed') { setLatestAttempt(computed); throw new Error(computed.reason ?? m.baselineRunDidNotComplete); } setLatestAttempt(null); runDisplayNames.current.set(computed, snapshot.name); setBaseline(computed); }} /><button className="secondary-button" disabled={!baseline || !shownResult} onClick={event => { setExperimentContext({ project: structuredClone(live.current.project), baseline: baseline ? structuredClone(baseline) : null }); setPanel('experiments', event.currentTarget, true); }}>{sx.repeatComparison}</button></>}
      {panel === 'model' && <ModelEditor project={project} onChange={edit} selectedId={selected} selectedIds={selection.ids} onSelect={setSelected} onMove={moveSelected} />}
      {panel === 'insights' && <RunInsights result={result} draft={project.model} onReport={() => openFiles('reports')} onExperiments={() => setPanel('experiments')} onSelectNode={id => { if (!project.model.nodes.some(node => node.id === id)) return; setPanel(null); editSceneNode(id); }} />}
      {panel === 'experiments' && <ExperimentsPanel project={experimentContext?.project ?? project} baseline={experimentContext?.baseline ?? baseline} initialKind={experimentContext ? 'paired' : undefined} draftPending={pendingEdits} onApplyCapacity={(poolId, capacity) => { if (!canEditProject()) return; if (experimentContext && (project.id !== experimentContext.project.id || modelHash(project.model) !== modelHash(experimentContext.project.model) || project.model.seed !== experimentContext.project.model.seed)) { setToast(sx.earlierExperiment); return; } edit(mutateProject(project, p => { const pool = p.model.resources.find(r => r.id === poolId); if (pool) pool.capacity = capacity; })); setPanel(null); setToast(m.appliedTheVerifiedPoolCapacityToYourDraftRun); }} />}
      {panel === 'data' && <DataTools initialTab={dataInitialTab} project={project} result={result} latestAttempt={latestAttempt} onImport={acceptProject} onSave={persistProject} retainedDrafts={retainedDrafts} onRestoreDraft={restoreDraft} onRetryDraft={token => { const draft = retained.current.find(item => item.token === token); if (draft) void persistProject(draft.project, false, draft.context).catch(() => {}); }} onRemoveDraft={token => updateRetained(retained.current.filter(draft => draft.token !== token))} />}
      {panel === 'help' && <div className="help-content"><button className="secondary-button" onClick={() => setPanel('guide')}>{sx.guide}</button><dl className="ease-glossary">{sx.glossary.map(([term,description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl><p>{m.everyWorldIsASmallEditableProcessSimulationJobs}</p><ol><li><b>{m.watchTheQueue}</b>{m.selectAStationToInspectItsCapacityAndProcessing}</li><li><b>{m.tryAnotherPlan}</b>{m.makeAChangeThenRunTheModelTheOriginal}</li><li><b>{m.compareTheTradeOff}</b>{m.checkCompletedWorkWaitingAndResourceCostTogether}</li><li><b>{m.keepYourWorld}</b>{m.downloadTheProjectFileAndReopenItLater}</li></ol><p className="quiet-copy">{m.withTheWorldFocusedSpaceToPlayOrPause}</p><p className="quiet-copy">{m.theEngineUsesAReproducibleSeedTheVisualLayout}</p><button className="secondary-button" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>{m.qualitySetting(quality === 'high' ? m.detailed : m.lowPower)}</button><button className="secondary-button" onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? <Check size={15} /> : <Pause size={15} />}{m.motionSetting(reducedMotion)}</button></div>}
      </div>
    </section></div>}
  </div></NumericDraftProvider>;
}
