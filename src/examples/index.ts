import type { Project, ResourcePool, SimulationModel, World } from '../model/types';

const pool = (id: string, label: string, capacity: number, costPerHour: number): ResourcePool => ({
  id, label, capacity, installedCapacity: 12, calendar: [], costPerHour, overtimeCostPerHour: costPerHour * 1.5,
});

function base(world: World): Project {
  const factory = world === 'factory'; const festival = world === 'festival';
  const name = factory ? 'Little Factory' : festival ? 'Festival Gate' : 'Service Studio';
  const names = factory ? ['Machining', 'Quality check', 'Packing'] : festival ? ['Wristbands', 'Ticket check', 'Security'] : ['Reception', 'Specialists', 'Resolution'];
  const horizon = 3600;
  const model: SimulationModel = {
    id: `${world}-model`, name, horizon, warmup: 0, seed: 4207, slaSeconds: factory ? 300 : 180, currency: 'USD',
    resources: [pool('team-a', `${names[0]} team`, 1, 24), pool('team-b', `${names[1]} team`, 1, 28), pool('team-c', `${names[2]} team`, 1, 22)],
    nodes: [
      { id: 'arrivals', samplingId: `${world}-arrivals`, label: factory ? 'Incoming orders' : festival ? 'Visitors arrive' : 'New requests', kind: 'source', next: 'queue-a',
        arrival: { kind: 'poisson', segments: [{ start: 0, end: 900, perHour: factory ? 70 : 80 }, { start: 900, end: 2400, perHour: factory ? 110 : 125 }, { start: 2400, end: horizon, perHour: factory ? 70 : 85 }] },
        classes: [{ id: 'standard', label: 'Standard', priority: 0, probability: world === 'service' ? 0.85 : 1 }, ...(world === 'service' ? [{ id: 'priority', label: 'Priority', priority: -1, probability: 0.15 }] : [])] },
      { id: 'queue-a', samplingId: `${world}-queue-a`, label: `Before ${names[0].toLowerCase()}`, kind: 'queue', next: 'station-a', capacity: null, discipline: world === 'service' ? 'priority' : 'fifo', patience: null },
      { id: 'station-a', samplingId: `${world}-station-a`, label: names[0], kind: 'service', next: 'queue-b', servers: 1, duration: { kind: 'triangular', min: 18, mode: factory ? 28 : 22, max: 40 }, resources: [{ poolId: 'team-a', units: 1 }] },
      { id: 'queue-b', samplingId: `${world}-queue-b`, label: `Before ${names[1].toLowerCase()}`, kind: 'queue', next: 'station-b', capacity: null, discipline: world === 'service' ? 'priority' : 'fifo', patience: null },
      { id: 'station-b', samplingId: `${world}-station-b`, label: names[1], kind: 'service', next: 'queue-c', servers: 1, duration: { kind: 'triangular', min: 12, mode: 18, max: 28 }, resources: [{ poolId: 'team-b', units: 1 }] },
      { id: 'queue-c', samplingId: `${world}-queue-c`, label: `Before ${names[2].toLowerCase()}`, kind: 'queue', next: 'station-c', capacity: null, discipline: world === 'service' ? 'priority' : 'fifo', patience: world === 'factory' ? null : { kind: 'constant', value: 900 } },
      { id: 'station-c', samplingId: `${world}-station-c`, label: names[2], kind: 'service', next: 'exit', servers: 1, duration: { kind: 'triangular', min: factory ? 65 : 50, mode: factory ? 85 : 75, max: factory ? 110 : 100 }, resources: [{ poolId: 'team-c', units: 1 }] },
      { id: 'exit', samplingId: `${world}-exit`, label: factory ? 'Ready to ship' : festival ? 'Inside the festival' : 'Resolved', kind: 'sink' },
    ],
  };
  if (world === 'service') {
    model.resources = [pool('team-a', 'Reception team', 1, 24), { ...pool('specialists', 'Shared specialists', 2, 32), calendar: [{ start: 1800, end: 2100, capacity: 1 }] }];
    for (const id of ['station-b', 'station-c']) {
      const node = model.nodes.find(n => n.id === id);
      if (node?.kind === 'service') { node.servers = 2; node.resources = [{ poolId: 'specialists', units: 1 }]; }
    }
  }
  return {
    schemaVersion: 1, id: `${world}-project`, name, world, model, revision: 0,
    description: factory ? 'A small workshop with a growing packing queue. Explore where an extra station makes a difference.' : festival ? 'A wave of visitors meets three checkpoints. Keep the entrance moving without hiding the staffing cost.' : 'Standard and priority requests share a specialist team. A five-minute team break changes capacity halfway through the hour.',
    layout: {
      arrivals: { x: -8, z: -2 }, 'queue-a': { x: -6, z: -2 }, 'station-a': { x: -4, z: -2 },
      'queue-b': { x: -2, z: 0 }, 'station-b': { x: 0, z: 0 },
      'queue-c': { x: 2, z: 2 }, 'station-c': { x: 4, z: 2 }, exit: { x: 8, z: 2 },
    },
  };
}

export function createExample(world: World): Project { const project = structuredClone(base(world)); project.id = `${world}-${crypto.randomUUID().slice(0, 8)}`; return project; }

export const WORLD_INFO: Record<World, { name: string; subtitle: string; unit: string; color: string }> = {
  factory: { name: 'Little Factory', subtitle: 'From first part to final package', unit: 'orders', color: '#ea754b' },
  festival: { name: 'Festival Gate', subtitle: 'A great night starts at the entrance', unit: 'visitors', color: '#537ea2' },
  service: { name: 'Service Studio', subtitle: 'A little room for every request', unit: 'requests', color: '#8c76a7' },
};
