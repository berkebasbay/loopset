import type { ArrivalSpec, Distribution, ModelNode, Project, QueueNode, ResourcePool, ServiceNode, SimulationModel } from '../model/types';
import { createStudioExample } from '../examples/studio';
import { starterTemplates, type StarterId } from './catalogue';
import { starterCopy, starterMessages } from '../ui/messages/starterTemplates';
import { dressStarter } from './presentation';
import { validateProject } from '../model/validate';

const fixed = (value: number): Distribution => ({ kind: 'constant', value });
const triangular = (min: number, mode: number, max: number): Distribution => ({ kind: 'triangular', min, mode, max });
const resource = (id: string, label: string, capacity: number, cost = 24): ResourcePool => ({ id, label, installedCapacity: 6, capacity, calendar: [], costPerHour: cost, overtimeCostPerHour: cost * 1.5 });
function station(model: SimulationModel, id: string): ServiceNode { const node = model.nodes.find(node => node.id === id); if (node?.kind !== 'service') throw new Error(`Missing station ${id}`); return node; }
function pool(model: SimulationModel, id: string): ResourcePool { const p = model.resources.find(p => p.id === id); if (!p) throw new Error(`Missing pool ${id}`); return p; }
const burst = (count: number, start: number, spacing: number) => Array.from({ length: count }, (_, i) => start + i * spacing);

function customProject(id: StarterId): Project {
  const item = starterTemplates.find(item => item.id === id)!;
  const project: Project = { schemaVersion: 1, id: `starter-${id}`, name: item.copy.title, world: item.world, revision: 0, description: '', layout: {},
    model: { id: `${id}-model`, name: item.copy.title, horizon: item.minutes * 60, warmup: 0, seed: 4207, slaSeconds: 600, currency: 'USD', nodes: [], resources: [] } };
  const model = project.model;
  const add = (node: ModelNode, x: number, z: number) => { model.nodes.push(node); project.layout[node.id] = { x, z }; };
  const base = (node: string, label: string) => ({ id: node, samplingId: `${id}-${node}`, label });
  const source = (next: string, arrival: ArrivalSpec, x: number, z: number, priority = 0) => add({ ...base('arrivals', 'Incoming jobs'), kind: 'source', next, arrival,
    classes: [{ id: 'standard', label: 'Standard', priority: 0, probability: 1 - priority }, ...(priority ? [{ id: 'priority', label: 'Priority', priority: -1, probability: priority }] : [])] }, x, z);
  const queue = (node: string, label: string, next: string, x: number, z: number, discipline: QueueNode['discipline'] = 'fifo') => add({ ...base(node, label), kind: 'queue', next, capacity: null, discipline, patience: null }, x, z);
  const service = (node: string, label: string, next: string, duration: Distribution, servers: number, team: string | null, x: number, z: number) => add({ ...base(node, label), kind: 'service', next, duration, servers, resources: team ? [{ poolId: team, units: 1 }] : [] }, x, z);
  const exit = (node: string, label: string, x: number, z: number) => add({ ...base(node, label), kind: 'sink' }, x, z);
  const route = (node: string, label: string, branches: { to: string; probability: number }[], x: number, z: number) => add({ ...base(node, label), kind: 'route', branches }, x, z);

  if (id === 'workshop') {
    model.resources = [resource('operators', 'Shared workshop operators', 2, 26), resource('finishers', 'Finishing operator', 1, 26)];
    source('q-prepare', { kind: 'fixed', perHour: 30 }, -9, 4);
    queue('q-prepare', 'Preparation queue', 'prepare', -6, 1); service('prepare', 'Preparation', 'q-machine', fixed(90), 2, 'operators', -3, -3);
    queue('q-machine', 'Machining queue', 'machine', 1, 1); service('machine', 'Machining', 'cure', triangular(140, 180, 220), 2, 'operators', 3, -3);
    add({ ...base('cure', 'Timed cure'), kind: 'delay', duration: fixed(300), next: 'q-finish' }, 8, 2);
    queue('q-finish', 'Finishing queue', 'finish', 3, 5); service('finish', 'Finishing', 'exit', fixed(70), 2, 'finishers', -3, 5); exit('exit', 'Finished jobs', -9, 6);
  } else if (id === 'machining') {
    model.resources = [resource('prep', 'Preparation team', 1, 24), resource('operators', 'Shared machine operators', 2, 30), resource('inspection', 'Inspection team', 1, 28)];
    source('q-prepare', { kind: 'fixed', perHour: 36 }, -14, 4);
    queue('q-prepare', 'Preparation queue', 'prepare', -11, 1); service('prepare', 'Preparation', 'route', fixed(60), 1, 'prep', -11, -3);
    route('route', 'Job routing', [{ to: 'q-fast', probability: .6 }, { to: 'q-slow', probability: .4 }], -8, -5);
    queue('q-fast', 'Short-job queue', 'fast', -4, 2); service('fast', 'Short machining', 'q-inspect', triangular(100, 140, 180), 1, 'operators', -4, -2);
    queue('q-slow', 'Long-job queue', 'slow', 3, 2); service('slow', 'Long machining', 'q-inspect', triangular(220, 300, 380), 1, 'operators', 3, -2);
    queue('q-inspect', 'Inspection queue', 'inspect', 8, 4); service('inspect', 'Final inspection', 'exit', fixed(45), 1, 'inspection', 11, 1); exit('exit', 'Inspected parts', 14, 5);
  } else if (id === 'quality') {
    model.resources = [resource('inspectors', 'Inspection team', 1, 28), resource('repairers', 'Rework team', 1, 30)];
    source('q-inspect', { kind: 'fixed', perHour: 48 }, -11, 4);
    queue('q-inspect', 'Inspection queue', 'inspect', -7, 1); service('inspect', 'Inspection', 'verdict', fixed(85), 1, 'inspectors', -3, 0);
    route('verdict', 'Inspection outcome', [{ to: 'exit', probability: .88 }, { to: 'q-repair', probability: .12 }], 2, 1);
    queue('q-repair', 'Rework queue', 'repair', 6, -3); service('repair', 'Repair and recheck', 'q-inspect', triangular(120, 180, 240), 1, 'repairers', 1, -6); exit('exit', 'Accepted parts', 8, 4);
  } else if (id === 'packing') {
    model.resources = [resource('packers', 'Shared packing crew', 2, 24), resource('checkers', 'Label check', 1, 24)];
    source('route', { kind: 'fixed', perHour: 100 }, -13, 1);
    route('route', 'Parcel format', [{ to: 'q-standard', probability: .75 }, { to: 'q-bulky', probability: .25 }], -9, 0);
    queue('q-standard', 'Standard parcel queue', 'standard', -5, -4); service('standard', 'Standard packing', 'q-check', triangular(35, 45, 55), 2, 'packers', 0, -4);
    queue('q-bulky', 'Bulky parcel queue', 'bulky', -5, 3); service('bulky', 'Bulky packing', 'q-check', triangular(100, 140, 180), 1, 'packers', 0, 3);
    queue('q-check', 'Label-check queue', 'check', 6, 1); service('check', 'Label and weight check', 'exit', fixed(20), 1, 'checkers', 10, 0); exit('exit', 'Ready parcels', 13, 4);
  } else if (id === 'fulfillment') {
    model.resources = [resource('pickers', 'Picking crew', 3, 24), resource('packers', 'Packing crew', 1, 24), resource('dispatch', 'Carrier handoff', 1, 24)];
    source('q-pick', { kind: 'schedule', times: [...burst(60, 0, 10), ...burst(60, 2400, 10)] }, -15, 4);
    queue('q-pick', 'Released orders', 'pick', -10, 3); service('pick', 'Order picking', 'q-pack', triangular(90, 120, 150), 3, 'pickers', -7, 0);
    queue('q-pack', 'Packing queue', 'pack', -1, 3); service('pack', 'Order packing', 'q-handoff', triangular(50, 60, 70), 2, 'packers', 2, 0);
    queue('q-handoff', 'Carrier queue', 'handoff', 8, 4); service('handoff', 'Carrier handoff', 'exit', fixed(30), 1, 'dispatch', 11, 1); exit('exit', 'Dispatched orders', 15, 4);
  } else if (id === 'returns') {
    model.resources = [resource('intake', 'Returns intake', 1, 24), resource('restock', 'Restock team', 1, 24), resource('repair', 'Refurbishment team', 1, 30)];
    source('q-triage', { kind: 'fixed', perHour: 70 }, -13, 4);
    queue('q-triage', 'Returns intake queue', 'triage', -9, 1); service('triage', 'Condition triage', 'route', fixed(60), 1, 'intake', -5, 0);
    route('route', 'Return outcome', [{ to: 'q-restock', probability: .6 }, { to: 'q-refurbish', probability: .4 }], 0, 0);
    queue('q-restock', 'Restock queue', 'restock', 4, 3); service('restock', 'Repack for restock', 'restocked', fixed(75), 1, 'restock', 8, 3); exit('restocked', 'Ready for restock', 13, 5);
    queue('q-refurbish', 'Refurbishment queue', 'refurbish', 4, -4); service('refurbish', 'Refurbishment', 'refurbished', triangular(120, 180, 240), 1, 'repair', 8, -4); exit('refurbished', 'Refurbished items', 13, -2);
  } else if (id === 'parcel') {
    model.resources = [resource('scan', 'Scanning team', 2, 24), resource('sort', 'Sorting team', 2, 24), resource('dispatch', 'Dispatch staff', 1, 26)];
    source('q-scan', { kind: 'schedule', times: [...burst(50, 0, 12), ...burst(50, 2400, 12), ...burst(50, 4800, 12)] }, -13, 3);
    queue('q-scan', 'Scan queue', 'scan', -9, 2); service('scan', 'Scan and weigh', 'q-sort', fixed(30), 2, 'scan', -6, -1);
    queue('q-sort', 'Sorting queue', 'sort', -1, 2); service('sort', 'Destination sorting', 'q-dispatch', fixed(40), 2, 'sort', 2, -1);
    queue('q-dispatch', 'Dispatch queue', 'dispatch', 7, 4); service('dispatch', 'Dispatch checks', 'exit', fixed(55), 2, 'dispatch', 10, 1); exit('exit', 'Dispatched parcels', 13, 5);
  } else if (id === 'repair') {
    model.resources = [resource('techs', 'Shared technicians', 2, 30), resource('testers', 'Final test team', 1, 28)];
    pool(model, 'techs').calendar = [{ start: 3000, end: 4200, capacity: 1 }];
    source('q-diagnose', { kind: 'fixed', perHour: 34 }, -12, 4, .2);
    queue('q-diagnose', 'Diagnostic queue', 'diagnose', -8, 2, 'priority'); service('diagnose', 'Diagnosis', 'q-repair', triangular(50, 80, 110), 2, 'techs', -6, -2);
    queue('q-repair', 'Repair queue', 'repair', -1, 2, 'priority'); service('repair', 'Bench repair', 'q-test', triangular(100, 180, 260), 2, 'techs', 2, -2);
    queue('q-test', 'Final-test queue', 'test', 7, 4, 'priority'); service('test', 'Final test', 'exit', fixed(60), 1, 'testers', 9, 0); exit('exit', 'Repaired jobs', 12, 4);
  } else if (id === 'print') {
    model.resources = [resource('designers', 'Job preparation', 1, 28), resource('finishers', 'Finishing team', 1, 26)];
    source('q-prepare', { kind: 'fixed', perHour: 6 }, -12, 3);
    queue('q-prepare', 'Job preparation queue', 'prepare', -8, 2); service('prepare', 'Prepare print job', 'q-print', fixed(225), 1, 'designers', -6, -1);
    queue('q-print', 'Print queue', 'print', -1, 2); service('print', '3D printing', 'q-finish', { kind: 'empirical', values: [300, 300, 600, 1200, 3600] }, 2, null, 1, -1);
    queue('q-finish', 'Finishing queue', 'finish', 6, 2); service('finish', 'Finish and inspect', 'exit', triangular(500, 650, 800), 1, 'finishers', 8, -1); exit('exit', 'Finished print jobs', 12, 3);
  } else throw new Error(`No custom process for ${id}`);
  return project;
}

/** Explicit scenario edits preserve sampling identities and leave the original snapshot untouched. */
export function editTrial(id: StarterId, index: 0 | 1, model: SimulationModel): void {
  if (id === 'factory') { station(model, 'station-c').servers = 2; if (index === 1) pool(model, 'team-c').capacity = 2; }
  else if (id === 'festival') {
    station(model, 'station-c').servers = 2;
    if (index === 0) pool(model, 'team-c').calendar = [{ start: 600, end: 3000, capacity: 2 }]; else pool(model, 'team-c').capacity = 2;
  } else if (id === 'service') {
    if (index === 0) pool(model, 'specialists').calendar[0].capacity = 2;
    else for (const node of model.nodes) if (node.kind === 'queue') node.discipline = 'fifo';
  } else if (id === 'workshop') {
    if (index === 0) { pool(model, 'operators').capacity = 3; model.resources = model.resources.filter(p => p.id !== 'finishers'); station(model, 'finish').resources = [{ poolId: 'operators', units: 1 }]; }
    else { const node = model.nodes.find(n => n.id === 'cure'); if (node?.kind !== 'delay') throw new Error('Missing cure'); node.duration = fixed(120); }
  } else if (id === 'machining') { station(model, 'slow').servers = 2; if (index === 1) pool(model, 'operators').capacity = 3; }
  else if (id === 'quality') {
    if (index === 0) { station(model, 'inspect').servers = 2; pool(model, 'inspectors').capacity = 2; }
    else { const node = model.nodes.find(n => n.id === 'verdict'); if (node?.kind !== 'route') throw new Error('Missing verdict'); node.branches = [{ to: 'exit', probability: .96 }, { to: 'q-repair', probability: .04 }]; }
  } else if (id === 'packing') { station(model, 'bulky').servers = 2; if (index === 1) pool(model, 'packers').capacity = 3; }
  else if (id === 'fulfillment') {
    if (index === 0) { pool(model, 'pickers').capacity = 2; pool(model, 'packers').capacity = 2; }
    else { const node = model.nodes[0]; if (node.kind !== 'source') throw new Error('Missing source'); node.arrival = { kind: 'schedule', times: burst(120, 0, 50) }; }
  } else if (id === 'returns') { if (index === 0) station(model, 'triage').duration = fixed(40); else { station(model, 'refurbish').servers = 2; pool(model, 'repair').capacity = 2; } }
  else if (id === 'parcel') {
    if (index === 0) pool(model, 'dispatch').calendar = [{ start: 1800, end: 5400, capacity: 2 }];
    else { const node = model.nodes[0]; if (node.kind !== 'source') throw new Error('Missing source'); node.arrival = { kind: 'schedule', times: burst(150, 0, 40) }; }
  } else if (id === 'repair') { pool(model, 'techs').calendar[0].capacity = 2; if (index === 1) pool(model, 'techs').capacity = 3; }
  else if (id === 'print') { if (index === 0) station(model, 'print').duration = fixed(1200); else { station(model, 'finish').servers = 2; pool(model, 'finishers').capacity = 2; } }
}

export function buildStarter(id: StarterId): Project {
  const copy = starterCopy[id];
  const project = id === 'factory' || id === 'festival' || id === 'service' ? createStudioExample(id) : customProject(id);
  project.id = `starter-${id}`; project.name = copy.title; project.revision = 0; delete project.savedAt;
  project.description = `${copy.summary}\n\n${copy.question}\n\n${starterMessages.assumptions}\n${copy.assumptions.map(item => `• ${item}`).join('\n')}\n\n${starterMessages.scope}`;
  if (id === 'service') project.layout = { arrivals: { x: -11, z: 4 }, 'queue-a': { x: -7, z: 2 }, 'station-a': { x: -7, z: -2 }, 'queue-b': { x: -3, z: 0 }, 'station-b': { x: 0, z: -2 }, 'queue-c': { x: -3, z: 5 }, 'station-c': { x: 0, z: 5 }, exit: { x: 6, z: 7 } };
  dressStarter(project, id);
  project.scenarios = [null, 0, 1].map(index => {
    const model = structuredClone(project.model);
    if (index !== null) editTrial(id, index as 0 | 1, model);
    const presentation = { ...project, model, layout: structuredClone(project.layout) };
    dressStarter(presentation, id);
    return { id: `${id}-${index === null ? 'original' : `trial-${index + 1}`}`, name: index === null ? starterMessages.original : copy.trials[index].title,
      createdAt: '2026-10-28T00:00:00.000Z', world: project.world, model, layout: presentation.layout, facility: presentation.facility };
  });
  const issues = validateProject(project).filter(issue => issue.severity === 'error');
  if (issues.length) throw new Error(`${id}: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
  return project;
}
