import { describe, expect, it } from 'vitest';
import { insertCalendarBreak } from '../src/features/ScheduleEditor';

describe('explicit break preview', () => {
  it('preserves calendar parts outside a new break and leaves the original array unchanged', () => {
    const periods = [{ start: 1800, end: 2100, capacity: 1 }, { start: 2400, end: 3000, capacity: 3 }];
    expect(insertCalendarBreak(periods, 1900, 2000, 3600, 4)).toEqual([
      { start: 1800, end: 1900, capacity: 1 }, { start: 1900, end: 2000, capacity: 0 },
      { start: 2000, end: 2100, capacity: 1 }, { start: 2400, end: 3000, capacity: 3 },
    ]);
    expect(periods).toEqual([{ start: 1800, end: 2100, capacity: 1 }, { start: 2400, end: 3000, capacity: 3 }]);
  });
  it('inserts a break in a base-capacity gap and deliberately replaces overlapping overrides', () => {
    expect(insertCalendarBreak([{ start: 10, end: 20, capacity: 2 }, { start: 30, end: 40, capacity: 1 }], 15, 35, 60, 4)).toEqual([
      { start: 10, end: 15, capacity: 2 }, { start: 15, end: 35, capacity: 0 }, { start: 35, end: 40, capacity: 1 },
    ]);
    expect(insertCalendarBreak([], 10, 20, 60, 2)).toEqual([{ start: 10, end: 20, capacity: 0 }]);
  });
  it('rejects invalid and over-limit previews rather than dropping or repairing periods', () => {
    expect(() => insertCalendarBreak([{ start: 20, end: 30, capacity: 1 }, { start: 10, end: 15, capacity: 1 }], 35, 40, 60, 2)).toThrow(/out of order/);
    expect(() => insertCalendarBreak([], 40, 40, 60, 2)).toThrow(/start before/);
    expect(() => insertCalendarBreak([], 50, 70, 60, 2)).toThrow(/within the run/);
    const periods = Array.from({ length: 200 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, capacity: 1 }));
    expect(() => insertCalendarBreak(periods, 1, 2, 2000, 2)).toThrow(/at most 200/);
  });
});
