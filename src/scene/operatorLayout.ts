import type { Project } from '../model/types';
import type { WorldFrame } from '../playback';
import type { PersonTarget } from './peopleMotion';

/** Anonymous pool-unit illustrations; shared pools never create duplicate people. */
export function operatorTargets(project: Project, frame: WorldFrame, layout: Record<string, { x: number; z: number }>, previous: Map<string, string>): PersonTarget[] {
  const targets: PersonTarget[] = [];
  const services = project.model.nodes.filter(node => node.kind === 'service');
  for (const pool of project.model.resources) {
    if (!/team|staff|specialist|operator|worker|crew/i.test(pool.label)) continue;
    const uses = services.filter(node => node.resources.some(req => req.poolId === pool.id));
    if (!uses.length) continue;
    const requests = new Map(uses.map(node => [node.id, (frame.busy[node.id] ?? 0) * (node.resources.find(req => req.poolId === pool.id)?.units ?? 1)]));
    const busy = [...requests.values()].reduce((a, b) => a + b, 0);
    const capacity = pool.calendar.find(period => frame.time >= period.start && frame.time < period.end)?.capacity ?? pool.capacity;
    const count = Math.min(6, Math.max(capacity, busy));
    for (let i = 0; i < count && targets.length < 32; i++) {
      const id = `operator:${pool.id}:${i}`, last = previous.get(id);
      const node = last && (requests.get(last) ?? 0) > 0 ? uses.find(node => node.id === last)! : uses.find(node => (requests.get(node.id) ?? 0) > 0) ?? uses.find(node => node.id === last) ?? uses[0];
      if ((requests.get(node.id) ?? 0) > 0) requests.set(node.id, requests.get(node.id)! - 1);
      previous.set(id, node.id);
      const p = layout[node.id]; if (!p) continue;
      const local = targets.filter(target => target.nodeId === node.id).length;
      const slots = Math.min(3, Math.max(1, node.servers)), slot = local % slots;
      const x = p.x + (slots === 1 ? 0 : slot === 0 ? -1.65 : slot === 1 ? 1.65 : 0) + .9 + Math.floor(local / slots) * .6;
      const z = p.z + (slots > 2 && slot === 2 ? -3.2 : 0) + (project.world === 'factory' ? 1.5 : -1.2);
      const arrival = project.model.nodes.find(item => item.kind === 'source'), entry = arrival ? layout[arrival.id] : null;
      targets.push({ spawn: entry ? { x: entry.x, y: 0, z: entry.z } : undefined, id, role: 'operator', nodeId: node.id, variant: i % 2, position: { x, y: 0, z }, heading: project.world === 'factory' ? Math.PI : 0 });
    }
  }
  for (const id of previous.keys()) if (!targets.some(target => target.id === id)) previous.delete(id);
  return targets;
}
