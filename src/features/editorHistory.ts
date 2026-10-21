import { editorHistoryMessages as m } from '../ui/messages/editorHistory';
import type { Point, Project } from '../model/types';

export const HISTORY_ACTION_LIMIT = 50;
export const HISTORY_BYTE_LIMIT = 16 * 1024 * 1024;
type PointChange = { id: string; before?: Point; after?: Point };
type EntryBody = { kind: 'layout'; changes: PointChange[] } | { kind: 'snapshot'; before: Project; after: Project };
export type HistoryEntry = EntryBody & { id: number; label: string };
export interface EditorHistory {
  past: HistoryEntry[]; future: HistoryEntry[]; nextId: number;
  discarded: number; estimatedBytes: number; estimateUnavailable: boolean;
}
export const emptyHistory = (): EditorHistory => ({ past: [], future: [], nextId: 1, discarded: 0, estimatedBytes: 0, estimateUnavailable: false });
const byteCache = new WeakMap<object, number | null>();

/** Includes NaN/Infinity drafts in memory exactly. This comparison never serializes them. */
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function sameExcept(a: Project, b: Project, omitted: string[]): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !omitted.includes(key))
    .every(key => equal(a[key as keyof Project], b[key as keyof Project]));
}
function payloadBytes(value: object): number | null {
  if (byteCache.has(value)) return byteCache.get(value)!;
  let bytes: number | null;
  try { bytes = new TextEncoder().encode(JSON.stringify(value, (_key, item) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item)).length; }
  catch { bytes = null; }
  byteCache.set(value, bytes); return bytes;
}
/** Conservative serialized payload accounting, not heap: shared nested subtrees may count twice. */
function accounting(entries: HistoryEntry[]): { estimatedBytes: number; estimateUnavailable: boolean } {
  const seen = new Set<object>(); let estimatedBytes = 0, estimateUnavailable = false;
  for (const entry of entries) {
    estimatedBytes += new TextEncoder().encode(entry.label).length + 32;
    const payloads = entry.kind === 'snapshot' ? [entry.before, entry.after] : [entry.changes];
    for (const payload of payloads) if (!seen.has(payload)) {
      seen.add(payload); const bytes = payloadBytes(payload);
      if (bytes === null) estimateUnavailable = true; else estimatedBytes += bytes;
    }
  }
  return { estimatedBytes, estimateUnavailable };
}
function bounded(history: EditorHistory): EditorHistory {
  const past = [...history.past], future = [...history.future]; let discarded = history.discarded;
  let totals = accounting([...past, ...future]);
  while (past.length + future.length > HISTORY_ACTION_LIMIT || totals.estimatedBytes > HISTORY_BYTE_LIMIT) {
    if (past.length) past.shift(); else if (future.length) future.pop(); else break;
    discarded++; totals = accounting([...past, ...future]);
  }
  return { ...history, past, future, discarded, ...totals };
}
function restored(snapshot: Project, revision: number): Project {
  const project = { ...snapshot, revision }; delete project.savedAt; return project;
}
function apply(entry: HistoryEntry, project: Project, direction: 'before' | 'after'): Project {
  if (entry.kind === 'snapshot') return restored(entry[direction], project.revision + 1);
  const layout = { ...project.layout };
  for (const change of entry.changes) {
    const point = change[direction];
    if (point === undefined) delete layout[change.id]; else layout[change.id] = point;
  }
  return restored({ ...project, layout }, project.revision + 1);
}

export function describeProjectEdit(before: Project, after: Project): string {
  if (!equal(before.model, after.model) || !equal(before.layout, after.layout) || before.world !== after.world) {
    const scenario = after.scenarios?.find(item => item.world === after.world && equal(item.model, after.model) && equal(item.layout, after.layout));
    if (scenario && equal(before.scenarios, after.scenarios)) return m.restoreScenario(scenario.name);
  }
  const oldIds = new Set(before.model.nodes.map(node => node.id)), newIds = new Set(after.model.nodes.map(node => node.id));
  const added = after.model.nodes.filter(node => !oldIds.has(node.id)), removed = before.model.nodes.filter(node => !newIds.has(node.id));
  if (added.length === 1 && removed.length === 1 && added[0].samplingId === removed[0].samplingId) return m.renameId(removed[0].label);
  if (added.length) return m.add(added[0].label || added[0].kind);
  if (removed.length) return m.delete(removed[0].label || removed[0].kind);
  const beforeScenarios = before.scenarios ?? [], afterScenarios = after.scenarios ?? [];
  const addedScenario = afterScenarios.find(item => !beforeScenarios.some(previous => previous.id === item.id));
  if (addedScenario) return m.saveScenario(addedScenario.name);
  const removedScenario = beforeScenarios.find(item => !afterScenarios.some(next => next.id === item.id));
  if (removedScenario) return m.removeScenario(removedScenario.name);
  if (before.world !== after.world) return m.changeVisualWorld;
  for (const node of after.model.nodes) {
    const previous = before.model.nodes.find(item => item.id === node.id); if (!previous || equal(previous, node)) continue;
    const names: Record<string, string> = { label: m.name, next: m.connection, duration: m.processingTime, servers: m.parallelServers, resources: m.resourceRequirements, arrival: m.arrivals, classes: m.entityClasses, capacity: m.waitingCapacity, discipline: m.queueDiscipline, patience: m.patience, branches: m.routeDestinations, samplingId: m.samplingId };
    const changed = Object.keys(node).filter(key => !equal((previous as unknown as Record<string, unknown>)[key], (node as unknown as Record<string, unknown>)[key]));
    return m.change(previous.label || previous.kind, changed.length === 1 ? names[changed[0]] ?? changed[0] : m.settings);
  }
  const addedPool = after.model.resources.find(pool => !before.model.resources.some(old => old.id === pool.id));
  if (addedPool) return m.add(addedPool.label || m.resourcePool);
  const removedPool = before.model.resources.find(pool => !after.model.resources.some(next => next.id === pool.id));
  if (removedPool) return m.delete(removedPool.label || m.resourcePool);
  for (const pool of after.model.resources) {
    const previous = before.model.resources.find(item => item.id === pool.id);
    if (previous && !equal(previous, pool)) return m.changeSettings(previous.label || m.resourcePool);
  }
  for (const key of ['name', 'horizon', 'warmup', 'seed', 'slaSeconds', 'currency'] as const) if (!equal(before.model[key], after.model[key])) {
    return m.changeModelField(m.modelFields[key]);
  }
  if (before.name !== after.name) return m.renameProject;
  if (before.description !== after.description) return m.editProjectDescription;
  if (!equal(before.layout, after.layout)) {
    const ids = [...new Set([...Object.keys(before.layout), ...Object.keys(after.layout)])].filter(id => !equal(before.layout[id], after.layout[id]));
    return ids.length === 1 ? m.move(after.model.nodes.find(node => node.id === ids[0])?.label ?? m.step) : m.moveSteps(ids.length);
  }
  return m.editProjectSettings;
}

export function commitEdit(history: EditorHistory, before: Project, requested: Project, label = describeProjectEdit(before, requested)): { history: EditorHistory; project: Project; entry?: HistoryEntry } {
  if (sameExcept(before, requested, ['revision', 'savedAt'])) return { history, project: before };
  const project = restored(requested, before.revision + 1);
  let body: EntryBody;
  if (sameExcept(before, project, ['layout', 'revision', 'savedAt'])) {
    const ids = [...new Set([...Object.keys(before.layout), ...Object.keys(project.layout)])];
    body = { kind: 'layout', changes: ids.filter(id => !equal(before.layout[id], project.layout[id])).map(id => ({ id,
      before: Object.hasOwn(before.layout, id) ? before.layout[id] : undefined, after: Object.hasOwn(project.layout, id) ? project.layout[id] : undefined,
    })) };
    // Layout commands share immutable model/scenario data even if the DOM editor cloned it.
    project.model = before.model; project.scenarios = before.scenarios;
  } else body = { kind: 'snapshot', before, after: project };
  const entry: HistoryEntry = { ...body, id: history.nextId, label };
  return { project, entry, history: bounded({ ...history, past: [...history.past, entry], future: [], nextId: history.nextId + 1 }) };
}
export function undoEdit(history: EditorHistory, project: Project): { history: EditorHistory; project: Project; entry?: HistoryEntry } {
  const entry = history.past.at(-1); if (!entry) return { history, project };
  return { project: apply(entry, project, 'before'), entry, history: { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] } };
}
export function redoEdit(history: EditorHistory, project: Project): { history: EditorHistory; project: Project; entry?: HistoryEntry } {
  const entry = history.future[0]; if (!entry) return { history, project };
  return { project: apply(entry, project, 'after'), entry, history: { ...history, past: [...history.past, entry], future: history.future.slice(1) } };
}
