import type { Project, RunResult, TraceEvent } from '../model/types';

export interface Actor { id: string; nodeId: string; state: 'waiting' | 'working' | 'moving'; priority: number }
export interface WorldFrame {
  time: number; actors: Actor[]; queues: Record<string, number>; busy: Record<string, number>;
  arrivals: number; completed: number; abandoned: number; inSystem: number; aggregated: boolean;
}

/** Presentation allocation/accounting limits, not a measurement of browser heap. */
export const REPLAY_LIMITS = Object.freeze({
  targetEventsPerCheckpoint: 2_048, maxCheckpoints: 32,
  maxCheckpointActorRecords: 50_000, maxCheckpointEstimatedBytes: 8 * 1_024 * 1_024,
});
export interface ReplayCheckpoint {
  readonly kind: 'origin' | 'sealed-timestamp';
  readonly time: number; readonly eventOffset: number; readonly activeActors: number;
}
export interface ReplaySegment {
  readonly start: number; readonly end: number;
  /** Half-open indexes into the retained trace: [eventStart, eventEnd). */
  readonly eventStart: number; readonly eventEnd: number; readonly checkpointIndex: number;
}
export interface ReplayManifest {
  /** Closed seekable intervals. The current engine supplies one safe prefix, or none. */
  readonly coverage: readonly Readonly<{ start: number; end: number }>[];
  readonly traceComplete: boolean; readonly coveredEvents: number;
  readonly checkpoints: readonly ReplayCheckpoint[]; readonly segments: readonly ReplaySegment[];
  readonly limits: typeof REPLAY_LIMITS;
  readonly accounting: Readonly<{
    checkpointActorRecords: number; checkpointEstimatedBytes: number;
    priorityRecords: number; priorityEstimatedBytes: number;
    peakActiveActors: number; peakActiveEstimatedBytes: number; cursorActorLimit: number;
  }>;
}

type StoredActor = Readonly<Actor>;
interface ReplayState {
  active: Map<string, StoredActor>; queues: Map<string, number>; busy: Map<string, number>;
  arrivals: number; completed: number; abandoned: number; eventOffset: number; actorEstimatedBytes: number;
}
interface Checkpoint extends ReplayCheckpoint {
  readonly actors: readonly StoredActor[];
  readonly arrivals: number; readonly completed: number; readonly abandoned: number;
}
interface ReplayIndex {
  events: RunResult['events']; entities: RunResult['entities'];
  until: number; complete: boolean; entityLimit: number; eventLimit: number;
  priorities: Map<string, number>; checkpoints: readonly Checkpoint[];
  manifest: ReplayManifest; cursor: ReplayState;
}
const indexes = new WeakMap<RunResult, ReplayIndex>();
const emptyState = (): ReplayState => ({ active: new Map(), queues: new Map(), busy: new Map(), arrivals: 0, completed: 0, abandoned: 0, eventOffset: 0, actorEstimatedBytes: 0 });
// Deliberately conservative accounting units: record/container allowance plus
// UTF-16 characters, even when strings/immutable actor objects are shared.
const actorBytes = (actor: StoredActor) => 96 + 2 * (actor.id.length + actor.nodeId.length);
const count = (counts: Map<string, number>, id: string, delta: number) => {
  const next = (counts.get(id) ?? 0) + delta;
  if (next === 0) counts.delete(id); else counts.set(id, next);
};
function addActor(state: ReplayState, actor: StoredActor, delta: number) {
  if (actor.state === 'waiting') count(state.queues, actor.nodeId, delta);
  if (actor.state === 'working') count(state.busy, actor.nodeId, delta);
  state.actorEstimatedBytes += delta * actorBytes(actor);
}
function apply(state: ReplayState, event: TraceEvent, priorities: ReadonlyMap<string, number>) {
  const previous = state.active.get(event.entityId);
  if (previous) addActor(state, previous, -1);
  if (event.kind === 'arrival') state.arrivals++;
  if (event.kind === 'complete' || event.kind === 'balk' || event.kind === 'renege') {
    state.active.delete(event.entityId);
    if (event.kind === 'complete') state.completed++; else state.abandoned++;
  } else {
    const actor: StoredActor = Object.freeze({
      id: event.entityId, nodeId: event.nodeId,
      state: event.kind === 'queue' ? 'waiting' : event.kind === 'start' ? 'working' : 'moving',
      priority: priorities.get(event.entityId) ?? 0,
    });
    // Updating a Map entry preserves original arrival/insertion order.
    state.active.set(actor.id, actor); addActor(state, actor, 1);
  }
  state.eventOffset++;
}
/** First event after time, so a seek always consumes a whole timestamp transaction. */
function afterTime(events: readonly TraceEvent[], end: number, time: number): number {
  let low = 0; let high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].time <= time) low = middle + 1; else high = middle;
  }
  return low;
}
function buildIndex(result: RunResult): ReplayIndex {
  const { until, complete, entityLimit, eventLimit } = result.trace;
  const available = complete || until !== 0;
  const coveredEvents = available ? afterTime(result.events, result.events.length, until) : 0;
  const priorities = new Map<string, number>(); let priorityEstimatedBytes = 0;
  // Only small presentation fields are copied; model/distributions/result are not.
  for (const entity of available ? result.entities : []) {
    priorities.set(entity.id, entity.priority); priorityEstimatedBytes += 48 + 2 * entity.id.length;
  }
  const cursor = emptyState(); const checkpoints: Checkpoint[] = [];
  let checkpointActorRecords = 0; let checkpointEstimatedBytes = 0;
  let peakActiveActors = 0; let peakActiveEstimatedBytes = 0;
  const capture = (time: number, kind: ReplayCheckpoint['kind']) => {
    const estimate = 128 + cursor.actorEstimatedBytes;
    if (checkpoints.length >= REPLAY_LIMITS.maxCheckpoints ||
      checkpointActorRecords + cursor.active.size > REPLAY_LIMITS.maxCheckpointActorRecords ||
      checkpointEstimatedBytes + estimate > REPLAY_LIMITS.maxCheckpointEstimatedBytes) return;
    checkpoints.push(Object.freeze({
      kind, time, eventOffset: cursor.eventOffset, activeActors: cursor.active.size,
      actors: Object.freeze([...cursor.active.values()]),
      arrivals: cursor.arrivals, completed: cursor.completed, abandoned: cursor.abandoned,
    }));
    checkpointActorRecords += cursor.active.size; checkpointEstimatedBytes += estimate;
  };
  if (available) capture(0, 'origin'); // Empty state BEFORE the first timestamp, including time0.
  const spacing = Math.max(REPLAY_LIMITS.targetEventsPerCheckpoint, Math.ceil(coveredEvents / (REPLAY_LIMITS.maxCheckpoints - 1)));
  while (cursor.eventOffset < coveredEvents) {
    const time = result.events[cursor.eventOffset].time;
    do {
      apply(cursor, result.events[cursor.eventOffset], priorities);
      peakActiveActors = Math.max(peakActiveActors, cursor.active.size);
      peakActiveEstimatedBytes = Math.max(peakActiveEstimatedBytes, cursor.actorEstimatedBytes);
    } while (cursor.eventOffset < coveredEvents && result.events[cursor.eventOffset].time === time);
    if (cursor.eventOffset - checkpoints[checkpoints.length - 1].eventOffset >= spacing) capture(time, 'sealed-timestamp');
  }
  const segments = Object.freeze(checkpoints.map((checkpoint, i) => Object.freeze({
    // The starting checkpoint includes its timestamp (except the explicit origin).
    // The following event range includes the ending timestamp, matching time<=seek.
    start: checkpoint.time, end: checkpoints[i + 1]?.time ?? until,
    eventStart: checkpoint.eventOffset, eventEnd: checkpoints[i + 1]?.eventOffset ?? coveredEvents, checkpointIndex: i,
  })));
  const manifest: ReplayManifest = Object.freeze({
    coverage: Object.freeze(available ? [Object.freeze({ start: 0, end: until })] : []),
    traceComplete: complete, coveredEvents,
    checkpoints: Object.freeze(checkpoints.map(({ kind, time, eventOffset, activeActors }) => Object.freeze({ kind, time, eventOffset, activeActors }))),
    segments, limits: REPLAY_LIMITS,
    accounting: Object.freeze({ checkpointActorRecords, checkpointEstimatedBytes, priorityRecords: priorities.size, priorityEstimatedBytes,
      peakActiveActors, peakActiveEstimatedBytes, cursorActorLimit: entityLimit }),
  });
  return { events: result.events, entities: result.entities, until, complete, entityLimit, eventLimit, priorities, checkpoints: Object.freeze(checkpoints), manifest, cursor };
}
function indexFor(result: RunResult): ReplayIndex {
  let index = indexes.get(result);
  // Engine/worker results are sealed inputs. Replaced arrays/coverage invalidate
  // cheaply; hostile in-place mutation is outside this internal contract.
  if (!index || index.events !== result.events || index.entities !== result.entities ||
    index.until !== result.trace.until || index.complete !== result.trace.complete ||
    index.entityLimit !== result.trace.entityLimit || index.eventLimit !== result.trace.eventLimit) {
    index = buildIndex(result); indexes.set(result, index);
  }
  return index;
}

/** Immutable presentation metadata; neither the numerical result nor its raw trace is changed. */
export function replayManifest(result: RunResult): ReplayManifest { return indexFor(result).manifest; }

function restore(state: ReplayState, checkpoint: Checkpoint) {
  // Reuse one cursor rather than retaining a second full active-state copy.
  state.active.clear(); state.queues.clear(); state.busy.clear(); state.actorEstimatedBytes = 0;
  for (const actor of checkpoint.actors) { state.active.set(actor.id, actor); addActor(state, actor, 1); }
  state.arrivals = checkpoint.arrivals; state.completed = checkpoint.completed;
  state.abandoned = checkpoint.abandoned; state.eventOffset = checkpoint.eventOffset;
}
function seek(index: ReplayIndex, time: number): ReplayState {
  const target = afterTime(index.events, index.manifest.coveredEvents, time);
  let low = 0; let high = index.checkpoints.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.checkpoints[middle].eventOffset <= target) low = middle; else high = middle;
  }
  const checkpoint = index.checkpoints[low]; const state = index.cursor;
  if (state.eventOffset > target || state.eventOffset < checkpoint.eventOffset) restore(state, checkpoint);
  // Seek uses the stored following segments, not an unindexed scan from origin.
  let segmentIndex = low;
  while (state.eventOffset < target) {
    const segment = index.manifest.segments[segmentIndex++];
    const end = Math.min(target, segment.eventEnd);
    while (state.eventOffset < end) apply(state, index.events[state.eventOffset], index.priorities);
  }
  return state;
}

/** Replay consumes sealed engine evidence. It never calls the engine or invents outcomes. */
export function frameAt(project: Project, result: RunResult | null, requestedTime: number): WorldFrame {
  const end = result?.trace.until ?? project.model.horizon;
  const time = Number.isFinite(end) && Number.isFinite(requestedTime) ? Math.max(0, Math.min(requestedTime, end)) : 0;
  const frame: WorldFrame = { time, actors: [], queues: Object.create(null), busy: Object.create(null), arrivals: 0, completed: 0, abandoned: 0, inSystem: 0, aggregated: false };
  if (!result || (!result.trace.complete && result.trace.until === 0)) return frame;
  const index = indexFor(result); const state = seek(index, time);
  frame.arrivals = state.arrivals; frame.completed = state.completed; frame.abandoned = state.abandoned;
  for (const [id, value] of state.queues) frame.queues[id] = value;
  for (const [id, value] of state.busy) frame.busy[id] = value;
  frame.inSystem = state.active.size;
  // A bounded representative set keeps one crowded queue from hiding every
  // other station. Exact totals above always use the complete sealed frame.
  const groups = new Map<string, StoredActor[]>();
  for (const actor of state.active.values()) {
    const key = `${actor.nodeId}:${actor.state}`;
    const group = groups.get(key) ?? [];
    if (group.length < 24) group.push(actor);
    groups.set(key, group);
  }
  for (let rank = 0; rank < 24 && frame.actors.length < 500; rank++) {
    for (const group of groups.values()) {
      // Frames never expose cached immutable actor records.
      if (group[rank]) frame.actors.push({ ...group[rank] });
      if (frame.actors.length === 500) break;
    }
  }
  frame.aggregated = frame.actors.length < state.active.size || !result.trace.complete;
  return frame;
}
