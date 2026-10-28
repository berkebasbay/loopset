import type { Project, World } from '../model/types';
import { duplicateProject } from '../model/commands';
import { openProjectJSON, serializeProject } from './projectFile';
import { templateMessages as m } from '../ui/messages/templates';

export const TEMPLATE_LIMIT = 50;
export const TEMPLATE_BYTE_LIMIT = 50 * 1024 * 1024;
export interface TemplateMetadata { id: string; name: string; createdAt: string; world: World; objects: number; steps: number; bytes: number }
export interface StoredTemplate extends TemplateMetadata { payload: string }
export const validTemplateId = (id: unknown): id is string => typeof id === 'string' && /^template-[a-f0-9-]{36}$/.test(id);
export function validTemplateMetadata(value: unknown): value is TemplateMetadata {
  if (!value || typeof value !== 'object') return false;
  const v = value as TemplateMetadata;
  return validTemplateId(v.id) && typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 160
    && typeof v.createdAt === 'string' && v.createdAt.length <= 64 && Number.isFinite(Date.parse(v.createdAt))
    && ['factory', 'festival', 'service'].includes(v.world)
    && Number.isSafeInteger(v.objects) && v.objects >= 0 && v.objects <= 500
    && Number.isSafeInteger(v.steps) && v.steps >= 0 && v.steps <= 100
    && Number.isSafeInteger(v.bytes) && v.bytes > 0 && v.bytes <= 5_000_000;
}
/** Immutable snapshot. Saving a template never edits the source document. */
export function createTemplateRecord(project: Project, name: string): StoredTemplate {
  if (!name.trim() || name.trim().length > 160) throw new Error(m.invalidName);
  serializeProject(project);
  const snapshot = duplicateProject(project); snapshot.name = name.trim();
  const payload = serializeProject(snapshot);
  return { id: `template-${crypto.randomUUID()}`, name: snapshot.name, createdAt: new Date().toISOString(), world: snapshot.world,
    objects: snapshot.facility?.objects.length ?? 0, steps: snapshot.model.nodes.length, bytes: new TextEncoder().encode(payload).length, payload };
}
export function readTemplate(record: unknown): Project {
  if (!validTemplateMetadata(record) || !('payload' in record) || typeof record.payload !== 'string' || new TextEncoder().encode(record.payload).length !== record.bytes) throw new Error(m.invalidRecord);
  const project = openProjectJSON(record.payload);
  if (project.name !== record.name || project.world !== record.world || project.model.nodes.length !== record.steps || (project.facility?.objects.length ?? 0) !== record.objects) throw new Error(m.invalidRecord);
  return project;
}
/** Each use gets its own document identity while retaining reproducible modeled inputs. */
export function instantiateTemplate(record: StoredTemplate): Project {
  const project = duplicateProject(readTemplate(record)); project.name = record.name; return project;
}
