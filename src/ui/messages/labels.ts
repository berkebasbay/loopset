import type { Distribution, ModelNode, RunStatus } from '../../model/types';

/** Presentation labels only. The values used in models, files and worker messages remain canonical. */
export const stepKindLabels = {
  source: 'source', queue: 'queue', service: 'service', route: 'route', delay: 'delay', sink: 'sink',
} as const satisfies Record<ModelNode['kind'], string>;
export const stepTypeLabels = {
  source: 'Source', queue: 'Queue', service: 'Service', route: 'Route', delay: 'Delay', sink: 'Sink',
} as const satisfies Record<ModelNode['kind'], string>;
export const distributionLabels = {
  constant: 'constant', exponential: 'exponential', triangular: 'triangular', empirical: 'empirical',
} as const satisfies Record<Distribution['kind'], string>;
export const runStatusHeadings = {
  completed: 'COMPLETED', cancelled: 'CANCELLED', limited: 'LIMITED', failed: 'FAILED',
} as const satisfies Record<RunStatus, string>;
