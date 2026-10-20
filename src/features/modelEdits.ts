import { mutateProject } from '../model/commands';
import type { ModelNode, Project } from '../model/types';
import { validateProject } from '../model/validate';

/** The scene and DOM editor use the same model links; routing weights stay explicit. */
export function connectNext(project: Project, from: string, to: string): Project {
  const next = mutateProject(project, copy => {
    const node = copy.model.nodes.find(n => n.id === from);
    if (!node || !('next' in node)) throw new Error('Choose a source, queue, service or delay. Edit weighted routes in the model editor.');
    if (!copy.model.nodes.some(n => n.id === to)) throw new Error('The destination step no longer exists.');
    node.next = to;
  });
  const issue = validateProject(next).find(i => i.severity === 'error');
  if (issue) throw new Error(issue.message);
  return next;
}

export const validIdentity = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
export function uniqueIdentity(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let i = 1; i <= 100_000; i++) { const candidate = `${prefix}-${i}`; if (!used.has(candidate)) return candidate; }
  throw new Error('No unused identity is available.');
}
export function renameNode(project: Project, from: string, to: string): Project {
  if (!validIdentity(to) || project.model.nodes.some(n => n.id === to && n.id !== from)) throw new Error('Use a unique 1–64 character ID with letters, numbers, hyphens or underscores.');
  return mutateProject(project, copy => {
    const node = copy.model.nodes.find(n => n.id === from); if (!node) throw new Error('Step no longer exists.');
    node.id = to;
    for (const item of copy.model.nodes) {
      if ('next' in item && item.next === from) item.next = to;
      if (item.kind === 'route') for (const branch of item.branches) if (branch.to === from) branch.to = to;
    }
    if (Object.hasOwn(copy.layout, from)) { const point = copy.layout[from]; delete copy.layout[from]; copy.layout[to] = point; }
  });
}
export function removeNode(project: Project, id: string, replacement: string): Project {
  if (replacement && (!project.model.nodes.some(n => n.id === replacement) || replacement === id)) throw new Error('Choose an existing replacement step.');
  return mutateProject(project, copy => {
    copy.model.nodes = copy.model.nodes.filter(n => n.id !== id); delete copy.layout[id];
    for (const node of copy.model.nodes) {
      if ('next' in node && node.next === id) node.next = replacement;
      if (node.kind === 'route') for (const branch of node.branches) if (branch.to === id) branch.to = replacement;
    }
  });
}
export function addNode(project: Project, kind: ModelNode['kind']): { project: Project; id: string } {
  if (project.model.nodes.length >= 100) throw new Error('Models are limited to 100 steps.');
  const id = uniqueIdentity(kind, project.model.nodes.map(n => n.id));
  const samplingId = uniqueIdentity(`sample-${kind}`, project.model.nodes.map(n => n.samplingId));
  const destination = project.model.nodes.find(n => n.kind === (kind === 'queue' ? 'service' : 'sink'))?.id ?? '';
  const base = { id, samplingId, label: `New ${kind}` };
  let node: ModelNode;
  switch (kind) {
    case 'source': node = { ...base, kind, next: destination, arrival: { kind: 'fixed', perHour: 60 }, classes: [{ id: 'standard', label: 'Standard', priority: 0, probability: 1 }] }; break;
    case 'queue': node = { ...base, kind, next: destination, capacity: null, discipline: 'fifo', patience: null }; break;
    case 'service': node = { ...base, kind, next: destination, duration: { kind: 'constant', value: 30 }, servers: 1, resources: [] }; break;
    case 'route': node = { ...base, kind, branches: [{ to: destination, probability: 1 }] }; break;
    case 'delay': node = { ...base, kind, next: destination, duration: { kind: 'constant', value: 10 } }; break;
    case 'sink': node = { ...base, kind }; break;
  }
  return { id, project: mutateProject(project, copy => { copy.model.nodes.push(node); copy.layout[id] = { x: 0, z: 0 }; }) };
}
