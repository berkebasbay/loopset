import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Check, ChevronRight, CircleHelp, Copy, Factory, FileUp, FlaskConical, Focus, GitCompareArrows, Globe2, Layers3, Leaf, Link2, List, LoaderCircle, Minus, MousePointer2, Move, Pause, Play, Plus, Redo2, Settings2, ShieldCheck, SkipBack, Sparkles, Undo2, Users, X } from 'lucide-react';
import { createExample, WORLD_INFO } from './examples';
import { meanDuration, mutateProject, serviceNodes, setCapacity } from './model/commands';
import { modelHash } from './model/identity';
import { validateProject } from './model/validate';
import type { Project, RunResult, ServiceNode, World } from './model/types';
import { frameAt } from './playback';
const WorldScene = lazy(() => import('./scene/WorldScene').then(module => ({ default: module.WorldScene })));
import { useSimulation } from './worker/useSimulation';
import { ModelEditor } from './features/ModelEditor';
import { connectNext } from './features/modelEdits';
import { DataTools } from './features/DataTools';
import { ExperimentsPanel } from './lab/ExperimentsPanel';
import { SavedScenarios } from './lab/SavedScenarios';
import { RunInsights } from './lab/RunInsights';
import { loadLastProject, saveProject } from './storage/projectStore';
import { openProjectJSON, serializeProject } from './storage/projectFile';
import { readLocalText } from './storage/csv';

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

export default function App() {
  const [project, setProject] = useState<Project>(() => createExample('factory'));
  const [history, setHistory] = useState<Project[]>([]); const [future, setFuture] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>('station-c');
  const [result, setResult] = useState<RunResult | null>(null); const [baseline, setBaseline] = useState<RunResult | null>(null);
  const [time, setTime] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(60);
  const [panel, setPanel] = useState<'worlds' | 'model' | 'compare' | 'data' | 'experiments' | 'insights' | 'help' | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [moving, setMoving] = useState(false); const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [toast, setToast] = useState<string | null>(null); const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [localRevision, setLocalRevision] = useState<number | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const sim = useSimulation(); const initialized = useRef(false); const requestGeneration = useRef(0); const manualClock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null); const live = useRef({ project, result, time, playing, speed, selected, running: sim.running, canReplay: false });

  const issues = useMemo(() => validateProject(project), [project]);
  const hasErrors = issues.some(i => i.severity === 'error');
  const lastValidProject = useRef(project);
  if (!hasErrors) lastValidProject.current = project;
  const visualProject = lastValidProject.current;
  const currentHash = useMemo(() => modelHash(project.model), [project.model]);
  const stale = Boolean(result && (result.modelHash !== currentHash || result.seed !== project.model.seed));
  const shownResult = stale || hasErrors ? null : result;
  const canReplay = Boolean(shownResult && (shownResult.trace.complete || shownResult.trace.until > 0));
  live.current = { project, result, time, playing, speed, selected, running: sim.running, canReplay };
  const singlePaired = Boolean(baseline && shownResult && baseline.demandHash === shownResult.demandHash && baseline.model.warmup === shownResult.model.warmup && baseline.model.slaSeconds === shownResult.model.slaSeconds && baseline.model.currency === shownResult.model.currency);
  const frame = useMemo(() => frameAt(visualProject, shownResult, time), [visualProject, shownResult, time]);
  const station = project.model.nodes.find((n): n is ServiceNode => n.id === selected && n.kind === 'service');
  const stations = serviceNodes(project); const worldInfo = WORLD_INFO[project.world];
  const stationMetrics = shownResult?.stations.find(n => n.nodeId === selected);
  const source = project.model.nodes.find(n => n.kind === 'source');

  async function compute(p: Project, establishBaseline = false) {
    const generation = ++requestGeneration.current; setPlaying(false);
    try {
      const r = await sim.run(p.model);
      if (generation !== requestGeneration.current) return;
      if (r.status !== 'completed') { setToast(r.reason ?? `Run ${r.status}. No completed comparison was produced.`); return; }
      setResult(r); if (establishBaseline || !baseline) setBaseline(r);
      setTime(establishBaseline ? Math.min(p.model.horizon * .38, r.trace.until) : 0);
      setPlaying(establishBaseline); manualClock.current = false;
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
        if (saved && untouched) { setProject(saved); setLocalRevision(saved.revision); setSelected(serviceNodes(saved)[0]?.id ?? null); }
        setStorageReady(true); void compute(initial, true);
      }).catch(error => {
        if (!alive) return;
        setStorageError(error instanceof Error ? error.message : 'Browser storage is unavailable. Keep a downloaded backup.');
        setStorageReady(true); void compute(live.current.project, true);
      });
    }, 50);
    return () => { alive = false; clearTimeout(timer); initialized.current = false; };
  }, []);
  useEffect(() => {
    if (!storageReady || issues.some(i => i.severity === 'error')) return;
    const snapshot = project;
    const timer = setTimeout(() => {
      void saveProject(snapshot).then(ack => {
        if (live.current.project.id === ack.projectId && live.current.project.revision === ack.revision) { setLocalRevision(ack.revision); setStorageError(null); }
      }).catch(error => { if (live.current.project.id === snapshot.id) setStorageError(error instanceof Error ? error.message : 'Could not save locally. Download a backup.'); });
    }, 800);
    return () => clearTimeout(timer);
  }, [project, storageReady]);
  useEffect(() => {
    if (!playing) return;
    let handle = 0; let previous = performance.now();
    const tick = (now: number) => {
      handle = 0;
      if (document.hidden || manualClock.current) return;
      const elapsed = Math.min((now - previous) / 1000, .1); previous = now;
      const state = live.current;
      if (state.playing && state.result && !manualClock.current) {
        const end = state.result.trace.until;
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
      return JSON.stringify({ mode: panel ?? 'playground', revision: s.project.revision, world: s.project.world, selected: s.selected, running: s.running, playing: s.playing, time: s.time, speed: s.speed,
        coordinates: 'Illustrative world coordinates: x horizontal, z depth; layout does not model travel time.',
        frame: frameAt(s.project, valid, s.time), model: s.project.model.nodes.filter(n => n.kind === 'service').map(n => ({ id: n.id, label: n.label, servers: n.servers })),
        result: s.result ? { status: s.result.status, hash: s.result.modelHash, stale: !valid, summary: s.result.summary } : null });
    };
    window.advanceTime = ms => {
      manualClock.current = true; const s = live.current;
      if (s.playing && s.result) setTime(t => Math.min(s.result!.trace.until, t + ms / 1000 * s.speed));
    };
    return () => { delete window.render_game_to_text; delete window.advanceTime; };
  }, [panel]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (panel) { setPlaying(false); setLinkFrom(null); }
    if (panel) {
      const focusDialog = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[role=dialog] button')?.focus());
      if (document.fullscreenElement) void document.exitFullscreen().then(focusDialog); else focusDialog();
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && linkFrom && !panel) { event.preventDefault(); setLinkFrom(null); return; }
      if (event.key === 'Escape' && panel) { event.preventDefault(); setPanel(null); return; }
      if (event.key === 'Tab' && panel) {
        const elements = [...document.querySelectorAll<HTMLElement>('[role=dialog] button:not(:disabled),[role=dialog] input:not(:disabled),[role=dialog] select,[role=dialog] a[href],[role=dialog] textarea')].filter(e => e.offsetParent !== null);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (panel || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(event.target instanceof Element) || !event.target.closest('.world-workspace') || (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName))) return;
      if (event.code === 'Space' && live.current.canReplay && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); manualClock.current = false; setPlaying(p => !p); }
      if (event.key.toLowerCase() === 'g') { event.preventDefault(); document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:focus')); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (document.fullscreenElement) void document.exitFullscreen(); else void document.querySelector<HTMLElement>('.world-workspace')?.requestFullscreen?.().catch(() => setToast('Full screen is unavailable in this browser.')); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (panel && previous?.isConnected) previous.focus(); };
  }, [panel, linkFrom]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);

  function edit(next: Project) { setLinkFrom(null); next = { ...next, revision: project.revision + 1 }; setHistory(h => [...h.slice(-49), project]); setFuture([]); setProject({ ...next, revision: project.revision + 1 }); setPlaying(false); }
  function undo() { setLinkFrom(null); const previous = history.at(-1); if (!previous) return; setFuture(f => [project, ...f]); setHistory(h => h.slice(0, -1)); setProject({ ...previous, revision: project.revision + 1 }); setPlaying(false); }
  function redo() { setLinkFrom(null); const next = future[0]; if (!next) return; setHistory(h => [...h, project]); setFuture(f => f.slice(1)); setProject({ ...next, revision: project.revision + 1 }); setPlaying(false); }
  function acceptProject(next: Project) {
    setLinkFrom(null);
    if (next.id === project.id) edit(next);
    else { setProject(next); setHistory([]); setFuture([]); setResult(null); setBaseline(null); setSelected(serviceNodes(next)[0]?.id ?? null); setSavedRevision(null); setLocalRevision(null); void compute(next, true); }
  }
  function chooseWorld(world: World) {
    setLinkFrom(null);
    const next = createExample(world); setProject(next); setHistory([]); setFuture([]); setResult(null); setBaseline(null); setSelected('station-c'); setPanel(null); setSavedRevision(null); setLocalRevision(null); void compute(next, true);
  }
  function downloadProject() {
    try {
      const data = { ...project, savedAt: new Date().toISOString() };
      const url = URL.createObjectURL(new Blob([serializeProject(data)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${project.world}-queuelab.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSavedRevision(project.revision); setToast('Project file downloaded. Keep it to reopen your world.');
    } catch (e) { setToast(e instanceof Error ? e.message : 'Repair the draft before downloading a project.'); }
  }
  async function importProject(file: File | undefined) {
    setLinkFrom(null);
    if (!file) return;
    try {
      const next = openProjectJSON(await readLocalText(file));
      if (next.id === project.id) {
        const restored = { ...next, revision: project.revision + 1 }; edit(restored); void compute(restored, true);
      } else {
        setProject(next); setHistory([]); setFuture([]); setResult(null); setBaseline(null); setSelected(serviceNodes(next)[0]?.id ?? null); setLocalRevision(null); void compute(next, true);
      }
      setSavedRevision(null);
    } catch (e) { setToast(e instanceof Error ? e.message : 'Could not open this project.'); }
  }
  function updateDuration(seconds: number) {
    if (!station) return;
    edit(mutateProject(project, p => { const n = p.model.nodes.find(n => n.id === station.id); if (n?.kind === 'service') n.duration = { kind: 'constant', value: Math.max(1, seconds) }; }));
  }

  return <div className="app-shell">
    <aside className="sidebar" inert={Boolean(panel)}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPanel(null); }} aria-label="QueueLab playground"><span className="brand-mark"><Box size={24} strokeWidth={1.9} /></span>QueueLab<span className="brand-dot">.</span></a>
      <div className="sidebar-section-label">YOUR LITTLE LAB</div>
      <nav aria-label="Main navigation">
        <button className={!panel ? 'nav-item active' : 'nav-item'} onClick={() => setPanel(null)}><Layers3 size={18} />Playground<span className="nav-shortcut">01</span></button>
        <button className={panel === 'worlds' ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('worlds')}><Globe2 size={18} />Explore worlds</button>
        <button className={panel === 'model' ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('model')}><List size={18} />Model editor</button>
        <button className={panel === 'compare' ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('compare')}><GitCompareArrows size={18} />Compare plans</button>
        <button className={panel === 'insights' ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('insights')}><Activity size={18} />Run insights</button>
        <button className={panel === 'experiments' ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('experiments')}><FlaskConical size={18} />Experiments</button>
        <button className={panel === 'data' ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('data')}><ArrowDownToLine size={18} />Data & reports</button>
      </nav>
      <div className="sidebar-rule" /><div className="sidebar-section-label">IN THIS WORLD</div>
      <div className="process-list">{stations.map((n, i) => <button key={n.id} className={`process-item ${selected === n.id ? 'selected' : ''}`} onClick={() => { setSelected(n.id); setPanel(null); }}><span className="process-index">{String(i + 1).padStart(2, '0')}</span><span>{n.label}</span><span className="process-dot" /></button>)}</div>
      <button className="side-add" onClick={() => setPanel('model')}><Plus size={15} />Edit process</button>
      <div className="sidebar-bottom"><div className="local-note"><span className="status-dot" />Your world stays on your device<ShieldCheck size={15} /></div><button className="nav-item" onClick={() => setPanel('help')}><CircleHelp size={18} />A little guidance<ArrowUpRight size={15} /></button><div className="sidebar-foot">FREE & OPEN SOURCE <span>EARLY BUILD</span></div></div>
    </aside>
    <main className="main-shell" inert={Boolean(panel)}>
      <header className="topbar"><div className="breadcrumb">Playground<ChevronRight size={14} /><span>{project.name}</span><span className="synthetic-label">SYNTHETIC EXAMPLE</span></div><div className="top-actions"><button className="icon-button" title="Open project" aria-label="Open project" onClick={() => fileInput.current?.click()}><FileUp size={17} /></button><button className="text-button save-button" onClick={downloadProject}><ArrowDownToLine size={16} />Save project</button><span className="version-tag">LAB / 001</span></div></header>
      <div className="workspace-heading"><div><div className="eyebrow"><span />A PLAYGROUND FOR BETTER DECISIONS</div><h1>{project.name}<span className="title-period">.</span></h1><p>{worldInfo.subtitle}. What would you change?</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setPanel('compare')}><GitCompareArrows size={16} />Compare plans</button><button className="primary-button" disabled={sim.running || issues.some(i => i.severity === 'error')} onClick={() => void compute(project)}>{sim.running ? <LoaderCircle size={17} className="spin" /> : <Play size={16} fill="currentColor" />}{sim.running ? `${Math.round(sim.progress * 100)}% calculating` : 'Run simulation'}</button></div></div>
      <div className="workspace-body">
        <section className="world-workspace" aria-label="Simulation workspace">
          <div className="world-toolbar"><div className="world-tabs">{(['factory', 'festival', 'service'] as const).map(w => <button key={w} className={project.world === w ? 'selected' : ''} onClick={() => chooseWorld(w)}>{w === 'factory' ? <Factory size={14} /> : w === 'festival' ? <Users size={14} /> : <Leaf size={14} />}{w === 'factory' ? 'Factory' : w === 'festival' ? 'Festival' : 'Service'}</button>)}</div><div className="world-tools"><button className="icon-button" disabled={!history.length} aria-label="Undo" onClick={undo}><Undo2 size={16} /></button><button className="icon-button" disabled={!future.length} aria-label="Redo" onClick={redo}><Redo2 size={16} /></button><span className="tool-divider" /><button className={`icon-button ${linkFrom ? 'selected' : ''}`} aria-label="Connect selected step" aria-pressed={Boolean(linkFrom)} disabled={!project.model.nodes.some(n => n.id === selected && 'next' in n)} onClick={() => { setMoving(false); setLinkFrom(linkFrom ? null : selected); }}><Link2 size={16} /></button><button className={`icon-button ${moving ? 'selected' : ''}`} aria-label="Move stations" aria-pressed={moving} onClick={() => { setLinkFrom(null); setMoving(!moving); }}><Move size={16} /></button><button className="icon-button" aria-label="Focus selected station" disabled={!selected} onClick={() => document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:focus'))}><MousePointer2 size={16} /></button><button className="icon-button" aria-label="Fit world" onClick={() => document.querySelector('.world-scene')?.dispatchEvent(new Event('queuelab:fit'))}><Focus size={16} /></button></div></div>
          <div className="scene-area"><div className="scene-topline"><span className="live-label"><span className={sim.running ? 'status-dot orange' : 'status-dot'} />{sim.running ? 'CALCULATING' : stale ? 'DRAFT · RUN TO PREVIEW' : shownResult ? shownResult.trace.complete ? 'REPLAY' : 'LIMITED REPLAY' : 'YOUR MODEL'}</span><span className="scene-unit">{worldInfo.unit.toUpperCase()} / {Number.isFinite(project.model.horizon) ? `${Math.round(project.model.horizon / 60)} MIN` : 'CHECK MODEL'}</span></div>
            <Suspense fallback={<div className="scene-fallback" role="status"><p>Building your little world…</p></div>}><WorldScene project={visualProject} quality={quality} frame={frame} selected={selected} reducedMotion={reducedMotion} moving={moving} onSelect={id => { if (linkFrom) { try { edit(connectNext(project, linkFrom, id)); setToast('Connection updated. Run the changed plan to calculate its results.'); setLinkFrom(null); } catch (e) { setToast(e instanceof Error ? e.message : 'Choose a valid next step.'); } return; } setSelected(id); if (project.model.nodes.find(n => n.id === id)?.kind !== 'service') setPanel('model'); }} onMove={(id, x, z) => edit(mutateProject(project, p => { p.layout[id] = { x, z }; }))} /></Suspense>
            {(stale || hasErrors) && <div className="draft-banner"><Sparkles size={16} /><span>{hasErrors ? 'Your draft has issues to repair before running.' : 'Your plan has changed. Run it to see what happens.'}</span><button onClick={() => hasErrors ? setPanel('model') : void compute(project)}>{hasErrors ? 'Review model' : 'Run this plan'}<ArrowRight size={14} /></button></div>}
            <div className="scene-caption"><MousePointer2 size={13} />{linkFrom ? `Connect ${project.model.nodes.find(n => n.id === linkFrom)?.label ?? 'step'}: choose its next step. Escape cancels.` : shownResult && !shownResult.trace.complete ? `Replay coverage: 00:00–${clock(shownResult.trace.until)}. Full-run statistics are shown below.` : frame.aggregated ? `Showing ${frame.actors.length} representative ${worldInfo.unit} of ${frame.inSystem}. Queue counts remain exact.` : <>Click a station to explore<span />Drag to pan · scroll to zoom</>}</div>
            <div className="world-compass"><span>N</span><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4L24 25L16 20L8 25Z" fill="#9aaa94"/><path d="M16 4V20L8 25Z" fill="#496354"/></svg></div>
          </div>
          <div className="playback-bar"><button className="icon-button" aria-label="Restart replay" onClick={() => setTime(0)} disabled={!canReplay}><SkipBack size={16} /></button><button className="play-toggle" aria-label={playing ? 'Pause replay' : 'Play replay'} disabled={!canReplay} onClick={() => { manualClock.current = false; if (time >= (shownResult?.trace.until ?? 0)) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="playback-time">{clock(shownResult ? frame.time : 0)}</span><input aria-label="Replay time" type="range" min="0" max={shownResult ? shownResult.trace.until : Number.isFinite(project.model.horizon) ? project.model.horizon : 1} step="1" value={shownResult ? frame.time : 0} disabled={!canReplay} onChange={e => { setPlaying(false); setTime(+e.target.value); }} /><span className="playback-end">{clock(shownResult?.trace.until ?? project.model.horizon)}</span><select aria-label="Replay speed" value={speed} onChange={e => setSpeed(+e.target.value)}><option value="15">15×</option><option value="30">30×</option><option value="60">60×</option><option value="120">120×</option></select></div>
          <div className="metrics-strip"><div><span className="metric-label"><span className="tiny-square green" />{project.world === 'factory' ? 'Ready to ship' : 'Completed'}</span><strong>{number(frame.completed)}<small>{worldInfo.unit}</small></strong><span className="metric-foot">{canReplay ? `At ${clock(frame.time)} in the replay` : 'No replay observation'}</span></div><div><span className="metric-label"><span className="tiny-square amber" />In progress</span><strong>{number(frame.inSystem)}<small>{worldInfo.unit}</small></strong><span className="metric-foot">Waiting + being processed</span></div><div><span className="metric-label"><span className="tiny-square orange" />Average wait</span><strong>{shownResult?.summary.waitSampleSize ? wait(shownResult.summary.meanWait) : '—'}</strong><span className="metric-foot">Completed jobs · full run</span></div><div><span className="metric-label"><span className="tiny-square grey" />Resource cost</span><strong>{shownResult ? money(shownResult.summary.cost, shownResult.model.currency) : '—'}</strong><span className="metric-foot">Full run · {project.model.currency}</span></div></div>
        </section>
        <aside className="inspector" aria-label="Station inspector"><div className="inspector-eyebrow">SELECTED STATION<Settings2 size={15} /></div>{station ? <><div className="station-title"><span className="large-station-number">{String(stations.findIndex(n => n.id === station.id) + 1).padStart(2, '0')}</span><div><h2>{station.label}</h2><span>{project.world === 'factory' ? 'Processing station' : 'Service station'}</span></div></div><div className="inspector-divider" /><div className="field-heading"><label htmlFor="capacity">Parallel stations</label><span className="field-help" title="A dedicated resource pool is scaled with this quick control. Shared pools are managed in the model editor.">?</span></div><div className="stepper"><button aria-label="Remove one station" disabled={station.servers <= 1} onClick={() => edit(setCapacity(project, station.id, station.servers - 1))}><Minus size={15} /></button><output id="capacity">{Number.isFinite(station.servers) ? station.servers : '—'}</output><button aria-label="Add one station" disabled={station.servers >= 12} onClick={() => edit(setCapacity(project, station.id, station.servers + 1))}><Plus size={15} /></button></div><p className="field-description">{station.resources.some(req => project.model.nodes.filter(n => n.kind === 'service' && n.resources.some(r => r.poolId === req.poolId)).length > 1) ? 'This station shares a resource pool. Adjust the shared team in Model editor to change that limit.' : 'More capacity here may move the bottleneck elsewhere.'}</p><label className="input-label" htmlFor="process-time">Processing time</label><div className="input-with-unit"><input id="process-time" type="number" min="1" max="604800" value={Number.isFinite(meanDuration(station.duration)) ? Math.round(meanDuration(station.duration)) : ''} onChange={e => { if (e.target.value && +e.target.value > 0) updateDuration(+e.target.value); }} /><span>sec / {project.world === 'factory' ? 'item' : 'request'}</span></div><div className="distribution-note">{station.duration.kind === 'triangular' ? 'Variable · triangular distribution' : station.duration.kind === 'constant' ? 'Fixed processing time' : `${station.duration.kind} distribution`}</div><button className="subtle-link" onClick={() => setPanel('model')}>Advanced settings<ArrowUpRight size={13} /></button><div className="inspector-divider" /><div className="inspector-section-title">THIS RUN<span>{stale ? 'OUT OF DATE' : 'FULL RUN'}</span></div><dl className="station-stats"><div><dt>Finished here</dt><dd>{stationMetrics ? number(stationMetrics.finished) : '—'}</dd></div><div><dt>Avg. waiting time</dt><dd>{stationMetrics?.finished ? wait(stationMetrics.averageWait) : '—'}</dd></div><div><dt>Utilization</dt><dd>{stationMetrics?.utilization != null ? `${Math.round(stationMetrics.utilization * 100)}%` : '—'}</dd></div></dl><div className="inspector-tip"><FlaskConical size={19} /><p><b>A little experiment</b>Try one more station. Compare the same arrivals, then check both waiting time and cost.</p></div><button className="inspector-compare" onClick={() => setPanel('compare')}>Compare with baseline<ArrowRight size={15} /></button></> : <p>Select a station in the world or the list.</p>}<div className="inspector-bottom"><ShieldCheck size={13} />Layout is illustrative. Timing comes from your model.</div></aside>
      </div>
      <footer className="workspace-footer"><span><span className="status-dot" />{storageError ? 'Local save failed · download a backup' : !storageReady ? 'Opening local project…' : issues.some(i => i.severity === 'error') ? 'Draft has issues · repair before saving' : localRevision === project.revision ? 'Saved in this browser' : 'Saving locally…'}{savedRevision === project.revision ? ' · backup downloaded' : ''}</span><span>Seed {Number.isFinite(project.model.seed) ? project.model.seed : 'CHECK'}<span className="footer-separator" />{source?.kind === 'source' ? 'Variable demand' : 'Custom model'}<span className="footer-separator" /><button onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? 'Reduced motion on' : 'Motion on'}</button></span></footer>
    </main>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { void importProject(e.target.files?.[0]); e.target.value = ''; }} />
    {storageError && <button className="storage-warning" onClick={() => { setToast(storageError); setPanel('data'); }}>Local save needs attention — download a backup</button>}
    {(toast || sim.error) && <div role="status" className="toast"><span>{toast ?? sim.error}</span><button aria-label="Dismiss notification" onClick={() => { setToast(null); sim.clearError(); }}><X size={15} /></button></div>}
    {sim.running && <button className="cancel-run" disabled={sim.cancelling} onClick={sim.cancel}>{sim.cancelling ? 'Stopping calculation…' : 'Cancel calculation'}<X size={14} /></button>}
    {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className={`modal ${panel === 'model' || panel === 'data' || panel === 'experiments' || panel === 'insights' ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">QUEUELAB / {panel.toUpperCase()}</span><h2 id="modal-title">{panel === 'worlds' ? 'Choose your little world.' : panel === 'compare' ? 'A better plan starts here.' : panel === 'model' ? 'Inside your model.' : panel === 'data' ? 'Keep your work. Share your findings.' : panel === 'experiments' ? 'Run experiments.' : panel === 'insights' ? 'Your run, in detail.' : 'A little guidance.'}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setPanel(null)}><X size={20} /></button></div>
      {panel === 'worlds' && <div className="world-gallery">{(['factory', 'festival', 'service'] as const).map(w => <button key={w} onClick={() => chooseWorld(w)}><span className={`world-mini ${w}`}><img src={`/previews/${w}.jpg`} alt="" loading="lazy" width="640" height="360" /></span><h3>{WORLD_INFO[w].name}<ArrowUpRight size={18} /></h3><p>{WORLD_INFO[w].subtitle}</p><span className="gallery-foot">SYNTHETIC MODEL · OPEN & EDIT</span></button>)}</div>}
      {panel === 'compare' && <><p className="modal-intro">Keep your original plan. Change a station, run it, and compare the same modeled demand.</p><div className="comparison-table"><div className="comparison-row table-header"><span>FULL RUN</span><span>Baseline</span><span>Current plan</span></div>{[['Completed', baseline?.summary.completed, shownResult?.summary.completed, ''], ['Average wait', baseline?.summary.waitSampleSize ? baseline.summary.meanWait : null, shownResult?.summary.waitSampleSize ? shownResult.summary.meanWait : null, 'wait'], ['95th percentile wait', baseline?.summary.waitSampleSize ? baseline.summary.p95Wait : null, shownResult?.summary.waitSampleSize ? shownResult.summary.p95Wait : null, 'wait'], ['Resource cost', baseline?.summary.cost, shownResult?.summary.cost, 'cost']].map(([label, a, b, kind]) => <div className="comparison-row" key={String(label)}><span>{label}</span><strong>{typeof a === 'number' ? kind === 'wait' ? wait(a) : kind === 'cost' ? money(a, baseline?.model.currency ?? project.model.currency) : number(a) : '—'}</strong><strong>{typeof b === 'number' ? kind === 'wait' ? wait(b) : kind === 'cost' ? money(b, shownResult?.model.currency ?? project.model.currency) : number(b) : shownResult ? '—' : 'Run your plan'}</strong></div>)}</div><div className="comparison-note"><ShieldCheck size={16} />{singlePaired ? `Same external demand, seed ${shownResult?.seed}.` : 'Demand, seed or measurement policies differ. These are separate runs, not a paired comparison.'} Repeated experiments are required to assess sampling uncertainty.</div><button className="secondary-button" disabled={!shownResult} onClick={() => { if (shownResult) { setBaseline(shownResult); setToast('Current run is now your baseline.'); } }}><Copy size={16} />Use current run as baseline</button><SavedScenarios project={project} baseline={baseline} busy={sim.running} onChange={edit} onBaseline={async snapshot => { const generation = ++requestGeneration.current; const computed = await sim.run(snapshot.model); if (generation !== requestGeneration.current) throw new Error('Superseded by a newer run.'); if (computed.status !== 'completed') throw new Error(computed.reason ?? 'Baseline run did not complete.'); setBaseline(computed); }} /></>}
      {panel === 'model' && <ModelEditor project={project} onChange={edit} selectedId={selected} onSelect={setSelected} />}
      {panel === 'insights' && <RunInsights result={result} draft={project.model} onReport={() => setPanel('data')} onExperiments={() => setPanel('experiments')} />}
      {panel === 'experiments' && <ExperimentsPanel project={project} baseline={baseline} onApplyCapacity={(poolId, capacity) => { edit(mutateProject(project, p => { const pool = p.model.resources.find(r => r.id === poolId); if (pool) pool.capacity = capacity; })); setPanel(null); setToast('Applied the verified pool capacity to your draft. Run it to calculate results.'); }} />}
      {panel === 'data' && <DataTools project={project} result={result} onImport={acceptProject} />}
      {panel === 'help' && <div className="help-content"><p>Every world is a small, editable process simulation. Jobs arrive, wait for limited resources, move through stations and leave.</p><ol><li><b>Watch the queue.</b> Select a station to inspect its capacity and processing time.</li><li><b>Try another plan.</b> Make a change, then run the model. The original result stays as your baseline.</li><li><b>Compare the trade-off.</b> Check completed work, waiting and resource cost together.</li><li><b>Keep your world.</b> Download the project file and reopen it later.</li></ol><p className="quiet-copy">With the world focused: Space to play or pause · F for full screen · G to focus the selected station.</p><p className="quiet-copy">The engine uses a reproducible seed. The visual layout does not determine travel time or simulate physical collisions. These are synthetic examples, not validated forecasts of a real business.</p><button className="secondary-button" onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>3D quality: {quality === 'high' ? 'detailed' : 'low power'}</button><button className="secondary-button" onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? <Check size={15} /> : <Pause size={15} />}Reduced motion: {reducedMotion ? 'on' : 'off'}</button></div>}
    </section></div>}
  </div>;
}
