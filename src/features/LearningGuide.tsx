import { useRef, type ReactNode } from 'react';
import { ArrowRight, Check, Compass, ChevronDown, Clock3, LoaderCircle, Users, CircleCheck, X } from 'lucide-react';
import { assetURL } from '../assetUrl';
import { learningMessages as m } from '../ui/messages/learning';
import { learningStages, type LearningSession, type LearningStage } from './learning';
import { NumberField } from './EditFields';
import type { RunResult } from '../model/types';
import './learning.css';

function ExampleFlow() {
  return <ol className="learning-example-flow">{[Users, Clock3, CircleCheck].map((Icon, i) => <li key={i}><Icon size={23} aria-hidden="true" /><span>{m.welcomeSteps[i]}</span>{i < 2 && <ArrowRight className="learning-flow-arrow" size={16} aria-hidden="true" />}</li>)}</ol>;
}
export function LearningIntro({ busy, blocked, error, onStart, onExplore, onReference }: {
  busy: boolean; blocked?: string; error?: string | null;
  onStart: () => void; onExplore: () => void; onReference: () => void;
}) {
  return <section className="learning-intro">
    <div className="learning-intro-visual"><img src={assetURL('/previews/templates/service.png')} alt="" /></div>
    <div className="learning-intro-copy"><h3>{m.welcome}</h3><p>{m.introduction}</p><ExampleFlow />
      <p className="learning-scope">{m.practiceScope}</p>
      {blocked && <p role="status" className="learning-feedback">{blocked}</p>}
      {error && <p role="alert" className="learning-error">{error}</p>}
      <div className="learning-intro-actions"><button type="button" className="learning-primary" disabled={busy || Boolean(blocked)} onClick={onStart}>{busy ? <LoaderCircle size={18} className="spin" /> : <Compass size={18} />}{busy ? m.starting : m.start}<ArrowRight size={17} /></button><button type="button" className="learning-secondary" onClick={onExplore}>{m.explore}</button></div>
      <button type="button" className="learning-text-button" onClick={onReference}>{m.reference}</button>
    </div>
  </section>;
}
function LearningResults({ before, after }: { before: RunResult; after: RunResult }) {
  const money = (value: number) => new Intl.NumberFormat('en', { style: 'currency', currency: after.model.currency, maximumFractionDigits: 0 }).format(value);
  const cost = after.summary.cost - before.summary.cost;
  const rows = [
    [m.completedLabel, String(before.summary.completed), String(after.summary.completed), m.completedChange(after.summary.completed - before.summary.completed)],
    [m.waitLabel, m.waitValue(before.summary.meanWait), m.waitValue(after.summary.meanWait), m.waitChange(after.summary.meanWait - before.summary.meanWait)],
    [m.costLabel, money(before.summary.cost), money(after.summary.cost), m.costChange(cost)],
  ];
  return <section className="learning-results" aria-label={m.review.title}>{rows.map(([label, a, b, change]) => <div className="learning-result" key={label}><h4>{label}</h4><dl><div><dt>{m.before}</dt><dd>{a}</dd></div><ArrowRight size={18} aria-hidden="true" /><div><dt>{m.after}</dt><dd>{b}</dd></div></dl><p>{change}</p></div>)}<p className="learning-result-explanation">{m.resultLesson}</p><p className="learning-scope">{m.lessonScope}</p></section>;
}
interface CoachProps {
  session: LearningSession; stage: LearningStage; minimized: boolean; busy: boolean; busyLabel?: string; pending: boolean;
  capacity: number; installedCapacity: number; onCapacityChange: (value: number) => void;
  baseline: RunResult | null; result: RunResult | null; error?: string | null; children?: ReactNode;
  onAction: () => void; onMinimize: () => void; onLeave: () => void; onReturn: () => void; onFinishWithoutSave: () => void;
}
export function LearningCoach(props: CoachProps) {
  const { session, stage, minimized, busy, pending, baseline, result, error } = props;
  const root = useRef<HTMLElement>(null);
  const index = stage === 'complete' ? 4 : Math.max(0, learningStages.findIndex(item => item === stage));
  const caption = m.step(index + 1);
  if (minimized) return <aside className="learning-mini" aria-label={m.coach}><button type="button" disabled={pending} onClick={props.onMinimize} data-learning-resume><Compass size={17} /><strong>{m.resume}</strong><span>{caption}</span><ArrowRight size={16} /></button>{pending && <p className="learning-feedback" role="status">{m.pending}</p>}</aside>;
  const content = stage === 'off-track' ? m.offTrack : stage === 'complete' ? null : m[stage];
  const action = stage === 'complete' ? m.continue : content!.action;
  const apply = () => {
    if (stage === 'edit') root.current?.querySelector<HTMLInputElement>('[data-learning-team] input')?.blur();
    else props.onAction();
  };
  return <aside ref={root} className={`learning-coach ${stage === 'complete' ? 'learning-complete' : ''}`} aria-label={m.coach} data-learning-stage={stage}>
    <div className="learning-coach-top"><span><Compass size={16} />{m.coach}</span><div><button data-learning-toggle type="button" disabled={pending} aria-label={m.pause} onClick={props.onMinimize}><ChevronDown size={17} /></button><button type="button" disabled={pending} aria-label={m.leave} onClick={props.onLeave}><X size={17} /></button></div></div>
    <div className="learning-progress" role="progressbar" aria-label={m.progress} aria-valuenow={stage === 'complete' ? 5 : index + 1} aria-valuemin={1} aria-valuemax={5} aria-valuetext={caption}><span style={{ width: `${stage === 'complete' ? 100 : index * 20}%` }} /></div>
    <div className="learning-coach-main"><span className="learning-step-caption">{caption} · {m.labels[learningStages[index]]}</span><h3 id="lesson-step" tabIndex={-1} data-learning-heading>{content?.title ?? m.completed}</h3><p id="learning-instruction" aria-live="polite">{content?.text ?? m.completedText}</p>
      {stage === 'select' && <ExampleFlow />}
      {stage === 'edit' && <div data-learning-team className="learning-team"><NumberField label={m.teamLabel} value={props.capacity} min={0} max={props.installedCapacity} step={1} contextKey={`${session.projectId}:lesson-team`} disabled={busy} help={m.teamHelp} onChange={props.onCapacityChange} /></div>}
      {stage === 'run' && <p className="learning-applied"><Check size={18} />{m.applied}</p>}
      {pending && <p className="learning-feedback" role="status">{m.applyField}</p>}
      {error && <p className="learning-error" role="alert">{error}</p>}
      {stage === 'review' && baseline && result && <LearningResults before={baseline} after={result} />}
      {stage === 'save' && props.children}
      {stage === 'complete' && <><p className="learning-saved" role="status">{session.savedName ? <><Check size={18} />{m.saved(session.savedName)}</> : m.notSaved}</p><div className="learning-next"><h4>{m.nextStep}</h4><p>{m.nextStepText}</p></div></>}
    </div>
    <div className="learning-coach-actions">{stage !== 'save' && <button type="button" className="learning-primary" data-learning-action disabled={busy || stage === 'preparing' || (pending && stage !== 'edit')} onPointerDown={stage === 'edit' ? event => event.preventDefault() : undefined} onClick={apply}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? props.busyLabel ?? m.running : action}{!busy && <ArrowRight size={17} />}</button>}
      {stage === 'save' && <button type="button" className="learning-text-button" disabled={busy || pending} onClick={props.onFinishWithoutSave}>{m.finishWithoutSave}</button>}
      {session.returnProjectId && <button type="button" className="learning-text-button" disabled={busy || pending} onClick={props.onReturn}>{m.return}</button>}
    </div>
  </aside>;
}
