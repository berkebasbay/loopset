import { couplingDetailsMessages as m } from '../ui/messages/CouplingDetails';
import { useState } from 'react';
import type { CouplingChange, CouplingManifest, CouplingMatch, ModelNode, RunResult, SimulationModel } from '../model/types';
import { RunProvenanceDetails } from './RunProvenanceDetails';
import './provenance.css';

const changeLabels: Record<CouplingChange, string> = {
  arrival: m.arrivalPattern, classes: m.classProbabilitiesOrPriorities, distribution: m.timeDistribution,
  routing: m.nextStepsOrRouteProbabilities, queuePolicy: m.queuePolicy, capacity: m.capacity, resources: m.resourceRequirementsOrPoolSettings,
};
const kinds = (values: readonly string[]) => values.length ? values.join(', ') : m.none;
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
    <summary>{changes.length ? m.changedValuesComponentInputSnapshots : m.componentInputSnapshots}</summary>
    {open && <>
      {changes.map(change => <div key={change} className="ql-provenance-change"><h5>{changeLabels[change]}</h5><p>{m.baseline}</p><pre className="ql-provenance-json" tabIndex={0} role="region" aria-label={m.baselineData(changeLabels[change])}>{JSON.stringify(parameter(change, baselineNode, baseline.model), null, 2)}</pre><p>{m.candidate}</p><pre className="ql-provenance-json" tabIndex={0} role="region" aria-label={m.candidateData(changeLabels[change])}>{JSON.stringify(parameter(change, candidateNode, candidate.model), null, 2)}</pre></div>)}
      <div className="ql-provenance-snapshots">
        {baselineNode && <div><h5>{m.baselineComponentHeading(baselineNode.label)}</h5><pre className="ql-provenance-json" tabIndex={0} role="region" aria-label={m.baselineInputs(baselineNode.label)}>{JSON.stringify(componentInputs(baselineNode, baseline.model), null, 2)}</pre></div>}
        {candidateNode && <div><h5>{m.candidateComponentHeading(candidateNode.label)}</h5><pre className="ql-provenance-json" tabIndex={0} role="region" aria-label={m.candidateInputs(candidateNode.label)}>{JSON.stringify(componentInputs(candidateNode, candidate.model), null, 2)}</pre></div>}
      </div>
    </>}
  </details>;
}
function Match({ match, baseline, candidate }: { match: CouplingMatch; baseline: RunResult; candidate: RunResult }) {
  const a = nodeIn(baseline, match.baselineNodeId); const b = nodeIn(candidate, match.candidateNodeId);
  const noDraws = !match.baselineDrawKinds.length && !match.candidateDrawKinds.length;
  return <li>
    <p><strong>{m.componentPair(a?.label ?? match.baselineNodeId, b?.label ?? match.candidateNodeId)}</strong></p>
    <p>{m.identityMatched}{match.kind}{m.samplingId}<code>{match.samplingId}</code><br />{m.nodeIDs}<code>{match.baselineNodeId}</code> → <code>{match.candidateNodeId}</code></p>
    <p>{noDraws ? m.noKeyedRandomDrawsInEitherSnapshotOnlyThe : <>{m.potentialSharedDrawKinds}<strong>{kinds(match.sharedDrawKinds)}</strong>{m.baselineDrawKinds}{kinds(match.baselineDrawKinds)}{m.candidateDrawKinds}{kinds(match.candidateDrawKinds)}.</>}</p>
    <p>{match.changes.length ? m.changed(match.changes.map(change => changeLabels[change]).join('; ')) : m.noModeledParameterChangesDetectedForThisComponent}</p>
    <SnapshotSettings baselineNode={a} candidateNode={b} baseline={baseline} candidate={candidate} changes={match.changes} />
  </li>;
}

export function CouplingDetails({ manifest, baseline, candidate, includeRunSettings = true }: { manifest: CouplingManifest; baseline: RunResult; candidate: RunResult; includeRunSettings?: boolean }) {
  if (!manifest) return <p className="ql-provenance-unavailable">{m.theMatchingScopeWasNotRecordedInThisOlder}</p>;
  const compatibility = manifest.compatibility;
  return <details className="ql-provenance ql-coupling">
    <summary>{m.howTheseRunsAreLinked}</summary>
    <div className="ql-provenance-body">
      <p>{m.matchingIdentitiesCanReuseTheSameRawRandomInputs}</p>
      <p>{m.baselinePrefix}<strong>{baseline.model.name}</strong>{m.snapshot}<code>{baseline.modelHash}</code><br />{m.candidatePrefix}<strong>{candidate.model.name}</strong>{m.snapshot}<code>{candidate.modelHash}</code></p>
      <dl className="ql-provenance-values">
        <div><dt>{m.externalArrivalsAndClasses}</dt><dd>{compatibility.sameExternalDemand ? m.sameModeledDemand : m.differBetweenTheseSnapshots}</dd></div>
        <div><dt>{m.measurementAndCurrency}</dt><dd>{compatibility.sameMeasurementPolicies ? m.samePolicies : m.differentHorizonWarmUpSlaOrCurrency}</dd></div>
        <div><dt>{m.actualSeed}</dt><dd>{baseline.seed} / {candidate.seed} · {compatibility.sameSeed ? m.same : m.different}</dd></div>
        <div><dt>{m.rngVersion}</dt><dd>{manifest.rngVersions.baseline} / {manifest.rngVersions.candidate} · {compatibility.sameRngVersion ? m.same : m.different}</dd></div>
      </dl>
      <h4>{m.matchedSourceCount(manifest.matchedSources.length)}</h4>
      {manifest.matchedSources.length ? <ul className="ql-provenance-components">{manifest.matchedSources.map(match => <Match key={match.samplingId} match={match} baseline={baseline} candidate={candidate} />)}</ul> : <p>{m.noSourceIdentitiesMatchStageKeysCannotBeShared}</p>}
      <h4>{m.matchedStageCount(manifest.matchedStages.length)}</h4>
      {manifest.matchedStages.length ? <ul className="ql-provenance-components">{manifest.matchedStages.map(match => <Match key={match.samplingId} match={match} baseline={baseline} candidate={candidate} />)}</ul> : <p>{m.noStageIdentitiesMatch}</p>}
      <h4>{m.unmatchedCount(manifest.unmatched.length)}</h4>
      {manifest.unmatched.length ? <ul className="ql-provenance-components">{manifest.unmatched.map(({ side, component, reason }) => {
        const node = nodeIn(side === 'baseline' ? baseline : candidate, component.nodeId);
        return <li key={`${side}:${component.samplingId}`}><p><strong>{side === 'baseline' ? m.baseline : m.candidate}: {node?.label ?? component.nodeId}</strong> · {component.kind}</p><p>{m.samplingIdPrefix}<code>{component.samplingId}</code>{m.node}<code>{component.nodeId}</code><br />{reason === 'kind-changed' ? m.thisSamplingIdRefersToADifferentKindOf : m.thisSamplingIdIsAbsentFromTheOtherSnapshot}{m.noCorrespondingKeyedDrawsAreSharedForThisComponent}{kinds(component.drawKinds)}.</p><SnapshotSettings baselineNode={side === 'baseline' ? node : undefined} candidateNode={side === 'candidate' ? node : undefined} baseline={baseline} candidate={candidate} /></li>;
      })}</ul> : <p>{m.everySourceAndStageIdentityHasACorrespondingComponent}</p>}
      <details>
        <summary>{m.keyMethodFullScopeCaveats}</summary>
        <p>{m.keyEncoding}<code>{manifest.rawKeys.encoding}</code>{m.ordinalsStartAt}{manifest.rawKeys.ordinalBase}.</p>
        <dl className="ql-provenance-values">{(['arrival', 'class', 'stage'] as const).map(kind => <div key={kind}><dt>{m.keyHeading(kind)}</dt><dd><code>{JSON.stringify(manifest.rawKeys[kind])}</code></dd></div>)}</dl>
        <p>{manifest.rawKeys.visitScope}</p><p>{manifest.rawKeys.replicationScope}</p>
        <ul className="ql-provenance-caveats">{manifest.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>
      </details>
      {includeRunSettings && <><RunProvenanceDetails run={baseline} summary={m.baselineRunSettingsIdentity} /><RunProvenanceDetails run={candidate} summary={m.candidateRunSettingsIdentity} /></>}
    </div>
  </details>;
}
