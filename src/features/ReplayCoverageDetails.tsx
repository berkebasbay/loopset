import { replayCoverageDetailsMessages as m } from '../ui/messages/ReplayCoverageDetails';
import { useMemo, useState } from 'react';
import type { RunResult } from '../model/types';
import { replayManifest } from '../playback';
import './provenance.css';

/** Build advanced presentation evidence only when this disclosure is requested. */
export function ReplayCoverageDetails({ run }: { run: RunResult }) {
  // Disclosure state keeps an opaque token, not an obsolete large RunResult.
  const identity = useMemo(() => ({}), [run]);
  const [openFor, setOpenFor] = useState<object | null>(null);
  const open = openFor === identity;
  const manifest = useMemo(() => open ? replayManifest(run) : null, [open, run]);
  const [showIndex, setShowIndex] = useState(false);
  return <details className="ql-replay-coverage" open={open} onToggle={event => setOpenFor(event.currentTarget.open ? identity : null)}>
    <summary>{m.replayCoverage}</summary>
    {manifest && <div className="ql-provenance-body">
      {manifest.coverage.length ? <>
        <p>{m.intervalEndpointsHelp}</p>
        <ul aria-label={m.availableReplayIntervals}>{manifest.coverage.map((interval, index) => <li key={index}><code>{String(interval.start)}</code>–<code>{String(interval.end)}</code>{m.seconds}</li>)}</ul>
        {!manifest.traceComplete && <p>{m.replayStopsAtTheLastFullyRetainedTimestampNo}</p>}
      </> : <p>{m.noDetailedReplayIntervalWasRetainedForThisRun}</p>}
      <p>{run.status === 'completed' ? m.completeNumericalCoverage : m.incompleteNumericalCoverage(run.simulatedUntil)}</p>
      <details open={showIndex} onToggle={event => setShowIndex(event.currentTarget.open)}>
        <summary>{m.replayIndexEvidence}</summary>
        {showIndex && <><p>{m.indexAccountingHelp}</p><pre className="ql-provenance-json" tabIndex={0} role="region" aria-label={m.replayIndexData}>{JSON.stringify(manifest, null, 2)}</pre></>}
      </details>
    </div>}
  </details>;
}
