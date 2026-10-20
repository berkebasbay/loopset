import { useEffect, useRef, useState } from 'react';
import type { RunResult, SimulationModel } from '../model/types';

export function useSimulation() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef<{ id: string; resolve: (r: RunResult) => void; reject: (e: Error) => void } | null>(null);
  const [running, setRunning] = useState(false); const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const w = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    w.onmessage = event => {
      const data = event.data;
      if (!pending.current || data.id !== pending.current.id) return;
      if (data.type === 'progress') { setProgress(Math.max(0, Math.min(1, data.fraction))); return; }
      if (data.type === 'result') { const p = pending.current; pending.current = null; setRunning(false); setCancelling(false); setProgress(1); p.resolve(data.result); }
      if (data.type === 'error' && pending.current) { const p = pending.current; pending.current = null; setRunning(false); setCancelling(false); setError(data.message); p.reject(new Error(data.message)); }
    };
    w.onerror = event => { const message = event.message || 'The simulation worker stopped unexpectedly.'; setError(message); setRunning(false); setCancelling(false); pending.current?.reject(new Error(message)); pending.current = null; };
    return () => { w.terminate(); worker.current = null; pending.current?.reject(new Error('Run cancelled.')); pending.current = null; };
  }, []);
  function run(model: SimulationModel): Promise<RunResult> {
    if (!worker.current) return Promise.reject(new Error('The simulation worker is not ready yet.'));
    if (pending.current) { worker.current.postMessage({ type: 'cancel', id: pending.current.id }); pending.current.reject(new Error('Superseded by a new run.')); }
    const id = crypto.randomUUID(); setRunning(true); setCancelling(false); setProgress(0); setError(null);
    return new Promise((resolve, reject) => { pending.current = { id, resolve, reject }; worker.current!.postMessage({ type: 'run', id, model: structuredClone(model) }); });
  }
  function cancel() { if (pending.current) { setCancelling(true); worker.current?.postMessage({ type: 'cancel', id: pending.current.id }); } }
  return { run, cancel, running, cancelling, progress, error, clearError: () => setError(null) };
}
