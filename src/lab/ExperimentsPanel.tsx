import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FlaskConical, LoaderCircle, Play, X } from 'lucide-react';
import type { CapacitySearchResult, CapacitySearchSpec } from '../experiments';
import type { ExperimentResult, MetricEstimate, PairedComparison, Project, RunResult } from '../model/types';
import { modelHash } from '../model/identity';
import { validateProject } from '../model/validate';
import type { LabRequest } from '../worker/experiments.worker';
import { CouplingDetails } from '../features/CouplingDetails';
import { RunProvenanceDetails } from '../features/RunProvenanceDetails';
import './lab.css';

type Result = { kind: 'replications'; value: ExperimentResult } | { kind: 'paired'; value: PairedComparison } | { kind: 'search'; value: CapacitySearchResult };
interface Props { project: Project; baseline: RunResult | null; onApplyCapacity: (poolId: string, capacity: number) => void }
const formatted = (n: number, unit: string) => `${n.toLocaleString('en', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
const interval = (e: MetricEstimate, unit = '') => e.samples === 0 ? 'No observations' : e.lower95 === null || e.upper95 === null ? 'Requires at least 2 runs' : `${formatted(e.lower95, unit)} to ${formatted(e.upper95, unit)}`;
function Estimates({ experiment, currency }: { experiment: ExperimentResult; currency: string }) {
  return <table className="lab-table"><thead><tr><th>Metric</th><th>Mean</th><th>95% interval</th><th>Runs with observations</th></tr></thead><tbody>{[
    ['Completed', experiment.completed, ''], ['Mean wait', experiment.wait, 'sec'], ['Mean of run P95s', experiment.p95Wait, 'sec'], ['Resource cost', experiment.cost, currency],
  ].map(([label, estimate, unit]) => { const e = estimate as MetricEstimate; return <tr key={String(label)}><th>{String(label)}</th><td>{e.samples ? formatted(e.mean, String(unit)) : '—'}</td><td>{interval(e, String(unit))}</td><td>{e.samples}</td></tr>; })}</tbody></table>;
}

function ExperimentRunSettings({ experiment, summary }: { experiment: ExperimentResult; summary: string }) {
  return <details className="ql-provenance"><summary>{summary}</summary><div className="ql-provenance-body"><p>Each entry preserves the actual seed, RNG version and limits used by that calculation. Replay retention can be zero while numerical results are complete.</p>{experiment.runs.map((run, index) => <RunProvenanceDetails key={`${index}:${run.id}`} run={run} summary={`Run ${index + 1} · seed ${run.seed} · ${run.status}`} />)}</div></details>;
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
  const pending = useRef<{ id: string; worker: Worker } | null>(null);
  const currentPool = project.model.resources.find(p => p.id === poolId);
  const invalid = validateProject(project).some(i => i.severity === 'error');
  useEffect(() => () => pending.current?.worker.terminate(), []);
  function cancel() { pending.current?.worker.terminate(); pending.current = null; setRunning(false); setError('Experiment cancelled. No partial estimate was accepted.'); }
  function submit() {
    setError('');
    try {
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Choose 1–100 independent runs.');
      const seeds = Array.from({ length: count }, (_, i) => firstSeed + i);
      if (seeds.some(s => !Number.isSafeInteger(s))) throw new Error('Replication seeds must be safe integers.');
      const id = crypto.randomUUID(); let request: LabRequest;
      if (tab === 'replications') request = { id, kind: tab, model: structuredClone(project.model), seeds };
      else if (tab === 'paired') {
        if (!baseline) throw new Error('Create a baseline run first.');
        request = { id, kind: tab, baseline: baseline.model, model: structuredClone(project.model), seeds };
      } else {
        const values = capacities.split(',').map(v => Number(v.trim()));
        if (!capacities.trim() || capacities.split(',').some(v => !v.trim())) throw new Error('Enter comma-separated integer capacities without empty values.');
        const verificationSeeds = Array.from({ length: count }, (_, i) => firstSeed + 1_000_000 + i);
        const spec: CapacitySearchSpec = { poolId, capacities: values, trainingSeeds: seeds, verificationSeeds, maxRuns: 256,
          targetCompleted: target.trim() ? Number(target) : undefined, maxMeanWait: maxWait.trim() ? Number(maxWait) : undefined };
        request = { id, kind: tab, model: structuredClone(project.model), spec };
      }
      pending.current?.worker.terminate();
      const worker = new Worker(new URL('../worker/experiments.worker.ts', import.meta.url), { type: 'module' });
      pending.current = { id, worker }; setRunning(true); setProgress(0);
      const hash = modelHash(project.model); const currency = project.model.currency; const searchedPool = poolId;
      worker.onmessage = event => {
        if (pending.current?.id !== id || event.data.id !== id) return;
        if (event.data.type === 'progress') { setProgress(event.data.fraction); return; }
        if (event.data.type === 'result') { setResult({ kind: event.data.kind, value: event.data.value }); setResultHash(hash); setResultCurrency(currency); setResultPoolId(searchedPool); setProgress(1); }
        else setError(event.data.message ?? 'The experiment could not finish.');
        setRunning(false); pending.current = null; worker.terminate();
      };
      worker.onerror = event => { if (pending.current?.id === id) { setError(event.message || 'The experiment worker stopped unexpectedly.'); setRunning(false); pending.current = null; } worker.terminate(); };
      worker.postMessage(request);
    } catch (e) { setError(e instanceof Error ? e.message : 'Check experiment settings.'); }
  }
  const stale = Boolean(result && resultHash !== modelHash(project.model));
  return <div className="lab-panel">
    <p className="lab-intro">A single run tells one story. Repeat it with independent seeds, compare alternatives, or test a bounded set of resource capacities.</p>
    <div className="lab-tabs" role="tablist" aria-label="Experiment type">{(['replications', 'paired', 'search'] as const).map(kind => <button key={kind} role="tab" aria-selected={tab === kind} disabled={running} onClick={() => setTab(kind)}>{kind === 'replications' ? 'Independent runs' : kind === 'paired' ? 'Paired comparison' : 'Capacity search'}</button>)}</div>
    <div className="lab-settings"><label>Independent runs<input type="number" min="1" max="100" value={count} disabled={running} onChange={e => setCount(Number(e.target.value))} /></label><label>First seed<input type="number" step="1" value={firstSeed} disabled={running} onChange={e => setFirstSeed(Number(e.target.value))} /></label><div className="lab-seed-note">Seeds {firstSeed}–{firstSeed + count - 1}<br />{tab === 'paired' ? `${count * 2} total model runs` : tab === 'search' ? 'Up to 256 total model runs' : 'Sequential, independent replications'}</div></div>
    {tab === 'paired' && <div className="lab-note"><FlaskConical size={17} /><span>{baseline ? `Baseline snapshot ${baseline.modelHash}. Both plans receive the same seed list. Demand and measurement compatibility are checked before paired deltas are shown.` : 'Run a model and preserve a baseline before comparing plans.'}</span></div>}
    {tab === 'search' && <><div className="lab-settings"><label>Resource pool<select value={poolId} disabled={running} onChange={e => setPoolId(e.target.value)}>{project.model.resources.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>Candidate capacities<input value={capacities} disabled={running} onChange={e => setCapacities(e.target.value)} placeholder="1, 2, 3, 4" /></label></div><div className="lab-settings"><label>Minimum mean completed<input type="number" min="0" disabled={running} value={target} onChange={e => setTarget(e.target.value)} placeholder="No constraint" /></label><label>Maximum mean wait (seconds)<input type="number" min="0" disabled={running} value={maxWait} onChange={e => setMaxWait(e.target.value)} placeholder="No constraint" /></label></div><p className="lab-small">Only the pool’s base scheduled capacity changes. Station concurrency and calendar overrides remain unchanged. Installed limit: {currentPool?.installedCapacity ?? '—'}. The selected training candidate is checked on a disjoint held-out seed list.</p></>}
    <div className="lab-actions"><button className="primary-button" disabled={running || invalid || (tab === 'paired' && !baseline) || (tab === 'search' && !currentPool)} onClick={submit}>{running ? <LoaderCircle size={15} className="spin" /> : <Play size={14} />} {running ? `${Math.round(progress * 100)}% complete` : tab === 'search' ? 'Evaluate candidates' : 'Run experiment'}</button>{running && <button className="secondary-button" onClick={cancel}><X size={14} />Cancel experiment</button>}</div>
    {running && <progress className="lab-progress" max="1" value={progress} aria-label="Experiment progress" />}
    {error && <p role="alert" className="lab-error">{error}</p>}
    {stale && <p className="lab-note">This experiment belongs to an earlier model snapshot. Run it again to describe the current draft.</p>}
    {result && <section className="lab-results" aria-label="Experiment results">
      {result.kind === 'replications' && <><h3>{result.value.seeds.length} independent runs</h3><Estimates experiment={result.value} currency={resultCurrency} /><p className="lab-small">Snapshot {result.value.modelHash}. Seeds {result.value.seeds.join(', ')}. Wait estimates exclude runs without completed-cohort observations. P95 is the mean of each run’s P95, not a pooled-entity quantile.</p><ExperimentRunSettings experiment={result.value} summary="Actual run settings & identities" /></>}
      {result.kind === 'paired' && <><h3>{result.value.paired ? 'Same demand. Paired differences.' : 'These plans are not paired.'}</h3>{result.value.reason && <p className="lab-note">{result.value.reason}</p>}{result.value.paired && <table className="lab-table"><thead><tr><th>Candidate − baseline</th><th>Mean difference</th><th>95% interval</th><th>Pairs</th></tr></thead><tbody>{[['Completed', result.value.delta.completed, ''], ['Wait', result.value.delta.wait, 'sec'], ['Resource cost', result.value.delta.cost, resultCurrency]].map(([label, estimate, unit]) => { const e = estimate as MetricEstimate; return <tr key={String(label)}><th>{String(label)}</th><td>{e.samples ? formatted(e.mean, String(unit)) : '—'}</td><td>{interval(e, String(unit))}</td><td>{e.samples}</td></tr>; })}</tbody></table>}<p className="lab-small">The matching scope below describes the recorded model pair at its first actual seed. Each replication uses its own actual seed; inspect all run settings below.</p>{result.value.baseline.runs[0] && result.value.candidate.runs[0] && <CouplingDetails manifest={result.value.coupling} baseline={result.value.baseline.runs[0]} candidate={result.value.candidate.runs[0]} includeRunSettings={false} />}<ExperimentRunSettings experiment={result.value.baseline} summary="Baseline run settings & identities" /><ExperimentRunSettings experiment={result.value.candidate} summary="Candidate run settings & identities" /><details><summary>Baseline estimates</summary><Estimates experiment={result.value.baseline} currency={result.value.baseline.runs[0]?.model.currency ?? resultCurrency} /></details><details><summary>Candidate estimates</summary><Estimates experiment={result.value.candidate} currency={resultCurrency} /></details></>}
      {result.kind === 'search' && <><h3>{result.value.selectedCapacity === null ? 'No feasible training candidate' : `Selected capacity: ${result.value.selectedCapacity}`}</h3><p className={result.value.verified ? 'lab-success' : 'lab-note'}>{result.value.selectedCapacity !== null ? result.value.verified ? 'The selected candidate also met the mean constraints on independent held-out runs.' : 'The selected candidate did not pass held-out verification. It is not a verified recommendation.' : result.value.reason}</p><table className="lab-table"><thead><tr><th>Capacity</th><th>Mean completed</th><th>Mean wait</th><th>Mean cost</th><th>Training constraints</th></tr></thead><tbody>{result.value.candidates.map(c => <tr key={c.capacity}><th>{c.capacity}</th><td>{formatted(c.experiment.completed.mean, '')}</td><td>{c.experiment.wait.samples ? formatted(c.experiment.wait.mean, 'sec') : 'No completions'}</td><td>{formatted(c.experiment.cost.mean, resultCurrency)}</td><td>{c.feasible ? 'Met' : 'Not met'}</td></tr>)}</tbody></table>{result.value.verification && <details><summary>Held-out verification estimates</summary><Estimates experiment={result.value.verification} currency={resultCurrency} /></details>}<p className="lab-small">Evaluated {result.value.totalRuns} of {result.value.runBudget} allowed runs. Selection considers only the candidates entered, not a global optimum. Constraints concern observed means, not guaranteed outcomes.</p><details className="ql-provenance"><summary>Actual search run settings & identities</summary><div className="ql-provenance-body">{result.value.candidates.map(candidate => <ExperimentRunSettings key={candidate.capacity} experiment={candidate.experiment} summary={`Training capacity ${candidate.capacity} · ${candidate.experiment.runs.length} runs`} />)}{result.value.verification && <ExperimentRunSettings experiment={result.value.verification} summary="Held-out verification runs" />}</div></details>{result.value.verified && result.value.selectedCapacity !== null && !stale && <button className="secondary-button" onClick={() => { if (result.kind === 'search' && result.value.selectedCapacity !== null) onApplyCapacity(resultPoolId, result.value.selectedCapacity); }}>Apply verified capacity<ArrowRight size={14} /></button>}</>}
    </section>}
    <p className="lab-limit">Intervals describe sampling variation within this model. They do not validate real-world assumptions or guarantee a business outcome. With fewer than two observations, uncertainty is not estimated.</p>
  </div>;
}
