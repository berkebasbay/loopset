import { layoutCommandsMessages as m } from '../ui/messages/layoutCommands';
import type { Point, Project } from '../model/types';
import { sceneLayout } from '../scene/graph';

export const LAYOUT_LIMIT = 100;
export const GRID_STEP = .5;
export interface AlignmentGuide { axis: 'x' | 'z'; value: number; from: number; to: number; movingId: string; targetId: string }
export interface LayoutTranslation { ids: string[]; delta: Point; points: Record<string, Point>; guides: AlignmentGuide[]; error?: string }
export interface MoveGesture {
  preview: (delta: Point) => LayoutTranslation | null;
  finish: () => Pick<LayoutTranslation, 'ids' | 'delta'> | null;
  cancel: () => void;
}

/** A preview owns no project writes; a completed gesture can yield at most one command. */
export function beginMoveGesture(project: Project, ids: string[], anchor: string): MoveGesture {
  let closed = false, last: LayoutTranslation | null = null;
  return {
    preview(delta) { if (closed) return null; last = previewTranslation(project, ids, delta, { anchor, snap: true, align: true }); return last; },
    finish() {
      if (closed) return null; closed = true;
      return last && !last.error && (last.delta.x !== 0 || last.delta.z !== 0) ? { ids: last.ids, delta: last.delta } : null;
    },
    cancel() { closed = true; last = null; },
  };
}

/** A single shared delta preserves every offset, including off-grid imported coordinates. */
export function previewTranslation(project: Project, selectedIds: readonly string[], requested: Point, options: { anchor?: string; snap?: boolean; align?: boolean; tolerance?: number } = {}): LayoutTranslation {
  const existing = new Set(project.model.nodes.map(node => node.id));
  const ids = [...new Set(selectedIds)].filter(id => existing.has(id));
  const layout = sceneLayout(project);
  const fail = (error: string): LayoutTranslation => ({ ids, delta: { x: 0, z: 0 }, points: Object.create(null), guides: [], error });
  if (!ids.length) return fail(m.selectAtLeastOneExistingStepToMove);
  if (![requested.x, requested.z].every(Number.isFinite)) return fail(m.enterAFiniteVisualMoveAmount);
  const range = (axis: 'x' | 'z') => ({ min: Math.max(...ids.map(id => -LAYOUT_LIMIT - layout[id][axis])), max: Math.min(...ids.map(id => LAYOUT_LIMIT - layout[id][axis])) });
  const xr = range('x'), zr = range('z');
  if (xr.min > xr.max || zr.min > zr.max) return fail(m.theseStepsSpanMoreThanTheVisualWorkspaceRepair);
  // Do not silently reposition an out-of-bounds imported/fallback group on the other axis.
  if (xr.min > 0 || xr.max < 0 || zr.min > 0 || zr.max < 0) return fail(m.aSelectedStepIsOutsideTheVisualWorkspaceRepair);
  const clamp = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, v));
  const anchor = options.anchor && ids.includes(options.anchor) ? options.anchor : ids[0];
  const delta = { ...requested };
  if (options.snap) for (const axis of ['x', 'z'] as const) delta[axis] = Math.round((layout[anchor][axis] + requested[axis]) / GRID_STEP) * GRID_STEP - layout[anchor][axis];
  const guides: AlignmentGuide[] = [];
  if (options.align) {
    const selected = new Set(ids), targets = project.model.nodes.filter(node => !selected.has(node.id)).map(node => node.id).sort();
    for (const axis of ['x', 'z'] as const) {
      const r = axis === 'x' ? xr : zr;
      const candidates = ids.flatMap(movingId => targets.map(targetId => ({ movingId, targetId,
        value: layout[targetId][axis], offset: layout[targetId][axis] - layout[movingId][axis],
        distance: Math.abs(layout[targetId][axis] - layout[movingId][axis] - requested[axis]),
      }))).filter(candidate => candidate.distance <= (options.tolerance ?? .18) && candidate.offset >= r.min && candidate.offset <= r.max)
        .sort((a, b) => a.distance - b.distance || (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0) || (a.movingId < b.movingId ? -1 : a.movingId > b.movingId ? 1 : 0));
      const match = candidates[0];
      if (match) { delta[axis] = match.offset; guides.push({ axis, value: match.value, from: 0, to: 0, movingId: match.movingId, targetId: match.targetId }); }
      // Endpoints are filled after both axes have reached their final common delta.
    }
  }
  delta.x = clamp(delta.x, xr); delta.z = clamp(delta.z, zr);
  const points = Object.fromEntries(ids.map(id => [id, { x: layout[id].x + delta.x, z: layout[id].z + delta.z }]));
  for (const guide of guides) { const axis = guide.axis === 'x' ? 'z' : 'x'; guide.from = points[guide.movingId][axis]; guide.to = layout[guide.targetId][axis]; }
  return { ids, delta, points, guides };
}

/** Presentation-only edit, with immutable model/scenario sharing and no partial application. */
export function translateSelection(project: Project, ids: readonly string[], delta: Point, options: Parameters<typeof previewTranslation>[3] = {}): Project {
  const preview = previewTranslation(project, ids, delta, options);
  if (preview.error) throw new Error(preview.error);
  if (preview.delta.x === 0 && preview.delta.z === 0) return project;
  return { ...project, layout: { ...project.layout, ...preview.points }, revision: project.revision + 1, savedAt: undefined };
}
