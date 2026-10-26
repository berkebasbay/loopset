/** Browser-independent entry point. No UI, renderer, storage or network imports. */
export * from './model/types';
export { simulate, simulateAsync, quantile, RNG_VERSION, normalizeRunLimits, buildCouplingManifest } from './engine';
export { runExperiment, runExperimentAsync, comparePaired, capacitySearch, capacitySearchPlan, estimate } from './experiments';
export type { CapacitySearchSpec, CapacityCandidate, CapacitySearchResult, CapacitySearchPlan } from './experiments';
export { arrivalExpectation, calculationBudget } from './model/workBudget';
export type { WorkGroup, WorkBudget } from './model/workBudget';
export { validateModel, validateProject, assertModel, parseProject } from './model/validate';
export { canonical, fingerprint, modelHash, demandHash } from './model/identity';
export { meanDuration, mutateProject, setCapacity, serviceNodes, duplicateProject } from './model/commands';
export { saveScenario, restoreScenario, removeScenario } from './model/scenarios';
export { createExample, WORLD_INFO } from './examples';

import type { Project } from './model/types';
import { validateProject } from './model/validate';

export const PROJECT_FILE_LIMIT = 5_000_000;

/** Portable UTF-8 JSON text boundary for Node and browser consumers.
 * Decode external bytes with a fatal UTF-8 decoder before calling this function.
 * Error messages never contain imported names, values or object keys.
 */
export function parsePortableProject(text: string): Project {
  if (new TextEncoder().encode(text).length > PROJECT_FILE_LIMIT) throw new Error('Project files are limited to 5 MB.');
  let value: unknown;
  try { value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); }
  catch { throw new Error('Project JSON is incomplete or malformed.'); }
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const validUnicode = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const point = text.codePointAt(i)!;
      if (point >= 0xd800 && point <= 0xdfff) return false;
      if (point > 0xffff) i++;
    }
    return true;
  };
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 40) throw new Error('Project nesting is too deep.');
    if (typeof item.value === 'string' && !validUnicode(item.value)) throw new Error('Project contains invalid Unicode.');
    if (item.value === null || typeof item.value !== 'object') continue;
    for (const [key, child] of Object.entries(item.value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Project contains an unsafe object key.');
      if (!validUnicode(key)) throw new Error('Project contains invalid Unicode.');
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  if (value && typeof value === 'object' && 'savedAt' in value &&
    (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)))) throw new Error('Project save timestamp is invalid.');
  const errors = validateProject(value).filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error('Project schema validation failed. Check the model fields and connections.');
  return value as Project;
}
