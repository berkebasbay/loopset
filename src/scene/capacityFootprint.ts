import type { ModelNode, Point } from '../model/types';
import { sceneExtent } from './graph';

export const CELL_WIDTH = 3.6;
export const CELL_DEPTH = 4.2;
export const MAX_3D_CELLS = 16;

export function stationCopies(node: ModelNode): number {
  return node.kind === 'service' ? Math.max(1, Math.min(1000, Math.floor(node.servers))) : 1;
}

/** A stable square spiral: increasing capacity adds one cell without moving earlier cells. */
export function capacityCell(index: number): Point {
  if (index <= 0) return { x: 0, z: 0 };
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2), side = ring * 2;
  const offset = index - (side - 1) ** 2;
  let x: number, z: number;
  if (offset < side) { x = ring; z = ring - 1 - offset; }
  else if (offset < side * 2) { x = ring - 1 - (offset - side); z = -ring; }
  else if (offset < side * 3) { x = -ring; z = -ring + 1 + (offset - side * 2); }
  else { x = -ring + 1 + (offset - side * 3); z = ring; }
  return { x: x * CELL_WIDTH, z: z * CELL_DEPTH };
}

function cellBounds(count: number) {
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (let i = 1; i < count; i++) {
    const p = capacityCell(i); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function axisMap(points: { at: number; extra: number }[]) {
  const extras = new Map<number, number>();
  for (const p of points) extras.set(p.at, Math.max(extras.get(p.at) ?? 0, p.extra));
  const original = [...extras.keys()].sort((a, b) => a - b), visual = original.slice();
  for (let i = 1; i < original.length; i++) visual[i] = visual[i - 1] + original[i] - original[i - 1] + extras.get(original[i - 1])! + extras.get(original[i])!;
  const shift = original.length ? (original[0] + original.at(-1)! - visual[0] - visual.at(-1)!) / 2 : 0;
  for (let i = 0; i < visual.length; i++) visual[i] += shift;
  const convert = (value: number, from: number[], to: number[]) => {
    if (!from.length) return value;
    if (value <= from[0]) return to[0] + value - from[0];
    for (let i = 1; i < from.length; i++) if (value <= from[i]) return to[i - 1] + (value - from[i - 1]) / (from[i] - from[i - 1]) * (to[i] - to[i - 1]);
    return to.at(-1)! + value - from.at(-1)!;
  };
  return { forward: (value: number) => convert(value, original, visual), inverse: (value: number) => convert(value, visual, original) };
}

/** Reversible presentation coordinates only; saved points and simulation input stay untouched. */
export function capacityLayout(nodes: readonly ModelNode[], layout: Record<string, Point>) {
  const footprints = nodes.map(node => ({ node, bounds: cellBounds(stationCopies(node)), p: layout[node.id] })).filter(item => item.p);
  const x = axisMap(footprints.map(({ p, bounds }) => ({ at: p.x, extra: Math.max(-bounds.minX, bounds.maxX) })));
  const z = axisMap(footprints.map(({ p, bounds }) => ({ at: p.z, extra: Math.max(-bounds.minZ, bounds.maxZ) })));
  const toVisual = (point: Point): Point => ({ x: x.forward(point.x), z: z.forward(point.z) });
  const toModel = (point: Point): Point => ({ x: x.inverse(point.x), z: z.inverse(point.z) });
  const positions = Object.fromEntries(Object.entries(layout).map(([id, p]) => [id, toVisual(p)]));
  const base = sceneExtent(positions);
  let { minX, maxX, minZ, maxZ } = base;
  for (const { node, bounds } of footprints) {
    const p = positions[node.id];
    minX = Math.min(minX, p.x + bounds.minX - 2.2); maxX = Math.max(maxX, p.x + bounds.maxX + 2.2);
    minZ = Math.min(minZ, p.z + bounds.minZ - 2.2); maxZ = Math.max(maxZ, p.z + bounds.maxZ + 3.4);
  }
  const extent = { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  return { positions, extent, toVisual, toModel };
}
