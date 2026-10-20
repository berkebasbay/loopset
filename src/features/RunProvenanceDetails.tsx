import { useState } from 'react';
import type { RunResult } from '../model/types';
import { ReplayCoverageDetails } from './ReplayCoverageDetails';
import './provenance.css';

/** The recorded run is the only source for these settings, including literal zero caps. */
export function RunProvenanceDetails({ run, summary = 'Run settings & identity' }: { run: RunResult; summary?: string }) {
  const [showModel, setShowModel] = useState(false);
  const provenance = run.provenance;
  return <details className="ql-provenance">
    <summary>{summary}</summary>
    <div className="ql-provenance-body">
      <p>These settings belong to this recorded run of “{run.model.name}”.</p>
      <dl className="ql-provenance-values">
        <div><dt>Run</dt><dd><code>{run.id}</code> · {run.status}</dd></div>
        <div><dt>Model snapshot</dt><dd><code>{run.modelHash}</code></dd></div>
        <div><dt>External demand</dt><dd><code>{run.demandHash}</code></dd></div>
        <div><dt>Engine / RNG</dt><dd>{run.engineVersion} / {provenance?.rngVersion ?? 'Not recorded in this run'}</dd></div>
        <div><dt>Actual seed</dt><dd>{run.seed}</dd></div>
        <div><dt>Measurement settings</dt><dd>Horizon {run.model.horizon} sec · warm-up {run.model.warmup} sec · SLA {run.model.slaSeconds} sec · {run.model.currency}</dd></div>
      </dl>
      {provenance ? <>
        <h4>Limits used for this run</h4>
        <dl className="ql-provenance-values">
          <div><dt>Work units <code>maxEvents</code></dt><dd>{provenance.limits.maxEvents.toLocaleString('en')}</dd></div>
          <div><dt>External arrivals <code>maxEntities</code></dt><dd>{provenance.limits.maxEntities.toLocaleString('en')}</dd></div>
          <div><dt>Transitions per timestamp <code>maxMicrosteps</code></dt><dd>{provenance.limits.maxMicrosteps.toLocaleString('en')}</dd></div>
          <div><dt>Retained replay entities <code>maxTraceEntities</code></dt><dd>{provenance.limits.maxTraceEntities.toLocaleString('en')}</dd></div>
          <div><dt>Retained replay events <code>maxTraceEvents</code></dt><dd>{provenance.limits.maxTraceEvents.toLocaleString('en')}</dd></div>
        </dl>
        <p>Zero is a literal cap. Work units count engine processing work, rather than replay events. Replay caps limit retained detail; reaching them alone does not make numerical results incomplete. These count limits are not a total memory guarantee.</p>
      </> : <p>The RNG version and effective limits were not recorded in this older run. A new calculation records them; no values have been inferred here.</p>}
      <p>Processed {run.processedEvents.toLocaleString('en')} work units. Observed through {run.simulatedUntil} / {run.model.horizon} sec. Replay: {run.trace.complete ? 'complete' : `retained through ${run.trace.until} sec`}.</p>
      <ReplayCoverageDetails run={run} />
      <details onToggle={event => setShowModel(event.currentTarget.open)}>
        <summary>Exact run model inputs</summary>
        {showModel && <pre className="ql-provenance-json">{JSON.stringify(run.model, null, 2)}</pre>}
      </details>
    </div>
  </details>;
}
