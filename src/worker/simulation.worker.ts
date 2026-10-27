import { simulateAsync } from '../engine';
import { readSimulationRequest, responseId, simulationEnvelope } from './protocol';
import type { SimulationResponse } from './protocol';
const post = (message: SimulationResponse) => self.postMessage(message);

let active: string | null = null;
const cancelled = new Set<string>();
self.onmessage = async (event: MessageEvent<unknown>) => {
  let message;
  try { message = readSimulationRequest(event.data); }
  catch {
    const id = responseId(event.data);
    if (id !== undefined) post({ ...simulationEnvelope(id), type: 'error', message: 'The simulation request is incompatible or invalid. Check the model and reload the page if this repeats.' });
    return;
  }
  if (message.type === 'cancel') { if (active === message.id) cancelled.add(message.id); return; }
  active = message.id;
  const envelope = simulationEnvelope(message.id);
  post({ ...envelope, type: 'start' });
  try {
    const result = await simulateAsync(message.model, {
      ...message.options,
      shouldCancel: () => cancelled.has(message.id) || active !== message.id,
      onProgress: fraction => { if (active === message.id) post({ ...envelope, type: 'progress', fraction }); },
    });
    if (active === message.id) post({ ...envelope, type: 'result', result });
  } catch (error) {
    if (active === message.id) post({ ...envelope, type: 'error', message: error instanceof Error ? error.message : 'The run could not be completed.' });
  } finally { cancelled.delete(message.id); if (active === message.id) active = null; }
};
