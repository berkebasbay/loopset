import type { SimulationModel } from './types';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FNV-1a-64 is a reproducibility fingerprint, not a security or integrity signature. */
export function fingerprint(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical(value))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

export function modelHash(model: SimulationModel): string {
  return fingerprint({
    horizon: model.horizon, warmup: model.warmup, slaSeconds: model.slaSeconds, currency: model.currency,
    nodes: model.nodes.map(n => {
      const { label: _label, ...node } = n;
      if (node.kind === 'source') return { ...node, classes: node.classes.map(({ label: _name, ...c }) => c).sort((a, b) => a.id.localeCompare(b.id)) };
      if (node.kind === 'route') return { ...node, branches: [...node.branches].sort((a, b) => a.to.localeCompare(b.to) || a.probability - b.probability) };
      if (node.kind === 'service') return { ...node, resources: [...node.resources].sort((a, b) => a.poolId.localeCompare(b.poolId)) };
      return node;
    }).sort((a, b) => a.id.localeCompare(b.id)),
    resources: model.resources.map(({ label: _label, ...pool }) => pool).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function demandHash(model: SimulationModel, seed: number): string {
  return fingerprint({ seed, horizon: model.horizon, sources: model.nodes.filter(n => n.kind === 'source').map(n => ({ samplingId: n.samplingId, arrival: n.arrival, classes: n.classes.map(c => ({ id: c.id, priority: c.priority, probability: c.probability })).sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => a.samplingId.localeCompare(b.samplingId)) });
}
