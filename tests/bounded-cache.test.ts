import { describe, expect, it } from 'vitest';
import { BoundedCache } from '../src/storage/boundedCache';
import { assertSaveAllowed } from '../src/storage/projectStore';

describe('bounded comparison caches', () => {
  it('evicts least recently used entries under both bounds and tracks deletion/clear', () => {
    const cache = new BoundedCache<string>(3, 8, value => value.length);
    expect(cache.set('a', 'aa')).toBe(true); cache.set('b', 'bbb'); cache.set('c', 'cc');
    expect(cache.get('a')).toBe('aa'); cache.set('d', 'ddd');
    expect([...cache.keys()]).toEqual(['c', 'a', 'd']); expect(cache.bytes).toBe(7);
    cache.set('a', 'aaaa'); expect([...cache.keys()]).toEqual(['d', 'a']); expect(cache.bytes).toBe(7);
    expect(cache.delete('d')).toBe(true); expect(cache.delete('missing')).toBe(false);
    cache.clear(); expect([cache.size, cache.bytes]).toEqual([0, 0]);
  });
  it('rejects oversized or invalid estimates without changing existing values', () => {
    const cache = new BoundedCache<number>(2, 8, value => value);
    cache.set('a', 4); expect(cache.set('a', 9)).toBe(false); expect(cache.set('b', NaN)).toBe(false);
    expect(cache.get('a')).toBe(4); expect(cache.bytes).toBe(4);
    expect(new BoundedCache<string>(0, 100, () => 0).set('a', '')).toBe(false);
  });
  it('cannot authorize a changed saved payload after its comparison base was evicted', () => {
    const cache = new BoundedCache<{ revision: number; payload: string }>(1, 100, value => value.payload.length);
    const base = { revision: 1, payload: 'original' }; cache.set('a', base); cache.set('b', base);
    expect(() => assertSaveAllowed({ revision: 2, payload: 'edited' }, base, cache.get('a'))).toThrow('comparison copy');
    expect(() => assertSaveAllowed(base, base, cache.get('a'))).not.toThrow();
  });
});
