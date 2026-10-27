import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { addNode, removeNode, renameNode, uniqueIdentity } from '../src/features/modelEdits';
import { CSV_CELL_LIMIT, encodeCSV, escapeCSV, parseCSV, parseSampleCSV, readLocalText, safeFilename } from '../src/storage/csv';
import { openProjectJSON, serializeProject } from '../src/storage/projectFile';
import { assertSaveAllowed, loadLastProject, saveProject } from '../src/storage/projectStore';
import { resultCSV, resultReportHTML, resultRows } from '../src/storage/report';

describe('strict local CSV data', () => {
  it('reads BOM, CRLF, commas, escaped quotes and multiline quoted cells', () => {
    expect(parseCSV('\ufeffa,b\r\n"one,two","a""b"\r\n"line\nnext",last\r\n')).toEqual([['a', 'b'], ['one,two', 'a"b'], ['line\nnext', 'last']]);
    expect(parseSampleCSV('\ufeff"arrival_seconds"\r\n"0"\r\n"12.5"\r\n12.5\r\n', 'arrival', 20)).toEqual([0, 12.5, 12.5]);
  });
  it.each(['a\n"unterminated', 'a\nplain"quote', 'a\n"quoted"junk', 'a\n\u0000'])('rejects malformed CSV without dropping rows: %j', text => {
    expect(() => parseCSV(text)).toThrow();
  });
  it('bounds file bytes, row count, cell size and column count', () => {
    expect(() => parseCSV('a'.repeat(5_000_001))).toThrow('5 MB');
    expect(() => parseCSV(`a\n${'b'.repeat(CSV_CELL_LIMIT + 1)}`)).toThrow('characters');
    expect(() => parseCSV('a\nb\nc', 2)).toThrow('data rows');
    expect(() => parseCSV(Array.from({ length: 101 }, () => 'a').join(','))).toThrow('100 columns');
  });
  it.each(['12,5', '"12,5"', '1 000', '1e3', 'Infinity', 'NaN', '-1', '=2+2', '12 sec', ''])('rejects unsupported numeric forms: %j', value => {
    expect(() => parseSampleCSV(`service_seconds\n${value}\n`, 'service')).toThrow();
  });
  it('checks headers, positivity, sorted schedule and exclusive horizon', () => {
    expect(() => parseSampleCSV('duration\n12', 'service')).toThrow('service_seconds');
    expect(() => parseSampleCSV('service_seconds,other\n12,2', 'service')).toThrow('one column');
    expect(() => parseSampleCSV('service_seconds\n0', 'service')).toThrow('positive');
    expect(() => parseSampleCSV('service_seconds\n604801', 'service')).toThrow('604,800');
    expect(() => parseSampleCSV('arrival_seconds\n2\n1', 'arrival', 10)).toThrow('non-decreasing');
    expect(() => parseSampleCSV('arrival_seconds\n10', 'arrival', 10)).toThrow('before the run');
    expect(() => parseSampleCSV('service_seconds\n1\n\n2', 'service')).toThrow('Row 3');
    expect(() => parseSampleCSV('service_seconds\n' + '1\n'.repeat(10001), 'service')).toThrow('10,000'.replace(',', ''));
  });
  it('roundtrips CSV text and neutralizes spreadsheet formulas with leading whitespace', () => {
    const rows = [['name', 'note'], ['comma, label', 'He said "yes"\nnext'], ['=HYPERLINK("evil")', '\t@SUM(1)'], ['  +2', '-3']];
    const output = parseCSV(encodeCSV(rows));
    expect(output[1]).toEqual(rows[1]);
    expect(output[2][0]).toBe('\'=HYPERLINK("evil")');
    expect(output[2][1]).toBe("'\t@SUM(1)");
    expect(output[3]).toEqual(["'  +2", "'-3"]);
    expect(escapeCSV('plain')).toBe('"plain"');
  });
  it('rejects invalid UTF-8 bytes before decoding', async () => {
    const file = { size: 2, arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer } as File;
    await expect(readLocalText(file)).rejects.toThrow('UTF-8');
    await expect(readLocalText({ size: 5_000_001 } as File)).rejects.toThrow('5 MB');
    expect(safeFilename('../../<img> 💥\n demo', 'csv')).toBe('img-demo.csv');
  });
});

describe('portable project protection', () => {
  it('roundtrips the entire project without replacing the original object', () => {
    const project = createExample('service');
    const opened = openProjectJSON(serializeProject(project));
    expect(opened).toEqual(project); expect(opened).not.toBe(project);
  });
  it('rejects broken, future-version, oversized and dangerous object input', () => {
    const project = createExample('factory'); const original = structuredClone(project);
    expect(() => openProjectJSON('{')).toThrow('malformed');
    expect(() => openProjectJSON(JSON.stringify({ ...project, schemaVersion: 2 }))).toThrow('not supported');
    expect(() => openProjectJSON('{"__proto__":{"polluted":true}}')).toThrow('unsafe');
    expect(() => openProjectJSON(JSON.stringify({ ...project, description: '\ud800' }))).toThrow('Unicode');
    expect(() => openProjectJSON(JSON.stringify({ ...project, savedAt: {} }))).toThrow('timestamp');
    expect(() => openProjectJSON(JSON.stringify({ ...project, description: 'x'.repeat(5_000_001) }))).toThrow('5 MB');
    expect(project).toEqual(original); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('refuses to export an invalid draft as an apparently valid portable file', () => {
    const project = createExample('factory'); project.model.horizon = NaN;
    expect(() => serializeProject(project)).toThrow('Repair');
    const malformedText = createExample('factory'); malformedText.name = '\ud800';
    expect(() => serializeProject(malformedText)).toThrow('Unicode');
  });
});

describe('revision and reference safety', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renames graph and layout references atomically while preserving sampling identity', () => {
    const project = createExample('factory'); const sample = project.model.nodes.find(n => n.id === 'station-a')!.samplingId;
    const renamed = renameNode(project, 'station-a', 'new-station');
    expect(renamed.revision).toBe(1);
    expect(renamed.model.nodes.find(n => n.id === 'queue-a')).toMatchObject({ next: 'new-station' });
    expect(renamed.layout['new-station']).toEqual(project.layout['station-a']); expect(renamed.layout['station-a']).toBeUndefined();
    expect(renamed.model.nodes.find(n => n.id === 'new-station')!.samplingId).toBe(sample);
    expect(project.model.nodes.some(n => n.id === 'station-a')).toBe(true);
    expect(() => renameNode(project, 'station-a', 'exit')).toThrow('unique');
    expect(() => renameNode(project, 'station-a', '__proto__')).toThrow('unique');
  });
  it('gives new steps independent unique draw identities and keeps delete references explicit', () => {
    const project = createExample('factory');
    const a = addNode(project, 'route'); const b = addNode(a.project, 'route');
    expect(a.id).not.toBe(b.id); expect(new Set(b.project.model.nodes.map(n => n.samplingId)).size).toBe(b.project.model.nodes.length);
    expect(uniqueIdentity('route', ['route-1', 'route-2'])).toBe('route-3');
    const removed = removeNode(project, 'station-a', 'station-b');
    expect(removed.model.nodes.find(n => n.id === 'queue-a')).toMatchObject({ next: 'station-b' });
    expect(removed.layout['station-a']).toBeUndefined(); expect(removed.revision).toBe(1);
    expect(() => removeNode(project, 'station-a', 'station-a')).toThrow('replacement');
  });
  it('rejects stale revisions, equal-revision forks and unseen-tab changes', () => {
    const current = { revision: 5, payload: 'current' };
    expect(() => assertSaveAllowed({ revision: 4, payload: 'old' }, current, current)).toThrow('newer');
    expect(() => assertSaveAllowed({ revision: 5, payload: 'fork' }, current, current)).toThrow('different content');
    expect(() => assertSaveAllowed({ revision: 6, payload: 'next' }, current)).toThrow('Another QueueLab tab');
    expect(() => assertSaveAllowed({ revision: 9, payload: 'next' }, current, { revision: 4, payload: 'old' })).toThrow('Another QueueLab tab');
    expect(() => assertSaveAllowed({ revision: 6, payload: 'next' }, current, current)).not.toThrow();
    expect(() => assertSaveAllowed(current, current)).not.toThrow();
    expect(() => assertSaveAllowed({ revision: 0, payload: 'first' })).not.toThrow();
  });
  it.each([['QuotaExceededError', 'quota'], ['VersionError', 'schema'], ['SecurityError', 'unavailable']])('surfaces IndexedDB %s without fallback', async (name, code) => {
    vi.stubGlobal('indexedDB', { open: () => {
      const request = { error: new DOMException('Injected storage failure', name), onerror: null as null | (() => void) };
      queueMicrotask(() => request.onerror?.());
      return request;
    } });
    await expect(saveProject(createExample('factory'))).rejects.toMatchObject({ code });
  });
  it('surfaces unavailable IndexedDB instead of claiming a save or silently falling back', async () => {
    await expect(saveProject(createExample('factory'))).rejects.toMatchObject({ code: 'unavailable' });
    await expect(loadLastProject()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('run-bound result exports', () => {
  it('uses the actual immutable run, clear units and completed-cohort definitions', () => {
    const result = simulate(createExample('factory').model);
    const csv = resultCSV(result); const rows = parseCSV(csv);
    expect(rows).toContainEqual(['identity', 'seed', String(result.seed), '', 'run snapshot']);
    expect(rows).toContainEqual(['summary', 'completed', String(result.summary.completed), 'entities', 'full run']);
    expect(rows.find(row => row[1] === 'wait_population')?.[2]).toContain('completed cohort entities');
    expect(rows.find(row => row[1] === 'sla_population')?.[2]).toContain('all cohort arrivals');
    expect(resultReportHTML(result)).toContain(result.modelHash); expect(resultReportHTML(result)).toContain('Exact model snapshot');
  });
  it('marks limited runs incomplete and escapes imported labels in downloadable HTML', () => {
    const result = simulate(createExample('factory').model, { maxEvents: 2 });
    result.model.name = '<img src=x onerror=alert(1)>'; result.warnings.push('=HYPERLINK("unsafe")');
    expect(result.status).toBe('limited');
    const html = resultReportHTML(result);
    expect(html).toContain('INCOMPLETE RUN'); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
    expect(resultRows(result).find(row => row[1] === 'completed')?.[4]).toContain('incomplete');
    expect(resultCSV(result)).toContain("'=HYPERLINK");
  });
});

describe('portable parser diagnostic privacy', () => {
  it('keeps imported labels out of public errors while preserving useful UI validation', async () => {
    const { parsePortableProject, validateProject } = await import('../src/public-api');
    const project = createExample('factory');
    const source = project.model.nodes.find(node => node.kind === 'source')!;
    source.label = 'SYNTHETIC_PRIVATE_LABEL'; source.next = 'SYNTHETIC_MISSING_STEP';
    expect(validateProject(project).some(issue => issue.message.includes(source.label))).toBe(true);
    let message = '';
    try { parsePortableProject(JSON.stringify(project)); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('schema validation failed');
    expect(message).not.toMatch(/SYNTHETIC_PRIVATE_LABEL|SYNTHETIC_MISSING_STEP/);
  });
});
