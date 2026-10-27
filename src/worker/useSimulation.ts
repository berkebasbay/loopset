import { useSimulationMessages as m } from '../ui/messages/useSimulation';
import { useEffect, useRef, useState } from 'react';
import type { RunResult, SimulationModel } from '../model/types';
import { WorkerClient } from './client';
import { readSimulationRequest, readSimulationResponse, simulationEnvelope } from './protocol';
import type { SimulationRunRequest } from './protocol';

export function useSimulation() {
  const [state, setState] = useState({ running: false, progress: 0, cancelling: false, error: null as string | null });
  const client = useRef<WorkerClient<SimulationRunRequest, RunResult> | null>(null);
  if (!client.current) client.current = new WorkerClient(
    () => new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' }),
    readSimulationResponse, setState, 'simulation', request => ({ ...simulationEnvelope(request.id), type: 'cancel' }),
  );
  useEffect(() => { const current = client.current!; current.prepare(); return () => current.dispose(); }, []);
  function run(model: SimulationModel): Promise<RunResult> {
    try {
      const request = { ...simulationEnvelope(crypto.randomUUID()), type: 'run' as const, model: structuredClone(model) };
      readSimulationRequest(request);
      return client.current!.run(request);
    } catch { return Promise.reject(new Error(m.theModelCouldNotBeSentToTheWorker)); }
  }
  return { run, cancel: () => client.current!.cancel(), ...state, clearError: () => client.current!.clearError() };
}
