import { useEffect, useRef, useState } from 'react';
import type { RunResult, SimulationModel } from '../model/types';

export function useSimulation() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef<{ id: string; resolve: (r: RunResult) => void; reject: (e: Error) => void } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function ensureWorker(): Worker {
    if (worker.current) return worker.current;
    const w = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = event => {
      const data = event.data;
      if (worker.current !== w || !pending.current || data?.id !== pending.current.id) return;
      if (data.type === 'progress') { setProgress(Math.max(0, Math.min(1, data.fraction))); return; }
      if (data.type === 'result' || data.type === 'error') {
        const request = pending.current; pending.current = null;
        setRunning(false); setCancelling(false);
        if (data.type === 'result') { setProgress(1); request.resolve(data.result); }
        else { setError(data.message); request.reject(new Error(data.message)); }
      }
    };
    w.onerror = event => {
      if (worker.current !== w) return;
      const message = event.message || 'The simulation worker stopped unexpectedly. Run again to restart it.';
      w.terminate(); worker.current = null;
      setError(message); setRunning(false); setCancelling(false);
      pending.current?.reject(new Error(message)); pending.current = null;
    };
    return w;
  }

  useEffect(() => {
    try { ensureWorker(); }
    catch { setError('The simulation worker could not start. Run again to retry.'); }
    return () => {
      worker.current?.terminate(); worker.current = null;
      pending.current?.reject(new Error('Run cancelled.')); pending.current = null;
    };
  }, []);

  function run(model: SimulationModel): Promise<RunResult> {
    let w: Worker;
    try { w = ensureWorker(); }
    catch { return Promise.reject(new Error('The simulation worker could not start. Run again to retry.')); }
    if (pending.current) {
      w.postMessage({ type: 'cancel', id: pending.current.id });
      pending.current.reject(new Error('Superseded by a new run.'));
    }
    const id = crypto.randomUUID();
    setRunning(true); setCancelling(false); setProgress(0); setError(null);
    return new Promise((resolve, reject) => {
      pending.current = { id, resolve, reject };
      try { w.postMessage({ type: 'run', id, model: structuredClone(model) }); }
      catch {
        pending.current = null; setRunning(false);
        const message = 'The model could not be sent to the worker. Your draft is preserved.';
        setError(message); reject(new Error(message));
      }
    });
  }
  function cancel() {
    if (pending.current) { setCancelling(true); worker.current?.postMessage({ type: 'cancel', id: pending.current.id }); }
  }
  return { run, cancel, running, cancelling, progress, error, clearError: () => setError(null) };
}
