import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Distribution, ModelNode, Project, QueueNode, ResourcePool, RouteNode, RunResult, ServiceNode, SourceNode } from '../model/types';
import { meanDuration, mutateProject } from '../model/commands';
import { arrivalProfile, scaleDemand, scaleDistribution, setNodeMean } from '../model/easeCommands';
import { MAX_ARRIVALS_PER_HOUR, MAX_WAITING_PLACES } from '../model/limits';
import { modelHash } from '../model/identity';
import { validateProject } from '../model/validate';
import { arrivalExpectation } from '../model/workBudget';
import { stepKindLabels } from '../ui/messages/labels';
import { actualArrivalDisplay } from './demandSummary';
import { ConnectionPicker } from './ProcessActions';
import { NumberField, TimeField, usePendingEdit } from './EditFields';
import { ScheduleEditor, Timeline } from './ScheduleEditor';
import { easeMessages as m } from '../ui/messages/ease';

interface Props { project: Project; node: ModelNode; onChange: (project: Project, label?: string) => void; onAdvanced: () => void; result?: RunResult | null; onPreviewConnection?: (targetId: string | null) => void }
interface ControlProps extends Props { commit: (next: Project, label: string) => void; attempt: (action: () => void) => void }
const count = (v: number) => v.toLocaleString('en', { maximumFractionDigits: 3 });
const money = (v: number, currency: string) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v); } catch { return `${count(v)} ${currency}`; } };
function checked(project: Project) { const issue = validateProject(project).find(issue => issue.severity === 'error'); if (issue) throw new Error(issue.message); return project; }
function LabelEditor({ project, node, commit }: Pick<ControlProps, 'project' | 'node' | 'commit'>) {
  const [name, setName] = useState(node.label); const [error, setError] = useState(''); const id = useId();
  useEffect(() => { setName(node.label); setError(''); }, [project.id, node.id, node.label]);
  usePendingEdit(`${project.id}:${node.id}:label`, name !== node.label);
  function apply() {
    if (name === node.label) return;
    if (!name.trim() || name.length > 160) { setError(m.nameRequired); return; }
    try { commit(mutateProject(project, copy => { copy.model.nodes.find(item => item.id === node.id)!.label = name; }), m.changedName(node.label)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : m.editFailed); }
  }
  return <details className="ease-name-editor"><summary><small>{stepKindLabels[node.kind]}</small><span>{node.label}</span><em>{m.rename}</em></summary><label htmlFor={id}>{m.name}</label><input id={id} value={name} maxLength={160} onChange={event => { setName(event.currentTarget.value); setError(''); }} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setName(node.label); setError(''); } }} />{error && <p role="alert" className="ease-error">{error}</p>}</details>;
}
function DistributionControl({ project, node, distribution, commit, patience = false }: { project: Project; node: ModelNode; distribution: Distribution; commit: ControlProps['commit']; patience?: boolean }) {
  const [mode, setMode] = useState<'scale' | 'fixed'>('scale'); const [error, setError] = useState(''); const root = useRef<HTMLElement>(null); const id = useId();
  useEffect(() => { setMode('scale'); }, [project.id, node.id, distribution.kind]);
  const mean = meanDuration(distribution); const isService = node.kind === 'service';
  return <section ref={root} className="ease-section ease-duration-control">
    <TimeField label={patience ? m.patienceTime : node.kind === 'delay' ? m.delayTime : distribution.kind === 'constant' ? m.processingTime : m.meanTime} value={mean} min={isService ? Number.MIN_VALUE : 0} max={604800} contextKey={`${project.id}:${node.id}:${patience ? 'patience' : 'duration'}:${mode}`} onChange={value => {
      if (!patience && mode === 'scale') commit(setNodeMean(project, node.id, value), node.kind === 'delay' ? m.delayChanged(node.label) : m.durationChanged(node.label));
      else commit(mutateProject(project, copy => {
        const target = copy.model.nodes.find(item => item.id === node.id)!;
        const next = mode === 'fixed' ? { kind: 'constant' as const, value } : scaleDistribution(distribution, value);
        if (patience && target.kind === 'queue') target.patience = next;
        else if (target.kind === 'service' || target.kind === 'delay') target.duration = next;
      }), patience ? m.queueChanged(node.label) : m.durationChanged(node.label));
    }} help={distribution.kind !== 'constant' ? mode === 'scale' ? m.shapePreserved : m.fixedConversion : undefined} />
    <details className="ease-disclosure quality-duration-options"><summary>{m.distributionSummary(m.distributionNames[distribution.kind], m.duration(mean))}</summary>
    {distribution.kind !== 'constant' && <label className="ease-select-label" htmlFor={id}>{m.distributionMode}<select id={id} value={mode} onChange={event => setMode(event.currentTarget.value as typeof mode)}><option value="scale">{m.keepDistribution}</option><option value="fixed">{m.fixedDuration}</option></select></label>}
    {mode === 'fixed' && distribution.kind !== 'constant' && <button type="button" className="ease-button" onClick={() => {
      if (root.current?.querySelector('[data-pending="true"]')) { setError(m.applyFieldsFirst); return; }
      try {
        commit(mutateProject(project, copy => { const target = copy.model.nodes.find(item => item.id === node.id); if (patience && target?.kind === 'queue') target.patience = { kind: 'constant', value: mean }; else if (target?.kind === 'service' || target?.kind === 'delay') target.duration = { kind: 'constant', value: mean }; }), patience ? m.queueChanged(node.label) : m.durationChanged(node.label)); setError('');
      } catch (e) { setError(e instanceof Error ? e.message : m.editFailed); }
    }}>{m.convertToFixed}</button>}
    </details>
    {error && <p role="alert" className="ease-error">{error}</p>}
  </section>;
}
function TeamControl({ project, pool, service, commit }: { project: Project; pool: ResourcePool; service: ServiceNode; commit: ControlProps['commit'] }) {
  const consumers = project.model.nodes.filter((node): node is ServiceNode => node.kind === 'service' && node.resources.some(req => req.poolId === pool.id));
  const requirement = service.resources.find(req => req.poolId === pool.id)!;
  const change = (patch: Partial<ResourcePool>) => commit(mutateProject(project, copy => { Object.assign(copy.model.resources.find(item => item.id === pool.id)!, patch); }), m.teamChanged(pool.label));
  const context = `${project.id}:${pool.id}`;
  return <details open className="ease-disclosure ease-team"><summary><span><strong>{pool.label}</strong><small>{m.availableUnits(pool.capacity, pool.installedCapacity)}</small></span></summary>
    <NumberField label={m.teamCapacity} contextKey={`${context}:base`} value={pool.capacity} min={0} max={pool.installedCapacity} step={1} onChange={capacity => change({ capacity })} help={m.unitsPerStart(requirement.units)} />
    {consumers.length > 1 && <p className="ease-help">{m.usedBy(consumers.map(node => node.label).join(', '))}</p>}
    <details className="ease-disclosure quality-team-details"><summary>{m.teamPlanDetails}</summary>
    <NumberField label={m.installedLimit} contextKey={`${context}:installed`} value={pool.installedCapacity} min={1} max={1000} step={1} onChange={installedCapacity => change({ installedCapacity })} />
    <NumberField label={m.costPerHour} contextKey={`${context}:cost`} value={pool.costPerHour} min={0} max={1_000_000} onChange={costPerHour => change({ costPerHour })} />
    <p className="ease-help">{m.modeledHourlyCost(money(pool.capacity * pool.costPerHour, project.model.currency))}</p>
    </details>
    <details className="ease-disclosure"><summary>{m.timelineCalendar}</summary><ScheduleEditor kind="calendar" periods={pool.calendar} horizon={project.model.horizon} baseCapacity={pool.capacity} installedCapacity={pool.installedCapacity} contextKey={`${context}:calendar`} onChange={calendar => change({ calendar })} /></details>
    <details className="ease-disclosure"><summary>{m.overtimeCost}</summary><NumberField label={m.overtimeCost} value={pool.overtimeCostPerHour} min={0} max={1_000_000} contextKey={`${context}:overtime`} onChange={overtimeCostPerHour => change({ overtimeCostPerHour })} /></details>
  </details>;
}
function CapacityNote({ project, node }: { project: Project; node: ServiceNode }) {
  const notes = node.resources.flatMap(requirement => {
    const pool = project.model.resources.find(item => item.id === requirement.poolId);
    const needed = node.servers * requirement.units;
    return pool && pool.capacity < needed ? [m.baseCapacityNote(pool.label, pool.capacity, needed)] : [];
  });
  if (!notes.length) return null;
  return <aside className="quality-capacity-note" aria-label={m.checkTeamCapacity}><strong>{m.checkTeamCapacity}</strong>{notes.map(note => <p key={note}>{note}</p>)}</aside>;
}
function SourceControl(props: ControlProps & { node: SourceNode }) {
  const { project, node, commit, attempt, onAdvanced, result } = props;
  const [profile, setProfile] = useState<'' | 'regular' | 'peak' | 'waves'>(''); const [profileError, setProfileError] = useState('');
  useEffect(() => { setProfile(''); setProfileError(''); }, [project.id, node.id]);
  const expected = useMemo(() => { try { return arrivalExpectation({ ...project.model, nodes: project.model.nodes.map(item => item.kind === 'source' && item.id !== node.id ? { ...item, arrival: { kind: 'fixed' as const, perHour: 0 } } : item) }); } catch { return null; } }, [project.model, node.id]);
  const averageRate = (expected?.count ?? 0) / project.model.horizon * 3600;
  const profilePreview = useMemo(() => { if (!profile) return { project: null, error: '' }; try { return { project: arrivalProfile(project, node.id, profile), error: '' }; } catch (e) { return { project: null, error: e instanceof Error ? e.message : m.editFailed }; } }, [project, node.id, profile]);
  const preview = profilePreview.project, previewFailure = profilePreview.error;
  const previewSource = preview?.model.nodes.find((item): item is SourceNode => item.id === node.id && item.kind === 'source');
  const previewCount = previewSource?.arrival.kind === 'poisson' ? previewSource.arrival.segments.reduce((sum, segment) => sum + (segment.end - segment.start) * segment.perHour / 3600, 0) : null;
  const update = (arrival: SourceNode['arrival']) => commit(mutateProject(project, copy => { const target = copy.model.nodes.find(item => item.id === node.id); if (target?.kind === 'source') target.arrival = arrival; }), m.demandChanged(node.label));
  const currentHash = useMemo(() => modelHash(project.model), [project.model]);
  const matches = result && result.status === 'completed' && result.modelHash === currentHash && result.seed === project.model.seed;
  const actual = useMemo(() => actualArrivalDisplay(result, node.id), [result, node.id]);
  return <>
    {node.arrival.kind === 'fixed' && <NumberField label={m.demandRate} value={node.arrival.perHour} min={0} max={MAX_ARRIVALS_PER_HOUR} contextKey={`${project.id}:${node.id}:rate`} onChange={perHour => update({ kind: 'fixed', perHour })} />}
    {node.arrival.kind === 'poisson' && <><NumberField label={m.averageDemandRate} value={averageRate} min={0} max={MAX_ARRIVALS_PER_HOUR} contextKey={`${project.id}:${node.id}:average-rate`} onChange={rate => { if (averageRate === 0 && rate !== 0) throw new Error(m.zeroDemandScale); commit(scaleDemand(project, node.id, averageRate === 0 ? 1 : rate / averageRate), m.demandChanged(node.label)); }} help={m.variableDemandScope} /></>}
    {node.arrival.kind !== 'schedule' ? <div className="ease-presets" role="group" aria-label={m.demandScale}>{[[.5, m.scaleHalf], [1, m.scaleOriginal], [2, m.scaleDouble]].map(([factor, label]) => <button type="button" key={factor} onClick={() => attempt(() => commit(scaleDemand(project, node.id, Number(factor)), m.demandChanged(node.label)))}>{label}</button>)}</div> : <><p>{m.exactScheduleCount(node.arrival.times.length)}</p><p className="ease-help">{m.exactScheduleScope}</p><button type="button" className="ease-link" onClick={onAdvanced}>{m.advancedSettings}</button></>}
    <dl className="ease-demand-summary"><div><dt>{expected?.stochastic ? m.expectedArrivals : m.scheduledArrivals}</dt><dd>{expected ? `${expected.stochastic ? '≈ ' : ''}${count(expected.count)}` : '—'}</dd></div>{matches && actual && <div><dt>{actual.scope === 'source' ? m.actualSourceArrivals : m.actualAllArrivals}</dt><dd>{count(actual.count)}</dd></div>}</dl>
    {project.model.warmup > 0 && <p className="ease-help">{m.arrivalWarmupScope}</p>}{matches && actual?.scope === 'allSources' && <p className="ease-help">{m.arrivalAllScope}</p>}
    {expected?.stochastic && <p className="ease-help">{m.randomExpectation}</p>}
    {node.arrival.kind === 'poisson' && <details className="ease-disclosure"><summary>{m.timelineArrival}</summary><ScheduleEditor kind="arrival" segments={node.arrival.segments} horizon={project.model.horizon} contextKey={`${project.id}:${node.id}:rates`} onChange={segments => update({ kind: 'poisson', segments })} /></details>}
    <details className="ease-disclosure"><summary>{m.profile}</summary><label className="ease-select-label">{m.profile}<select value={profile} onChange={event => { setProfile(event.currentTarget.value as typeof profile); setProfileError(''); }}><option value="">{m.chooseProfile}</option><option value="regular">{m.regular}</option><option value="peak">{m.peak}</option><option value="waves">{m.waves}</option></select></label>
      {profile && <><p className="ease-help">{m.profileReplacement}</p>{previewCount !== null && <strong>{m.totalExpected(count(previewCount), true)}</strong>}{previewSource?.arrival.kind === 'poisson' && <Timeline kind="arrival" horizon={project.model.horizon} slots={previewSource.arrival.segments.map(segment => ({ start: segment.start, end: segment.end, value: segment.perHour }))} />}{previewFailure && <p role="alert" className="ease-error">{previewFailure}</p>}<button type="button" className="ease-button" disabled={!preview} onClick={() => { try { if (preview) { commit(preview, m.profileChanged(node.label)); setProfile(''); } } catch (e) { setProfileError(e instanceof Error ? e.message : m.editFailed); } }}>{m.applyProfile}</button></>}{profileError && <p role="alert" className="ease-error">{profileError}</p>}
    </details>
  </>;
}
function QueueControl({ project, node, commit, attempt }: ControlProps & { node: QueueNode }) {
  const change = (patch: Partial<QueueNode>) => commit(mutateProject(project, copy => { Object.assign(copy.model.nodes.find(item => item.id === node.id)!, patch); }), m.queueChanged(node.label));
  return <>
    <label className="ease-select-label">{m.waitingLimit}<select value={node.capacity === null ? 'unlimited' : 'limited'} onChange={event => attempt(() => change({ capacity: event.currentTarget.value === 'unlimited' ? null : 10 }))}><option value="unlimited">{m.unlimited}</option><option value="limited">{m.limited}</option></select></label>
    {node.capacity !== null && <NumberField label={m.waitingCapacity} contextKey={`${project.id}:${node.id}:waiting-capacity`} value={node.capacity} min={0} max={MAX_WAITING_PLACES} step={1} onChange={capacity => change({ capacity })} help={node.capacity === 0 ? m.zeroQueue : undefined} />}
    <label className="ease-select-label">{m.queueOrder}<select value={node.discipline} onChange={event => attempt(() => change({ discipline: event.currentTarget.value as QueueNode['discipline'] }))}><option value="fifo">{m.fifo}</option><option value="priority">{m.priority}</option></select></label>
    <label className="ease-select-label">{m.abandonment}<select value={node.patience ? 'timed' : 'none'} onChange={event => attempt(() => change({ patience: event.currentTarget.value === 'none' ? null : { kind: 'constant', value: 300 } }))}><option value="none">{m.neverLeave}</option><option value="timed">{m.timedPatience}</option></select></label>
    {node.patience && <DistributionControl project={project} node={node} distribution={node.patience} commit={commit} patience />}
    <p className="ease-help">{m.patienceScope}</p>
  </>;
}
function RouteControl({ project, node, commit }: Pick<ControlProps, 'project' | 'commit'> & { node: RouteNode }) {
  const signature = JSON.stringify(node.branches); const [values, setValues] = useState(node.branches.map(branch => branch.probability)); const [error, setError] = useState(''); const [resetEpoch, setResetEpoch] = useState(0); const root = useRef<HTMLElement>(null);
  useEffect(() => { setValues(node.branches.map(branch => branch.probability)); setError(''); }, [signature, project.id, node.id]);
  const pending = values.some((value, i) => value !== node.branches[i]?.probability); usePendingEdit(`${project.id}:${node.id}:route`, pending);
  const total = values.reduce((sum, value) => sum + value, 0); const valid = Math.abs(total - 1) <= 1e-9;
  return <section ref={root} className="ease-section"><h4>{m.routeHeading}</h4>{node.branches.map((branch, i) => <NumberField key={`${i}:${branch.to}`} label={`${project.model.nodes.find(item => item.id === branch.to)?.label ?? branch.to} · ${m.probability}`} contextKey={`${project.id}:${node.id}:probability:${i}:${resetEpoch}`} value={(values[i] ?? 0) * 100} min={0} max={100} onChange={percentage => setValues(previous => previous.map((value, index) => index === i ? percentage / 100 : value))} />)}<p className={valid ? 'ease-help' : 'ease-error'}>{m.probabilitySum(count(total * 100))}</p>{!valid && <p className="ease-help">{m.percentRequired}</p>}{pending && <button type="button" className="ease-button" disabled={!valid} onClick={() => { try { if (root.current?.querySelector('[data-pending="true"]')) { setError(m.applyFieldsFirst); return; } commit(mutateProject(project, copy => { const target = copy.model.nodes.find(item => item.id === node.id); if (target?.kind === 'route') target.branches = target.branches.map((branch, i) => ({ ...branch, probability: values[i] })); }), m.routeChanged(node.label)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : m.editFailed); } }}>{m.applyProbabilities}</button>}<button type="button" className="ease-link" onPointerDown={event=>event.preventDefault()} onClick={() => { setValues(node.branches.map(branch => branch.probability)); setError(''); setResetEpoch(epoch => epoch + 1); }}>{m.cancelChange}</button>{error && <p role="alert" className="ease-error">{error}</p>}</section>;
}
export function QuickProperties(props: Props) {
  const { project, node, onChange, onAdvanced, onPreviewConnection } = props; const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [project.id, node.id]);
  const commit = (next: Project, label: string) => { onChange(checked(next), label); setError(''); };
  const attempt = (action: () => void) => { try { action(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : m.editFailed); } };
  const controls: ControlProps = { ...props, commit, attempt };
  return <div className="ease-quick-properties">
    <LabelEditor project={project} node={node} commit={commit} />
    {node.kind === 'service' && <><div className="ease-station-stepper"><button className="ease-button" type="button" aria-label={m.removeOneStation} disabled={node.servers <= 1} onClick={() => attempt(() => commit(mutateProject(project, copy => { const target = copy.model.nodes.find(item => item.id === node.id); if (target?.kind === 'service') target.servers--; }), m.stationChanged(node.label)))}>−</button><NumberField label={m.parallelStations} value={node.servers} contextKey={`${project.id}:${node.id}:servers`} min={1} max={1000} step={1} help={m.parallelHint} onChange={servers => commit(mutateProject(project, copy => { const target = copy.model.nodes.find(item => item.id === node.id); if (target?.kind === 'service') target.servers = servers; }), m.stationChanged(node.label))} /><button className="ease-button" type="button" aria-label={m.addOneStation} disabled={node.servers >= 1000} onClick={() => attempt(() => commit(mutateProject(project, copy => { const target = copy.model.nodes.find(item => item.id === node.id); if (target?.kind === 'service') target.servers++; }), m.stationChanged(node.label)))}>+</button></div><CapacityNote project={project} node={node} /><DistributionControl project={project} node={node} distribution={node.duration} commit={commit} />{node.resources.length > 0 && <section className="ease-section"><h4>{m.teamHeading}</h4>{node.resources.map(requirement => { const pool = project.model.resources.find(item => item.id === requirement.poolId); return pool ? <TeamControl key={pool.id} project={project} pool={pool} service={node} commit={commit} /> : null; })}<details className="ease-disclosure quality-capacity-explanation"><summary>{m.capacityExplanation}</summary><p className="ease-help">{m.capacityScope}</p></details></section>}</>}
    {node.kind === 'delay' && <DistributionControl project={project} node={node} distribution={node.duration} commit={commit} />}
    {node.kind === 'source' && <SourceControl {...controls} node={node} />}
    {node.kind === 'queue' && <QueueControl {...controls} node={node} />}
    {node.kind === 'route' && <RouteControl project={project} node={node} commit={commit} />}
    {node.kind === 'sink' && <p className="ease-help">{m.exitScope}</p>}
    {'next' in node && <details className="ease-disclosure"><summary>{m.nextStep}</summary><ConnectionPicker project={project} node={node} onChange={onChange} onPreview={onPreviewConnection} /></details>}
    <button type="button" className="ease-link" onClick={onAdvanced}>{m.advancedSettings}</button>
    {error && <p role="alert" className="ease-error">{error}</p>}
  </div>;
}
