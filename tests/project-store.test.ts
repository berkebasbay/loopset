import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExample } from '../src/examples';
import type { Project } from '../src/model/types';
import { canonical } from '../src/model/identity';
import { ProjectSaveQueue } from '../src/storage/projectSaveQueue';

// Deliberately small, synthetic IDB request/transaction port. It rejects getAll and
// payload cursors, so targeted/key-only contracts cannot pass by using those APIs.
function memoryIDB(records: unknown[] = [], options: { version?: number; blocked?: boolean } = {}) {
  const projects = new Map<string, any>(records.map((record: any) => [record.id, structuredClone(record)]));
  const meta = new Map<string, any>(); const indexed = new Set(options.version === 1 ? [] : ['savedAt-id']);
  const calls = { gets: [] as string[], keyCursors: 0, keysVisited: 0, puts: 0, closes: 0, upgrades: 0 };
  let version = options.version ?? 2;
  const openRequests: any[] = [];
  const names = { contains: (name: string) => name === 'projects' || name === 'meta' };
  const compare = (a: string[], b: string[]) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  const ordered = () => [...projects.values()].filter(item => typeof item.savedAt === 'string' && typeof item.id === 'string').map(item => [item.savedAt, item.id] as string[]).sort(compare);
  function transaction() {
    let pending = 0, aborted = false, finished = false; const writes: (() => void)[] = [];
    const tx: any = { error: null, oncomplete: null, onabort: null, onerror: null,
      abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore(name: string) {
        const data = name === 'projects' ? projects : meta;
        return {
          indexNames: { contains: (key: string) => indexed.has(key) },
          createIndex(key: string, keyPath: string[]) { expect(keyPath).toEqual(['savedAt', 'id']); indexed.add(key); calls.upgrades++; },
          get(key: string) { if (name === 'projects') calls.gets.push(key); return request(() => structuredClone(data.get(key))); },
          put(value: any) { calls.puts++; writes.push(() => data.set(name === 'projects' ? value.id : value.key, structuredClone(value))); return request(() => undefined); },
          count() { return request(() => data.size); },
          getAll() { throw new Error('Unbounded getAll is forbidden in this fixture.'); },
          index(key: string) {
            if (!indexed.has(key)) throw new Error('Missing index');
            return { keyPath: ['savedAt', 'id'], unique: false,
              count: () => request(() => ordered().length),
              openKeyCursor(range: any, direction: string) {
                expect(direction).toBe('prev'); calls.keyCursors++;
                const keys = ordered().filter(key => !range || compare(key, range.upper) < 0).reverse(); let offset = 0;
                const req: any = { result: null, onsuccess: null };
                const advance = () => schedule(req, () => {
                  const key = keys[offset++]; if (!key) return null;
                  calls.keysVisited++;
                  return { key, primaryKey: key[1], continue: advance, get value() { throw new Error('Payload cursor forbidden'); } };
                });
                advance(); return req;
              },
            };
          },
        };
      },
    };
    const complete = () => queueMicrotask(() => {
      if (pending || aborted || finished) return;
      finished = true; writes.forEach(write => write()); tx.oncomplete?.();
    });
    function schedule(req: any, read: () => unknown) {
      pending++;
      queueMicrotask(() => {
        if (!aborted) { req.result = read(); req.onsuccess?.(); }
        pending--; complete();
      });
    }
    function request(read: () => unknown) { const req: any = { result: undefined, onsuccess: null }; schedule(req, read); return req; }
    complete(); return tx;
  }
  const db: any = { objectStoreNames: names, onversionchange: null, close() { calls.closes++; }, transaction,
    createObjectStore(name: string) { return transaction().objectStore(name); },
  };
  vi.stubGlobal('IDBKeyRange', { upperBound: (upper: string[], open: boolean) => { expect(open).toBe(true); return { upper }; } });
  vi.stubGlobal('indexedDB', { open(_name: string, requested: number) {
    const req: any = { result: db, transaction: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    openRequests.push(req);
    queueMicrotask(() => {
      if (options.blocked) { req.onblocked?.(); return; }
      if (version > requested) { req.error = new DOMException('future', 'VersionError'); req.onerror?.(); return; }
      if (version < requested) { const previous = version; req.transaction = transaction(); req.onupgradeneeded?.({ oldVersion: previous }); version = requested; }
      req.onsuccess?.();
    }); return req;
  } });
  return { projects, meta, calls, db, openRequests };
}
function record(project: Project, savedAt = '2026-10-22T12:00:00.000Z') {
  return { id: project.id, revision: project.revision, savedAt, payload: canonical(project) };
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('bounded local project access', () => {
  it('reads only the requested payload and startup meta target, then one bounded newest fallback', async () => {
    const a = createExample('factory'), b = createExample('service');
    const fake = memoryIDB([record(a), record(b, '2026-10-23T12:00:00.000Z')]);
    const store = await import('../src/storage/projectStore');
    await expect(store.loadProject(a.id)).resolves.toMatchObject({ id: a.id }); expect(fake.calls.gets).toEqual([a.id]);
    fake.meta.set('lastProject', { key: 'lastProject', projectId: a.id });
    await expect(store.loadLastProject()).resolves.toMatchObject({ id: a.id }); expect(fake.calls.keyCursors).toBe(0);
    fake.meta.delete('lastProject');
    await expect(store.loadLastProject()).resolves.toMatchObject({ id: b.id }); expect(fake.calls.keysVisited).toBe(1);
  });
  it('pages only metadata in stable descending time/id order without duplicates or payload loads', async () => {
    const records = Array.from({ length: 45 }, (_, i) => record({ ...createExample('factory'), id: `p-${String(i).padStart(2, '0')}` }));
    const fake = memoryIDB(records); const store = await import('../src/storage/projectStore');
    const ids: string[] = []; let token: import('../src/storage/projectStore').ProjectPageCursor | null = null;
    do {
      const page = await store.listProjectPage(token); expect(page.items.length).toBeLessThanOrEqual(20);
      expect(page.items.every(item => !('model' in item) && !('payload' in item))).toBe(true);
      ids.push(...page.items.map(item => item.id)); token = page.next;
    } while (token);
    expect(ids).toEqual(records.map(item => item.id).sort().reverse()); expect(new Set(ids).size).toBe(45);
    expect(fake.calls.gets).toEqual([]); expect(fake.calls.keysVisited).toBe(47);
    await expect(store.listProjectPage(null, 21)).rejects.toThrow('1–20');
  });
  it('does not advance the conflict base on a newer preview, even if final replacement is blocked', async () => {
    const project = createExample('factory'); const fake = memoryIDB([record(project)]);
    const store = await import('../src/storage/projectStore'); await store.loadProject(project.id);
    const newer = { ...project, revision: 1, name: 'Other tab' }; fake.projects.set(project.id, record(newer));
    await store.loadProject(project.id, { observe: false }); // Review/cancel/blocked import: no rememberOpenedProject.
    await expect(store.saveProject({ ...project, revision: 2, name: 'Local draft' })).rejects.toMatchObject({ code: 'conflict' });
    expect(fake.projects.get(project.id).payload).toContain('Other tab'); expect(fake.calls.puts).toBe(0);
    const opened = await store.loadProject(project.id, { observe: false }); store.rememberOpenedProject(opened!);
    await expect(store.saveProject({ ...newer, revision: 2, name: 'Accepted edit' })).resolves.toMatchObject({ revision: 2 });
  });
  it('does not authorize an early draft from a startup snapshot the editor did not accept', async () => {
    const stock = createExample('factory'), saved = { ...stock, revision: 1, name: 'Previously saved content' };
    const fake = memoryIDB([record(saved)]); fake.meta.set('lastProject', { key: 'lastProject', projectId: stock.id });
    const store = await import('../src/storage/projectStore');
    const read = await store.loadLastProject({ observe: false }); expect(read).toMatchObject({ revision: 1, name: saved.name });
    await expect(store.saveProject({ ...stock, revision: 2, name: 'Early stock edits' })).rejects.toMatchObject({ code: 'conflict' });
    expect(fake.projects.get(stock.id).payload).toBe(canonical(saved)); expect(fake.calls.puts).toBe(0);
    store.rememberOpenedProject(read!);
    await expect(store.saveProject({ ...saved, revision: 2, name: 'Edit after accepted startup' })).resolves.toMatchObject({ revision: 2 });
  });
  it('fresh final Open remembers the saved snapshot, not the accepted same-ID edit revision', async () => {
    const initial = createExample('factory'); const fake = memoryIDB([record(initial)]);
    const store = await import('../src/storage/projectStore'); await store.loadProject(initial.id);
    const reviewed = { ...initial, revision: 1, name: 'Reviewed' }; fake.projects.set(initial.id, record(reviewed));
    await store.loadProject(initial.id, { observe: false });
    const latest = { ...reviewed, revision: 2, name: 'New after preview' }; fake.projects.set(initial.id, record(latest));
    const { openSavedProject } = await import('../src/features/DataTools');
    await expect(openSavedProject(initial.id, () => null)).rejects.toThrow('paused');
    await expect(store.saveProject({ ...initial, revision: 10, name: 'Blocked context' })).rejects.toMatchObject({ code: 'conflict' });
    let received: Project | undefined;
    await openSavedProject(initial.id, opened => { received = opened; return { ...opened, revision: 20, name: 'Editor monotonic revision' }; });
    expect(received).toMatchObject({ revision: 2, name: 'New after preview' });
    await expect(store.saveProject({ ...latest, revision: 21, name: 'Edited after acceptance' })).resolves.toMatchObject({ revision: 21 });
    const page = await store.listProjectPage(); expect(page.items[0]).toMatchObject({ name: 'Edited after acceptance', revision: 21 });
  });
  it('never lends a newly accepted Open context to an older queued write, while own ACKs can advance one context', async () => {
    const initial = createExample('factory'); const fake = memoryIDB([record(initial)]);
    const store = await import('../src/storage/projectStore'); await store.loadProject(initial.id);
    const context = store.captureSaveContext(initial.id);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const queue = new ProjectSaveQueue(async job => {
      if (job.id === 'gate') { await gate; return { projectId: 'gate', revision: 0, savedAt: '' }; }
      return store.saveProject(JSON.parse(job.serialized), { context: job.context });
    });
    const held = queue.enqueue({ id: 'gate', revision: 0, contentKey: 'gate', serialized: '{}' }, 'explicit');
    const old = { ...initial, revision: 10, name: 'OLD queued editing context' };
    const task = queue.enqueue({ id: old.id, revision: old.revision, contentKey: canonical(old), serialized: JSON.stringify(old), context }, 'explicit');
    const rejection = expect(task).rejects.toMatchObject({ code: 'conflict' });
    const external = { ...initial, revision: 1, name: 'New accepted content' }; fake.projects.set(initial.id, record(external));
    const { openSavedProject } = await import('../src/features/DataTools'); await openSavedProject(initial.id, opened => opened);
    release(); await held; await rejection;
    expect(fake.projects.get(initial.id).payload).toBe(canonical(external)); expect(fake.calls.puts).toBe(0);
    const next = store.captureSaveContext(initial.id); expect(next).not.toBe(context);
    await store.saveProject({ ...external, revision: 2 }, { context: next });
    await store.saveProject({ ...external, revision: 3 }, { context: next });
    expect(store.captureSaveContext(initial.id)).toBe(next); expect(fake.projects.get(initial.id).revision).toBe(3);
  });
  it('fails closed after the actual comparison cache evicts an old project', async () => {
    const values = Array.from({ length: 65 }, (_, i) => ({ ...createExample('factory'), id: `cache-${i}` }));
    const fake = memoryIDB(values.map(project => record(project))); const store = await import('../src/storage/projectStore');
    for (const project of values) await store.loadProject(project.id);
    await expect(store.saveProject({ ...values[0], revision: 1, name: 'Changed' })).rejects.toThrow('comparison copy');
    expect(fake.calls.puts).toBe(0);
  });
  it('upgrades v1 with only an index, retains corrupt/future payloads, and reports unindexed records', async () => {
    const project = createExample('factory'); const bad = { id: 'broken', revision: 0, payload: '{', savedAt: undefined };
    const future = record({ ...project, id: 'future', schemaVersion: 99 } as unknown as Project);
    const fake = memoryIDB([record(project), bad, future], { version: 1 }); const before = structuredClone([...fake.projects]);
    const store = await import('../src/storage/projectStore'); const page = await store.listProjectPage();
    expect(fake.calls.upgrades).toBe(1); expect(page.unlistedRecords).toBe(1); expect(page.items.map(item => item.id)).toContain('future');
    await expect(store.loadProject('future')).rejects.toMatchObject({ code: 'schema' });
    await expect(store.loadProject('broken')).rejects.toMatchObject({ code: 'schema' });
    await expect(store.saveProject({ ...project, id: 'future', revision: 1 })).rejects.toMatchObject({ code: 'schema' });
    await expect(store.loadLastProject()).rejects.toMatchObject({ code: 'schema' });
    expect([...fake.projects]).toEqual(before); expect(fake.calls.puts).toBe(0);
  });
  it('reports malformed indexed ordering metadata instead of skipping it as gone', async () => {
    const project = createExample('factory'); const malformed = record(project, 'not-a-save-time');
    const fake = memoryIDB([malformed]); const store = await import('../src/storage/projectStore');
    await expect(store.listProjectPage()).rejects.toMatchObject({ code: 'schema' });
    await expect(store.loadLastProject()).rejects.toMatchObject({ code: 'schema' });
    expect(fake.projects.get(project.id)).toEqual(malformed); expect(fake.calls.puts).toBe(0);
  });
  it('leaves future database versions and blocked upgrades intact', async () => {
    const fake = memoryIDB([record(createExample('factory'))], { version: 3 });
    let store = await import('../src/storage/projectStore'); await expect(store.loadLastProject()).rejects.toMatchObject({ code: 'schema' });
    expect(fake.calls.upgrades).toBe(0); expect(fake.calls.puts).toBe(0);
    vi.resetModules(); const blocked = memoryIDB([], { version: 1, blocked: true });
    store = await import('../src/storage/projectStore'); await expect(store.listProjectPage()).rejects.toMatchObject({ code: 'unavailable' });
    expect(blocked.calls.upgrades).toBe(0); expect(blocked.calls.puts).toBe(0);
    // A rejected/abandoned open may later receive upgradeneeded after the old
    // connection closes. Abort that event before schema mutation is possible.
    const late = blocked.openRequests[0], abort = vi.fn();
    late.transaction = { abort, objectStore: () => { throw new Error('Late upgrade must not inspect stores'); } };
    late.onupgradeneeded({ oldVersion: 1 }); expect(abort).toHaveBeenCalledOnce();
    expect(blocked.calls.upgrades).toBe(0); late.onsuccess(); expect(blocked.calls.closes).toBe(1);
  });
});
