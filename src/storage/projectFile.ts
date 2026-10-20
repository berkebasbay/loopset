import type { Project } from '../model/types';
import { parseProject, validateProject } from '../model/validate';
import { FILE_LIMIT } from './csv';

function rejectUnsafeKeys(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error('Project nesting is too deep.');
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index++) {
      const point = value.codePointAt(index)!;
      if (point >= 0xd800 && point <= 0xdfff) throw new Error('Project contains invalid Unicode.');
      if (point > 0xffff) index++;
    }
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Project contains an unsafe object key.');
    rejectUnsafeKeys(child, depth + 1);
  }
}

/** Validate before applying; no migration rewrites the user's source file. */
export function openProjectJSON(text: string): Project {
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error('Project files are limited to 5 MB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Project JSON is incomplete or malformed. The current project has not been replaced.'); }
  rejectUnsafeKeys(value);
  if (value && typeof value === 'object' && 'savedAt' in value && (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)))) throw new Error('Project save timestamp is invalid. The current project has not been replaced.');
  return parseProject(JSON.stringify(value));
}

export function serializeProject(project: Project): string {
  const errors = validateProject(project).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(`Repair the model before exporting: ${errors[0].message}`);
  rejectUnsafeKeys(project);
  const text = JSON.stringify(project, null, 2);
  if (new TextEncoder().encode(text).length > FILE_LIMIT) throw new Error('This project exceeds the 5 MB portable-file limit. Reduce imported samples before exporting.');
  return text;
}
