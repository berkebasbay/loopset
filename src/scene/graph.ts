import type { ModelNode, Point, Project } from '../model/types';

export interface ModelLink { from: string; to: string; probability?: number }

/** Visual links preserve the model graph, including explicit buffers and routing. */
export function modelLinks(nodes: ModelNode[]): ModelLink[] {
  const ids = new Set(nodes.map(node => node.id));
  return nodes.flatMap(node => node.kind === 'sink' ? [] : node.kind === 'route'
    ? node.branches.filter(branch => ids.has(branch.to)).map(branch => ({ from: node.id, to: branch.to, probability: branch.probability }))
    : ids.has(node.next) ? [{ from: node.id, to: node.next }] : []);
}

/** Missing positions get stable visual coordinates; simulation input is untouched. */
export function sceneLayout(project: Project): Record<string, Point> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(project.model.nodes.length * 1.5)));
  return Object.fromEntries(project.model.nodes.map((node, index) => [node.id,
    Number.isFinite(project.layout[node.id]?.x) && Number.isFinite(project.layout[node.id]?.z)
      ? project.layout[node.id] : { x: (index % columns) * 4 - columns * 2, z: Math.floor(index / columns) * 4 },
  ]));
}

export function sceneExtent(layout: Record<string, Point>) {
  const points = Object.values(layout);
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const minX = Math.min(-10.3, ...xs.map(x => x - 2.2));
  const maxX = Math.max(10.3, ...xs.map(x => x + 2.2));
  const minZ = Math.min(-6.1, ...zs.map(z => z - 2.2));
  const maxZ = Math.max(6.1, ...zs.map(z => z + 3.4));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}
