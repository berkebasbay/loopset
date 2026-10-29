import { useEffect, useRef } from 'react';
import { ArrowRight, Check, Compass, ChevronDown, LoaderCircle, X } from 'lucide-react';
import { assetURL } from '../assetUrl';
import { learningMessages as m } from '../ui/messages/learning';
import { learningStages, type LearningSession, type LearningStage } from './learning';
import type { RunResult } from '../model/types';
import './learning.css';

export function LearningIntro({ busy, blocked, error, onStart, onExplore, onReference }: {
  busy: boolean; blocked?: string; error?: string | null;
  onStart: () => void; onExplore: () => void; onReference: () => void;
}) {
  return <section className="learning-intro">
    <div className="learning-intro-visual"><img src={assetURL('/previews/templates/service.png')} alt="" /></div>
    <div className="learning-intro-copy"><h3>{m.welcome}</h3><p>{m.introduction}</p>
      <ol className="learning-overview">{m.welcomeSteps.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}</ol>
      <p className="learning-scope">{m.practiceScope}</p>
      {blocked && <p role="status" className="learning-feedback">{blocked}</p>}
      {error && <p role="alert" className="learning-error">{error}</p>}
      <div className="learning-intro-actions"><button type="button" className="learning-primary" disabled={busy || Boolean(blocked)} onClick={onStart}>{busy ? <LoaderCircle size={18} className="spin" /> : <Compass size={18} />}{busy ? m.starting : m.start}<ArrowRight size={17} /></button><button type="button" className="learning-secondary" onClick={onExplore}>{m.explore}</button></div>
      <button type="button" className="learning-text-button" onClick={onReference}>{m.reference}</button>
    </div>
  </section>;
}

interface CoachProps {
  session: LearningSession; stage: LearningStage; minimized: boolean; busy: boolean; busyLabel?: string; pending: boolean;
  comparisonOpen: boolean; saveOpen: boolean; baseline: RunResult | null; result: RunResult | null; error?: string | null;
  onAction: () => void; onMinimize: () => void; onLeave: () => void; onReturn: () => void; onFinishWithoutSave: () => void;
}
export function LearningCoach(props: CoachProps) {
  const { session, stage, minimized, busy, pending, comparisonOpen, saveOpen, baseline, result, error } = props;
  const resume = useRef<HTMLButtonElement>(null), toggle = useRef<HTMLButtonElement>(null), toggled = useRef(false);
  useEffect(() => { if (toggled.current) { toggled.current = false; (minimized ? resume.current : toggle.current)?.focus(); } }, [minimized]);
  const index = stage === 'complete' ? 4 : Math.max(0, learningStages.findIndex(item => item === stage));
  const caption = m.step(index + 1);
  const minimize = () => { toggled.current = true; props.onMinimize(); };
  if (minimized) return <aside className="learning-mini" aria-label={m.coach}><button ref={resume} type="button" onClick={minimize} data-learning-resume><Compass size={17} /><strong>{m.resume}</strong><span>{caption}</span><ArrowRight size={16} /></button></aside>;
  const content = stage === 'off-track' ? m.offTrack : stage === 'complete' ? null : m[stage];
  const action = stage === 'complete' ? m.continue : stage === 'review' && !comparisonOpen ? m.openComparison : stage === 'save' && saveOpen ? m.save.action : content!.action;
  const formatCost = (run: RunResult) => new Intl.NumberFormat('en', { style: 'currency', currency: run.model.currency, maximumFractionDigits: 0 }).format(run.summary.cost);
  return <aside className={`learning-coach ${stage === 'complete' ? 'learning-complete' : ''}`} aria-label={m.coach} data-learning-stage={stage}>
    <div className="learning-coach-top"><span><Compass size={15} />{m.coach}</span><div><button ref={toggle} type="button" aria-label={m.pause} onClick={minimize}><ChevronDown size={17} /></button><button type="button" aria-label={m.leave} onClick={props.onLeave}><X size={17} /></button></div></div>
    <ol className="learning-progress" aria-label={m.progress}>{learningStages.map((step, i) => <li key={step} aria-current={stage === step ? 'step' : undefined} className={i < index || stage === 'complete' ? 'is-done' : i === index ? 'is-current' : ''}><span>{i < index || stage === 'complete' ? <Check size={13} /> : i + 1}</span><span>{m.labels[step]}</span></li>)}</ol>
    <div className="learning-coach-main"><div><span className="learning-step-caption">{caption}</span><h3>{content?.title ?? m.completed}</h3><p id="learning-instruction" aria-live="polite">{content?.text ?? m.completedText}</p>
      {pending && stage !== 'complete' && <p className="learning-feedback" role="status">{m.applyField}</p>}
      {error && <p className="learning-error" role="alert">{error}</p>}
      {stage === 'complete' && <p className="learning-saved" role="status">{session.savedName ? <><Check size={16} />{m.saved(session.savedName)}</> : m.notSaved}</p>}
    </div><div className="learning-coach-actions"><button type="button" className="learning-primary" data-learning-action disabled={busy || stage === 'preparing' || (pending && ['run', 'review', 'save'].includes(stage))} onClick={props.onAction}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? props.busyLabel ?? m.running : action}{!busy && <ArrowRight size={16} />}</button>
      {stage === 'save' && <button type="button" className="learning-text-button" disabled={busy || pending} onClick={props.onFinishWithoutSave}>{m.finishWithoutSave}</button>}
      {session.returnProjectId && <button type="button" className="learning-text-button" disabled={busy || pending} onClick={props.onReturn}>{m.return}</button>}
    </div></div>
    {stage === 'complete' && baseline && result && <><dl className="learning-outcomes">{[
      [m.completedLabel, String(baseline.summary.completed), String(result.summary.completed)],
      [m.waitLabel, m.waitValue(baseline.summary.meanWait), m.waitValue(result.summary.meanWait)],
      [m.costLabel, formatCost(baseline), formatCost(result)],
    ].map(([label, before, after]) => <div key={label}><dt>{label}</dt><dd><span>{before}</span><ArrowRight size={18} /><strong>{after}</strong></dd></div>)}</dl><p className="learning-scope">{m.lessonScope}</p></>}
  </aside>;
}
