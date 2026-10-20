import { capacitySearch, comparePaired, runExperiment } from '../experiments';
import type { CapacitySearchSpec } from '../experiments';
import type { SimulationModel } from '../model/types';

export type LabRequest =
  | { id: string; kind: 'replications'; model: SimulationModel; seeds: number[] }
  | { id: string; kind: 'paired'; baseline: SimulationModel; model: SimulationModel; seeds: number[] }
  | { id: string; kind: 'search'; model: SimulationModel; spec: CapacitySearchSpec };

self.onmessage = (event: MessageEvent<LabRequest>) => {
  const request = event.data;
  let completed = 0; let lastSent = -1;
  const total = request.kind === 'search' ? request.spec.capacities.length * request.spec.trainingSeeds.length + request.spec.verificationSeeds.length : request.seeds.length * (request.kind === 'paired' ? 2 : 1);
  const options = { maxTraceEntities: 0, maxTraceEvents: 0, onProgress: (fraction: number) => {
    const overall = Math.min(1, (completed + fraction) / total);
    if (overall >= lastSent + .01 || overall === 1) { lastSent = overall; self.postMessage({ id: request.id, type: 'progress', fraction: overall }); }
    if (fraction === 1) completed++;
  } };
  try {
    const value = request.kind === 'replications' ? runExperiment(request.model, request.seeds, options)
      : request.kind === 'paired' ? comparePaired(request.baseline, request.model, request.seeds, options)
      : capacitySearch(request.model, request.spec, options);
    self.postMessage({ id: request.id, type: 'result', kind: request.kind, value });
  } catch (error) { self.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : 'The experiment could not finish.' }); }
};
