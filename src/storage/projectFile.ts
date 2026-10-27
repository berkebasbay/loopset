import type { Project } from '../model/types';
import { parseProject, validateProject } from '../model/validate';
import { FILE_LIMIT } from './csv';
import { fileErrorMessages as messages } from '../ui/messages/fileErrors';

function rejectUnsafeKeys(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error(messages.projectTooDeep);
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index++) {
      const point = value.codePointAt(index)!;
      if (point >= 0xd800 && point <= 0xdfff) throw new Error(messages.invalidProjectUnicode);
      if (point > 0xffff) index++;
    }
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(messages.unsafeProjectKey);
    rejectUnsafeKeys(child, depth + 1);
  }
}

/** Validate before applying; no migration rewrites the user's source file. */
export function openProjectJSON(text: string): Project {
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error(messages.projectTooLarge);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(messages.malformedProject); }
  rejectUnsafeKeys(value);
  if (value && typeof value === 'object' && 'savedAt' in value && (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)))) throw new Error(messages.invalidProjectTimestamp);
  return parseProject(JSON.stringify(value));
}

export function serializeProject(project: Project): string {
  const errors = validateProject(project).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(messages.repairBeforeExport(errors[0].message));
  rejectUnsafeKeys(project);
  const text = JSON.stringify(project, null, 2);
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error(messages.portableProjectTooLarge);
  return text;
}
