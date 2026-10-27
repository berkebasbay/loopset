import { experimentsPanelMessages as m } from '../ui/messages/ExperimentsPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FlaskConical, LoaderCircle, Play, X } from 'lucide-react';
import type { ExperimentResult, MetricEstimate, Project, RunResult } from '../model/types';
import { modelHash } from '../model/identity';
import { validateProject } from '../model/validate';
import { WorkerClient } from '../worker/client';
import { readExperimentResponse } from '../worker/protocol';
import type { ExperimentRequest, ExperimentValue } from '../worker/protocol';
import { CouplingDetails } from '../features/CouplingDetails';
import { RunProvenanceDetails } from '../features/RunProvenanceDetails';
import { CalculationBudget } from '../features/CalculationBudget';
import { CalculationStatus, useCalculationAnnouncement } from '../ui/CalculationAnnouncement';
import { prepareExperiment } from './experimentPlan';
import './lab.css';

type Result = ExperimentValue & { receipt: { id: string; elapsedMs: number; runs: number; workUnits: number } };
interface Props { project: Project; baseline: RunResult | null; onApplyCapacity: (poolId: string, capacity: number) => void }
const formatted = (n: number, unit: string) => `${n.toLocaleString('en', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
const interval = (e: MetricEstimate, unit = '') => e.samples === 0 ? m.noObservations : e.lower95 === null || e.upper95 === null ? m.requiresAtLeast2Runs : m.interval(formatted(e.lower95, unit), formatted(e.upper95, unit));
function Estimates({ experiment, currency }: { experiment: ExperimentResult; currency: string }) {
  return <table className="lab-table"><thead><tr><th>{m.metric}</th><th>{m.mean}</th><th>{m.label95Interval}</th><th>{m.runsWithObservations}</th></tr></thead><tbody>{[
    [m.completed, experiment.completed, ''], [m.meanWait, experiment.wait, m.sec], [m.meanOfRunP95s, experiment.p95Wait, m.sec], [m.resourceCost, experiment.cost, currency],
  ].map(([label, estimate, unit]) => { const e = estimate as MetricEstimate; return <tr key={String(label)}><th>{String(label)}</th><td>{e.samples ? formatted(e.mean, String(unit)) : '—'}</td><td>{interval(e, String(unit))}</td><td>{e.samples}</td></tr>; })}</tbody></table>;
}

function ExperimentRunSettings({ experiment, summary }: { experiment: ExperimentResult; summary: string }) {
  return <details className="ql-provenance"><summary>{summary}</summary><div className="ql-provenance-body"><p>{m.eachEntryPreservesTheActualSeedRngVersionAnd}</p>{experiment.runs.map((run, index) => <RunProvenanceDetails key={`${index}:${run.id}`} run={run} summary={m.runIdentity(index + 1, run.seed, run.status)} />)}</div></details>;
}

export function ExperimentsPanel({ project, baseline, onApplyCapacity }: Props) {
  const [tab, setTab] = useState<'replications' | 'paired' | 'search'>('replications');
  const [count, setCount] = useState(10); const [firstSeed, setFirstSeed] = useState(Number.isSafeInteger(project.model.seed) ? project.model.seed : 4207);
  const [poolId, setPoolId] = useState(project.model.resources.at(-1)?.id ?? '');
  const [capacities, setCapacities] = useState('1, 2, 3, 4');
  const [target, setTarget] = useState(String(baseline?.summary.completed ?? 1)); const [maxWait, setMaxWait] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [resultPoolId, setResultPoolId] = useState('');
  const [resultCurrency, setResultCurrency] = useState(project.model.currency); const [resultHash, setResultHash] = useState('');
  const [running, setRunning] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState('');
  const calculationStatus = useCalculationAnnouncement();
  const liveIdentity = useRef({ projectId: project.id, hash: '', valid: false });
  const currentHash = useMemo(() => modelHash(project.model), [project.model]);
  const pending = useRef<string | null>(null);
  const client = useRef<WorkerClient<ExperimentRequest, ExperimentValue> | null>(null);
  if (!client.current) client.current = new WorkerClient(
    () => new Worker(new URL('../worker/experiments.worker.ts', import.meta.url), { type: 'module' }),
    readExperimentResponse, state => { setRunning(state.running); setProgress(state.progress); setError(state.error ?? ''); }, 'experiment',
  );
  const currentPool = project.model.resources.find(p => p.id === poolId);
  const invalid = validateProject(project).some(i => i.severity === 'error');
  const preparation = useMemo(() => {
    try { return { value: prepareExperiment({ kind: tab, model: project.model, baseline, count, firstSeed, poolId, capacities, target, maxWait }), error: '' }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : m.checkExperimentSettings }; }
  }, [tab, project.model, baseline, count, firstSeed, poolId, capacities, target, maxWait]);
  liveIdentity.current = { projectId: project.id, hash: currentHash, valid: !invalid };
  useEffect(() => () => { pending.current = null; client.current?.dispose(); }, []);
  function cancel() {
    const id = pending.current; pending.current = null;
    if (id) calculationStatus.controller.finish(id, '');
    // WorkerClient already supplies the cancellation alert; do not speak it twice.
    client.current!.cancel();
  }
  function submit() {
    setError('');
    try {
      if (!preparation.value) throw new Error(preparation.error);
      const id = crypto.randomUUID();
      const request: ExperimentRequest = structuredClone({ ...preparation.value.request, id });
      pending.current = id;
      const hash = modelHash(project.model); const currency = project.model.currency; const searchedPool = poolId;
      const sourceProjectId = project.id; const snapshotName = project.model.name;
      calculationStatus.controller.begin(id, m.experimentStarted(snapshotName));
      const started = performance.now();
      void client.current!.run(request).then(value => {
        if (pending.current !== id) return;
        pending.current = null;
        const runs = value.kind === 'replications' ? value.value.runs : value.kind === 'paired' ? [...value.value.baseline.runs, ...value.value.candidate.runs] : [...value.value.candidates.flatMap(candidate => candidate.experiment.runs), ...(value.value.verification?.runs ?? [])];
        setResult({ ...value, receipt: { id, elapsedMs: performance.now() - started, runs: runs.length, workUnits: runs.reduce((sum, run) => sum + run.processedEvents, 0) } });
        setResultHash(hash); setResultCurrency(currency); setResultPoolId(searchedPool);
        const outcome = value.kind === 'replications' ? m.replicationFinished : value.kind === 'paired'
          ? value.value.paired ? m.pairedFinished : m.unpairedFinished
          : value.value.selectedCapacity === null ? m.searchNoCandidate : value.value.verified ? m.searchVerified : m.searchNotVerified;
        const incompleteRuns = runs.reduce((count, run) => count + Number(run.status !== 'completed'), 0);
        const message = liveIdentity.current.projectId === sourceProjectId
          ? m.experimentFinished(snapshotName, runs.length, incompleteRuns, !liveIdentity.current.valid || liveIdentity.current.hash !== hash, outcome) : '';
        calculationStatus.controller.finish(id, message);
      }).catch(() => { if (pending.current === id) { pending.current = null; calculationStatus.controller.finish(id, ''); } });
    } catch (e) { setError(e instanceof Error ? e.message : m.checkExperimentSettings); }
  }
  const stale = Boolean(result && resultHash !== currentHash);
  return <div className="lab-panel">
    <CalculationStatus announcement={calculationStatus.announcement} label={m.experimentStatus} />
    <p className="lab-intro">{m.aSingleRunTellsOneStoryRepeatItWith}</p>
    <div className="lab-tabs" role="tablist" aria-label={m.experimentType}>{(['replications', 'paired', 'search'] as const).map(kind => <button key={kind} role="tab" aria-selected={tab === kind} disabled={running} onClick={() => setTab(kind)}>{kind === 'replications' ? m.independentRuns : kind === 'paired' ? m.pairedComparison : m.capacitySearch}</button>)}</div>
    <div className="lab-settings"><label>{m.independentRuns}<input type="number" min="1" max="100" value={count} disabled={running} onChange={e => setCount(Number(e.target.value))} /></label><label>{m.firstSeed}<input type="number" step="1" value={firstSeed} disabled={running} onChange={e => setFirstSeed(Number(e.target.value))} /></label><div className="lab-seed-note">{m.seedRange(firstSeed, firstSeed + count - 1)}<br />{preparation.value ? m.totalModelRuns(preparation.value.budget.minimumRuns === preparation.value.budget.maximumRuns ? preparation.value.budget.maximumRuns : `${preparation.value.budget.minimumRuns}–${preparation.value.budget.maximumRuns}`) : m.checkSettings}</div></div>
    {tab === 'paired' && <div className="lab-note"><FlaskConical size={17} /><span>{baseline ? m.pairedBaselineScope(baseline.modelHash) : m.runAModelAndPreserveABaselineBeforeComparing}</span></div>}
    {tab === 'search' && <><div className="lab-settings"><label>{m.resourcePool}<select value={poolId} disabled={running} onChange={e => setPoolId(e.target.value)}>{project.model.resources.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>{m.candidateCapacities}<input value={capacities} disabled={running} onChange={e => setCapacities(e.target.value)} placeholder="1, 2, 3, 4" /></label></div><div className="lab-settings"><label>{m.minimumMeanCompleted}<input type="number" min="0" disabled={running} value={target} onChange={e => setTarget(e.target.value)} placeholder={m.noConstraint} /></label><label>{m.maximumMeanWaitSeconds}<input type="number" min="0" disabled={running} value={maxWait} onChange={e => setMaxWait(e.target.value)} placeholder={m.noConstraint} /></label></div><p className="lab-small">{m.capacitySearchScope(currentPool?.installedCapacity ?? '—')}</p></>}
    {preparation.value ? <details className="lab-preflight"><summary>{m.beforeRunningWorkEstimateLimits}</summary><CalculationBudget budget={preparation.value.budget} /></details> : <p className="lab-error" role="alert">{preparation.error}</p>}
    <div className="lab-actions"><button className="primary-button" disabled={running || invalid || !preparation.value} onClick={submit}>{running ? <LoaderCircle size={15} className="spin" /> : <Play size={14} />} {running ? m.progress(Math.round(progress * 100)) : tab === 'search' ? m.evaluateCandidates : m.runExperiment}</button>{running && <button className="secondary-button" onClick={cancel}><X size={14} />{m.cancelExperiment}</button>}</div>
    {running && <progress className="lab-progress" max="1" value={progress} aria-label={m.experimentProgress} />}
    {error && <p role="alert" className="lab-error">{error}</p>}
    {stale && <p className="lab-note">{m.thisExperimentBelongsToAnEarlierModelSnapshotRun}</p>}
    {result && <section className="lab-results" aria-label={m.experimentResults}>
      <dl className="lab-receipt" aria-label={m.completedExperimentWork}><div><dt>{m.elapsedOnThisDevice}</dt><dd>{Math.round(result.receipt.elapsedMs).toLocaleString('en')}{m.ms}</dd></div><div><dt>{m.completedModelRuns}</dt><dd>{result.receipt.runs}</dd></div><div><dt>{m.processedWorkUnits}</dt><dd>{result.receipt.workUnits.toLocaleString('en')}</dd></div></dl><p className="lab-small">{m.receiptScope(result.receipt.id)}</p>
      {result.kind === 'replications' && <><h3>{m.replicationHeading(result.value.seeds.length)}</h3><Estimates experiment={result.value} currency={resultCurrency} /><p className="lab-small">{m.replicationScope(result.value.modelHash, result.value.seeds.join(', '))}</p><ExperimentRunSettings experiment={result.value} summary={m.actualRunSettingsIdentities} /></>}
      {result.kind === 'paired' && <><h3>{result.value.paired ? m.sameDemandPairedDifferences : m.thesePlansAreNotPaired}</h3>{result.value.reason && <p className="lab-note">{result.value.reason}</p>}{result.value.paired && <table className="lab-table"><thead><tr><th>{m.candidateBaseline}</th><th>{m.meanDifference}</th><th>{m.label95Interval}</th><th>{m.pairs}</th></tr></thead><tbody>{[[m.completed, result.value.delta.completed, ''], [m.wait, result.value.delta.wait, m.sec], [m.resourceCost, result.value.delta.cost, resultCurrency]].map(([label, estimate, unit]) => { const e = estimate as MetricEstimate; return <tr key={String(label)}><th>{String(label)}</th><td>{e.samples ? formatted(e.mean, String(unit)) : '—'}</td><td>{interval(e, String(unit))}</td><td>{e.samples}</td></tr>; })}</tbody></table>}<p className="lab-small">{m.theMatchingScopeBelowDescribesTheRecordedModelPair}</p>{result.value.baseline.runs[0] && result.value.candidate.runs[0] && <CouplingDetails manifest={result.value.coupling} baseline={result.value.baseline.runs[0]} candidate={result.value.candidate.runs[0]} includeRunSettings={false} />}<ExperimentRunSettings experiment={result.value.baseline} summary={m.baselineRunSettingsIdentities} /><ExperimentRunSettings experiment={result.value.candidate} summary={m.candidateRunSettingsIdentities} /><details><summary>{m.baselineEstimates}</summary><Estimates experiment={result.value.baseline} currency={result.value.baseline.runs[0]?.model.currency ?? resultCurrency} /></details><details><summary>{m.candidateEstimates}</summary><Estimates experiment={result.value.candidate} currency={resultCurrency} /></details></>}
      {result.kind === 'search' && <><h3>{result.value.selectedCapacity === null ? m.noFeasibleTrainingCandidate : m.selectedCapacity(result.value.selectedCapacity)}</h3><p className={result.value.verified ? 'lab-success' : 'lab-note'}>{result.value.selectedCapacity !== null ? result.value.verified ? m.theSelectedCandidateAlsoMetTheMeanConstraintsOn : m.theSelectedCandidateDidNotPassHeldOutVerification : result.value.reason}</p><table className="lab-table"><thead><tr><th>{m.capacity}</th><th>{m.meanCompleted}</th><th>{m.meanWait}</th><th>{m.meanCost}</th><th>{m.trainingConstraints}</th></tr></thead><tbody>{result.value.candidates.map(c => <tr key={c.capacity}><th>{c.capacity}</th><td>{formatted(c.experiment.completed.mean, '')}</td><td>{c.experiment.wait.samples ? formatted(c.experiment.wait.mean, m.sec) : m.noCompletions}</td><td>{formatted(c.experiment.cost.mean, resultCurrency)}</td><td>{c.feasible ? m.met : m.notMet}</td></tr>)}</tbody></table>{result.value.verification && <details><summary>{m.heldOutVerificationEstimates}</summary><Estimates experiment={result.value.verification} currency={resultCurrency} /></details>}<p className="lab-small">{m.searchScope(result.value.totalRuns, result.value.runBudget)}</p><details className="ql-provenance"><summary>{m.actualSearchRunSettingsIdentities}</summary><div className="ql-provenance-body">{result.value.candidates.map(candidate => <ExperimentRunSettings key={candidate.capacity} experiment={candidate.experiment} summary={m.trainingCapacityRuns(candidate.capacity, candidate.experiment.runs.length)} />)}{result.value.verification && <ExperimentRunSettings experiment={result.value.verification} summary={m.heldOutVerificationRuns} />}</div></details>{result.value.verified && result.value.selectedCapacity !== null && !stale && <button className="secondary-button" onClick={() => { if (result.kind === 'search' && result.value.selectedCapacity !== null) onApplyCapacity(resultPoolId, result.value.selectedCapacity); }}>{m.applyVerifiedCapacity}<ArrowRight size={14} /></button>}</>}
    </section>}
    <p className="lab-limit">{m.uncertaintyScope}</p>
  </div>;
}
