import type { Project, RunResult } from '../model/types';

export interface Actor { id: string; nodeId: string; state: 'waiting' | 'working' | 'moving'; priority: number }
export interface WorldFrame {
  time: number; actors: Actor[]; queues: Record<string, number>; busy: Record<string, number>;
  arrivals: number; completed: number; abandoned: number; inSystem: number; aggregated: boolean;
}

/** Replay consumes sealed engine evidence. It never calls the engine or invents outcomes. */
export function frameAt(project: Project, result: RunResult | null, requestedTime: number): WorldFrame {
  const end = result?.trace.until ?? project.model.horizon;
  const time = Number.isFinite(end) && Number.isFinite(requestedTime) ? Math.max(0, Math.min(requestedTime, end)) : 0;
  const frame: WorldFrame = { time, actors: [], queues: Object.create(null), busy: Object.create(null), arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
  if (!result || (!result.trace.complete && result.trace.until === 0)) return frame;
  const active = new Map<string, Actor>();
  const priorities = new Map(result.entities.map(e => [e.id, e.priority]));
  for (const e of result.events) {
    if (e.time > time) break;
    if (e.kind === 'arrival') {
      frame.arrivals++;
      active.set(e.entityId, { id: e.entityId, nodeId: e.nodeId, state: 'moving', priority: priorities.get(e.entityId) ?? 0 });
    } else if (e.kind === 'complete') { active.delete(e.entityId); frame.completed++; }
    else if (e.kind === 'balk' || e.kind === 'renege') { active.delete(e.entityId); frame.abandoned++; }
    else active.set(e.entityId, { id: e.entityId, nodeId: e.nodeId, state: e.kind === 'queue' ? 'waiting' : e.kind === 'start' ? 'working' : 'moving', priority: priorities.get(e.entityId) ?? 0 });
  }
  for (const actor of active.values()) {
    if (actor.state === 'waiting') frame.queues[actor.nodeId] = (frame.queues[actor.nodeId] ?? 0) + 1;
    if (actor.state === 'working') frame.busy[actor.nodeId] = (frame.busy[actor.nodeId] ?? 0) + 1;
  }
  frame.inSystem = active.size;
  // A bounded representative set keeps one crowded queue from hiding every
  // other station. Exact totals above always use the complete sealed frame.
  const groups = new Map<string, Actor[]>();
  for (const actor of active.values()) {
    const key = `${actor.nodeId}:${actor.state}`;
    const group = groups.get(key) ?? [];
    if (group.length < 24) group.push(actor);
    groups.set(key, group);
  }
  for (let rank = 0; rank < 24 && frame.actors.length < 500; rank++) {
    for (const group of groups.values()) {
      if (group[rank]) frame.actors.push(group[rank]);
      if (frame.actors.length === 500) break;
    }
  }
  frame.aggregated = frame.actors.length < active.size || !result.trace.complete;
  return frame;
}
