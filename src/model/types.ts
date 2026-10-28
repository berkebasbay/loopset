/** Model contract v1. Presentation coordinates are deliberately outside the engine model. */
export const SCHEMA_VERSION = 1 as const;
export const ENGINE_VERSION = '0.1.2';

export type World = 'factory' | 'festival' | 'service';
export type Distribution =
  | { kind: 'constant'; value: number }
  | { kind: 'exponential'; mean: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  | { kind: 'empirical'; values: number[] };
export interface RateSegment { start: number; end: number; perHour: number }
export type ArrivalSpec =
  | { kind: 'fixed'; perHour: number }
  | { kind: 'poisson'; segments: RateSegment[] }
  | { kind: 'schedule'; times: number[] };
export interface EntityClass { id: string; label: string; priority: number; probability: number }
export interface BaseNode { id: string; samplingId: string; label: string }
export interface SourceNode extends BaseNode {
  kind: 'source'; arrival: ArrivalSpec; next: string; classes: EntityClass[];
}
export interface QueueNode extends BaseNode {
  kind: 'queue'; next: string; capacity: number | null;
  discipline: 'fifo' | 'priority'; patience: Distribution | null;
}
export interface ServiceNode extends BaseNode {
  kind: 'service'; next: string; duration: Distribution; servers: number;
  resources: { poolId: string; units: number }[];
}
export interface RouteNode extends BaseNode {
  kind: 'route'; branches: { to: string; probability: number }[];
}
export interface DelayNode extends BaseNode { kind: 'delay'; next: string; duration: Distribution }
export interface SinkNode extends BaseNode { kind: 'sink' }
export type ModelNode = SourceNode | QueueNode | ServiceNode | RouteNode | DelayNode | SinkNode;
export interface CapacityPeriod { start: number; end: number; capacity: number }
export interface ResourcePool {
  id: string; label: string; installedCapacity: number; capacity: number;
  calendar: CapacityPeriod[]; costPerHour: number; overtimeCostPerHour: number;
}
export interface SimulationModel {
  id: string; name: string; nodes: ModelNode[]; resources: ResourcePool[];
  horizon: number; warmup: number; seed: number; slaSeconds: number; currency: string;
}
export interface Point { x: number; z: number }
export interface AssetReference { assetId: string; assetVersion: string; rotation: number; scale: number }
export interface FacilityObject extends Point, AssetReference { id: string; name: string; y?: number }
/** Presentation only: never part of the numerical model or its fingerprint. */
export interface FacilityLayout {
  version: 1;
  objects: FacilityObject[];
  nodeAssets: Record<string, AssetReference>;
  scenery?: boolean;
}
export interface ScenarioSnapshot {
  id: string; name: string; createdAt: string; world: World;
  model: SimulationModel; layout: Record<string, Point>;
  facility?: FacilityLayout;
  workspaceMode?: 'layout';
}
export interface Project {
  schemaVersion: typeof SCHEMA_VERSION; id: string; name: string; world: World;
  model: SimulationModel; layout: Record<string, Point>; revision: number;
  description: string; savedAt?: string;
  scenarios?: ScenarioSnapshot[];
  facility?: FacilityLayout;
  workspaceMode?: 'layout';
}
export interface ValidationIssue { path: string; message: string; severity: 'error' | 'warning' }
export type EntityStatus = 'active' | 'completed' | 'balked' | 'reneged';
export interface Visit {
  nodeId: string; arrival: number; start?: number; end?: number;
  outcome?: 'served' | 'balked' | 'reneged' | 'passed';
}
export interface EntityRecord {
  id: string; sourceId: string; ordinal: number; classId: string; priority: number;
  arrivedAt: number; endedAt?: number; status: EntityStatus; visits: Visit[];
}
export interface TraceEvent {
  time: number; kind: 'arrival' | 'queue' | 'start' | 'finish' | 'complete' | 'balk' | 'renege' | 'transfer';
  entityId: string; nodeId: string;
}
export interface StationMetrics {
  nodeId: string; arrived: number; started: number; finished: number; balked: number; reneged: number;
  queueAtEnd: number; busyAtEnd: number; averageQueue: number;
  averageWait: number; p95Wait: number; utilization: number | null; busySeconds: number;
}
export interface PoolMetrics {
  poolId: string; scheduledUnitSeconds: number; busyUnitSeconds: number;
  overtimeUnitSeconds: number; cost: number; utilization: number | null;
}
export interface Summary {
  arrivals: number; completed: number; balked: number; reneged: number; inSystem: number;
  meanWait: number; p50Wait: number; p95Wait: number; meanSojourn: number;
  slaMet: number; slaRate: number | null; throughputPerHour: number; cost: number;
  waitSampleSize: number; measurementStart: number; measurementEnd: number;
}
export type RunStatus = 'completed' | 'cancelled' | 'limited' | 'failed';
/** Effective numeric caps. Zero is a literal cap, not an unlimited sentinel. */
export interface RunLimits {
  readonly maxEvents: number; readonly maxEntities: number; readonly maxMicrosteps: number;
  readonly maxTraceEntities: number; readonly maxTraceEvents: number;
}
export interface RunProvenance { readonly rngVersion: string; readonly limits: RunLimits }
export interface RunResult {
  id: string; engineVersion: string; modelHash: string; demandHash: string;
  provenance: RunProvenance;
  seed: number; model: SimulationModel; status: RunStatus; reason?: string;
  simulatedUntil: number; summary: Summary; stations: StationMetrics[]; pools: PoolMetrics[];
  entities: EntityRecord[]; events: TraceEvent[];
  trace: { complete: boolean; until: number; entityLimit: number; eventLimit: number };
  warnings: string[]; processedEvents: number; elapsedMs: number;
  diagnostics: { totalArrivals: number; activeWaiting: number; activeService: number; activeTransfer: number; bypassedRequests: number; maxHeapSize: number; maxActiveEntities: number };
  classes: { classId: string; arrivals: number; completed: number; balked: number; reneged: number; inSystem: number; meanWait: number; waitSampleSize: number }[];
  waitDistribution: { sampleSize: number; bins: { from: number; to: number | null; count: number }[] };
}
export interface RunOptions {
  seed?: number; maxEvents?: number; maxEntities?: number; maxTraceEntities?: number;
  maxTraceEvents?: number; maxMicrosteps?: number;
  onProgress?: (fraction: number) => void; shouldCancel?: () => boolean;
}
export interface MetricEstimate { mean: number; standardError: number | null; lower95: number | null; upper95: number | null; samples: number }
export interface ExperimentResult {
  modelHash: string; seeds: number[]; runs: RunResult[];
  completed: MetricEstimate; wait: MetricEstimate; p95Wait: MetricEstimate; cost: MetricEstimate;
}
export type DrawKind = 'arrival' | 'class' | 'service' | 'patience' | 'delay' | 'route';
export interface CouplingComponent {
  nodeId: string; samplingId: string; kind: ModelNode['kind']; drawKinds: DrawKind[];
}
export type CouplingChange = 'arrival' | 'classes' | 'distribution' | 'routing' | 'queuePolicy' | 'capacity' | 'resources';
export interface CouplingMatch {
  samplingId: string; kind: ModelNode['kind']; baselineNodeId: string; candidateNodeId: string;
  baselineDrawKinds: DrawKind[]; candidateDrawKinds: DrawKind[];
  /** Potential common raw uniforms, conditional on the stated source/ordinal/visit scope. Not observed counts. */
  sharedDrawKinds: DrawKind[]; changes: CouplingChange[];
}
export interface CouplingManifest {
  kind: 'static-key-scope';
  rngVersions: { baseline: string; candidate: string };
  compatibility: { sameRngVersion: boolean; sameSeed: boolean; sameExternalDemand: boolean; sameMeasurementPolicies: boolean };
  rawKeys: {
    encoding: 'JSON.stringify'; ordinalBase: 0;
    arrival: string[]; class: string[]; stage: string[];
    visitScope: string; replicationScope: string;
  };
  matchedSources: CouplingMatch[]; matchedStages: CouplingMatch[];
  unmatched: { side: 'baseline' | 'candidate'; component: CouplingComponent; reason: 'sampling-id-absent' | 'kind-changed' }[];
  caveats: string[];
}
export interface PairedComparison {
  paired: boolean; reason?: string; baseline: ExperimentResult; candidate: ExperimentResult;
  coupling: CouplingManifest;
  delta: { completed: MetricEstimate; wait: MetricEstimate; cost: MetricEstimate };
}
