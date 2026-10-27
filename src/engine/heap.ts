/** Exact Number ordering: report tolerances must never enter this comparator. */
export interface TimedEvent { time: number; phase: number; key: string; sequence: number }
const compare = (a: TimedEvent, b: TimedEvent) => a.time - b.time || a.phase - b.phase || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.sequence - b.sequence;

export class EventHeap<T extends TimedEvent> {
  private items: T[] = [];
  get size() { return this.items.length; }
  peek(): T | undefined { return this.items[0]; }
  push(event: T) {
    this.items.push(event);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (compare(this.items[p], event) <= 0) break;
      this.items[i] = this.items[p]; i = p;
    }
    this.items[i] = event;
  }
  pop(): T | undefined {
    const first = this.items[0]; const last = this.items.pop();
    if (!last || this.items.length === 0) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.items.length && compare(this.items[child + 1], this.items[child]) < 0) child++;
      if (compare(last, this.items[child]) <= 0) break;
      this.items[i] = this.items[child]; i = child;
    }
    this.items[i] = last; return first;
  }
  /** Drop stale patience events; heap occupancy is also bounded by the work budget. */
  compact(keep: (event: T) => boolean) {
    const retained = this.items.filter(keep); this.items = [];
    for (const event of retained) this.push(event);
  }
}
