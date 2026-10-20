import { useState } from 'react';
import type { CouplingChange, CouplingManifest, CouplingMatch, ModelNode, RunResult, SimulationModel } from '../model/types';
import { RunProvenanceDetails } from './RunProvenanceDetails';
import './provenance.css';

const changeLabels: Record<CouplingChange, string> = {
  arrival: 'Arrival pattern', classes: 'Class probabilities or priorities', distribution: 'Time distribution',
  routing: 'Next steps or route probabilities', queuePolicy: 'Queue policy', capacity: 'Capacity', resources: 'Resource requirements or pool settings',
};
const kinds = (values: readonly string[]) => values.length ? values.join(', ') : 'None';
const nodeIn = (run: RunResult, id: string) => run.model.nodes.find(node => node.id === id);
function componentInputs(node: ModelNode | undefined, model: SimulationModel) {
  return { node, ...(node?.kind === 'service' ? { resourcePools: node.resources.map(requirement => model.resources.find(pool => pool.id === requirement.poolId)) } : {}) };
}
function parameter(change: CouplingChange, node: ModelNode | undefined, model: SimulationModel): unknown {
  if (!node) return null;
  switch (change) {
    case 'arrival': return node.kind === 'source' ? node.arrival : null;
    case 'classes': return node.kind === 'source' ? node.classes : null;
    case 'distribution': return node.kind === 'service' || node.kind === 'delay' ? node.duration : node.kind === 'queue' ? node.patience : null;
    case 'queuePolicy': return node.kind === 'queue' ? node.discipline : null;
    case 'capacity': return node.kind === 'service' ? node.servers : node.kind === 'queue' ? node.capacity : null;
    case 'resources': return node.kind === 'service' ? { requirements: node.resources, pools: componentInputs(node, model).resourcePools } : null;
    case 'routing': return node.kind === 'sink' ? null : node.kind === 'route' ? node.branches.map(branch => ({ ...branch, destination: model.nodes.find(target => target.id === branch.to)?.label })) : { next: node.next, destination: model.nodes.find(target => target.id === node.next)?.label };
  }
}
function SnapshotSettings({ baselineNode, candidateNode, baseline, candidate, changes = [] }: { baselineNode?: ModelNode; candidateNode?: ModelNode; baseline: RunResult; candidate: RunResult; changes?: CouplingChange[] }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{changes.length ? 'Changed values & component input snapshots' : 'Component input snapshots'}</summary>
    {open && <>
      {changes.map(change => <div key={change} className="ql-provenance-change"><h5>{changeLabels[change]}</h5><p>Baseline</p><pre className="ql-provenance-json">{JSON.stringify(parameter(change, baselineNode, baseline.model), null, 2)}</pre><p>Candidate</p><pre className="ql-provenance-json">{JSON.stringify(parameter(change, candidateNode, candidate.model), null, 2)}</pre></div>)}
      <div className="ql-provenance-snapshots">
        {baselineNode && <div><h5>Baseline: {baselineNode.label}</h5><pre className="ql-provenance-json">{JSON.stringify(componentInputs(baselineNode, baseline.model), null, 2)}</pre></div>}
        {candidateNode && <div><h5>Candidate: {candidateNode.label}</h5><pre className="ql-provenance-json">{JSON.stringify(componentInputs(candidateNode, candidate.model), null, 2)}</pre></div>}
      </div>
    </>}
  </details>;
}
function Match({ match, baseline, candidate }: { match: CouplingMatch; baseline: RunResult; candidate: RunResult }) {
  const a = nodeIn(baseline, match.baselineNodeId); const b = nodeIn(candidate, match.candidateNodeId);
  const noDraws = !match.baselineDrawKinds.length && !match.candidateDrawKinds.length;
  return <li>
    <p><strong>Baseline: {a?.label ?? match.baselineNodeId} → Candidate: {b?.label ?? match.candidateNodeId}</strong></p>
    <p>Identity matched · {match.kind} · sampling ID <code>{match.samplingId}</code><br />Node IDs: <code>{match.baselineNodeId}</code> → <code>{match.candidateNodeId}</code></p>
    <p>{noDraws ? 'No keyed random draws in either snapshot; only the component identity is matched.' : <>Potential shared draw kinds: <strong>{kinds(match.sharedDrawKinds)}</strong>. Baseline draw kinds: {kinds(match.baselineDrawKinds)}. Candidate draw kinds: {kinds(match.candidateDrawKinds)}.</>}</p>
    <p>{match.changes.length ? `Changed: ${match.changes.map(change => changeLabels[change]).join('; ')}.` : 'No modeled parameter changes detected for this component.'}</p>
    <SnapshotSettings baselineNode={a} candidateNode={b} baseline={baseline} candidate={candidate} changes={match.changes} />
  </li>;
}

export function CouplingDetails({ manifest, baseline, candidate, includeRunSettings = true }: { manifest: CouplingManifest; baseline: RunResult; candidate: RunResult; includeRunSettings?: boolean }) {
  if (!manifest) return <p className="ql-provenance-unavailable">The matching scope was not recorded in this older comparison. Run the experiment again to inspect it.</p>;
  const compatibility = manifest.compatibility;
  return <details className="ql-provenance ql-coupling">
    <summary>How these runs are linked</summary>
    <div className="ql-provenance-body">
      <p>Matching identities can reuse the same raw random inputs. Different settings or paths can still produce different durations and outcomes. This describes possible shared keys, not observed matched visits or draw counts.</p>
      <p>Baseline: <strong>{baseline.model.name}</strong> · snapshot <code>{baseline.modelHash}</code><br />Candidate: <strong>{candidate.model.name}</strong> · snapshot <code>{candidate.modelHash}</code></p>
      <dl className="ql-provenance-values">
        <div><dt>External arrivals and classes</dt><dd>{compatibility.sameExternalDemand ? 'Same modeled demand' : 'Differ between these snapshots'}</dd></div>
        <div><dt>Measurement and currency</dt><dd>{compatibility.sameMeasurementPolicies ? 'Same policies' : 'Different horizon, warm-up, SLA or currency'}</dd></div>
        <div><dt>Actual seed</dt><dd>{baseline.seed} / {candidate.seed} · {compatibility.sameSeed ? 'same' : 'different'}</dd></div>
        <div><dt>RNG version</dt><dd>{manifest.rngVersions.baseline} / {manifest.rngVersions.candidate} · {compatibility.sameRngVersion ? 'same' : 'different'}</dd></div>
      </dl>
      <h4>Matched source identities ({manifest.matchedSources.length})</h4>
      {manifest.matchedSources.length ? <ul className="ql-provenance-components">{manifest.matchedSources.map(match => <Match key={match.samplingId} match={match} baseline={baseline} candidate={candidate} />)}</ul> : <p>No source identities match. Stage keys cannot be shared without a matching source identity.</p>}
      <h4>Matched stage identities ({manifest.matchedStages.length})</h4>
      {manifest.matchedStages.length ? <ul className="ql-provenance-components">{manifest.matchedStages.map(match => <Match key={match.samplingId} match={match} baseline={baseline} candidate={candidate} />)}</ul> : <p>No stage identities match.</p>}
      <h4>Unmatched components ({manifest.unmatched.length})</h4>
      {manifest.unmatched.length ? <ul className="ql-provenance-components">{manifest.unmatched.map(({ side, component, reason }) => {
        const node = nodeIn(side === 'baseline' ? baseline : candidate, component.nodeId);
        return <li key={`${side}:${component.samplingId}`}><p><strong>{side === 'baseline' ? 'Baseline' : 'Candidate'}: {node?.label ?? component.nodeId}</strong> · {component.kind}</p><p>Sampling ID <code>{component.samplingId}</code> · node <code>{component.nodeId}</code><br />{reason === 'kind-changed' ? 'This sampling ID refers to a different kind of step in the other snapshot.' : 'This sampling ID is absent from the other snapshot.'} No corresponding keyed draws are shared for this component. Draw kinds: {kinds(component.drawKinds)}.</p><SnapshotSettings baselineNode={side === 'baseline' ? node : undefined} candidateNode={side === 'candidate' ? node : undefined} baseline={baseline} candidate={candidate} /></li>;
      })}</ul> : <p>Every source and stage identity has a corresponding component of the same kind.</p>}
      <details>
        <summary>Key method, full scope & caveats</summary>
        <p>Key encoding: <code>{manifest.rawKeys.encoding}</code>. Ordinals start at {manifest.rawKeys.ordinalBase}.</p>
        <dl className="ql-provenance-values">{(['arrival', 'class', 'stage'] as const).map(kind => <div key={kind}><dt>{kind} key</dt><dd><code>{JSON.stringify(manifest.rawKeys[kind])}</code></dd></div>)}</dl>
        <p>{manifest.rawKeys.visitScope}</p><p>{manifest.rawKeys.replicationScope}</p>
        <ul className="ql-provenance-caveats">{manifest.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>
      </details>
      {includeRunSettings && <><RunProvenanceDetails run={baseline} summary="Baseline run settings & identity" /><RunProvenanceDetails run={candidate} summary="Candidate run settings & identity" /></>}
    </div>
  </details>;
}
