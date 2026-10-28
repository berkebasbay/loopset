import type { ValidationIssue } from './types';
import { facilityMessages as m } from '../ui/messages/facility';

export const FACILITY_OBJECT_LIMIT = 500;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const identity = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function validateFacility(value: unknown, nodeIds: ReadonlySet<string>, path = 'facility'): ValidationIssue[] {
  if (value === undefined) return [];
  const issues: ValidationIssue[] = [];
  const error = (at: string, message: string) => issues.push({ path: at, message, severity: 'error' });
  if (!object(value) || value.version !== 1 || !Array.isArray(value.objects) || !object(value.nodeAssets)) {
    error(path, m.invalidFacility); return issues;
  }
  const objects = value.objects;
  if (value.scenery !== undefined && typeof value.scenery !== 'boolean') error(`${path}.scenery`, m.invalidFacility);
  if (objects.length > FACILITY_OBJECT_LIMIT || Object.keys(objects).length !== objects.length) {
    error(`${path}.objects`, m.tooManyObjects); return issues;
  }
  function reference(item: Record<string, unknown>, at: string) {
    if (typeof item.assetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(item.assetId) || typeof item.assetVersion !== 'string' || !/^[a-f0-9]{40}$/.test(item.assetVersion)) error(at, m.invalidReference);
    // Catalogue availability is a rendering concern. Safe references remain
    // portable even when this installation does not include their geometry.
    if (!finite(item.rotation, -360, 360) || !finite(item.scale, .1, 10)) error(at, m.invalidTransform);
  }
  const seen = new Set<string>();
  value.objects.forEach((item, i) => {
    const at = `${path}.objects.${i}`;
    if (!object(item)) { error(at, m.invalidFacility); return; }
    if (!identity(item.id) || seen.has(String(item.id))) error(at, m.invalidFacility);
    seen.add(String(item.id));
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160) error(at, m.invalidName);
    if (!finite(item.x, -100, 100) || !finite(item.z, -100, 100)) error(at, m.invalidTransform);
    if (item.y !== undefined && !finite(item.y, 0, 50)) error(at, m.invalidTransform);
    reference(item, at);
  });
  if (Object.keys(value.nodeAssets).length > 100) error(`${path}.nodeAssets`, m.invalidFacility);
  for (const [id, item] of Object.entries(value.nodeAssets)) {
    if (!identity(id) || !nodeIds.has(id) || !object(item)) error(`${path}.nodeAssets.${id}`, m.invalidStep);
    else reference(item, `${path}.nodeAssets.${id}`);
  }
  return issues;
}
