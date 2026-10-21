import { runProvenanceDetailsMessages as m } from '../ui/messages/RunProvenanceDetails';
import { useState } from 'react';
import type { RunResult } from '../model/types';
import { ReplayCoverageDetails } from './ReplayCoverageDetails';
import './provenance.css';

/** The recorded run is the only source for these settings, including literal zero caps. */
export function RunProvenanceDetails({ run, summary = m.runSettingsIdentity }: { run: RunResult; summary?: string }) {
  const [showModel, setShowModel] = useState(false);
  const provenance = run.provenance;
  return <details className="ql-provenance">
    <summary>{summary}</summary>
    <div className="ql-provenance-body">
      <p>{m.recordedModelNote(run.model.name)}</p>
      <dl className="ql-provenance-values">
        <div><dt>{m.run}</dt><dd><code>{run.id}</code> · {run.status}</dd></div>
        <div><dt>{m.modelSnapshot}</dt><dd><code>{run.modelHash}</code></dd></div>
        <div><dt>{m.externalDemand}</dt><dd><code>{run.demandHash}</code></dd></div>
        <div><dt>{m.engineRng}</dt><dd>{run.engineVersion} / {provenance?.rngVersion ?? m.notRecordedInThisRun}</dd></div>
        <div><dt>{m.actualSeed}</dt><dd>{run.seed}</dd></div>
        <div><dt>{m.measurementSettings}</dt><dd>{m.horizon}{run.model.horizon}{m.secWarmUp}{run.model.warmup}{m.secSla}{run.model.slaSeconds}{m.sec}{run.model.currency}</dd></div>
      </dl>
      {provenance ? <>
        <h4>{m.limitsUsedForThisRun}</h4>
        <dl className="ql-provenance-values">
          <div><dt>{m.workUnits}<code>maxEvents</code></dt><dd>{provenance.limits.maxEvents.toLocaleString('en')}</dd></div>
          <div><dt>{m.externalArrivals}<code>maxEntities</code></dt><dd>{provenance.limits.maxEntities.toLocaleString('en')}</dd></div>
          <div><dt>{m.transitionsPerTimestamp}<code>maxMicrosteps</code></dt><dd>{provenance.limits.maxMicrosteps.toLocaleString('en')}</dd></div>
          <div><dt>{m.retainedReplayEntities}<code>maxTraceEntities</code></dt><dd>{provenance.limits.maxTraceEntities.toLocaleString('en')}</dd></div>
          <div><dt>{m.retainedReplayEvents}<code>maxTraceEvents</code></dt><dd>{provenance.limits.maxTraceEvents.toLocaleString('en')}</dd></div>
        </dl>
        <p>{m.zeroIsALiteralCapWorkUnitsCountEngine}</p>
      </> : <p>{m.theRngVersionAndEffectiveLimitsWereNotRecorded}</p>}
      <p>{m.processedWork(run.processedEvents.toLocaleString('en'), run.simulatedUntil, run.model.horizon, run.trace.complete ? m.complete : run.trace.until > 0 ? m.retainedThroughSec(run.trace.until) : m.noCompleteIntervalRetained)}</p>
      <ReplayCoverageDetails run={run} />
      <details onToggle={event => setShowModel(event.currentTarget.open)}>
        <summary>{m.exactRunModelInputs}</summary>
        {showModel && <pre className="ql-provenance-json" tabIndex={0} role="region" aria-label={m.exactRunModelData}>{JSON.stringify(run.model, null, 2)}</pre>}
      </details>
    </div>
  </details>;
}
