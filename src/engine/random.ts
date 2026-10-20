import type { Distribution } from '../model/types';

export const RNG_VERSION = 'keyed-murmur32-v1';

/** A counter/key based draw. No mutable stream can be shifted by dispatch decisions. */
export function uniform(seed: number, ...key: (string | number)[]): number {
  const input = JSON.stringify([RNG_VERSION, seed, ...key]);
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
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
