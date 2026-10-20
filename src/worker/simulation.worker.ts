import { simulateAsync } from '../engine';
import type { RunOptions, SimulationModel } from '../model/types';

type Request = { type: 'run'; id: string; model: SimulationModel; options?: Omit<RunOptions, 'onProgress' | 'shouldCancel'> } | { type: 'cancel'; id: string };
let active: string | null = null;
const cancelled = new Set<string>();
self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  if (!message || typeof message.id !== 'string') return;
  if (message.type === 'cancel') { cancelled.add(message.id); return; }
  if (message.type !== 'run') return;
  active = message.id;
  try {
    const result = await simulateAsync(message.model, {
      ...message.options,
      shouldCancel: () => cancelled.has(message.id) || active !== message.id,
      onProgress: fraction => { if (active === message.id) self.postMessage({ type: 'progress', id: message.id, fraction }); },
    });
    if (active === message.id) self.postMessage({ type: 'result', id: message.id, result });
  } catch (error) {
    if (active === message.id) self.postMessage({ type: 'error', id: message.id, message: error instanceof Error ? error.message : 'The run could not be completed.' });
  } finally { cancelled.delete(message.id); }
};
