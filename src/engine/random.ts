import type { Distribution } from '../model/types';

export const RNG_VERSION = 'keyed-murmur32-v1';

function hashKey(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return h;
}

/** Equal prefix states produce identical draws for every common key suffix. */
export function replicationSeedStates(seeds: readonly unknown[]): Set<number> {
  if (!Array.isArray(seeds) || !seeds.length || seeds.length > 100) throw new Error('Use 1–100 distinct safe-integer replication seeds.');
  const states = new Set<number>();
  for (const seed of seeds) {
    if (!Number.isSafeInteger(seed)) throw new Error('Use distinct safe-integer replication seeds.');
    const prefix = JSON.stringify([RNG_VERSION, seed]).slice(0, -1);
    const state = hashKey(prefix);
    if (states.has(state)) throw new Error('Choose replication seeds with distinct random streams.');
    states.add(state);
  }
  return states;
}

/** A counter/key based draw. No mutable stream can be shifted by dispatch decisions. */
export function uniform(seed: number, ...key: (string | number)[]): number {
  let h = hashKey(JSON.stringify([RNG_VERSION, seed, ...key]));
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

export function sample(distribution: Distribution, u: number): number {
  switch (distribution.kind) {
    case 'constant': return distribution.value;
    case 'exponential': return -Math.log1p(-u) * distribution.mean;
    case 'empirical': return distribution.values[Math.floor(u * distribution.values.length)];
    case 'triangular': {
      const { min, mode, max } = distribution;
      if (max === min) return min;
      return u < (mode - min) / (max - min)
        ? min + Math.sqrt(u * (max - min) * (mode - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
  }
}
