import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectSampleCSV, mapSampleCSV, plainDecimal } from '../src/storage/csvMapping';
import { compareProjectMetadata, scanProjectLibrary, type ProjectMetadata, type ProjectPage, type ProjectPageCursor } from '../src/storage/projectStore';
import * as projectStore from '../src/storage/projectStore';
import { openSavedProject } from '../src/features/DataTools';
import { serializeRunJSON } from '../src/features/ResultExports';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';

describe('explicit CSV column and time-unit mapping', () => {
  it('preserves canonical templates and maps a selected column without losing ordered duplicate arrivals', () => {
    const canonical = inspectSampleCSV('\ufeffarrival_seconds\r\n0\r\n12.5\r\n30\r\n', 'arrival');
    expect(mapSampleCSV(canonical, 0, 'seconds', 3600).values).toEqual([0, 12.5, 30]);
    const table = inspectSampleCSV('note,time,other\r\nfirst,0.5,a\r\nsecond,0.5,b\r\nthird,1,c\r\n', 'arrival');
    const original = JSON.stringify(table); const mapped = mapSampleCSV(table, 1, 'hours', 4000);
    expect(mapped.values).toEqual([1800, 1800, 3600]);
    expect(mapped.previewRows).toEqual([{ row: 2, original: '0.5', seconds: 1800 }, { row: 3, original: '0.5', seconds: 1800 }, { row: 4, original: '1', seconds: 3600 }]);
    expect(JSON.stringify(table)).toBe(original);
    expect(mapped.canonicalCSV).toBe('arrival_seconds\r\n1800\r\n1800\r\n3600\r\n');
  });
  it('preserves small decimal conversions through the unchanged strict parser', () => {
    const mapped = mapSampleCSV(inspectSampleCSV('duration\n0.0000000000001\n0.25', 'service'), 0, 'minutes');
    expect(mapped.values).toEqual([6e-12, 15]);
    expect(mapped.canonicalCSV).not.toMatch(/[eE][+-]?\d/);
    expect(Number(plainDecimal(Number.MIN_VALUE))).toBe(Number.MIN_VALUE);
  });
  it('rejects invalid rows, formulas, order, unit, horizon and size rather than repairing or skipping', () => {
    expect(() => inspectSampleCSV('a,b\n1,2\n3', 'arrival')).toThrow('Row 3');
    expect(() => mapSampleCSV(inspectSampleCSV('time\n0\n=2+2', 'arrival'), 0, 'seconds', 100)).toThrow('Row 3');
    expect(() => mapSampleCSV(inspectSampleCSV('time\n2\n1', 'arrival'), 0, 'minutes', 500)).toThrow('non-decreasing');
    expect(() => mapSampleCSV(inspectSampleCSV('time\n0\n50', 'arrival'), 0, 'minutes', 3000)).toThrow('before the run');
    expect(() => mapSampleCSV(inspectSampleCSV('time\n0', 'service'), 0, 'hours')).toThrow('positive');
    expect(() => mapSampleCSV(inspectSampleCSV('time\n1', 'service'), 1, 'seconds')).toThrow('valid time column');
    expect(() => mapSampleCSV(inspectSampleCSV('time\n1', 'service'), 0, '__proto__' as 'seconds')).toThrow('seconds, minutes or hours');
    expect(() => inspectSampleCSV('time\n' + '1'.repeat(5_000_000), 'service')).toThrow('5 MB');
  });
  it('keeps every service row, including repeated and unsorted durations', () => {
    const table = inspectSampleCSV('label,duration\na,3\nb,1\nc,3', 'service');
    expect(mapSampleCSV(table, 1, 'minutes').values).toEqual([180, 60, 180]);
  });
});

function metadata(count: number): ProjectMetadata[] {
  return Array.from({ length: count }, (_, i) => ({ id: `project-${String(i).padStart(4, '0')}`, name: `Plan ${String(i).padStart(4, '0')}`, revision: i, savedAt: '2026-10-27T00:00:00.000Z' })).reverse();
}
function reader(records: ProjectMetadata[], unlistedRecords = 0) {
  const visited: string[] = []; let pages = 0;
  const read = async (after: ProjectPageCursor | null, limit = 20): Promise<ProjectPage> => {
    pages++; const start = after ? records.findIndex(item => item.id === after[1] && item.savedAt === after[0]) + 1 : 0;
    const items = records.slice(start, start + limit).map(item => ({ ...item }));
    visited.push(...items.map(item => item.id));
    const last = items.at(-1); const next = start + items.length < records.length && last ? [last.savedAt, last.id] as const : null;
    return { items, next, unlistedRecords };
  };
  return { read, visited, get pages() { return pages; } };
}

describe('metadata-only library search and global sorting', () => {
  it('finds a summary beyond the first20 indexed records and retains unreadable metadata counts', async () => {
    const records = metadata(45); records[42].name = 'Hidden target'; const port = reader(records, 2);
    const found = await scanProjectLibrary({ query: 'hidden', sort: 'recent' }, null, port.read);
    expect(found.items.map(item => item.name)).toEqual(['Hidden target']);
    expect(found.complete).toBe(true); expect(found.scanned).toBe(45); expect(found.unlistedRecords).toBe(2);
    expect(port.pages).toBe(3); expect(port.visited).toHaveLength(45);
    expect(found.items.every(item => !('model' in item) && !('payload' in item))).toBe(true);
  });
  it('sorts across the complete library and pages results with a semantic sort cursor', async () => {
    const records = metadata(45); const sorted = [...records].sort((a, b) => compareProjectMetadata(a, b, 'name'));
    let after: ProjectMetadata | null = null; const ids: string[] = [];
    for (let page = 0; page < 3; page++) {
      const found = await scanProjectLibrary({ query: '', sort: 'name', after }, null, reader(records).read);
      expect(found.complete).toBe(true); expect(found.items.length).toBeLessThanOrEqual(20);
      ids.push(...found.items.map(item => item.id)); after = found.items.at(-1)!;
      expect(found.hasMoreResults).toBe(page < 2);
    }
    expect(ids).toEqual(sorted.map(item => item.id)); expect(new Set(ids).size).toBe(45);
  });
  it('states partial scope, resumes beyond500 metadata records and never retains more than20 candidates', async () => {
    const records = metadata(610); records[605].name = 'Late target'; const port = reader(records);
    const partial = await scanProjectLibrary({ query: 'target', sort: 'name' }, null, port.read);
    expect(partial.complete).toBe(false); expect(partial.scanned).toBe(500); expect(partial.items).toHaveLength(0);
    const complete = await scanProjectLibrary(partial.request, partial, port.read);
    expect(complete.complete).toBe(true); expect(complete.scanned).toBe(610); expect(complete.items[0].name).toBe('Late target');
    expect(complete.items.length).toBeLessThanOrEqual(20); expect(port.pages).toBe(31);
    await expect(scanProjectLibrary({ query: 'other', sort: 'name' }, partial, port.read)).rejects.toThrow('different search');
  });
});

describe('immutable run JSON export', () => {
  it('exports the calculated snapshot and identity after a newer draft changes', () => {
    const project = createExample('factory'); const run = simulate(project.model);
    project.model.horizon = 7200; project.model.name = 'Later draft';
    const parsed = JSON.parse(serializeRunJSON(run));
    expect(parsed.format).toBe('queuelab-run-v1'); expect(parsed.id).toBe(run.id);
    expect(parsed.model).toEqual(run.model); expect(parsed.model.horizon).toBe(3600);
    expect(parsed.summary).toEqual(run.summary); expect(parsed.provenance).toEqual(run.provenance);
  });
  it('retains explicit incomplete status/reason and partial observation scope', () => {
    const run = simulate(createExample('factory').model, { maxEvents: 1 }); const parsed = JSON.parse(serializeRunJSON(run));
    expect(parsed.status).toBe('limited'); expect(parsed.reason).toBe(run.reason);
    expect(parsed.simulatedUntil).toBe(run.simulatedUntil); expect(parsed.summary).toEqual(run.summary);
  });
});


describe('fresh saved-project acceptance context', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['unmounted', 'project', 'revision'] as const)('refuses a late IDB read after the %s context changes, without advancing the comparison base', async reason => {
    const project = createExample('factory'); let resolve!: (value: typeof project) => void;
    vi.spyOn(projectStore, 'loadProject').mockReturnValue(new Promise(done => { resolve = done; }));
    const remember = vi.spyOn(projectStore, 'rememberOpenedProject'); const accept = vi.fn();
    let mounted = true, currentId = project.id, currentRevision = project.revision;
    const pending = openSavedProject(project.id, accept, () => mounted && currentId === project.id && currentRevision === project.revision);
    if (reason === 'unmounted') mounted = false;
    if (reason === 'project') currentId = 'another-project';
    if (reason === 'revision') currentRevision++;
    resolve(project);
    await expect(pending).rejects.toThrow('active project or its revision changed');
    expect(accept).not.toHaveBeenCalled(); expect(remember).not.toHaveBeenCalled();
  });
  it('retains the existing default acceptance behavior and remembers the freshly read saved snapshot', async () => {
    const project = createExample('factory'); vi.spyOn(projectStore, 'loadProject').mockResolvedValue(project);
    const remember = vi.spyOn(projectStore, 'rememberOpenedProject'); const accept = vi.fn(() => ({ ...project, revision: 50 }));
    await expect(openSavedProject(project.id, accept)).resolves.toEqual(project);
    expect(accept).toHaveBeenCalledWith(project); expect(remember).toHaveBeenCalledWith(project);
  });
});
