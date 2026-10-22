import { describe, expect, it } from 'vitest';
import { ProjectSaveQueue, type SaveInput } from '../src/storage/projectSaveQueue';

const input = (revision: number, id = 'a'): SaveInput => ({ id, revision, contentKey: `${id}:${revision}`, serialized: `snapshot ${id} ${revision}` });
function blockedWriter() {
  const started: SaveInput[] = [];
  const controls: { resolve: (ack: string) => void; reject: (error: Error) => void }[] = [];
  const queue = new ProjectSaveQueue<string>(snapshot => {
    started.push(snapshot);
    return new Promise((resolve, reject) => { controls.push({ resolve, reject }); });
  });
  return { queue, started, controls };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('bounded project save scheduling', () => {
  it('keeps one active and the latest pending autosave during a slow write, without false ACKs', async () => {
    const { queue, controls, started } = blockedWriter();
    const first = queue.enqueue(input(0), 'auto'); await tick();
    const promises = Array.from({ length: 1000 }, (_, i) => queue.enqueue(input(i + 1), 'auto'));
    expect(queue.inspect()).toMatchObject({ jobs: 2, active: true, pending: 1 });
    expect(await Promise.all(promises.slice(0, -1))).toEqual(Array(999).fill(undefined));
    expect(started.map(job => job.revision)).toEqual([0]);
    controls[0].resolve('saved 0'); expect(await first).toBe('saved 0'); await tick();
    expect(started.map(job => job.revision)).toEqual([0, 1000]);
    controls[1].resolve('saved 1000'); expect(await promises.at(-1)).toBe('saved 1000');
    expect(queue.inspect()).toEqual({ jobs: 0, pending: 0, active: false, bytes: 0 });
  });
  it('promotes a matching manual request and preserves every explicit write in arrival order', async () => {
    const { queue, controls, started } = blockedWriter();
    const first = queue.enqueue(input(0), 'auto'); await tick();
    const second = queue.enqueue(input(1), 'auto');
    const manual = queue.enqueue(input(1), 'explicit'); expect(manual).toBe(second);
    const other = queue.enqueue(input(2, 'b'), 'explicit');
    const latest = queue.enqueue(input(3), 'auto');
    const writes = [first, manual, other, latest];
    for (let i = 0; i < writes.length; i++) { controls[i].resolve(`ack ${i}`); await writes[i]; await tick(); }
    expect(started.map(job => [job.id, job.revision])).toEqual([['a', 0], ['a', 1], ['b', 2], ['a', 3]]);
    expect(await Promise.all([first, manual, other, latest])).toEqual(['ack 0', 'ack 1', 'ack 2', 'ack 3']);
  });
  it('places a superseding autosave after explicit work that arrived before it', async () => {
    const { queue, controls, started } = blockedWriter();
    const first = queue.enqueue(input(0), 'explicit'); await tick();
    const superseded = queue.enqueue(input(1), 'auto');
    const manual = queue.enqueue(input(2, 'b'), 'explicit');
    const latest = queue.enqueue(input(3), 'auto');
    expect(await superseded).toBeUndefined();
    const writes = [first, manual, latest];
    for (let i = 0; i < writes.length; i++) { controls[i].resolve('ack'); await writes[i]; await tick(); }
    await Promise.all([first, manual, latest]);
    expect(started.map(job => job.contentKey)).toEqual(['a:0', 'b:2', 'a:3']);
  });
  it('rejects over-budget admission before replacing an existing pending save', async () => {
    const writes: number[] = []; let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const queue = new ProjectSaveQueue(async (job) => { writes.push(job.revision); await gate; return job.revision; }, 2, 300);
    const first = queue.enqueue(input(0), 'auto'); const second = queue.enqueue(input(1), 'auto');
    const before = queue.inspect();
    expect(() => queue.enqueue({ ...input(2), serialized: 'x'.repeat(200) }, 'auto')).toThrow('waiting');
    expect(() => queue.enqueue(input(1, 'b'), 'explicit')).toThrow('waiting');
    expect(queue.inspect()).toEqual(before);
    unblock(); expect(await Promise.all([first, second])).toEqual([0, 1]); expect(writes).toEqual([0, 1]);
  });
  it('rejects stale/equal revision autosave forks without losing the newer pending draft', async () => {
    const { queue, controls } = blockedWriter();
    const first = queue.enqueue(input(0), 'explicit'); const newer = queue.enqueue(input(3), 'auto'); await tick();
    const before = queue.inspect();
    for (const revision of [2, 3]) expect(() => queue.enqueue({ ...input(revision), contentKey: `fork-${revision}` }, 'auto')).toThrow('newer');
    expect(queue.inspect()).toEqual(before);
    controls[0].resolve('first'); await tick(); controls[1].resolve('newer');
    expect(await Promise.all([first, newer])).toEqual(['first', 'newer']);
  });
  it('deduplicates active/pending content and snapshots primitive input fields', async () => {
    const { queue, controls, started } = blockedWriter();
    const source = { ...input(0) }; const saved = queue.enqueue(source, 'explicit');
    expect(queue.enqueue(source, 'auto')).toBe(saved);
    source.serialized = 'mutated'; source.id = 'changed'; await tick();
    expect(started[0]).toEqual(input(0));
    controls[0].resolve('durable'); expect(await saved).toBe('durable');
  });
  it('keeps explicit requests from separate editing contexts distinct', async () => {
    const { queue, controls, started } = blockedWriter();
    const old = queue.enqueue({ ...input(0), context: 1 }, 'explicit');
    const current = queue.enqueue({ ...input(0), context: 2 }, 'explicit');
    expect(current).not.toBe(old); expect(queue.inspect().jobs).toBe(2); await tick();
    controls[0].resolve('old'); await old; await tick();
    controls[1].resolve('current'); await current;
    expect(started.map(job => job.context)).toEqual([1, 2]);
  });
  it('lets an accepted editing context replace an older pending autosave without borrowing its identity', async () => {
    const { queue, controls, started } = blockedWriter();
    const first = queue.enqueue(input(0, 'b'), 'explicit'); await tick();
    const old = queue.enqueue({ ...input(10), context: 1 }, 'auto');
    const current = queue.enqueue({ ...input(1), context: 2 }, 'auto');
    expect(await old).toBeUndefined();
    controls[0].resolve('first'); await first; await tick();
    expect(started[1]).toMatchObject({ revision: 1, context: 2 });
    controls[1].resolve('current'); expect(await current).toBe('current');
  });
  it('releases failed writes and still attempts later explicit work', async () => {
    const { queue, controls, started } = blockedWriter();
    const failure = queue.enqueue(input(0), 'explicit'); const rejected = expect(failure).rejects.toThrow('quota');
    const next = queue.enqueue(input(1), 'explicit'); await tick();
    controls[0].reject(new Error('quota')); await rejected; await tick();
    expect(started.map(job => job.revision)).toEqual([0, 1]);
    controls[1].resolve('saved'); expect(await next).toBe('saved'); expect(queue.inspect().bytes).toBe(0);
  });
});
