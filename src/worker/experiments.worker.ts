import { capacitySearch, comparePaired, runExperiment } from '../experiments';
import { experimentEnvelope, readExperimentRequest, responseId } from './protocol';
import type { ExperimentResponse, ExperimentValue } from './protocol';
const post = (message: ExperimentResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<unknown>) => {
  let request;
  try { request = readExperimentRequest(event.data); }
  catch {
    const id = responseId(event.data);
    // Echo only a validated discriminant. The UI rejects any other active kind.
    const kind = event.data !== null && typeof event.data === 'object' && 'kind' in event.data ? event.data.kind : undefined;
    if (id !== undefined && (kind === 'replications' || kind === 'paired' || kind === 'search')) post({ ...experimentEnvelope(id, kind), type: 'error', message: 'The experiment request is incompatible or invalid. Check its settings and reload the page if this repeats.' });
    return;
  }
  const envelope = experimentEnvelope(request.id, request.kind);
  post({ ...envelope, type: 'start' });
  let completed = 0; let lastSent = -1;
  const total = request.kind === 'search' ? request.spec.capacities.length * request.spec.trainingSeeds.length + request.spec.verificationSeeds.length : request.seeds.length * (request.kind === 'paired' ? 2 : 1);
  const options = { maxTraceEntities: 0, maxTraceEvents: 0, onProgress: (fraction: number) => {
    const overall = Math.min(1, (completed + fraction) / total);
    if (overall >= lastSent + .01 || overall === 1) { lastSent = overall; post({ ...envelope, type: 'progress', fraction: overall }); }
    if (fraction === 1) completed++;
  } };
  try {
    const result: ExperimentValue = request.kind === 'replications' ? { kind: request.kind, value: runExperiment(request.model, request.seeds, options) }
      : request.kind === 'paired' ? { kind: request.kind, value: comparePaired(request.baseline, request.model, request.seeds, options) }
      : { kind: request.kind, value: capacitySearch(request.model, request.spec, options) };
    post({ ...envelope, ...result, type: 'result' });
  } catch (error) { post({ ...envelope, type: 'error', message: error instanceof Error ? error.message : 'The experiment could not finish.' }); }
};
