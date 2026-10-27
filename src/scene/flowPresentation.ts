import type { ModelNode, Point } from '../model/types';
import { modelLinks, type ModelLink } from './graph';

export interface FlowLink extends ModelLink { index: number }
export interface FlowTopology {
  nodes: Map<string, ModelNode>;
  links: FlowLink[];
  incoming: Map<string, FlowLink[]>;
  outgoing: Map<string, FlowLink[]>;
}
export interface FlowWalk {
  anchor: string;
  ids: string[];
  links: FlowLink[];
  anchorIndex: number;
  hasSource: boolean;
  hasExit: boolean;
  repeated: boolean;
  otherBranches: number;
  excludedBranches: number;
}
export interface GuidePoint { x: number; y: number; z: number }
export interface ConnectionShape { points: GuidePoint[]; arrow: GuidePoint[]; coincident: boolean }
// Code-point ordering, independent of browser locale and insertion order.
const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const order = (a: FlowLink, b: FlowLink) => ascii(a.from, b.from) || ascii(a.to, b.to) || (a.probability ?? 1) - (b.probability ?? 1) || a.index - b.index;
const possible = (link: FlowLink) => link.probability === undefined || Number.isFinite(link.probability) && link.probability > 0;

/** Presentation-only adjacency. No sampling, timing or model writes. */
export function flowTopology(nodes: ModelNode[]): FlowTopology {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const links = modelLinks(nodes).map((link, index) => ({ ...link, index }));
  const incoming = new Map<string, FlowLink[]>(), outgoing = new Map<string, FlowLink[]>();
  for (const id of byId.keys()) { incoming.set(id, []); outgoing.set(id, []); }
  for (const link of links.filter(possible).sort(order)) {
    incoming.get(link.to)?.push(link); outgoing.get(link.from)?.push(link);
  }
  return { nodes: byId, links, incoming, outgoing };
}

function toward(topology: FlowTopology, anchor: string, direction: 'source' | 'exit'): FlowLink[] | null {
  const queue = [anchor], seen = new Set(queue), previous = new Map<string, FlowLink>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor], node = topology.nodes.get(id);
    if (node?.kind === (direction === 'source' ? 'source' : 'sink')) {
      const path: FlowLink[] = []; let current = id;
      while (current !== anchor) {
        const link = previous.get(current)!; path.push(link);
        current = direction === 'source' ? link.to : link.from;
      }
      return direction === 'source' ? path : path.reverse();
    }
    for (const link of (direction === 'source' ? topology.incoming : topology.outgoing).get(id) ?? []) {
      const next = direction === 'source' ? link.from : link.to;
      if (!seen.has(next)) { seen.add(next); previous.set(next, link); queue.push(next); }
    }
  }
  return null;
}

/** One deterministic shortest-hop context on each side of the inspected anchor.
 * It is a declared possible walk, not a sampled, likely or observed entity route.
 * A positive-delay cycle can repeat a step across the two finite halves. */
export function possibleFlow(topology: FlowTopology, anchor: string | null): FlowWalk | null {
  if (anchor === null || !topology.nodes.has(anchor)) return null;
  const upstream = toward(topology, anchor, 'source'), downstream = toward(topology, anchor, 'exit');
  const links = [...upstream ?? [], ...downstream ?? []];
  const ids = links.length ? [links[0].from, ...links.map(link => link.to)] : [anchor];
  const chosen = new Set(links.map(link => link.index)), visited = new Set(ids);
  return { anchor, ids, links, anchorIndex: upstream?.length ?? 0, hasSource: upstream !== null, hasExit: downstream !== null,
    repeated: visited.size < ids.length,
    otherBranches: topology.links.filter(link => visited.has(link.from) && possible(link) && !chosen.has(link.index)).length,
    excludedBranches: topology.links.filter(link => visited.has(link.from) && link.probability === 0).length };
}

export function connectionIsCoincident(a: Point, b: Point): boolean {
  return Math.hypot(b.x - a.x, b.z - a.z) < .01;
}

/** Actual self-loops are topology; they are not two distinct colocated steps. */
export function sharedPositionLinks(topology: FlowTopology, layout: Record<string, Point>): FlowLink[] {
  return topology.links.filter(link => link.from !== link.to && layout[link.from] && layout[link.to] && connectionIsCoincident(layout[link.from], layout[link.to]));
}

/** Finite guide ribbon above equipment. Coincidence is a directed connector
 * symbol returning to the same position, not an offset of either model node. */
export function connectionShape(a: Point, b: Point, lane = 0): ConnectionShape {
  const coincident = connectionIsCoincident(a, b), dx = b.x - a.x, dz = b.z - a.z;
  const distance = Math.hypot(dx, dz), y = 3.35 + Math.min(7, Math.max(0, lane)) * .055;
  const points: GuidePoint[] = [];
  if (coincident) {
    const radius = 1.05 + Math.min(7, Math.max(0, lane)) * .075;
    for (let i = 0; i <= 32; i++) {
      const t = i / 32, angle = t * Math.PI * 2;
      points.push({ x: a.x + radius * Math.sin(angle) + dx * t, y: y + .35 * Math.sin(Math.PI * t), z: a.z + radius * (1 - Math.cos(angle)) + dz * t });
    }
  } else {
    const bend = Math.min(.55, distance * .08) * (lane % 2 ? -1 : 1);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, offset = Math.sin(Math.PI * t) * bend;
      points.push({ x: a.x + dx * t - dz / distance * offset, y, z: a.z + dz * t + dx / distance * offset });
    }
  }
  const at = Math.floor((points.length - 1) * .62), tip = points[at], before = points[at - 1];
  const ax = tip.x - before.x, az = tip.z - before.z, length = Math.hypot(ax, az) || 1;
  const ux = ax / length, uz = az / length, size = coincident ? .31 : Math.min(.38, distance * .22);
  const arrow = [{ ...tip, y: tip.y + .035 },
    { x: tip.x - ux * size - uz * size * .6, y: tip.y + .035, z: tip.z - uz * size + ux * size * .6 },
    { x: tip.x - ux * size + uz * size * .6, y: tip.y + .035, z: tip.z - uz * size - ux * size * .6 }];
  return { points, arrow, coincident };
}

/** Stable bounded lanes for links between the same placed endpoints. */
export function connectionShapes(topology: FlowTopology, layout: Record<string, Point>): Map<number, ConnectionShape> {
  const lanes = new Map<string, number>(), shapes = new Map<number, ConnectionShape>();
  for (const link of [...topology.links].sort(order)) {
    const a = layout[link.from], b = layout[link.to]; if (!a || !b) continue;
    const ends = [[a.x, a.z], [b.x, b.z]].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const key = JSON.stringify(ends), lane = lanes.get(key) ?? 0;
    lanes.set(key, lane + 1); shapes.set(link.index, connectionShape(a, b, lane % 8));
  }
  return shapes;
}

/** Ribbon triangles share the same deterministic curve as the arrow and fit bounds. */
export function ribbonPositions(points: GuidePoint[], width: number): number[] {
  const positions: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 1e-10) continue;
    const x = -dz / length * width / 2, z = dx / length * width / 2;
    for (const p of [{ x: a.x + x, y: a.y, z: a.z + z }, { x: a.x - x, y: a.y, z: a.z - z }, { x: b.x + x, y: b.y, z: b.z + z },
      { x: a.x - x, y: a.y, z: a.z - z }, { x: b.x - x, y: b.y, z: b.z - z }, { x: b.x + x, y: b.y, z: b.z + z }]) positions.push(p.x, p.y, p.z);
  }
  return positions;
}

/** Explicit user framing only. The asymmetric frustum reserves the paper's
 * occluded pixels while fitting the real endpoints, equipment and full curve.
 * Zoom remains 1 inside the existing camera limits. */
export function connectionFraming(points: { x: number; y: number }[], viewport: { width: number; height: number; safeTop: number; safeBottom: number }) {
  const { width, height, safeTop, safeBottom } = viewport;
  if (!points.length || ![width, height, safeTop, safeBottom].every(Number.isFinite) || width <= 0 || height <= 0 || safeBottom <= safeTop) return null;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const aspect = width / height, vertical = Math.max((maxY - minY) / ((safeBottom - safeTop) / height * .76), (maxX - minX) / (aspect * .78), 6);
  const offset = (1 - (safeTop + safeBottom) / height) * vertical / 2;
  const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
  return { left: x - vertical * aspect / 2, right: x + vertical * aspect / 2, top: y + vertical / 2 - offset, bottom: y - vertical / 2 - offset, zoom: 1 };
}
