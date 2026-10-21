import { clientMessages as m } from '../ui/messages/client';
import { responseId } from './protocol';
import type { WorkerResponse } from './protocol';

/** Small port surface for adversarial lifecycle tests without a DOM. */
export interface WorkerPort {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
export interface WorkerState { running: boolean; cancelling: boolean; progress: number; error: string | null }
interface Pending<R, T> { request: R; resolve: (value: T) => void; reject: (error: Error) => void }

/** Validation never runs for an obsolete worker or a different request ID.
 * Failed boundary data discards the worker, preserving drafts and accepted results. */
export class WorkerClient<R extends { id: string }, T> {
  private worker: WorkerPort | null = null;
  private pending: Pending<R, T> | null = null;
  private state: WorkerState = { running: false, cancelling: false, progress: 0, error: null };
  constructor(
    private readonly create: () => WorkerPort,
    private readonly read: (data: unknown, request: R) => WorkerResponse<T>,
    private readonly onState: (state: WorkerState) => void,
    private readonly label: 'simulation' | 'experiment',
    private readonly cancelMessage?: (request: R) => unknown,
  ) {}
  private update(patch: Partial<WorkerState>) { this.state = { ...this.state, ...patch }; this.onState(this.state); }
  private stop() { const worker = this.worker; this.worker = null; worker?.terminate(); }
  private fail(message: string) {
    const pending = this.pending; this.pending = null; this.stop();
    this.update({ running: false, cancelling: false, error: message }); pending?.reject(new Error(message));
  }
  private ensureWorker(): WorkerPort {
    if (this.worker) return this.worker;
    const worker = this.create(); this.worker = worker;
    worker.onmessage = event => {
      if (this.worker !== worker || !this.pending) return;
      const pending = this.pending;
      try {
        const id = responseId(event.data);
        if (id !== undefined && id !== pending.request.id) return;
        const data = this.read(event.data, pending.request);
        if (this.worker !== worker || this.pending !== pending) return;
        if (data.type === 'start') return;
        if (data.type === 'progress') { this.update({ progress: data.fraction }); return; }
        this.pending = null;
        if (data.type === 'error') {
          this.stop(); this.update({ running: false, cancelling: false, error: m.runAgainToRetry(data.message) });
          pending.reject(new Error(this.state.error!));
        } else {
          if (!this.cancelMessage) this.stop();
          this.update({ running: false, cancelling: false, progress: 1 }); pending.resolve(data.result);
        }
      } catch {
        if (this.worker === worker && this.pending === pending) this.fail(m.invalidWorkerResponse(this.label));
      }
    };
    worker.onerror = event => {
      if (this.worker !== worker) return;
      this.fail(m.runAgainToRestartIt(event.message || m.workerStopped(this.label)));
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker) return;
      this.fail(m.unreadableWorkerResponse(this.label));
    };
    return worker;
  }
  prepare() {
    try { this.ensureWorker(); }
    catch { this.fail(m.workerStartFailed(this.label)); }
  }
  run(request: R): Promise<T> {
    if (this.pending) {
      const pending = this.pending; this.pending = null; this.stop(); pending.reject(new Error(m.supersededByANewRun));
    }
    this.update({ running: true, cancelling: false, progress: 0, error: null });
    return new Promise((resolve, reject) => {
      this.pending = { request, resolve, reject };
      try { this.ensureWorker().postMessage(request); }
      catch { this.fail(m.workerRequestFailed(this.label)); }
    });
  }
  cancel() {
    if (!this.pending) return;
    if (this.cancelMessage) {
      this.update({ cancelling: true });
      try { this.worker?.postMessage(this.cancelMessage(this.pending.request)); }
      catch { this.fail(m.cancellationCouldNotBeSentYourDraftAndPrevious); }
    } else this.fail(m.experimentCancelled);
  }
  clearError() { this.update({ error: null }); }
  dispose() { const pending = this.pending; this.pending = null; this.stop(); pending?.reject(new Error(m.runCancelled)); }
}
