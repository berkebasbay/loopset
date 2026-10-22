export interface SaveInput {
  readonly id: string;
  readonly revision: number;
  readonly contentKey: string;
  readonly serialized: string;
  readonly context?: number;
}
type Mode = 'explicit' | 'auto';
interface Job<Ack> {
  input: SaveInput; mode: Mode; bytes: number;
  promise: Promise<Ack | undefined>;
  resolve: (ack: Ack | undefined) => void;
  reject: (error: unknown) => void;
}

/** Serial writes with bounded retained string payloads. Explicit requests are never
 * superseded; only an unstarted autosave can yield to a newer autosave of its project.
 * Superseded autosaves resolve undefined, which is deliberately not a durable ACK.
 * Admission failures throw before changing existing jobs. Byte weights estimate
 * UTF-16 input strings; they are not a JavaScript/IndexedDB heap measurement. */
export class ProjectSaveQueue<Ack> {
  private active: Job<Ack> | undefined;
  private pending: Job<Ack>[] = [];
  private jobs = new Set<Job<Ack>>();
  private used = 0;
  constructor(private readonly write: (input: SaveInput) => Promise<Ack>,
    private readonly maxJobs = 12, private readonly maxBytes = 20_000_000) {
    if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid save queue bounds.');
  }
  inspect() { return { jobs: this.jobs.size, pending: this.pending.length, active: Boolean(this.active), bytes: this.used }; }
  enqueue(input: SaveInput, mode: 'explicit'): Promise<Ack>;
  enqueue(input: SaveInput, mode: 'auto'): Promise<Ack | undefined>;
  enqueue(input: SaveInput, mode: Mode): Promise<Ack | undefined> {
    const existing = [...this.jobs].find(job => job.input.contentKey === input.contentKey && job.input.context === input.context);
    if (existing) {
      if (existing.input.id !== input.id || existing.input.revision !== input.revision) throw new Error('The pending save identity does not match this draft. Keep a downloaded backup.');
      // A manual request for a queued autosave makes that exact write durable work.
      if (mode === 'explicit') existing.mode = mode;
      return existing.promise;
    }
    const replaced = mode === 'auto' ? this.pending.find(job => job.mode === 'auto' && job.input.id === input.id) : undefined;
    if (replaced && input.context === replaced.input.context && input.revision <= replaced.input.revision) throw new Error('A newer autosave is already waiting. Keep this draft open and review local saves.');
    const bytes = 2 * (input.id.length + input.contentKey.length + input.serialized.length) + 16;
    if (this.jobs.size + (replaced ? 0 : 1) > this.maxJobs || this.used - (replaced?.bytes ?? 0) + bytes > this.maxBytes) {
      throw new Error('Local saves are still waiting. Keep this draft open, download a backup, then retry saving.');
    }
    let resolve!: Job<Ack>['resolve'], reject!: Job<Ack>['reject'];
    const promise = new Promise<Ack | undefined>((yes, no) => { resolve = yes; reject = no; });
    // Copy primitive fields rather than retaining a mutable caller object/Project.
    const job: Job<Ack> = { input: { id: input.id, revision: input.revision, contentKey: input.contentKey, serialized: input.serialized, ...(input.context === undefined ? {} : { context: input.context }) }, mode, bytes, promise, resolve, reject };
    if (replaced) {
      this.pending.splice(this.pending.indexOf(replaced), 1);
      this.release(replaced); replaced.resolve(undefined);
    }
    this.jobs.add(job); this.used += bytes;
    // A replacement joins at its actual arrival time, after earlier explicit work.
    this.pending.push(job); this.pump(); return promise;
  }
  private release(job: Job<Ack>) { this.jobs.delete(job); this.used -= job.bytes; }
  private pump() {
    if (this.active || !this.pending.length) return;
    const job = this.pending.shift()!; this.active = job;
    void Promise.resolve().then(() => this.write(job.input)).then(
      ack => { this.finish(job); job.resolve(ack); },
      error => { this.finish(job); job.reject(error); },
    );
  }
  private finish(job: Job<Ack>) { this.release(job); this.active = undefined; this.pump(); }
}
