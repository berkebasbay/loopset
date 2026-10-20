import type { CouplingChange, CouplingComponent, CouplingManifest, CouplingMatch, DrawKind, ModelNode, RunLimits, RunOptions, RunResult, SimulationModel } from '../model/types';
import { canonical } from '../model/identity';
import { assertModel } from '../model/validate';

const limit = (value: number | undefined, fallback: number, ceiling: number) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) throw new Error(`Run limit must be an integer between 0 and ${ceiling}.`);
  return value;
};

/** The engine and pre-run displays share this one normalization boundary. */
export function normalizeRunLimits(options: RunOptions = {}): RunLimits {
  return Object.freeze({
    maxEvents: limit(options.maxEvents, 1_000_000, 10_000_000),
    maxEntities: limit(options.maxEntities, 100_000, 1_000_000),
    maxMicrosteps: limit(options.maxMicrosteps, 10_000, 1_000_000),
    maxTraceEntities: limit(options.maxTraceEntities, 4_000, 100_000),
    maxTraceEvents: limit(options.maxTraceEvents, 100_000, 1_000_000),
  });
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function drawKinds(node: ModelNode): DrawKind[] {
  switch (node.kind) {
    case 'source': return node.arrival.kind === 'poisson' ? ['arrival', 'class'] : ['class'];
    case 'queue': return node.patience === null ? [] : ['patience'];
    case 'service': return ['service'];
    case 'delay': return ['delay'];
    case 'route': return ['route'];
    case 'sink': return [];
  }
}
const component = (node: ModelNode): CouplingComponent => ({ nodeId: node.id, samplingId: node.samplingId, kind: node.kind, drawKinds: drawKinds(node) });
const classes = (node: ModelNode) => node.kind === 'source'
  ? node.classes.map(({ id, probability, priority }) => ({ id, probability, priority })).sort((a, b) => compare(a.id, b.id)) : undefined;
function routing(node: ModelNode, nodes: Map<string, ModelNode>) {
  if (node.kind === 'sink') return null;
  if (node.kind === 'route') return node.branches.map(branch => ({ samplingId: nodes.get(branch.to)!.samplingId, probability: branch.probability }))
    .sort((a, b) => compare(a.samplingId, b.samplingId) || a.probability - b.probability);
  return nodes.get(node.next)!.samplingId;
}
const distribution = (node: ModelNode) => node.kind === 'service' || node.kind === 'delay' ? node.duration : node.kind === 'queue' ? node.patience : undefined;
function resources(node: ModelNode, model: SimulationModel) {
  return node.kind === 'service' ? node.resources.map(({ poolId, units }) => {
    const { label: _label, ...pool } = model.resources.find(pool => pool.id === poolId)!;
    return { poolId, units, pool };
  }).sort((a, b) => compare(a.poolId, b.poolId)) : undefined;
}

/** Bounded static description of possible shared raw keys, never a runtime draw log.
 * The two sealed snapshots remain the authoritative full source/stage definitions.
 */
export function buildCouplingManifest(baseline: RunResult, candidate: RunResult): CouplingManifest {
  assertModel(baseline.model); assertModel(candidate.model);
  const a = baseline.model; const b = candidate.model;
  const aNodes = new Map(a.nodes.map(node => [node.id, node])); const bNodes = new Map(b.nodes.map(node => [node.id, node]));
  const aSampling = new Map(a.nodes.map(node => [node.samplingId, node])); const bSampling = new Map(b.nodes.map(node => [node.samplingId, node]));
  const sameRngVersion = baseline.provenance.rngVersion === candidate.provenance.rngVersion;
  const sameSeed = baseline.seed === candidate.seed;
  const matchedSources: CouplingMatch[] = []; const matchedStages: CouplingMatch[] = [];
  const unmatched: CouplingManifest['unmatched'] = [];
  const matchedSourceIds = a.nodes.filter(node => node.kind === 'source' && bSampling.get(node.samplingId)?.kind === 'source').map(node => node.samplingId);
  for (const node of [...a.nodes].sort((x, y) => compare(x.samplingId, y.samplingId))) {
    const other = bSampling.get(node.samplingId);
    if (!other || other.kind !== node.kind) {
      unmatched.push({ side: 'baseline', component: component(node), reason: other ? 'kind-changed' : 'sampling-id-absent' });
      continue;
    }
    const changes: CouplingChange[] = [];
    if (node.kind === 'source' && other.kind === 'source' && !equal(node.arrival, other.arrival)) changes.push('arrival');
    if (!equal(classes(node), classes(other))) changes.push('classes');
    if (!equal(distribution(node), distribution(other))) changes.push('distribution');
    if (!equal(routing(node, aNodes), routing(other, bNodes))) changes.push('routing');
    if (node.kind === 'queue' && other.kind === 'queue') {
      if (node.discipline !== other.discipline) changes.push('queuePolicy');
      if (node.capacity !== other.capacity) changes.push('capacity');
    }
    if (node.kind === 'service' && other.kind === 'service' && node.servers !== other.servers) changes.push('capacity');
    if (!equal(resources(node, a), resources(other, b))) changes.push('resources');
    const baselineDrawKinds = drawKinds(node); const candidateDrawKinds = drawKinds(other);
    const match: CouplingMatch = {
      samplingId: node.samplingId, kind: node.kind, baselineNodeId: node.id, candidateNodeId: other.id,
      baselineDrawKinds, candidateDrawKinds,
      sharedDrawKinds: sameRngVersion && sameSeed && (node.kind === 'source' || matchedSourceIds.length > 0)
        ? baselineDrawKinds.filter(kind => candidateDrawKinds.includes(kind)) : [], changes,
    };
    (node.kind === 'source' ? matchedSources : matchedStages).push(match);
  }
  for (const node of [...b.nodes].sort((x, y) => compare(x.samplingId, y.samplingId))) {
    const other = aSampling.get(node.samplingId);
    if (!other || other.kind !== node.kind) unmatched.push({ side: 'candidate', component: component(node), reason: other ? 'kind-changed' : 'sampling-id-absent' });
  }
  const sameExternalDemand = sameRngVersion && sameSeed && a.horizon === b.horizon
    && a.nodes.filter(node => node.kind === 'source').length === matchedSources.length
    && b.nodes.filter(node => node.kind === 'source').length === matchedSources.length
    && matchedSources.every(source => !source.changes.includes('arrival') && !source.changes.includes('classes'));
  const sameMeasurementPolicies = a.horizon === b.horizon && a.warmup === b.warmup && a.slaSeconds === b.slaSeconds && a.currency === b.currency;
  const caveats = [
    'Static potential key coupling only: no executed draw, matched visit or path counts are recorded or inferred.',
    'Stage keys share raw uniforms only for a matched source samplingId, the same actual seed, external arrival ordinal, stage samplingId, per-entity stage visit ordinal and draw kind. Unmatched sources cannot share stage keys.',
    'Arrival and visit ordinals start at 0. Visit counters are per entity and stage samplingId; service reached through a queue increments its service counter when service begins, while direct service increments it on arrival at the service node.',
    'Arrival draws occur only for Poisson sources (including the next-arrival proposal); class draws occur for actual external arrivals. Route/delay/patience draws occur on those stage visits; service draws occur only when service begins. Constant distributions still consume their keyed raw draw.',
    'Equal raw uniforms do not guarantee equal transformed durations, arrival times, classes, route choices, paths, visit counts, service starts or outcomes. Capacity, resources, queue policies, abandonment and horizon/limit stops can change which keys are reached.',
    'Class selection is ordered by class ID; route selection is ordered by destination samplingId. The snapshots retain full distributions and mappings; labels and graph node renames do not define random identities.',
  ];
  if (!sameExternalDemand) caveats.push('External demand differs: even shared source key identities need not produce the same arrivals or classes. Paired deltas require compatible external demand.');
  if (!sameMeasurementPolicies) caveats.push('Horizon, warm-up, SLA or currency policies differ. Potential shared uniforms do not make the measured results eligible for paired deltas.');
  if (unmatched.length) caveats.push('Unmatched sampling identities or changed node kinds have no corresponding component in the other snapshot. Downstream paths and visit alignment can diverge.');
  if ([...matchedSources, ...matchedStages].some(match => match.changes.includes('distribution') || match.changes.includes('arrival') || match.changes.includes('classes') || match.changes.includes('routing'))) caveats.push('Changed distributions or mappings can transform a shared uniform differently and send work along different paths; matching keys do not establish equal realized samples.');
  return {
    kind: 'static-key-scope', rngVersions: { baseline: baseline.provenance.rngVersion, candidate: candidate.provenance.rngVersion },
    compatibility: { sameRngVersion, sameSeed, sameExternalDemand, sameMeasurementPolicies },
    rawKeys: {
      encoding: 'JSON.stringify', ordinalBase: 0,
      arrival: ['RNG_VERSION', 'seed', 'sourceSamplingId', 'arrivalOrdinal', 'arrival'],
      class: ['RNG_VERSION', 'seed', 'sourceSamplingId', 'arrivalOrdinal', 'class'],
      stage: ['RNG_VERSION', 'seed', 'sourceSamplingId', 'arrivalOrdinal', 'stageSamplingId', 'visitOrdinal', 'kind'],
      visitScope: 'Zero-based counter per external entity and stage samplingId; keyed stage kinds are service, patience, delay and route.',
      replicationScope: 'Each replication uses its actual run seed. The replication index is not a raw key part.',
    }, matchedSources, matchedStages, unmatched, caveats,
  };
}
