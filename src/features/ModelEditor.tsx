import { interfaceMessages as ui } from '../ui/messages/interface';
import { easeMessages as ease } from '../ui/messages/ease';
import { processEaseMessages as processMessages } from '../ui/messages/modelEdits';
import { stepKindLabels, stepTypeLabels } from '../ui/messages/labels';
import { modelEditorMessages as m } from '../ui/messages/ModelEditor';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { mutateProject } from '../model/commands';
import { ProcessActions, ConnectionPicker } from './ProcessActions';
import { NumberField } from './EditFields';
import { HorizonControl as HorizonSettings } from './ScenarioSettings';
import { ScheduleEditor } from './ScheduleEditor';
import { MAX_ARRIVALS_PER_HOUR, MAX_RUN_SECONDS, MAX_WAITING_PLACES } from '../model/limits';
import type { Distribution, ModelNode, Point, Project, ResourcePool, SourceNode } from '../model/types';
import { validateProject } from '../model/validate';
import { parseSeconds } from '../storage/csv';
import { addNode, removeNode, renameNode, uniqueIdentity, validIdentity } from './modelEdits';
import type { SelectionIntent } from './editorSelection';
import { SelectionMoveControls } from './SelectionMoveControls';
import './features.css';

interface Props {
  project: Project; onChange: (project: Project, label?: string) => void;
  selectedId?: string | null; selectedIds?: string[];
  onSelect?: (id: string | null, intent?: SelectionIntent) => void;
  onMove?: (ids: string[], delta: Point) => void;
}
function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const id = useId(); return <div className="ql-field"><label id={id}>{label}</label>{children && <div aria-labelledby={id}>{children}</div>}{help && <small>{help}</small>}</div>;
}
function Numeric({ label, value, onChange, min, max, step = 'any', help }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number | 'any'; help?: string }) {
  return <NumberField label={label} value={value} onChange={onChange} contextKey={label} min={min} max={max} step={step} help={help} />;
}
function Text({ label, value, onChange, maxLength = 160, inputRef }: { label: string; value: string; onChange: (v: string) => void; maxLength?: number; inputRef?: Ref<HTMLInputElement> }) {
  const id = useId(); return <div className="ql-field"><label htmlFor={id}>{label}</label><input ref={inputRef} id={id} value={value} maxLength={maxLength} onChange={e => onChange(e.target.value)} /></div>;
}
function Choice({ label, value, onChange, options, help }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; help?: string }) {
  const id = useId(); return <div className="ql-field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{help && <small>{help}</small>}</div>;
}
function Samples({ values, onChange, allowZero, label, maximum = 10_000, maximumSeconds = 604800 }: { values: number[]; onChange: (v: number[]) => void; allowZero: boolean; label: string; maximum?: number; maximumSeconds?: number }) {
  const [draft, setDraft] = useState(values.join('\n')); const [error, setError] = useState(''); const id = useId();
  useEffect(() => { setDraft(values.join('\n')); setError(''); }, [values]);
  return <div className="ql-field"><label htmlFor={id}>{label}</label><textarea id={id} rows={5} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} /><small>{m.oneValuePerLineInSecondsDecimalPointOnly}</small><button className="ql-button" type="button" onClick={() => { try { const lines = draft.trim() ? draft.trim().split(/\r?\n/) : []; if (lines.length > maximum) throw new Error(m.sampleLimitReached); onChange(lines.map((v, i) => parseSeconds(v, i + 1, allowZero, maximumSeconds))); setError(''); } catch (e) { setError(e instanceof Error ? e.message : m.invalidTimeValues); } }}>{m.applyValues}</button>{error && <p className="ql-error" role="alert">{error}</p>}</div>;
}
function DistributionFields({ value, onChange, label = m.duration, allowZero = false }: { value: Distribution; onChange: (v: Distribution) => void; label?: string; allowZero?: boolean }) {
  const defaults: Record<Distribution['kind'], Distribution> = { constant: { kind: 'constant', value: 30 }, exponential: { kind: 'exponential', mean: 30 }, triangular: { kind: 'triangular', min: 15, mode: 30, max: 45 }, empirical: { kind: 'empirical', values: [30] } };
  const minimum = allowZero ? 0 : 0.000001;
  return <details className="ql-editor-section" open><summary>{m.durationLegend(label)}</summary><fieldset className="ql-subsection"><legend>{m.durationLegend(label)}</legend><Choice label={m.distribution(label)} value={value.kind} onChange={kind => onChange(structuredClone(defaults[kind as Distribution['kind']]))} options={[{ value: 'constant', label: m.constant }, { value: 'exponential', label: m.exponential }, { value: 'triangular', label: m.triangular }, { value: 'empirical', label: m.empiricalSamples }]} />
    {value.kind === 'constant' && <Numeric label={m.valueSeconds(label)} value={value.value} min={minimum} max={604800} onChange={v => onChange({ ...value, value: v })} />}
    {value.kind === 'exponential' && <Numeric label={m.meanSeconds(label)} value={value.mean} min={0.000001} max={604800} onChange={v => onChange({ ...value, mean: v })} />}
    {value.kind === 'triangular' && <div className="ql-grid">{(['min', 'mode', 'max'] as const).map(key => <Numeric key={key} label={m.distributionParameter(label, key)} value={value[key]} min={minimum} max={604800} onChange={v => onChange({ ...value, [key]: v })} />)}</div>}
    {value.kind === 'empirical' && <Samples label={m.samplesSeconds(label)} values={value.values} allowZero={allowZero} onChange={values => onChange({ ...value, values })} />}
  </fieldset></details>;
}
function Arrivals({ node, horizon, onChange }: { node: SourceNode; horizon: number; onChange: (n: SourceNode) => void }) {
  const arrival = node.arrival;
  return <><details className="ql-editor-section" open><summary>{m.arrivalPattern}</summary><Choice label={m.arrivalPattern} value={arrival.kind} options={[{ value: 'fixed', label: m.fixedInterval }, { value: 'poisson', label: m.poissonRatePeriods }, { value: 'schedule', label: m.exactArrivalTimes }]} onChange={kind => onChange({ ...node, arrival: kind === 'fixed' ? { kind, perHour: 60 } : kind === 'poisson' ? { kind, segments: [{ start: 0, end: horizon, perHour: 60 }] } : { kind: 'schedule', times: [] } })} />
    {arrival.kind === 'fixed' && <Numeric label={m.arrivalRateEntitiesHour} value={arrival.perHour} min={0} max={MAX_ARRIVALS_PER_HOUR} onChange={perHour => onChange({ ...node, arrival: { ...arrival, perHour } })} help={m.aRateOfZeroDisablesThisSource} />}
    {arrival.kind === 'schedule' && <Samples label={m.arrivalTimestampsSecondsFromStart} values={arrival.times} allowZero maximum={100_000} maximumSeconds={MAX_RUN_SECONDS} onChange={times => onChange({ ...node, arrival: { ...arrival, times } })} />}
    {arrival.kind === 'poisson' && <ScheduleEditor kind="arrival" segments={arrival.segments} horizon={horizon} contextKey={`${node.id}:arrival`} onChange={segments => onChange({ ...node, arrival: { kind: 'poisson', segments } })} />}
    </details><details className="ql-editor-section"><summary>{m.visitorClasses}</summary><fieldset className="ql-subsection"><legend>{m.classCount(node.classes.length)}</legend><p className="ql-help" role="status">{m.percentageTotal(node.classes.reduce((sum, item) => sum + item.probability, 0) * 100)}</p><p className="ql-help">{m.classProbabilityHelp}</p>{node.classes.map((item, i) => <div className="ql-repeat-row" key={i}><div className="ql-grid"><Text label={m.classId(i + 1)} value={item.id} maxLength={64} onChange={id => onChange({ ...node, classes: node.classes.map((c, j) => j === i ? { ...c, id } : c) })} /><Text label={m.className(i + 1)} value={item.label} onChange={label => onChange({ ...node, classes: node.classes.map((c, j) => j === i ? { ...c, label } : c) })} /><Numeric label={m.classPriority(i + 1)} value={item.priority} min={-1000} max={1000} step={1} onChange={priority => onChange({ ...node, classes: node.classes.map((c, j) => j === i ? { ...c, priority } : c) })} /><Numeric label={m.classPercentage(i + 1)} value={item.probability * 100} min={0} max={100} onChange={percentage => onChange({ ...node, classes: node.classes.map((c, j) => j === i ? { ...c, probability: percentage / 100 } : c) })} /></div><button className="ql-button ql-danger" disabled={node.classes.length <= 1} type="button" onClick={() => onChange({ ...node, classes: node.classes.filter((_, j) => i !== j) })}>{m.removeClass(i + 1)}</button></div>)}<button className="ql-button" disabled={node.classes.length >= 20} type="button" onClick={() => onChange({ ...node, classes: [...node.classes, { id: uniqueIdentity('class', node.classes.map(c => c.id)), label: 'New class', priority: 0, probability: 0 }] })}>{m.addClass}</button></fieldset></details>
  </>;
}

export function ModelEditor({ project, onChange, selectedId, selectedIds, onSelect, onMove }: Props) {
  const [tab, setTab] = useState<'steps' | 'resources' | 'run'>('steps');
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepNavigationId = useId();
  const [localSelected, setLocalSelected] = useState(project.model.nodes[0]?.id ?? '');
  const [addKind, setAddKind] = useState<ModelNode['kind']>('service');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null); const [replacement, setReplacement] = useState('');
  const [poolDelete, setPoolDelete] = useState<string | null>(null); const [message, setMessage] = useState('');
  const selected = project.model.nodes.find(n => n.id === (selectedId === undefined ? localSelected : selectedId));
  const editorRoot = useRef<HTMLDivElement>(null);
  const stepIdentityInput = useRef<HTMLInputElement>(null);
  const poolIdentityInputs = useRef(new Map<string, HTMLInputElement>());
  const pendingIdentityFocus = useRef<{ kind: 'step' | 'pool'; id: string; documentId: string; revision: number } | null>(null);
  useLayoutEffect(() => {
    const request = pendingIdentityFocus.current;
    if (!request) return;
    pendingIdentityFocus.current = null;
    if (request.documentId !== project.id || request.revision !== project.revision || tab !== (request.kind === 'step' ? 'steps' : 'resources')) return;
    const input = request.kind === 'step'
      ? selected?.id === request.id ? stepIdentityInput.current : null
      : poolIdentityInputs.current.get(request.id);
    if (!input?.isConnected) return;
    // Mutable IDs remount these controls. Restore the applied editor once, before paint.
    const disclosure = input.closest('details');
    if (disclosure) disclosure.open = true;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [project.id, project.revision, selected?.id, tab]);
  function commitIdentityRename(next: Project, kind: 'step' | 'pool', id: string, label?: string) {
    pendingIdentityFocus.current = { kind, id, documentId: next.id, revision: next.revision };
    try { onChange(next, label); }
    catch (error) { pendingIdentityFocus.current = null; throw error; }
  }
  const selection = selectedIds ?? (selected ? [selected.id] : []);
  const issues = validateProject(project);
  const select = (id: string | null, intent: SelectionIntent = 'inspect') => { setLocalSelected(id ?? ''); onSelect?.(id, intent); setPendingDelete(null); };
  const edit = (operation: (p: Project) => void) => attempt(() => onChange(mutateProject(project, operation)));
  const updateNode = (node: ModelNode) => edit(p => { const index = p.model.nodes.findIndex(n => n.id === node.id); if (index >= 0) p.model.nodes[index] = node; });
  const destinations = (_id: string, queue = false) => [{ value: '', label: m.chooseAConnection }, ...project.model.nodes.filter(n => n.kind !== 'source' && (!queue || n.kind === 'service')).map(n => ({ value: n.id, label: m.destinationOption(n.label, stepKindLabels[n.kind]) }))];
  function attempt(operation: () => void) { try { operation(); setMessage(''); } catch (e) { setMessage(e instanceof Error ? e.message : m.theEditCouldNotBeApplied); } }
  function updatePool(pool: ResourcePool) { edit(p => { const index = p.model.resources.findIndex(r => r.id === pool.id); if (index >= 0) p.model.resources[index] = pool; }); }
  const inbound = pendingDelete ? project.model.nodes.filter(n => ('next' in n && n.next === pendingDelete) || (n.kind === 'route' && n.branches.some(b => b.to === pendingDelete))) : [];
  function issueTarget(path: string) {
    const [scope, reference, field] = path.split('.');
    const node = scope === 'nodes' ? (/^\d+$/.test(reference) ? project.model.nodes[Number(reference)] ?? project.model.nodes.find(node => node.id === reference) : project.model.nodes.find(node => node.id === reference)) : undefined;
    const pool = scope === 'resources' ? (/^\d+$/.test(reference) ? project.model.resources[Number(reference)] ?? project.model.resources.find(pool => pool.id === reference) : project.model.resources.find(pool => pool.id === reference)) : undefined;
    const labels: Record<string, string> = { servers: m.parallelServers, next: processMessages.destination, duration: m.duration, arrival: m.arrivalPattern, classes: m.visitorClasses, branches: m.routeProbabilityHelp, capacity: pool ? m.baseScheduledUnits : m.waitingCapacity, installedCapacity: m.installedUnits, costPerHour: m.scheduledCostUnitHour(project.model.currency), overtimeCostPerHour: m.overtimeCostUnitHour(project.model.currency), calendar: m.calendarPeriodCount(pool?.calendar.length ?? 0), resources: m.allRequestedUnitsAreAllocatedTogetherAnEmptyList, horizon: m.runHorizonSeconds, warmup: m.warmUpSeconds, seed: m.randomSeed, slaSeconds: m.slaWaitTargetSeconds, currency: m.currencyThreeLetterCode };
    let targetField = labels[field ?? scope] ?? field ?? scope;
    if (node && (field === 'duration' || field === 'patience')) {
      const distribution = field === 'duration' && (node.kind === 'service' || node.kind === 'delay') ? node.duration : node.kind === 'queue' ? node.patience : null;
      const label = field === 'patience' ? m.patience : node.kind === 'delay' ? m.delay : m.duration;
      if (distribution?.kind === 'constant') targetField = m.valueSeconds(label);
      else if (distribution?.kind === 'exponential') targetField = m.meanSeconds(label);
      else if (distribution?.kind === 'empirical') targetField = m.samplesSeconds(label);
      else if (distribution?.kind === 'triangular') {
        const zero = node.kind !== 'service';
        const bad = (['min','mode','max'] as const).find(key => !Number.isFinite(distribution[key]) || distribution[key] < 0 || !zero && distribution[key] === 0 || distribution[key] > 604800)
          ?? (distribution.min > distribution.mode ? 'min' : distribution.mode > distribution.max ? 'mode' : 'min');
        targetField = m.distributionParameter(label, bad);
      }
    }
    if (node?.kind === 'source' && field === 'arrival') {
      targetField = node.arrival.kind === 'fixed' ? m.arrivalRateEntitiesHour : node.arrival.kind === 'schedule' ? m.arrivalTimestampsSecondsFromStart : m.arrivalPattern;
      const index = Number(path.split('.')[4]), part = path.split('.')[5];
      if (node.arrival.kind === 'poisson' && Number.isInteger(index)) targetField = part === 'end' ? ease.periodEnd(index + 1) : part === 'perHour' ? ease.periodRate(index + 1) : ease.periodStart(index + 1);
    }
    if (node?.kind === 'service' && field === 'resources') {
      const index = Number(path.split('.')[3]), requirement = node.resources[Number.isInteger(index) ? index : 0];
      const pool = project.model.resources.find(pool => pool.id === requirement?.poolId);
      targetField = !pool || node.resources.some((item,j) => j !== index && item.poolId === requirement?.poolId) ? m.requirementResource(Number.isInteger(index) ? index + 1 : 1) : m.requirementUnitsPerStart(Number.isInteger(index) ? index + 1 : 1);
    }
    if (node?.kind === 'source' && field === 'classes') {
      const index = Number(path.split('.')[3]), item = node.classes[Number.isInteger(index) ? index : 0], n = Number.isInteger(index) ? index + 1 : 1;
      targetField = !Number.isInteger(index) ? m.classPercentage(1) : !item || !validIdentity(item.id) ? m.classId(n) : !item.label.trim() ? m.className(n) : !Number.isInteger(item.priority) || Math.abs(item.priority) > 1000 ? m.classPriority(n) : m.classPercentage(n);
    }
    if (pool && field === 'label') targetField = m.poolName;
    if (node && field === 'label') targetField = m.stepName;
    if (node && field === 'samplingId') targetField = m.samplingId;
    if (node && field === 'id') targetField = m.stepId;
    if (pool && field === 'id') targetField = m.poolId;
    if (pool && field === 'calendar') { const index = Number(path.split('.')[3]); targetField = ease.periodStart(Number.isInteger(index) ? index + 1 : 1); }
    return { globalNodes: scope === 'nodes' && !node, node, pool, subject: node?.label ?? pool?.label ?? project.name, field: targetField };
  }
  function goToIssue(path: string) {
    const target = issueTarget(path), context = project.id;
    if (target.globalNodes) setStepsOpen(true);
    if (target.node) { setTab('steps'); select(target.node.id); }
    else setTab(target.pool ? 'resources' : target.globalNodes ? 'steps' : 'run');
    requestAnimationFrame(() => {
      const root = editorRoot.current;
      if (!root?.isConnected || root.dataset.projectId !== context) return;
      const scope = target.pool ? [...root.querySelectorAll<HTMLElement>('[data-pool-id]')].find(element => element.dataset.poolId === target.pool!.id) ?? root : target.node ? root.querySelector<HTMLElement>('.ql-step-detail') ?? root : root;
      if (target.globalNodes) {
        const control = root.querySelector<HTMLElement>('.ql-step-navigation ol button') ?? root.querySelector<HTMLElement>('.ql-step-navigation select');
        control?.scrollIntoView({ block: 'center', inline: 'nearest' }); control?.focus({ preventScroll: true }); return;
      }
      const controls = [...scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')];
      let control = controls.find(element => [...(element.labels ?? [])].some(label => label.textContent?.trim() === target.field));
      if (!control && /\.classes$|\.branches$/.test(path)) control = controls.find(element => [...(element.labels ?? [])].some(label => label.textContent?.includes('(%)')));
      if (!control && path.endsWith('horizon')) control = controls.find(element => [...(element.labels ?? [])].some(label => label.textContent?.includes('Run length')));
      if (!control) control = controls.find(element => !element.closest('details.ql-advanced')) ?? controls[0];
      for (let parent = control?.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      control?.scrollIntoView({ block: 'center' }); control?.focus({ preventScroll: true });
    });
  }
  return <div key={project.id} ref={editorRoot} data-project-id={project.id} className="ql-feature ql-model-editor"><div className="ql-toolbar" role="group" aria-label={m.modelSections}>{(['steps', 'resources', 'run'] as const).map(section => <button type="button" className={`ql-tab ${tab === section ? 'ql-active' : ''}`} aria-pressed={tab === section} key={section} onClick={() => setTab(section)}>{section === 'steps' ? m.processSteps(project.model.nodes.length) : section === 'resources' ? m.resources(project.model.resources.length) : m.runProject}</button>)}</div>
    <details className="ql-editor-guide"><summary>{ui.editingGuide}</summary><p>{m.allDurationsUseSecondsDraftEditsCanBeIncomplete}</p><p>{m.useCheckboxesToSelectSeveralStepsChooseASelected}</p></details>
    {message && <p role="alert" className="ql-error">{message}</p>}
    {tab === 'steps' && <><div className="selection-summary" role="group" aria-label={m.modelSelection}><span>{m.selectionSummary(selection.length, selected ? selected.label || m.unnamedStep : undefined)}</span><button type="button" disabled={!selection.length} onClick={() => select(null)}>{m.clearSelection}</button></div>{onMove && selection.length > 0 && <SelectionMoveControls project={project} ids={selection} onMove={onMove} />}<ProcessActions project={project} ids={selection} primaryId={selected?.id} onChange={onChange} onCreated={id => select(id, 'single')} /><div className="ql-mobile-navigation"><label>{ui.selectedStep}<select aria-label={ui.selectedStep} value={selected?.id ?? ''} onChange={event => select(event.currentTarget.value || null)}><option value="">{ui.chooseStep}</option>{project.model.nodes.map(node => <option key={node.id} value={node.id}>{node.label || m.unnamedStep}</option>)}</select></label><button className="ql-button" type="button" aria-expanded={stepsOpen} aria-controls={stepNavigationId} onClick={() => setStepsOpen(open => !open)}>{stepsOpen ? ui.hideSteps : ui.manageSteps}</button></div><div className="ql-editor-layout"><aside id={stepNavigationId} className={`ql-step-navigation${stepsOpen ? ' is-expanded' : ''}`} aria-label={m.processStepsNavigation}><div className="ql-step-scroll" role="region" aria-label={m.processStepsScrollToInspect} tabIndex={0}><ol>{project.model.nodes.map((node, i) => <li key={node.id} className={`ql-selectable-step ${selection.includes(node.id) ? 'ql-in-selection' : ''}`}><label><input type="checkbox" checked={selection.includes(node.id)} aria-label={m.selectForGroupEditing(node.label || m.unnamedStep)} onChange={() => select(node.id, 'toggle')} /></label><button className={selected?.id === node.id ? 'ql-current-step' : ''} type="button" aria-current={selected?.id === node.id ? 'step' : undefined} onClick={() => select(node.id)}><span>{String(i + 1).padStart(2, '0')}</span><span><b>{node.label || m.unnamedStep}</b><small>{stepKindLabels[node.kind]}</small></span></button></li>)}</ol></div><Choice label={m.newStepType} value={addKind} onChange={v => setAddKind(v as ModelNode['kind'])} options={(['source', 'queue', 'service', 'route', 'delay', 'sink'] as const).map(value => ({ value, label: stepTypeLabels[value] }))} /><button className="ql-button ql-primary" type="button" disabled={project.model.nodes.length >= 100} onClick={() => attempt(() => { const added = addNode(project, addKind); onChange(added.project, m.add(added.project.model.nodes.find(node => node.id === added.id)!.label)); select(added.id, 'single'); })}>{m.addStep}</button></aside>
      {selected && <section key={selected.id} className="ql-step-detail" aria-label={m.selectedStepSettings}><div className="ql-section-heading"><div><span className="ql-eyebrow">{stepKindLabels[selected.kind]}</span><h3>{selected.label || m.unnamedStep}</h3></div><button type="button" className="ql-button ql-danger" onClick={() => { setPendingDelete(selected.id); setReplacement(''); }}>{m.deleteStep}</button></div><Text label={m.stepName} value={selected.label} onChange={label => updateNode({ ...selected, label })} />
        {pendingDelete === selected.id && <div className="ql-delete-review" role="group" aria-label={m.reviewStepDeletion}><strong>{m.deleteName(selected.label)}</strong><p>{m.stepDeletionImpact(inbound.length ? m.incomingConnections(inbound.length, inbound.map(n => n.label).join(', ')) : m.noIncomingConnectionsReferToThisStep)}</p>{inbound.length > 0 && <Choice label={m.replacementForIncomingConnections} value={replacement} onChange={setReplacement} options={[{ value: '', label: m.leaveDisconnectedRepairBeforeRunning }, ...destinations(selected.id).filter(o => o.value && o.value !== selected.id)]} />}<div className="ql-actions"><button type="button" className="ql-button ql-danger" onClick={() => attempt(() => { onChange(removeNode(project, selected.id, replacement), m.deleteHistoryAction(selected.label || selected.kind)); if (selectedId === undefined) select(project.model.nodes.find(n => n.id !== selected.id)?.id ?? null); })}>{m.deleteAction(Boolean(replacement))}</button><button type="button" className="ql-button" onClick={() => setPendingDelete(null)}>{m.cancel}</button></div></div>}
        {'next' in selected && <ConnectionPicker project={project} node={selected} onChange={onChange} allowInvalidDraft />}
        {selected.kind === 'source' && <Arrivals node={selected} horizon={project.model.horizon} onChange={updateNode} />}
        {selected.kind === 'queue' && <><Choice label={m.waitingCapacity} value={selected.capacity === null ? 'unlimited' : 'limited'} onChange={value => updateNode({ ...selected, capacity: value === 'unlimited' ? null : 10 })} options={[{ value: 'unlimited', label: m.unlimited }, { value: 'limited', label: m.limitedWaitingPlaces }]} help={m.onlyWaitingWorkCountsAgainstThisLimitWorkAlready} />{selected.capacity !== null && <Numeric label={m.waitingPlaces} min={0} max={MAX_WAITING_PLACES} step={1} value={selected.capacity} onChange={capacity => updateNode({ ...selected, capacity })} />}<Choice label={m.queueDiscipline} value={selected.discipline} options={[{ value: 'fifo', label: m.firstInFirstOut }, { value: 'priority', label: m.nonpreemptiveClassPriority }]} onChange={discipline => updateNode({ ...selected, discipline: discipline as 'fifo' | 'priority' })} help={m.feasibleFirstAllocationMayBypassAnOlderRequestWhose} /><Choice label={m.patience} value={selected.patience === null ? 'none' : 'timed'} options={[{ value: 'none', label: m.noAbandonment }, { value: 'timed', label: m.abandonAfterASampledWait }]} onChange={value => updateNode({ ...selected, patience: value === 'none' ? null : { kind: 'constant', value: 300 } })} />{selected.patience && <DistributionFields label={m.patience} value={selected.patience} allowZero onChange={patience => updateNode({ ...selected, patience })} />}</>}
        {selected.kind === 'service' && <><Numeric label={m.parallelServers} value={selected.servers} min={1} max={1000} step={1} onChange={servers => updateNode({ ...selected, servers })} help={m.concurrencyIsSeparateFromSharedPoolCapacityBothLimits} /><DistributionFields value={selected.duration} onChange={duration => updateNode({ ...selected, duration })} /><details className="ql-editor-section"><summary>{m.requirementCount(selected.resources.length)}</summary><fieldset className="ql-subsection"><legend>{m.requirementCount(selected.resources.length)}</legend><p className="ql-help">{m.allRequestedUnitsAreAllocatedTogetherAnEmptyList}</p>{selected.resources.map((req, i) => <div className="ql-repeat-row" key={i}><div className="ql-grid"><Choice label={m.requirementResource(i + 1)} value={req.poolId} options={[{ value: '', label: m.chooseAPool }, ...(!project.model.resources.some(p => p.id === req.poolId) && req.poolId ? [{ value: req.poolId, label: m.missingPool(req.poolId) }] : []), ...project.model.resources.map(p => ({ value: p.id, label: p.label }))]} onChange={poolId => updateNode({ ...selected, resources: selected.resources.map((r, j) => j === i ? { ...r, poolId } : r) })} /><Numeric label={m.requirementUnitsPerStart(i + 1)} value={req.units} min={1} max={1000} step={1} onChange={units => updateNode({ ...selected, resources: selected.resources.map((r, j) => j === i ? { ...r, units } : r) })} /></div><button className="ql-button ql-danger" type="button" onClick={() => updateNode({ ...selected, resources: selected.resources.filter((_, j) => i !== j) })}>{m.removeRequirement(i + 1)}</button></div>)}<button className="ql-button" type="button" disabled={selected.resources.length >= 10 || !project.model.resources.some(p => !selected.resources.some(r => r.poolId === p.id))} onClick={() => updateNode({ ...selected, resources: [...selected.resources, { poolId: project.model.resources.find(p => !selected.resources.some(r => r.poolId === p.id))!.id, units: 1 }] })}>{m.addResourceRequirement}</button></fieldset></details></>}
        {selected.kind === 'delay' && <DistributionFields label={m.delay} value={selected.duration} allowZero onChange={duration => updateNode({ ...selected, duration })} />}
        {selected.kind === 'route' && <fieldset className="ql-subsection"><legend>{m.destinationCount(selected.branches.length)}</legend><p className="ql-help" role="status">{m.percentageTotal(selected.branches.reduce((sum, branch) => sum + branch.probability, 0) * 100)}</p><p className="ql-help">{m.routeProbabilityHelp}</p>{selected.branches.map((branch, i) => <div className="ql-repeat-row" key={i}><div className="ql-grid"><Choice label={m.branchDestination(i + 1)} value={branch.to} options={destinations(selected.id)} onChange={to => updateNode({ ...selected, branches: selected.branches.map((b, j) => j === i ? { ...b, to } : b) })} /><Numeric label={m.branchPercentage(i + 1)} value={branch.probability * 100} min={0} max={100} onChange={percentage => updateNode({ ...selected, branches: selected.branches.map((b, j) => j === i ? { ...b, probability: percentage / 100 } : b) })} /></div><button className="ql-button ql-danger" type="button" disabled={selected.branches.length <= 1} onClick={() => updateNode({ ...selected, branches: selected.branches.filter((_, j) => i !== j) })}>{m.removeBranch(i + 1)}</button></div>)}<button className="ql-button" type="button" disabled={selected.branches.length >= 100} onClick={() => updateNode({ ...selected, branches: [...selected.branches, { to: '', probability: 0 }] })}>{m.addBranch}</button></fieldset>}
        {selected.kind === 'sink' && <p className="ql-help">{m.workReachingThisExitIsMarkedCompletedItHas}</p>}
        <details className="ql-advanced" key={selected.id}><summary>{m.identityVisualPosition}</summary><p className="ql-help">{m.stepIDsConnectTheGraphRenamingPreservesLinksSampling}</p><IdentityEditor label={m.stepId} value={selected.id} inputRef={stepIdentityInput} onApply={id => attempt(() => { const next = renameNode(project, selected.id, id); commitIdentityRename(next, 'step', id, m.renameId(selected.label || selected.kind)); if (selectedId === undefined) select(id, 'single'); })} /><IdentityEditor label={m.samplingId} value={selected.samplingId} onApply={samplingId => attempt(() => { if (!validIdentity(samplingId) || project.model.nodes.some(n => n.id !== selected.id && n.samplingId === samplingId)) throw new Error(m.invalidSamplingId); updateNode({ ...selected, samplingId }); })} /><div className="ql-grid">{(['x', 'z'] as const).map(axis => <Numeric key={axis} label={m.visualPosition(axis)} value={project.layout[selected.id]?.[axis] ?? 0} min={-100} max={100} onChange={value => edit(p => { p.layout[selected.id] = { ...(p.layout[selected.id] ?? { x: 0, z: 0 }), [axis]: value }; })} />)}</div><p className="ql-help">{m.visualCoordinatesDoNotAffectSimulationTimeOrResults}</p></details>
      </section>}{!selected && <p className="ql-help">{m.selectAStepNameToInspectItsSettingsOr}</p>}</div></>}
    {tab === 'resources' && <section aria-label={m.resourcePools}><p className="ql-help">{m.resourceCapacityHelp}</p>{project.model.resources.map(pool => <section className="ql-resource-section" data-pool-id={pool.id} key={pool.id}><div className="ql-section-heading"><h3>{pool.label || m.unnamedPool}</h3><button className="ql-button ql-danger" type="button" onClick={() => setPoolDelete(pool.id)}>{m.deletePool}</button></div>{poolDelete === pool.id && <div className="ql-delete-review"><strong>{m.deleteName(pool.label)}</strong><p>{m.poolDeletionImpact(project.model.nodes.filter(n => n.kind === 'service' && n.resources.some(r => r.poolId === pool.id)).length)}</p><div className="ql-actions"><button className="ql-button ql-danger" type="button" onClick={() => { edit(p => { p.model.resources = p.model.resources.filter(r => r.id !== pool.id); }); setPoolDelete(null); }}>{m.deletePoolKeepReferencesForRepair}</button><button className="ql-button" type="button" onClick={() => setPoolDelete(null)}>{m.cancel}</button></div></div>}<Text label={m.poolName} value={pool.label} onChange={label => updatePool({ ...pool, label })} /><div className="ql-grid"><Numeric label={m.installedUnits} value={pool.installedCapacity} min={1} max={1000} step={1} onChange={installedCapacity => updatePool({ ...pool, installedCapacity })} /><Numeric label={m.baseScheduledUnits} value={pool.capacity} min={0} max={pool.installedCapacity} step={1} onChange={capacity => updatePool({ ...pool, capacity })} /><Numeric label={m.scheduledCostUnitHour(project.model.currency)} value={pool.costPerHour} min={0} max={1e6} onChange={costPerHour => updatePool({ ...pool, costPerHour })} /><Numeric label={m.overtimeCostUnitHour(project.model.currency)} value={pool.overtimeCostPerHour} min={0} max={1e6} onChange={overtimeCostPerHour => updatePool({ ...pool, overtimeCostPerHour })} /></div><details className="ql-editor-section"><summary>{m.calendarPeriodCount(pool.calendar.length)}</summary><ScheduleEditor kind="calendar" periods={pool.calendar} horizon={project.model.horizon} baseCapacity={pool.capacity} installedCapacity={pool.installedCapacity} contextKey={`${project.id}:${pool.id}:calendar`} onChange={calendar => updatePool({ ...pool, calendar })} /></details><details className="ql-advanced"><summary>{m.poolIdentity}</summary><IdentityEditor label={m.poolId} value={pool.id} inputRef={input => { if (input) poolIdentityInputs.current.set(pool.id, input); else poolIdentityInputs.current.delete(pool.id); }} onApply={id => attempt(() => { if (!validIdentity(id) || project.model.resources.some(p => p.id === id && p.id !== pool.id)) throw new Error(m.invalidPoolId); const next = mutateProject(project, p => { p.model.resources.find(r => r.id === pool.id)!.id = id; for (const n of p.model.nodes) if (n.kind === 'service') for (const req of n.resources) if (req.poolId === pool.id) req.poolId = id; }); commitIdentityRename(next, 'pool', id); })} /></details></section>)}<button className="ql-button ql-primary" type="button" disabled={project.model.resources.length >= 50} onClick={() => edit(p => { p.model.resources.push({ id: uniqueIdentity('pool', p.model.resources.map(r => r.id)), label: 'New resource pool', installedCapacity: 1, capacity: 1, calendar: [], costPerHour: 0, overtimeCostPerHour: 0 }); })}>{m.addResourcePool}</button></section>}
    {tab === 'run' && <section aria-label={m.runAndProjectSettings}><div className="ql-grid"><Text label={m.projectName} value={project.name} onChange={name => edit(p => { p.name = name; })} /><Text label={m.modelName} value={project.model.name} onChange={name => edit(p => { p.model.name = name; })} /><Choice label={m.visualWorld} value={project.world} options={[{ value: 'factory', label: m.factory }, { value: 'festival', label: m.festival }, { value: 'service', label: m.serviceStudio }]} onChange={world => edit(p => { p.world = world as Project['world']; })} /><HorizonSettings project={project} onChange={onChange} /><Numeric label={m.warmUpSeconds} value={project.model.warmup} min={0} max={project.model.horizon} onChange={warmup => edit(p => { p.model.warmup = warmup; })} /><Numeric label={m.randomSeed} value={project.model.seed} min={Number.MIN_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} step={1} onChange={seed => edit(p => { p.model.seed = seed; })} /><Numeric label={m.slaWaitTargetSeconds} value={project.model.slaSeconds} min={0} onChange={slaSeconds => edit(p => { p.model.slaSeconds = slaSeconds; })} /><Text label={m.currencyThreeLetterCode} value={project.model.currency} maxLength={3} onChange={currency => edit(p => { p.model.currency = currency.toUpperCase(); })} /></div><Field label={m.projectDescription}><textarea aria-label={m.projectDescription} value={project.description} maxLength={5000} rows={4} onChange={e => edit(p => { p.description = e.target.value; })} /></Field><p className="ql-help">{m.projectIdentity(project.id, project.model.id, project.revision)}</p></section>}
    <section className={`ql-validation ${issues.some(i => i.severity === 'error') ? 'ql-has-errors' : ''}`} aria-label={m.modelValidation} aria-live="polite"><strong>{issues.length ? m.issuesToReview(issues.length) : m.modelIsReadyToRun}</strong>{issues.length > 0 && <><p>{m.validationHint}</p><ul>{issues.map((issue, i) => { const target = issueTarget(issue.path); return <li key={`${issue.path}-${i}`}><b>{target.subject} · {target.field}</b> — {issue.message} <button type="button" className="ql-button" onClick={() => goToIssue(issue.path)}>{target.globalNodes ? m.reviewProcessSteps : m.goToIssue}</button></li>; })}</ul></>}</section>
  </div>;
}
function IdentityEditor({ label, value, onApply, inputRef }: { label: string; value: string; onApply: (value: string) => void; inputRef?: Ref<HTMLInputElement> }) {
  const [draft, setDraft] = useState(value); useEffect(() => setDraft(value), [value]);
  return <div className="ql-identity"><Text label={label} value={draft} maxLength={64} onChange={setDraft} inputRef={inputRef} /><button className="ql-button" type="button" disabled={draft === value} onClick={() => onApply(draft)}>{m.applyIdentity(label)}</button></div>;
}
