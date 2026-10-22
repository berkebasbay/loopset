/** A bounded in-memory cache. Eviction never deletes a persisted user record.
 * Byte weights are caller-supplied estimates, not measured JavaScript heap. */
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private used = 0;
  constructor(private readonly maxEntries: number, private readonly maxBytes: number, private readonly sizeOf: (value: T, key: string) => number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('Invalid cache bounds.');
  }
  get size() { return this.entries.size; }
  get bytes() { return this.used; }
  has(key: string) { return this.entries.has(key); }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry); return entry.value;
  }
  set(key: string, value: T): boolean {
    const bytes = this.sizeOf(value, key);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes || this.maxEntries === 0) return false;
    this.delete(key); this.entries.set(key, { value, bytes }); this.used += bytes;
    while (this.size > this.maxEntries || this.used > this.maxBytes) this.delete(this.entries.keys().next().value!);
    return true;
  }
  delete(key: string): boolean {
    const entry = this.entries.get(key); if (!entry) return false;
    this.used -= entry.bytes; return this.entries.delete(key);
  }
  clear() { this.entries.clear(); this.used = 0; }
  keys(): IterableIterator<string> { return this.entries.keys(); }
}
