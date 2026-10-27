import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../model/types';
import { MAX_RUN_SECONDS } from '../model/limits';
import { changeHorizon, horizonImpact } from '../model/easeCommands';
import { arrivalExpectation } from '../model/workBudget';
import { TimeField, usePendingEdit } from './EditFields';
import { easeMessages as m } from '../ui/messages/ease';

interface Props { project: Project; onChange: (project: Project, label?: string) => void; onBudget: () => void; onInspect?: (nodeId: string) => void }
export function HorizonControl({ project, onChange }: Pick<Props, 'project' | 'onChange'>) {
  const [seconds, setSeconds] = useState(project.model.horizon); const [policy, setPolicy] = useState<'keep' | 'crop' | 'repeat'>('keep'); const [error, setError] = useState(''); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setSeconds(project.model.horizon); setError(''); }, [project.id, project.model.horizon]);
  useEffect(() => { if (seconds <= project.model.horizon && policy === 'repeat') setPolicy('keep'); }, [seconds, project.model.horizon, policy]);
  const pending = !Object.is(seconds, project.model.horizon); usePendingEdit(`${project.id}:horizon-plan`, pending);
  let impact: ReturnType<typeof horizonImpact> | null = null; let impactFailure = '';
  if (pending) { try { impact = horizonImpact(project, seconds); } catch (e) { impactFailure = e instanceof Error ? e.message : m.editFailed; } }
  const preview = useMemo(() => {
    if (!pending) return { project: null, error: '' };
    try { return { project: changeHorizon(project, seconds, policy), error: '' }; }
    catch (e) { return { project: null, error: e instanceof Error ? e.message : m.editFailed }; }
  }, [project, seconds, policy, pending]);
  const beforeDemand = useMemo(() => { try { return pending ? arrivalExpectation(project.model) : null; } catch { return null; } }, [project.model, pending]);
  const afterDemand = preview.project ? arrivalExpectation(preview.project.model) : null;
  function apply() {
    if (root.current?.querySelector('[data-pending="true"]')) { setError(m.applyFieldsFirst); return; }
    try { onChange(changeHorizon(project, seconds, policy), m.changedRunLength); setError(''); } catch (e) { setError(e instanceof Error ? e.message : m.editFailed); }
  }
  return <div className="ease-horizon" ref={root}>
    <div className="ease-presets" role="group" aria-label={m.runLengthPresets}>{[[1800, m.thirtyMinutes], [3600, m.oneHour], [28800, m.eightHours]].map(([value, label]) => <button className={seconds === value ? 'is-selected' : ''} key={value} type="button" onClick={() => { setSeconds(Number(value)); setError(''); }}>{label}</button>)}</div>
    <TimeField label={m.runLength} value={seconds} onChange={value => { horizonImpact(project, value); setSeconds(value); }} min={Number.MIN_VALUE} max={MAX_RUN_SECONDS} contextKey={`${project.id}:run-length`} defaultUnit="minutes" help={m.horizonScope} />
    {impact && <section className="ease-horizon-review" aria-label={m.horizonImpact}>
      <h4>{m.horizonImpact}</h4><strong>{m.runLengthChange(m.duration(impact.from), m.duration(impact.to))}</strong>
      {impact.notes.length ? <ul>{impact.notes.map((note, i) => <li key={i}>{note}</li>)}</ul> : <p>{m.unchangedPlan}</p>}
      <label className="ease-select-label">{m.horizonPolicy}<select value={policy} onChange={event => setPolicy(event.currentTarget.value as typeof policy)}><option value="keep">{m.keepPlan}</option><option value="crop">{m.cropPlan}</option>{impact.extended && <option value="repeat">{m.repeatPlan}</option>}</select></label>
      <p className="ease-help">{policy === 'keep' ? m.horizonKeep : policy === 'crop' ? m.horizonCrop : m.horizonRepeat}</p>
      {beforeDemand && afterDemand && <p className="ease-help">{m.demandPreview(beforeDemand.count, afterDemand.count, afterDemand.stochastic)}</p>}{preview.error && <p className="ease-error" role="alert">{preview.error}</p>}
      <div className="ease-actions"><button type="button" className="ease-button ease-primary" disabled={!preview.project} onClick={apply}>{m.applyRunLength}</button><button type="button" className="ease-button" onPointerDown={event=>event.preventDefault()} onClick={() => { setSeconds(project.model.horizon); setPolicy('keep'); setError(''); }}>{m.cancelChange}</button></div>
    </section>}
    {impactFailure && <p role="alert" className="ease-error">{impactFailure}</p>}
    {error && <p className="ease-error" role="alert">{error}</p>}
  </div>;
}
export function ScenarioSettings({ project, onChange, onBudget, onInspect }: Props) {
  let demand: ReturnType<typeof arrivalExpectation> | null = null;
  try { demand = arrivalExpectation(project.model); } catch { /* Existing validation surface remains authoritative. */ }
  return <div className="ease-scenario">
    <p className="quality-scenario-intro">{m.scenarioIntro}</p>
    <HorizonControl project={project} onChange={onChange} />
    <section className="ease-section"><h3>{m.demandSummary}</h3>{demand ? <><strong>{m.totalExpected(demand.count.toLocaleString('en', { maximumFractionDigits: 2 }), demand.stochastic)}</strong>{demand.stochastic && <p className="ease-help">{m.randomExpectation}</p>}</> : <p className="ease-help">{m.modelInvalid}</p>}{onInspect && project.model.nodes.filter(node => node.kind === 'source').map(node => <button key={node.id} type="button" className="ease-link quality-scenario-jump" onClick={() => onInspect(node.id)}>{m.editDemand}<span>{node.label} ↗</span></button>)}</section>
    <section className="ease-section"><h3>{m.resourcesSummary}</h3>{project.model.resources.length ? <ul className="ease-resource-summary">{project.model.resources.map(pool => { const consumer = project.model.nodes.find(node => node.kind === 'service' && node.resources.some(requirement => requirement.poolId === pool.id)); return <li key={pool.id}><strong>{pool.label}</strong><span>{m.availableUnits(pool.capacity, pool.installedCapacity)}</span><small>{pool.calendar.length ? m.calendarSummary(pool.calendar.length) : m.teamNoCalendar}</small>{onInspect && consumer && <button type="button" className="ease-link quality-scenario-jump" onClick={() => onInspect(consumer.id)}>{m.editTeam(pool.label)}<span aria-hidden="true">↗</span></button>}</li>; })}</ul> : <p className="ease-help">{m.noResources}</p>}</section>
    <button type="button" className="ease-link" onClick={onBudget}>{m.openWorkBudget}</button>
  </div>;
}
