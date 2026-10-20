import { useMemo, useState } from 'react';
import type { RunResult } from '../model/types';
import { replayManifest } from '../playback';
import './provenance.css';

/** Build advanced presentation evidence only when this disclosure is requested. */
export function ReplayCoverageDetails({ run }: { run: RunResult }) {
  const [openFor, setOpenFor] = useState<RunResult | null>(null);
  const open = openFor === run;
  const manifest = useMemo(() => open ? replayManifest(run) : null, [open, run]);
  const [showIndex, setShowIndex] = useState(false);
  return <details className="ql-replay-coverage" open={open} onToggle={event => setOpenFor(event.currentTarget.open ? run : null)}>
    <summary>Replay coverage</summary>
    {manifest && <div className="ql-provenance-body">
      {manifest.coverage.length ? <>
        <p>These recorded intervals can be replayed. Both endpoints are included.</p>
        <ul aria-label="Available replay intervals">{manifest.coverage.map((interval, index) => <li key={index}><code>{String(interval.start)}</code>–<code>{String(interval.end)}</code> seconds</li>)}</ul>
        {!manifest.traceComplete && <p>Replay stops at the last fully retained timestamp. No instantaneous state is available after this coverage.</p>}
      </> : <p>No detailed replay interval was retained for this run. The timeline cannot show an observed instantaneous state.</p>}
      <p>{run.status === 'completed' ? 'Numerical results cover the full requested run, independently of replay retention.' : `Numerical results are incomplete; execution stopped at ${run.simulatedUntil} seconds.`}</p>
      <details open={showIndex} onToggle={event => setShowIndex(event.currentTarget.open)}>
        <summary>Replay index evidence</summary>
        {showIndex && <><p>Presentation checkpoints and event ranges support seeking. Estimated allocations below are accounting values, not a measurement or guarantee of total memory use.</p><pre className="ql-provenance-json">{JSON.stringify(manifest, null, 2)}</pre></>}
      </details>
    </div>}
  </details>;
}
