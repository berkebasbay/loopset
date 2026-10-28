import type { Project } from '../model/types';
import { createTemplateRecord, readTemplate, validTemplateId, validTemplateMetadata, TEMPLATE_LIMIT, TEMPLATE_BYTE_LIMIT, type TemplateMetadata, type StoredTemplate } from './templateFormat';
import { templateMessages as m } from '../ui/messages/templates';

const DATABASE = 'loopset-templates';
function failure(error: unknown): Error {
  if (error instanceof Error && Object.values(m).some(value => typeof value === 'string' && value === error.message)) return error;
  const name = error instanceof DOMException ? error.name : '';
  return new Error(name === 'QuotaExceededError' ? m.quota : name === 'VersionError' ? m.newer : name === 'SecurityError' || name === 'InvalidStateError' ? m.unavailable : m.storage);
}
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error(m.unavailable));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DATABASE, 1); } catch (error) { reject(failure(error)); return; }
    let settled = false;
    request.onupgradeneeded = event => {
      if (settled || event.oldVersion !== 0) { request.transaction?.abort(); return; }
      request.result.createObjectStore('templates', { keyPath: 'id' });
      request.result.createObjectStore('summaries', { keyPath: 'id' });
    };
    request.onblocked = () => { if (!settled) { settled = true; reject(new Error(m.unavailable)); } };
    request.onerror = () => { if (!settled) { settled = true; reject(failure(request.error)); } };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      db.onversionchange = () => db.close();
      try {
        const tx = db.transaction(['templates', 'summaries'], 'readonly');
        if (tx.objectStore('templates').keyPath !== 'id' || tx.objectStore('summaries').keyPath !== 'id') throw new Error(m.invalidRecord);
      } catch (error) { settled = true; db.close(); reject(failure(error)); return; }
      settled = true; resolve(db);
    };
  });
}
function summaries(values: unknown[], count: number): TemplateMetadata[] {
  if (values.length !== count || values.length > TEMPLATE_LIMIT || !values.every(validTemplateMetadata)) throw new Error(m.invalidRecord);
  return values;
}
export async function listTemplates(): Promise<TemplateMetadata[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['templates', 'summaries'], 'readonly');
      const count = tx.objectStore('templates').count(), rows = tx.objectStore('summaries').getAll(undefined, TEMPLATE_LIMIT + 1);
      tx.oncomplete = () => { try { resolve(summaries(rows.result, count.result).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))); } catch (error) { reject(failure(error)); } };
      tx.onabort = tx.onerror = () => reject(failure(tx.error));
    });
  } finally { db.close(); }
}
export async function saveTemplate(project: Project, name: string): Promise<TemplateMetadata> {
  const record = createTemplateRecord(project, name), { payload: _payload, ...metadata } = record;
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['templates', 'summaries'], 'readwrite'); let error: unknown; let ready = 0;
      const templates = tx.objectStore('templates'), meta = tx.objectStore('summaries');
      const count = templates.count(), rows = meta.getAll(undefined, TEMPLATE_LIMIT + 1);
      const write = () => {
        if (++ready !== 2) return;
        try {
          const current = summaries(rows.result, count.result);
          if (current.length >= TEMPLATE_LIMIT || current.reduce((sum, item) => sum + item.bytes, record.bytes) > TEMPLATE_BYTE_LIMIT) throw new Error(m.limit);
          templates.add(record); meta.add(metadata);
        } catch (cause) { error = cause; tx.abort(); }
      };
      count.onsuccess = write; rows.onsuccess = write;
      tx.oncomplete = () => resolve(metadata);
      tx.onabort = tx.onerror = () => reject(failure(error ?? tx.error));
    });
  } finally { db.close(); }
}
export async function loadTemplate(id: string): Promise<StoredTemplate> {
  if (!validTemplateId(id)) throw new Error(m.invalidRecord);
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('templates', 'readonly'), request = tx.objectStore('templates').get(id);
      tx.oncomplete = () => { try { if (!request.result) throw new Error(m.missing); readTemplate(request.result); resolve(request.result as StoredTemplate); } catch (error) { reject(failure(error)); } };
      tx.onabort = tx.onerror = () => reject(failure(tx.error));
    });
  } finally { db.close(); }
}
export async function removeTemplate(id: string): Promise<void> {
  if (!validTemplateId(id)) throw new Error(m.invalidRecord);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['templates', 'summaries'], 'readwrite');
      tx.objectStore('templates').delete(id); tx.objectStore('summaries').delete(id);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(failure(tx.error));
    });
  } finally { db.close(); }
}
