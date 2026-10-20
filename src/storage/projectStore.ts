import type { Project } from '../model/types';
import { canonical } from '../model/identity';
import { openProjectJSON, serializeProject } from './projectFile';

const DATABASE = 'queuelab-projects';
const VERSION = 1;
interface StoredProject { id: string; revision: number; savedAt: string; payload: string }
interface StoreMeta { key: 'lastProject'; projectId: string }
const observed = new Map<string, { revision: number; payload: string }>();

export class ProjectStorageError extends Error {
  constructor(public readonly code: 'unavailable' | 'quota' | 'conflict' | 'schema' | 'storage', message: string) { super(message); this.name = 'ProjectStorageError'; }
}
function storageError(error: unknown): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return new ProjectStorageError('quota', 'Local storage is full. Download a project JSON backup; the previous saved revision is preserved.');
  if (name === 'VersionError') return new ProjectStorageError('schema', 'This browser has a newer QueueLab project database. Existing data was left untouched. Open it with the newer app.');
  if (name === 'SecurityError' || name === 'InvalidStateError') return new ProjectStorageError('unavailable', 'Local storage is unavailable in this browser or private session. Download a project JSON backup.');
  return new ProjectStorageError('storage', 'The local project could not be read or saved. Existing data was left untouched. Keep a downloaded JSON backup.');
}
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new ProjectStorageError('unavailable', 'Local storage is unavailable. Download a project JSON backup.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    let settled = false;
    request.onupgradeneeded = event => {
      // No historical schema exists. Never guess at, delete, or rewrite a future schema.
      if (event.oldVersion !== 0) { request.transaction?.abort(); return; }
      request.result.createObjectStore('projects', { keyPath: 'id' });
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains('projects') || !db.objectStoreNames.contains('meta')) { db.close(); reject(new ProjectStorageError('schema', 'The local database schema is not supported. It has not been changed.')); return; }
      resolve(db);
    };
    request.onerror = () => { if (!settled) { settled = true; reject(storageError(request.error)); } };
    request.onblocked = () => { if (!settled) { settled = true; reject(new ProjectStorageError('unavailable', 'Another QueueLab tab is blocking the database. Close it and retry; existing projects are unchanged.')); } };
  });
}

function payloadOf(project: Project): string { const copy = structuredClone(project); delete copy.savedAt; return canonical(copy); }

/** Pure conflict check shared by the transaction and regression tests. */
export function assertSaveAllowed(incoming: { revision: number; payload: string }, current?: { revision: number; payload: string }, base?: { revision: number; payload: string }): void {
  if (!current) return;
  if (incoming.revision < current.revision || (incoming.revision === current.revision && incoming.payload !== current.payload)) throw new ProjectStorageError('conflict', 'A saved revision is newer or has different content at this revision. Reopen the saved project or download your draft; it was not overwritten.');
  if (incoming.payload === current.payload) return;
  if (!base || base.revision !== current.revision || base.payload !== current.payload) throw new ProjectStorageError('conflict', 'Another QueueLab tab changed this project. Download your draft before reopening the saved project. The other tab’s revision was preserved.');
}

function decode(record: StoredProject): Project {
  try {
    if (!record || typeof record.payload !== 'string' || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) throw new Error('Invalid envelope');
    const project = openProjectJSON(record.payload);
    if (project.id !== record.id || project.revision !== record.revision) throw new Error('Invalid envelope identity');
    project.savedAt = record.savedAt;
    return project;
  } catch { throw new ProjectStorageError('schema', 'A saved project has an unsupported or damaged schema. It has not been migrated, replaced, or deleted.'); }
}

export async function saveProject(project: Project): Promise<{ projectId: string; revision: number; savedAt: string }> {
  serializeProject(project); // Snapshot and validate before opening the transaction.
  const snapshot = structuredClone(project); const payload = payloadOf(snapshot); const savedAt = new Date().toISOString();
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'meta'], 'readwrite'); let failure: unknown;
      const projects = tx.objectStore('projects'); const request = projects.get(snapshot.id);
      request.onsuccess = () => {
        try {
          const record = request.result as StoredProject | undefined;
          if (record) decode(record); // Do not replace records that need a migration or recovery.
          assertSaveAllowed({ revision: snapshot.revision, payload }, record, observed.get(snapshot.id));
          projects.put({ id: snapshot.id, revision: snapshot.revision, savedAt, payload } satisfies StoredProject);
          tx.objectStore('meta').put({ key: 'lastProject', projectId: snapshot.id } satisfies StoreMeta);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => {
        observed.set(snapshot.id, { revision: snapshot.revision, payload });
        resolve({ projectId: snapshot.id, revision: snapshot.revision, savedAt });
      };
      tx.onabort = () => reject(storageError(failure ?? tx.error));
      tx.onerror = () => { failure ??= tx.error; };
    });
  } catch (error) { throw storageError(error); } finally { db.close(); }
}

async function readRecords(): Promise<{ records: StoredProject[]; last?: string }> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'meta'], 'readonly');
      const records = tx.objectStore('projects').getAll(); const last = tx.objectStore('meta').get('lastProject');
      tx.oncomplete = () => resolve({ records: records.result as StoredProject[], last: (last.result as StoreMeta | undefined)?.projectId });
      tx.onabort = () => reject(storageError(tx.error));
      tx.onerror = () => reject(storageError(tx.error));
    });
  } catch (error) { throw storageError(error); } finally { db.close(); }
}
export async function listProjects(): Promise<Project[]> {
  const { records } = await readRecords();
  const projects = records.map(decode).sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
  return projects;
}
export async function loadProject(projectId: string): Promise<Project | null> {
  const { records } = await readRecords(); const record = records.find(record => record.id === projectId);
  if (!record) return null;
  const project = decode(record); observed.set(project.id, { revision: project.revision, payload: payloadOf(project) }); return project;
}
export async function loadLastProject(): Promise<Project | null> {
  const { records, last } = await readRecords();
  const record = records.find(record => record.id === last) ?? [...records].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  if (!record) return null;
  const project = decode(record); observed.set(project.id, { revision: project.revision, payload: payloadOf(project) }); return project;
}
