import { ENGINE_VERSION } from '../model/types';
import type { EntityRecord, ModelNode, PoolMetrics, QueueNode, RunOptions, RunResult, RunStatus, ServiceNode, SimulationModel, SourceNode, StationMetrics, TraceEvent, Visit } from '../model/types';
import { assertModel } from '../model/validate';
import { demandHash, fingerprint, modelHash } from '../model/identity';
import { EventHeap } from './heap';
import { RNG_VERSION, sample, uniform } from './random';
import { normalizeRunLimits } from './provenance';

export { RNG_VERSION } from './random';
export { normalizeRunLimits, buildCouplingManifest } from './provenance';

type Event = { time: number; phase: number; key: string; sequence: number; kind: 'arrival' | 'finish' | 'calendar' | 'transfer' | 'patience'; nodeId: string; entityId?: string; ordinal?: number; requestId?: number };
interface Entity {
  id: string; source: SourceNode; ordinal: number; classId: string; priority: number;
  arrivedAt: number; cohort: boolean; wait: number; record?: EntityRecord;
  visits: Map<string, number>; request?: Request; delayVisit?: Visit;
}
interface Request {
  id: number; entity: Entity; service: ServiceNode; queue?: QueueNode; arrival: number;
  priority: number; accepted: boolean; queued: boolean; queueVisit?: Visit; serviceVisit?: Visit;
  serviceOrdinal?: number; startedAt?: number;
}
interface StationState {
  node: ServiceNode; requests: Request[]; waiting: number; busy: number; area: number; busyArea: number;
  arrived: number; started: number; finished: number; balked: number; reneged: number; waits: number[];
}
interface PoolState { busy: number; scheduled: number; scheduledArea: number; busyArea: number; overtimeArea: number }
class Stop extends Error { constructor(readonly status: RunStatus, message: string) { super(message); } }
const average = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
export function quantile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
const idCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const requestCompare = (a: Request, b: Request) => a.priority - b.priority || a.arrival - b.arrival || idCompare(a.entity.source.samplingId, b.entity.source.samplingId) || a.entity.ordinal - b.entity.ordinal || idCompare(a.service.samplingId, b.service.samplingId) || a.id - b.id;
/** Generator yields after bounded units of work, including same-timestamp transitions. */
function* execute(input: SimulationModel, options: RunOptions): Generator<void, RunResult> {
  const started = performance.now(); const model = structuredClone(input);
  const seed = options.seed ?? model.seed;
  if (!Number.isSafeInteger(seed)) throw new Error('Run seed must be a safe integer.');
  const limits = normalizeRunLimits(options);
  const { maxEvents: maxWork, maxEntities, maxTraceEntities, maxTraceEvents, maxMicrosteps } = limits;
  const nodes = new Map(model.nodes.map(n => [n.id, n]));
  const sources = model.nodes.filter((n): n is SourceNode => n.kind === 'source').sort((a, b) => idCompare(a.samplingId, b.samplingId));
  const stations = new Map<string, StationState>(); const pools = new Map<string, PoolState>();
  for (const n of model.nodes) if (n.kind === 'service') stations.set(n.id, { node: n, requests: [], waiting: 0, busy: 0, area: 0, busyArea: 0, arrived: 0, started: 0, finished: 0, balked: 0, reneged: 0, waits: [] });
  for (const p of model.resources) pools.set(p.id, { busy: 0, scheduled: p.capacity, scheduledArea: 0, busyArea: 0, overtimeArea: 0 });
  const heap = new EventHeap<Event>(); const active = new Map<string, Entity>();
  const classStats = new Map<string, { arrivals: number; completed: number; balked: number; reneged: number; waitSum: number }>();
  for (const source of sources) for (const c of source.classes) if (!classStats.has(c.id)) classStats.set(c.id, { arrivals: 0, completed: 0, balked: 0, reneged: 0, waitSum: 0 });
  const records: EntityRecord[] = []; const events: TraceEvent[] = [];
  const waits: number[] = []; const sojourns: number[] = [];
  let time = 0; let committedTime = 0; let sequence = 0; let requestId = 0; let work = 0; let totalArrivals = 0;
  let arrivals = 0; let completed = 0; let balked = 0; let reneged = 0; let slaMet = 0;
  let traceFull = true; let traceUntil = 0; let stalePatience = 0; let status: RunStatus = 'completed'; let reason: string | undefined;
  let maxHeapSize = 0; let maxActiveEntities = 0; let bypassedRequests = 0;
  let lastProgress = -1;
  let pending: { entity: Entity; nodeId: string }[] = []; let pendingIndex = 0; let microsteps = 0;
  const hasPending = () => pendingIndex < pending.length;
  const progress = (fraction: number) => {
    if (fraction >= lastProgress + 0.01 || fraction === 1 && lastProgress !== 1) { lastProgress = fraction; options.onProgress?.(fraction); }
  };
  const tick = () => {
    if (options.shouldCancel?.()) throw new Stop('cancelled', 'Cancellation requested.');
    if (work >= maxWork) throw new Stop('limited', `Total work budget (${maxWork}) reached; result is incomplete.`);
    work++;
  };
  const truncate = () => { if (traceFull) { traceFull = false; traceUntil = committedTime; } };
  const emit = (kind: TraceEvent['kind'], entity: Entity, nodeId: string) => {
    if (!traceFull) return;
    if (!entity.record || events.length >= maxTraceEvents) { truncate(); return; }
    events.push({ time, kind, entityId: entity.id, nodeId });
  };
  const schedule = (event: Omit<Event, 'sequence' | 'phase' | 'key'>) => {
    if (!Number.isFinite(event.time) || event.time < time) throw new Stop('failed', 'numeric-precision: event time must be finite and cannot move backwards.');
    const phase = event.kind === 'finish' ? 0 : event.kind === 'calendar' ? 1 : event.kind === 'patience' ? 4 : 2;
    heap.push({ ...event, phase, key: `${nodes.get(event.nodeId)?.samplingId ?? event.nodeId}:${event.entityId ?? ''}:${event.ordinal ?? ''}`, sequence: sequence++ });
    maxHeapSize = Math.max(maxHeapSize, heap.size);
  };
  const future = (duration: number, positive: boolean) => {
    const next = time + duration;
    if (!Number.isFinite(next) || duration < 0 || (positive || duration > 0) && !(next > time)) throw new Stop('failed', 'numeric-precision: positive duration does not advance representable time.');
    return next;
  };
  const draw = (entity: Entity, node: ModelNode, kind: string, visit: number) => uniform(seed, entity.source.samplingId, entity.ordinal, node.samplingId, visit, kind);
  const visit = (entity: Entity, node: ModelNode): { ordinal: number; record?: Visit } => {
    const ordinal = entity.visits.get(node.samplingId) ?? 0;
    entity.visits.set(node.samplingId, ordinal + 1);
    const record: Visit | undefined = entity.record && traceFull ? { nodeId: node.id, arrival: time } : undefined;
    if (record) entity.record!.visits.push(record);
    return { ordinal, record };
  };
  const end = (entity: Entity, outcome: 'completed' | 'balked' | 'reneged', nodeId: string) => {
    if (entity.record) { entity.record.status = outcome; entity.record.endedAt = time; }
    if (entity.cohort) {
      const c = classStats.get(entity.classId)!; c[outcome]++;
      if (outcome === 'completed') c.waitSum += entity.wait;
      if (outcome === 'completed') { completed++; waits.push(entity.wait); sojourns.push(time - entity.arrivedAt); if (entity.wait <= model.slaSeconds) slaMet++; }
      else if (outcome === 'balked') balked++; else reneged++;
    }
    entity.request = undefined; active.delete(entity.id);
    emit(outcome === 'completed' ? 'complete' : outcome === 'balked' ? 'balk' : 'renege', entity, nodeId);
  };
  const integrate = (next: number) => {
    const dt = Math.max(0, Math.min(next, model.horizon) - Math.max(time, model.warmup));
    for (const s of stations.values()) { s.area += s.waiting * dt; s.busyArea += s.busy * dt; }
    for (const p of pools.values()) { p.scheduledArea += p.scheduled * dt; p.busyArea += p.busy * dt; p.overtimeArea += Math.max(0, p.busy - p.scheduled) * dt; }
    time = next;
  };
  const nextArrival = (source: SourceNode, ordinal: number, previous: number) => {
    let next: number | undefined;
    if (source.arrival.kind === 'schedule') next = source.arrival.times[ordinal];
    else if (source.arrival.kind === 'fixed') {
      if (source.arrival.perHour > 0) next = ordinal === 0 ? 0 : ordinal * (3600 / source.arrival.perHour);
    } else {
      let hazard = -Math.log1p(-uniform(seed, source.samplingId, ordinal, 'arrival'));
      let from = previous;
      for (const segment of source.arrival.segments) {
        if (segment.end <= from || segment.perHour === 0) continue;
        const start = Math.max(from, segment.start); const rate = segment.perHour / 3600;
        const available = (segment.end - start) * rate;
        if (hazard < available) { next = start + hazard / rate; break; }
        hazard -= available; from = segment.end;
      }
    }
    if (next !== undefined && next < model.horizon) {
      if (source.arrival.kind !== 'schedule' && ordinal > 0 && !(next > previous)) throw new Stop('failed', 'numeric-precision: arrival clock did not advance.');
      schedule({ time: next, kind: 'arrival', nodeId: source.id, ordinal });
    }
  };
  const isLiveEvent = (event: Event) => event.kind !== 'patience' || (active.get(event.entityId!)?.request?.id === event.requestId && active.get(event.entityId!)?.request?.startedAt === undefined);
  try {
    if (options.shouldCancel?.()) throw new Stop('cancelled', 'Cancellation requested.');
    for (const source of sources) nextArrival(source, 0, 0);
    for (const pool of model.resources) for (const period of pool.calendar) for (const t of [period.start, period.end]) schedule({ time: t, kind: 'calendar', nodeId: pool.id });
    while (heap.size && heap.peek()!.time <= model.horizon) {
      tick(); integrate(heap.peek()!.time); microsteps = 0;
      // Complete/release, then calendar, then all arrivals/transfers at this exact Number timestamp.
      while (heap.peek()?.time === time && heap.peek()!.phase <= 2 || hasPending()) {
        tick(); yield;
        if (hasPending() && !(heap.peek()?.time === time && heap.peek()!.phase < 2)) {
          if (++microsteps > maxMicrosteps) throw new Stop('limited', `Timestamp transition budget (${maxMicrosteps}) reached at ${time}.`);
          const step = pending[pendingIndex++];
          if (!hasPending()) { pending = []; pendingIndex = 0; }
          const entity = step.entity; const node = nodes.get(step.nodeId)!;
          const v = visit(entity, node);
          if (node.kind === 'sink') { if (v.record) { v.record.end = time; v.record.outcome = 'passed'; } end(entity, 'completed', node.id); }
          else if (node.kind === 'route') {
            const branches = [...node.branches].sort((a, b) => idCompare(nodes.get(a.to)!.samplingId, nodes.get(b.to)!.samplingId));
            const u = draw(entity, node, 'route', v.ordinal); let cumulative = 0;
            const destination = branches.find(b => (cumulative += b.probability) > u) ?? branches[branches.length - 1];
            if (v.record) { v.record.end = time; v.record.outcome = 'passed'; }
            emit('transfer', entity, node.id); pending.push({ entity, nodeId: destination.to });
          } else if (node.kind === 'delay') {
            const duration = sample(node.duration, draw(entity, node, 'delay', v.ordinal));
            const until = future(duration, false);
            if (v.record) { v.record.start = time; entity.delayVisit = v.record; }
            emit('transfer', entity, node.id);
            if (until === time) {
              if (v.record) { v.record.end = time; v.record.outcome = 'passed'; entity.delayVisit = undefined; }
              pending.push({ entity, nodeId: node.next });
            }
            else schedule({ time: until, kind: 'transfer', nodeId: node.next, entityId: entity.id });
          } else if (node.kind === 'queue' || node.kind === 'service') {
            const queue = node.kind === 'queue' ? node : undefined; const service = queue ? nodes.get(queue.next) as ServiceNode : node as ServiceNode;
            const serviceVisit = queue ? undefined : v.record;
            const req: Request = { id: requestId++, entity, service, queue, arrival: time, priority: queue?.discipline === 'priority' ? entity.priority : 0, accepted: false, queued: true, queueVisit: queue ? v.record : undefined, serviceVisit, serviceOrdinal: queue ? undefined : v.ordinal };
            entity.request = req; stations.get(service.id)!.requests.push(req);
            if (entity.cohort) stations.get(service.id)!.arrived++;
            if (queue?.patience) {
              const until = future(sample(queue.patience, draw(entity, queue, 'patience', v.ordinal)), false);
              schedule({ time: until, kind: 'patience', nodeId: queue.id, entityId: entity.id, requestId: req.id });
            }
          } else throw new Stop('failed', 'Invariant: a source received incoming work.');
          continue;
        }
        const event = heap.pop()!;
        if (event.kind === 'finish') {
          const entity = active.get(event.entityId!); if (!entity?.request) throw new Stop('failed', 'Invariant: completion without active service.');
          const req = entity.request; const station = stations.get(req.service.id)!;
          station.busy--; for (const r of req.service.resources) pools.get(r.poolId)!.busy -= r.units;
          if (entity.cohort) { station.finished++; station.waits.push(req.startedAt! - req.arrival); }
          if (req.serviceVisit) { req.serviceVisit.end = time; req.serviceVisit.outcome = 'served'; }
          emit('finish', entity, req.service.id); entity.request = undefined;
          pending.push({ entity, nodeId: req.service.next });
        } else if (event.kind === 'calendar') {
          const pool = model.resources.find(p => p.id === event.nodeId)!;
          pools.get(pool.id)!.scheduled = pool.calendar.find(p => p.start <= time && time < p.end)?.capacity ?? pool.capacity;
        } else if (event.kind === 'arrival') {
          if (totalArrivals >= maxEntities) throw new Stop('limited', `Entity budget (${maxEntities}) reached; result is incomplete.`);
          const source = nodes.get(event.nodeId) as SourceNode; const ordinal = event.ordinal!;
          const u = uniform(seed, source.samplingId, ordinal, 'class'); let cumulative = 0;
          const classes = [...source.classes].sort((a, b) => idCompare(a.id, b.id));
          const cls = classes.find(c => (cumulative += c.probability) > u) ?? classes[classes.length - 1];
          const entity: Entity = { id: `${source.samplingId}:${ordinal}`, source, ordinal, classId: cls.id, priority: cls.priority, arrivedAt: time, cohort: time >= model.warmup, wait: 0, visits: new Map() };
          if (traceFull && records.length < maxTraceEntities) {
            entity.record = { id: entity.id, sourceId: source.id, ordinal, classId: cls.id, priority: cls.priority, arrivedAt: time, status: 'active', visits: [] }; records.push(entity.record);
          } else truncate();
          active.set(entity.id, entity); maxActiveEntities = Math.max(maxActiveEntities, active.size);
          totalArrivals++; if (entity.cohort) { arrivals++; classStats.get(entity.classId)!.arrivals++; }
          emit('arrival', entity, source.id); pending.push({ entity, nodeId: source.next }); nextArrival(source, ordinal + 1, time);
        } else if (event.kind === 'transfer') {
          const entity = active.get(event.entityId!);
          if (entity) {
            if (entity.delayVisit) { entity.delayVisit.end = time; entity.delayVisit.outcome = 'passed'; entity.delayVisit = undefined; }
            pending.push({ entity, nodeId: event.nodeId });
          }
        }
      }
      // One global feasible-first transaction across both old and same-time new requests.
      const requests = [...stations.values()].flatMap(s => s.requests).sort(requestCompare);
      let pendingBypasses = 0;
      for (const req of requests) {
        tick(); yield;
        const station = stations.get(req.service.id)!;
        if (time === model.horizon || station.busy >= req.service.servers || !req.service.resources.every(r => pools.get(r.poolId)!.scheduled - pools.get(r.poolId)!.busy >= r.units)) { pendingBypasses++; continue; }
        const v = req.serviceOrdinal !== undefined ? { ordinal: req.serviceOrdinal, record: req.serviceVisit } : visit(req.entity, req.service);
        const duration = sample(req.service.duration, draw(req.entity, req.service, 'service', v.ordinal)); const until = future(duration, true);
        req.serviceVisit = v.record;
        // wait is needed for full metrics even when no entity/visit trace is retained.
        req.startedAt = time;
        bypassedRequests += pendingBypasses; pendingBypasses = 0;
        req.entity.wait += time - req.arrival;
        if (req.serviceVisit) req.serviceVisit.start = time;
        if (req.queueVisit) { req.queueVisit.start = time; req.queueVisit.end = time; req.queueVisit.outcome = 'served'; }
        req.queued = false; if (req.accepted) station.waiting--; station.busy++;
        if (req.entity.cohort) station.started++;
        for (const r of req.service.resources) pools.get(r.poolId)!.busy += r.units;
        if (req.queue?.patience) stalePatience++;
        emit('start', req.entity, req.service.id); schedule({ time: until, kind: 'finish', nodeId: req.service.id, entityId: req.entity.id });
      }
      for (const req of requests) {
        if (!req.queued || req.accepted) continue;
        tick(); yield;
        const station = stations.get(req.service.id)!;
        if (req.queue && (req.queue.capacity === null || station.waiting < req.queue.capacity)) { req.accepted = true; station.waiting++; emit('queue', req.entity, req.queue.id); }
        else {
          req.queued = false; if (req.entity.cohort) station.balked++;
          if (req.queueVisit) { req.queueVisit.end = time; req.queueVisit.outcome = 'balked'; }
          if (req.serviceVisit) { req.serviceVisit.end = time; req.serviceVisit.outcome = 'balked'; }
          end(req.entity, 'balked', req.queue?.id ?? req.service.id);
        }
      }
      while (heap.peek()?.time === time) {
        tick(); yield; const event = heap.pop()!;
        if (event.kind !== 'patience') throw new Stop('failed', 'Invariant: an event was scheduled in a completed phase.');
        const entity = active.get(event.entityId!); const req = entity?.request;
        if (!req || !req.accepted || req.id !== event.requestId) continue;
        const station = stations.get(req.service.id)!;
        if (!req.queued) continue;
        req.queued = false; station.waiting--; if (entity!.cohort) station.reneged++;
        if (req.queueVisit) { req.queueVisit.end = time; req.queueVisit.outcome = 'reneged'; }
        end(entity!, 'reneged', req.queue!.id);
      }
      for (const station of stations.values()) station.requests = station.requests.filter(req => req.queued);
      committedTime = time;
      if (traceFull) traceUntil = time;
      if (stalePatience > 2048 && heap.size > 2048) { heap.compact(isLiveEvent); stalePatience = 0; }
      progress(time / model.horizon);
      yield;
    }
    integrate(model.horizon); committedTime = time; if (traceFull) traceUntil = time;
    progress(1);
  } catch (error) {
    status = error instanceof Stop ? error.status : 'failed'; reason = error instanceof Error ? error.message : String(error);
  }
  const window = Math.max(0, time - model.warmup);
  const poolMetrics: PoolMetrics[] = [...model.resources].sort((a, b) => idCompare(a.id, b.id)).map(pool => {
    const state = pools.get(pool.id)!;
    return { poolId: pool.id, scheduledUnitSeconds: state.scheduledArea, busyUnitSeconds: state.busyArea, overtimeUnitSeconds: state.overtimeArea, cost: (state.scheduledArea * pool.costPerHour + state.overtimeArea * pool.overtimeCostPerHour) / 3600, utilization: state.scheduledArea ? (state.busyArea - state.overtimeArea) / state.scheduledArea : null };
  });
  const stationMetrics: StationMetrics[] = [...stations.values()].sort((a, b) => idCompare(a.node.id, b.node.id)).map(s => ({ nodeId: s.node.id, arrived: s.arrived, started: s.started, finished: s.finished, balked: s.balked, reneged: s.reneged, queueAtEnd: s.waiting, busyAtEnd: s.busy, averageQueue: window ? s.area / window : 0, averageWait: average(s.waits), p95Wait: quantile(s.waits, 0.95), utilization: window ? s.busyArea / (s.node.servers * window) : null, busySeconds: s.busyArea }));
  const hash = modelHash(model); const demand = demandHash(model, seed);
  const activeEntities = [...active.values()];
  const activeService = activeEntities.filter(e => e.request?.startedAt !== undefined).length;
  const activeWaiting = activeEntities.filter(e => e.request?.accepted && e.request.startedAt === undefined).length;
  const warnings = [`RNG: ${RNG_VERSION}. Draw keys: seed/source samplingId/arrival ordinal/stage samplingId/visit/kind. Completed-cohort waiting samples; nearest-rank quantiles.`, 'Feasible-first dispatch can bypass an older request requiring unavailable resources.'];
  const waitEdges = [0, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  const waitBins = waitEdges.map((from, i) => ({ from, to: waitEdges[i + 1] ?? null, count: 0 }));
  for (const value of waits) {
    const index = waitBins.findIndex(bin => value >= bin.from && (bin.to === null || value < bin.to));
    if (index >= 0) waitBins[index].count++;
  }
  if (!traceFull) warnings.push('Detailed replay is a bounded prefix; full metrics are independent of retained trace.');
  if (status !== 'completed') warnings.push('Incomplete run: observed cohort and measurement window are partial; exclude from comparisons and confidence intervals.');
  if (time < model.warmup) warnings.push('Run stopped before the measurement window.');
  return {
    id: fingerprint({ engine: ENGINE_VERSION, hash, seed }), engineVersion: ENGINE_VERSION, modelHash: hash, demandHash: demand, provenance: { rngVersion: RNG_VERSION, limits }, seed, model, status, reason, simulatedUntil: time,
    summary: { arrivals, completed, balked, reneged, inSystem: [...active.values()].filter(e => e.cohort).length, meanWait: average(waits), p50Wait: quantile(waits, 0.5), p95Wait: quantile(waits, 0.95), meanSojourn: average(sojourns), slaMet, slaRate: arrivals ? slaMet / arrivals : null, throughputPerHour: window ? completed / window * 3600 : 0, cost: poolMetrics.reduce((sum, p) => sum + p.cost, 0), waitSampleSize: waits.length, measurementStart: model.warmup, measurementEnd: Math.max(model.warmup, time) },
    stations: stationMetrics, pools: poolMetrics, entities: records, events,
    trace: { complete: traceFull && status === 'completed', until: traceUntil, entityLimit: maxTraceEntities, eventLimit: maxTraceEvents }, warnings, processedEvents: work, elapsedMs: performance.now() - started,
    diagnostics: { totalArrivals, activeService, activeWaiting, activeTransfer: active.size - activeService - activeWaiting, bypassedRequests, maxHeapSize, maxActiveEntities },
    classes: [...classStats].sort(([a], [b]) => idCompare(a, b)).map(([classId, c]) => ({ classId, arrivals: c.arrivals, completed: c.completed, balked: c.balked, reneged: c.reneged, inSystem: activeEntities.filter(e => e.cohort && e.classId === classId).length, meanWait: c.completed ? c.waitSum / c.completed : 0, waitSampleSize: c.completed })),
    waitDistribution: { sampleSize: waits.length, bins: waitBins },
  };
}

export function simulate(model: SimulationModel, options: RunOptions = {}): RunResult {
  assertModel(model); const iterator = execute(model, options);
  let result = iterator.next(); while (!result.done) result = iterator.next(); return result.value;
}

export async function simulateAsync(model: SimulationModel, options: RunOptions = {}): Promise<RunResult> {
  assertModel(model); const iterator = execute(model, options);
  // Nested setTimeout(0) is clamped by browsers. A private message task yields
  // to cancellation/progress without adding that delay to every 256 units.
  const channel = typeof MessageChannel === 'undefined' ? null : new MessageChannel();
  let yields = 0;
  const yieldTask = () => new Promise<void>(resolve => {
    // Periodically use the timer queue too: continuously posted port tasks can
    // otherwise starve timers in Node (including a caller's cancel callback).
    if (channel && ++yields % 8 !== 0) { channel.port1.addEventListener('message', () => resolve(), { once: true }); channel.port2.postMessage(null); }
    else setTimeout(resolve, 0);
  });
  try {
    channel?.port1.start();
    let result = iterator.next(); let chunk = 0;
    while (!result.done) {
      if (++chunk === 256) { chunk = 0; await yieldTask(); }
      result = iterator.next();
    }
    return result.value;
  } finally { channel?.port1.close(); channel?.port2.close(); }
}
