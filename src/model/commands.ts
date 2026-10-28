import type { Distribution, Project, ServiceNode } from './types';

export const MAX_PARALLEL_STATIONS = 1000;

export function meanDuration(d: Distribution): number {
  switch (d.kind) {
    case 'constant': return d.value;
    case 'exponential': return d.mean;
    case 'triangular': return (d.min + d.mode + d.max) / 3;
    case 'empirical': return d.values.reduce((a, b) => a + b, 0) / d.values.length;
  }
}

export function mutateProject(project: Project, edit: (copy: Project) => void): Project {
  const revision = nextRevision(project);
  const next = structuredClone(project); edit(next);
  if (next.workspaceMode === 'layout' && next.model.nodes.length > 0) delete next.workspaceMode;
  next.revision = revision; delete next.savedAt; return next;
}

export function nextRevision(project: Pick<Project, 'revision'>): number {
  if (!Number.isSafeInteger(project.revision) || project.revision < 0 || project.revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Revision limit reached. Duplicate this project to continue editing.');
  }
  return project.revision + 1;
}

/** Quick capacity control also scales a dedicated pool. Shared resources stay explicit. */
export function setCapacity(project: Project, stationId: string, capacity: number): Project {
  if (!Number.isFinite(capacity)) throw new Error('Enter a finite station count.');
  return mutateProject(project, p => {
    const node = p.model.nodes.find(n => n.id === stationId);
    if (!node || node.kind !== 'service') return;
    node.servers = Math.max(1, Math.min(MAX_PARALLEL_STATIONS, Math.round(capacity)));
    for (const req of node.resources) {
      const consumers = p.model.nodes.filter(n => n.kind === 'service' && n.resources.some(r => r.poolId === req.poolId));
      const pool = p.model.resources.find(r => r.id === req.poolId);
      if (pool && consumers.length === 1) {
        const required = Math.min(MAX_PARALLEL_STATIONS, node.servers * req.units);
        pool.installedCapacity = Math.max(pool.installedCapacity, required);
        pool.capacity = required;
      }
    }
  });
}

export function serviceNodes(project: Project): ServiceNode[] { return project.model.nodes.filter((n): n is ServiceNode => n.kind === 'service'); }

/** New document identity, same modeled process and sampling identities. */
export function duplicateProject(project: Project): Project {
  const next = structuredClone(project);
  next.id = `${project.world}-${crypto.randomUUID().slice(0, 8)}`;
  next.name = `${project.name.slice(0, 150)} copy`;
  next.revision = 0; delete next.savedAt;
  return next;
}
