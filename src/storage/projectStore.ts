import type { Project } from '../model/types';
import { canonical } from '../model/identity';
import { openProjectJSON, serializeProject } from './projectFile';
import { BoundedCache } from './boundedCache';
import { fileEaseMessages as fileEase } from '../ui/messages/fileEase';

const DATABASE = 'queuelab-projects';
const VERSION = 2;
const ORDER_INDEX = 'savedAt-id';
interface StoredProject { id: string; revision: number; savedAt: string; payload: string }
interface StoreMeta { key: 'lastProject'; projectId: string }
interface ComparisonBase { revision: number; payload: string }
interface EditingContext { generation: number; base?: ComparisonBase }
const observed = new BoundedCache<EditingContext>(64, 20_000_000, (value, key) => 2 * ((value.base?.payload.length ?? 0) + key.length) + 24);
let nextContext = 0;
function newContext(projectId: string, base?: ComparisonBase): number {
  if (nextContext === Number.MAX_SAFE_INTEGER) throw new ProjectStorageError('conflict', 'Reopen this app before saving again. Keep a downloaded draft backup.');
  const generation = ++nextContext;
  observed.set(projectId, { generation, base }); return generation;
}
/** Capture before enqueueing. A later accepted Open creates another context;
 * its comparison base cannot authorize an older queued editing session. */
export function captureSaveContext(projectId: string): number {
  return observed.get(projectId)?.generation ?? newContext(projectId);
}
export interface ProjectMetadata { id: string; savedAt: string; name?: string; revision?: number }
export type ProjectPageCursor = readonly [savedAt: string, id: string];
export interface ProjectPage { items: ProjectMetadata[]; next: ProjectPageCursor | null; unlistedRecords: number }
const summaryKey = (id: string) => `project-summary:${id}`;
function orderKey(key: IDBValidKey): [string, string] {
  if (!Array.isArray(key) || key.length !== 2 || typeof key[0] !== 'string' || key[0].length > 64 || !Number.isFinite(Date.parse(key[0])) || typeof key[1] !== 'string' || !key[1] || key[1].length > 160) throw schemaError();
  return [key[0], key[1]];
}

export class ProjectStorageError extends Error {
  constructor(public readonly code: 'unavailable' | 'quota' | 'conflict' | 'schema' | 'storage', message: string) { super(message); this.name = 'ProjectStorageError'; }
}
function storageError(error: unknown): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return new ProjectStorageError('quota', 'Browser storage is full. Download a project JSON backup; existing data was not replaced.');
  if (name === 'VersionError') return new ProjectStorageError('schema', 'This browser contains a newer local database. Open it with the newer app.');
  if (name === 'SecurityError' || name === 'InvalidStateError') return new ProjectStorageError('unavailable', 'Local storage is unavailable in this browser or private session. Download a project JSON backup.');
  return new ProjectStorageError('storage', 'The local project could not be read or saved. Existing data was left untouched. Keep a downloaded JSON backup.');
}
const schemaError = () => new ProjectStorageError('schema', 'The local database schema is not supported. Existing records have not been replaced or deleted.');
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new ProjectStorageError('unavailable', 'Local storage is unavailable. Download a project JSON backup.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    let settled = false; let upgradeFailure: ProjectStorageError | undefined;
    request.onupgradeneeded = event => {
      // A blocked request may resume after its caller has already received an error.
      // Do not let that abandoned attempt silently mutate the database later.
      if (settled) { request.transaction?.abort(); return; }
      // v2 only adds a key index. No user payload is parsed, rewritten or removed.
      try {
        if (event.oldVersion === 0) {
          request.result.createObjectStore('projects', { keyPath: 'id' });
          request.result.createObjectStore('meta', { keyPath: 'key' });
        } else if (event.oldVersion !== 1 || !request.result.objectStoreNames.contains('projects') || !request.result.objectStoreNames.contains('meta')) throw schemaError();
        const store = request.transaction!.objectStore('projects');
        if (!store.indexNames.contains(ORDER_INDEX)) store.createIndex(ORDER_INDEX, ['savedAt', 'id']);
      } catch { upgradeFailure = schemaError(); request.transaction?.abort(); }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      db.onversionchange = () => db.close();
      try {
        if (!db.objectStoreNames.contains('projects') || !db.objectStoreNames.contains('meta')) throw schemaError();
        const index = db.transaction('projects', 'readonly').objectStore('projects').index(ORDER_INDEX);
        if (JSON.stringify(index.keyPath) !== JSON.stringify(['savedAt', 'id']) || index.unique) throw schemaError();
      } catch { settled = true; db.close(); reject(schemaError()); return; }
      settled = true; resolve(db);
    };
    request.onerror = () => { if (!settled) { settled = true; reject(upgradeFailure ?? storageError(request.error)); } };
    request.onblocked = () => { if (!settled) { settled = true; reject(new ProjectStorageError('unavailable', fileEase.storageUpgradeBlocked)); } };
  });
}
function payloadOf(project: Project): string { const copy = structuredClone(project); delete copy.savedAt; return canonical(copy); }

/** A missing/evicted comparison base cannot authorize overwriting a different saved payload. */
export function assertSaveAllowed(incoming: ComparisonBase, current?: ComparisonBase, base?: ComparisonBase): void {
  if (!current) return;
  if (incoming.revision < current.revision || (incoming.revision === current.revision && incoming.payload !== current.payload)) throw new ProjectStorageError('conflict', 'A saved revision is newer or has different content at this revision. Reopen the saved project or download your draft; it was not overwritten.');
  if (incoming.payload === current.payload) return;
  if (!base) throw new ProjectStorageError('conflict', fileEase.storageContextMissing);
  if (base.revision !== current.revision || base.payload !== current.payload) throw new ProjectStorageError('conflict', fileEase.storageConflict);
}
function decode(record: StoredProject): Project {
  try {
    if (!record || typeof record.payload !== 'string' || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) throw new Error('Invalid envelope');
    const project = openProjectJSON(record.payload);
    if (project.id !== record.id || project.revision !== record.revision) throw new Error('Invalid envelope identity');
    project.savedAt = record.savedAt; return project;
  } catch { throw new ProjectStorageError('schema', 'A saved project has an unsupported or damaged schema. It has not been migrated, replaced, or deleted.'); }
}
export async function saveProject(project: Project, options: { context?: number } = {}): Promise<{ projectId: string; revision: number; savedAt: string }> {
  serializeProject(project);
  const snapshot = structuredClone(project); const payload = payloadOf(snapshot); const savedAt = new Date().toISOString();
  const context = options.context ?? captureSaveContext(snapshot.id);
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'meta'], 'readwrite'); let failure: unknown;
      const projects = tx.objectStore('projects'); const request = projects.get(snapshot.id);
      request.onsuccess = () => {
        try {
          const record = request.result as StoredProject | undefined;
          if (record) decode(record);
          const editing = observed.get(snapshot.id);
          if (editing?.generation !== context) throw new ProjectStorageError('conflict', 'This save belongs to an earlier or expired editing session. Download its draft before reopening it; the current saved project was not overwritten.');
          assertSaveAllowed({ revision: snapshot.revision, payload }, record, editing.base);
          projects.put({ id: snapshot.id, revision: snapshot.revision, savedAt, payload } satisfies StoredProject);
          tx.objectStore('meta').put({ key: 'lastProject', projectId: snapshot.id } satisfies StoreMeta);
          tx.objectStore('meta').put({ key: summaryKey(snapshot.id), id: snapshot.id, name: snapshot.name, revision: snapshot.revision, savedAt });
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => {
        // An already-running transaction can finish after a user accepts another
        // Open. Its ACK is real, but must not replace that newer editing context.
        if (observed.get(snapshot.id)?.generation === context) observed.set(snapshot.id, { generation: context, base: { revision: snapshot.revision, payload } });
        resolve({ projectId: snapshot.id, revision: snapshot.revision, savedAt });
      };
      tx.onabort = () => reject(storageError(failure ?? tx.error));
      tx.onerror = () => { failure ??= tx.error; };
    });
  } catch (error) { throw storageError(error); } finally { db.close(); }
}
/** Call only after a freshly loaded local snapshot was actually accepted by the editor.
 * Review, cancelled and blocked imports must not refresh an older editing context. */
export function rememberOpenedProject(project: Project): void {
  serializeProject(project);
  newContext(project.id, { revision: project.revision, payload: payloadOf(project) });
}
/** Single-payload read. Preview callers must not advance the editing comparison base. */
export async function loadProject(projectId: string, options: { observe?: boolean } = {}): Promise<Project | null> {
  const db = await openDatabase();
  try {
    const record = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly'); const request = tx.objectStore('projects').get(projectId);
      tx.oncomplete = () => resolve(request.result as StoredProject | undefined);
      tx.onabort = tx.onerror = () => reject(storageError(tx.error));
    });
    if (!record) return null;
    const project = decode(record);
    if (options.observe !== false) newContext(project.id, { revision: project.revision, payload: payloadOf(project) });
    return project;
  } catch (error) { throw storageError(error); } finally { db.close(); }
}
export async function loadLastProject(options: { observe?: boolean } = {}): Promise<Project | null> {
  const db = await openDatabase();
  try {
    const record = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const tx = db.transaction(['projects', 'meta'], 'readonly'); const projects = tx.objectStore('projects');
      const request = tx.objectStore('meta').get('lastProject'); let found: StoredProject | undefined; let failure: unknown;
      const fallback = () => {
        const index = projects.index(ORDER_INDEX); const total = projects.count(); const indexed = index.count();
        const newest = index.openKeyCursor(null, 'prev');
        newest.onsuccess = () => {
          if (newest.result) {
            try { orderKey(newest.result.key); const read = projects.get(newest.result.primaryKey); read.onsuccess = () => { found = read.result as StoredProject | undefined; }; }
            catch (error) { failure = error; tx.abort(); }
          }
        };
        indexed.onsuccess = () => { if (indexed.result < total.result) failure = new ProjectStorageError('schema', 'Some saved records have damaged ordering metadata. They are preserved. Browse local projects for the recovery notice; no empty-library claim is made.'); };
      };
      request.onsuccess = () => {
        if (request.result === undefined) { fallback(); return; }
        const meta = request.result as StoreMeta;
        if (typeof meta.projectId !== 'string') { failure = schemaError(); return; }
        const read = projects.get(meta.projectId);
        read.onsuccess = () => { if (read.result === undefined) fallback(); else found = read.result as StoredProject; };
      };
      tx.oncomplete = () => failure ? reject(failure) : resolve(found);
      tx.onabort = tx.onerror = () => reject(storageError(failure ?? tx.error));
    });
    if (!record) return null;
    const project = decode(record);
    if (options.observe !== false) newContext(project.id, { revision: project.revision, payload: payloadOf(project) });
    return project;
  } catch (error) { throw storageError(error); } finally { db.close(); }
}
/** One replacement page of key/summary metadata; no project payloads or comparison bases are loaded. */
export async function listProjectPage(after: ProjectPageCursor | null = null, limit = 20): Promise<ProjectPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 || after !== null && (after.length !== 2 || after.some(value => typeof value !== 'string'))) throw new Error('Use a valid project page of 1–20 records.');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'meta'], 'readonly'); const projects = tx.objectStore('projects'); const index = projects.index(ORDER_INDEX);
      const total = projects.count(), indexed = index.count(); const items: ProjectMetadata[] = []; let next: ProjectPageCursor | null = null; let failure: unknown;
      const request = index.openKeyCursor(after ? IDBKeyRange.upperBound([...after], true) : null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        if (items.length === limit) { const last = items.at(-1)!; next = [last.savedAt, last.id]; return; }
        let key: [string, string];
        try { key = orderKey(cursor.key); } catch (error) { failure = error; tx.abort(); return; }
        const [savedAt, id] = key;
        const item: ProjectMetadata = { id, savedAt }; items.push(item);
        const summary = tx.objectStore('meta').get(summaryKey(id));
        summary.onsuccess = () => {
          const value = summary.result as Partial<ProjectMetadata> | undefined;
          if (value?.id === id && value.savedAt === savedAt && typeof value.name === 'string' && value.name.length <= 160 && Number.isSafeInteger(value.revision) && value.revision! >= 0) {
            item.name = value.name; item.revision = value.revision;
          }
        };
        cursor.continue();
      };
      tx.oncomplete = () => resolve({ items, next, unlistedRecords: Math.max(0, total.result - indexed.result) });
      tx.onabort = tx.onerror = () => reject(storageError(failure ?? tx.error));
    });
  } catch (error) { throw storageError(error); } finally { db.close(); }
}

export type ProjectLibrarySort = 'recent' | 'oldest' | 'name';
export interface ProjectLibraryQuery { query: string; sort: ProjectLibrarySort; after?: ProjectMetadata | null }
export interface ProjectLibraryScan {
  request: ProjectLibraryQuery; items: ProjectMetadata[]; next: ProjectPageCursor | null;
  scanned: number; matched: number; unlistedRecords: number; complete: boolean; hasMoreResults: boolean;
}
type MetadataPageReader = (after: ProjectPageCursor | null, limit?: number) => Promise<ProjectPage>;
/** A total metadata order. Name ordering never requires decoding stored payloads. */
export function compareProjectMetadata(a: ProjectMetadata, b: ProjectMetadata, sort: ProjectLibrarySort): number {
  const compare = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  const byTime = Date.parse(b.savedAt) - Date.parse(a.savedAt) || compare(b.id, a.id);
  if (sort === 'recent') return byTime;
  if (sort === 'oldest') return -byTime;
  return compare((a.name ?? a.id).toLocaleLowerCase('en'), (b.name ?? b.id).toLocaleLowerCase('en')) || byTime;
}
/** Scans at most25 bounded indexed pages per call, retaining only the best20 matches.
 * Continue until complete for a global result; partial scope is explicit.
 * Subsequent result pages rescan keys/summaries after the semantic sort cursor,
 * so the library is never decoded or retained as a payload-sized array. */
export async function scanProjectLibrary(request: ProjectLibraryQuery, previous?: ProjectLibraryScan | null, readPage: MetadataPageReader = listProjectPage, pageBudget = 25): Promise<ProjectLibraryScan> {
  const messages = fileEase;
  if (typeof request.query !== 'string' || request.query.length > 160 || !['recent', 'oldest', 'name'].includes(request.sort)) throw new Error(messages.libraryInvalidRequest);
  if (!Number.isSafeInteger(pageBudget) || pageBudget < 1 || pageBudget > 25) throw new Error(messages.libraryScanBudget);
  if (request.after) orderKey([request.after.savedAt, request.after.id]);
  const normalized: ProjectLibraryQuery = { query: request.query.trim(), sort: request.sort, after: request.after ? { ...request.after } : null };
  if (previous && canonical(previous.request) !== canonical(normalized)) throw new Error(messages.libraryInvalidContinuation);
  if (previous?.complete) return previous;
  const items = previous?.items.map(item => ({ ...item })) ?? [];
  let next = previous?.next ?? null, scanned = previous?.scanned ?? 0, matched = previous?.matched ?? 0, unlistedRecords = previous?.unlistedRecords ?? 0, complete = false;
  const query = normalized.query.toLocaleLowerCase('en'); const compare = (a: ProjectMetadata, b: ProjectMetadata) => compareProjectMetadata(a, b, normalized.sort);
  for (let page = 0; page < pageBudget; page++) {
    const result = await readPage(next, 20);
    for (const item of result.items) {
      scanned++;
      if (!`${item.name ?? ''} ${item.id}`.toLocaleLowerCase('en').includes(query) || normalized.after && compare(item, normalized.after) <= 0) continue;
      matched++; items.push({ ...item }); items.sort(compare); if (items.length > 20) items.length = 20;
    }
    unlistedRecords = Math.max(unlistedRecords, result.unlistedRecords); next = result.next;
    if (!next) { complete = true; break; }
  }
  return { request: normalized, items, next, scanned, matched, unlistedRecords, complete, hasMoreResults: complete && matched > items.length };
}
