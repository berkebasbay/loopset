import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCouplingManifest, normalizeRunLimits, RNG_VERSION, simulate, simulateAsync } from '../src/public-api';
import { comparePaired, runExperiment, runExperimentAsync } from '../src/experiments';
import { uniform } from '../src/engine/random';
import type { QueueNode, RouteNode, RunOptions, ServiceNode, SimulationModel, SourceNode } from '../src/model/types';
import { resultCSV, resultReportHTML, resultRows } from '../src/storage/report';
import { resultCardContent, resultCardPNG } from '../src/storage/resultCard';
import { parseCSV } from '../src/storage/csv';

function fixture(): SimulationModel {
  return { id: 'provenance', name: 'Synthetic provenance', horizon: 20, warmup: 0, seed: 42, slaSeconds: 5, currency: 'USD', resources: [], nodes: [
    { id: 'src', samplingId: 'input', label: 'Input', kind: 'source', next: 'q', arrival: { kind: 'schedule', times: [0, 1] }, classes: [{ id: 'all', label: 'All', priority: 0, probability: 1 }] },
    { id: 'q', samplingId: 'waiting', label: 'Waiting', kind: 'queue', next: 's', capacity: null, discipline: 'fifo', patience: null },
    { id: 's', samplingId: 'work', label: 'Work', kind: 'service', next: 'out', servers: 1, resources: [], duration: { kind: 'constant', value: 2 } },
    { id: 'out', samplingId: 'done', label: 'Done', kind: 'sink' },
  ] };
}
const defaults = { maxEvents: 1_000_000_000, maxEntities: 10_000_000, maxMicrosteps: 1_000_000, maxTraceEntities: 4_000, maxTraceEvents: 100_000 };
const zeroLimits = { maxEvents: 0, maxEntities: 0, maxMicrosteps: 0, maxTraceEntities: 0, maxTraceEvents: 0 };
const numerical = (run: ReturnType<typeof simulate>) => ({ summary: run.summary, stations: run.stations, pools: run.pools, classes: run.classes, waits: run.waitDistribution, processedEvents: run.processedEvents });
const withoutTiming = (run: ReturnType<typeof simulate>) => { const { elapsedMs: _time, ...rest } = run; return rest; };

describe('actual run RNG and effective caps', () => {
  it('retains exact defaults and the actual seed override without changing the configured model seed', () => {
    const run = simulate(fixture(), { seed: 0 });
    expect(run.provenance).toEqual({ rngVersion: 'keyed-murmur32-v1', limits: defaults });
    expect(run.provenance.rngVersion).toBe(RNG_VERSION);
    expect(run.seed).toBe(0); expect(run.model.seed).toBe(42);
    // Independent FIFO: two arrivals at 0 and 1 start at 0 and 2, finish at 2 and 4.
    expect(run.summary).toMatchObject({ completed: 2, meanWait: 0.5, meanSojourn: 2.5, waitSampleSize: 2 });
    expect(normalizeRunLimits()).toEqual(defaults);
  });

  it('keeps zero as a literal cap and keeps the documented modeled-input RunID across budget configurations', () => {
    const complete = simulate(fixture()); const stopped = simulate(fixture(), zeroLimits);
    expect(stopped.status).toBe('limited'); expect(stopped.processedEvents).toBe(0);
    expect(stopped.provenance.limits).toEqual(zeroLimits);
    expect(stopped.trace).toMatchObject({ entityLimit: 0, eventLimit: 0, complete: false });
    expect(stopped.id).toBe(complete.id); expect(stopped.modelHash).toBe(complete.modelHash);
    expect(stopped.summary.completed).toBe(0);
  });

  it.each<keyof typeof defaults>(['maxEvents', 'maxEntities', 'maxMicrosteps'])('retains the actual independent %s zero cap on partial observations', key => {
    const run = simulate(fixture(), { [key]: 0 });
    expect(run.status).toBe('limited'); expect(run.provenance.limits).toEqual({ ...defaults, [key]: 0 });
    expect(run.reason).toContain('(0)');
  });

  it('captures normalized overrides once before callbacks can mutate the caller options', () => {
    const options: RunOptions = { maxEvents: 1234, maxEntities: 56, maxMicrosteps: 78, maxTraceEntities: 9, maxTraceEvents: 10,
      onProgress: () => { options.maxEvents = 0; options.maxEntities = 0; options.maxTraceEvents = 0; } };
    const run = simulate(fixture(), options);
    expect(run.status).toBe('completed');
    expect(run.provenance.limits).toEqual({ maxEvents: 1234, maxEntities: 56, maxMicrosteps: 78, maxTraceEntities: 9, maxTraceEvents: 10 });
    expect(Object.isFrozen(run.provenance.limits)).toBe(true);
  });

  it.each(['maxEvents', 'maxEntities', 'maxMicrosteps', 'maxTraceEntities', 'maxTraceEvents'] as const)('rejects invalid %s values instead of claiming a clamped or default cap', key => {
    const ceilings = { maxEvents: 1_000_000_000, maxEntities: 10_000_000, maxMicrosteps: 1_000_000, maxTraceEntities: 100_000, maxTraceEvents: 1_000_000 };
    for (const value of [-1, 0.5, Infinity, NaN, ceilings[key] + 1]) expect(() => normalizeRunLimits({ [key]: value })).toThrow('Run limit');
  });

  it('keeps sync/async provenance and numerical results equal after task yielding, without serializing callbacks', async () => {
    const model = fixture(); model.horizon = 500;
    (model.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: Array.from({ length: 140 }, (_, i) => i) };
    const options = { seed: -9, maxTraceEntities: 0, maxTraceEvents: 0, onProgress: () => {}, shouldCancel: () => false };
    const sync = simulate(model, options); const async = await simulateAsync(model, options);
    expect(sync.processedEvents).toBeGreaterThan(256); expect(withoutTiming(async)).toEqual(withoutTiming(sync));
    expect(structuredClone(sync).provenance).toEqual(sync.provenance);
    expect(JSON.parse(JSON.stringify(sync)).provenance).toEqual(sync.provenance);
    expect(JSON.stringify(sync)).not.toMatch(/onProgress|shouldCancel/);
    expect(numerical(sync)).toEqual(numerical(simulate(model, { seed: -9 })));
  });

  it.each(['cancelled', 'failed'] as const)('retains provenance on an actual %s callback stop', status => {
    const run = simulate(fixture(), { seed: 7, shouldCancel: () => { if (status === 'failed') throw new Error('Synthetic stop'); return true; } });
    expect(run.status).toBe(status); expect(run.seed).toBe(7); expect(run.provenance.limits).toEqual(defaults);
  });

  it('retains replication seeds and trace-disabled effective caps with shared frozen snapshots', async () => {
    const sync = runExperiment(fixture(), [5, 6], { seed: 999, maxEntities: 50 });
    const async = await runExperimentAsync(fixture(), [5, 6], { seed: 999, maxEntities: 50 });
    for (const experiment of [sync, async]) {
      expect(experiment.runs.map(run => run.seed)).toEqual([5, 6]);
      expect(experiment.runs[0].model).toBe(experiment.runs[1].model); expect(Object.isFrozen(experiment.runs[0].model)).toBe(true);
      expect(experiment.runs[0].provenance.limits).toEqual({ ...defaults, maxEntities: 50, maxTraceEntities: 0, maxTraceEvents: 0 });
    }
    expect(structuredClone(sync).runs[0].provenance).toEqual(sync.runs[0].provenance);
  });
});

describe('static source and stage coupling', () => {
  it('matches the declared raw keys to actual source/class and revisited service/delay/route draws', () => {
    const poisson = fixture();
    const source = poisson.nodes[0] as SourceNode;
    source.arrival = { kind: 'poisson', segments: [{ start: 0, end: 20, perHour: 3600 }] };
    source.classes = [{ id: 'a', label: 'A', priority: 0, probability: 0.5 }, { id: 'b', label: 'B', priority: 1, probability: 0.5 }];
    const arrival = simulate(poisson, { seed: 1 }).entities[0];
    expect(arrival.arrivedAt).toBe(-Math.log1p(-uniform(1, 'input', 0, 'arrival')));
    expect(arrival.classId).toBe(uniform(1, 'input', 0, 'class') < 0.5 ? 'a' : 'b');

    const looping = fixture(); (looping.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: [0] };
    (looping.nodes[2] as ServiceNode).duration = { kind: 'exponential', mean: 2 };
    (looping.nodes[2] as ServiceNode).next = 'delay';
    looping.nodes.push({ id: 'delay', samplingId: 'travel', label: 'Delay', kind: 'delay', next: 'route', duration: { kind: 'exponential', mean: 1 } },
      { id: 'route', samplingId: 'branch', label: 'Route', kind: 'route', branches: [{ to: 'q', probability: 0.5 }, { to: 'out', probability: 0.5 }] });
    // Route sorts by destination samplingId: done first, waiting second. Seed 1 therefore loops once, then exits.
    expect(uniform(1, 'input', 0, 'branch', 0, 'route')).toBeGreaterThan(0.5);
    expect(uniform(1, 'input', 0, 'branch', 1, 'route')).toBeLessThan(0.5);
    const run = simulate(looping, { seed: 1 }); const visits = run.entities[0].visits;
    expect(run.entities[0].status).toBe('completed');
    for (const [nodeId, samplingId, kind, mean] of [['s', 'work', 'service', 2], ['delay', 'travel', 'delay', 1]] as const) {
      const sampled = visits.filter(visit => visit.nodeId === nodeId); expect(sampled).toHaveLength(2);
      for (const [ordinal, visit] of sampled.entries()) expect(visit.end! - visit.start!).toBeCloseTo(-Math.log1p(-uniform(1, 'input', 0, samplingId, ordinal, kind)) * mean, 12);
    }
    const manifest = buildCouplingManifest(run, run);
    expect(manifest.matchedStages.find(stage => stage.samplingId === 'travel')?.sharedDrawKinds).toEqual(['delay']);
    expect(manifest.caveats.join(' ')).toContain('per entity and stage samplingId');
  });

  it('uses queue stage identity and zero-based visit ordinal for patience, independently of service draws', () => {
    const model = fixture(); (model.nodes[0] as SourceNode).arrival = { kind: 'schedule', times: [0] };
    (model.nodes[1] as QueueNode).patience = { kind: 'exponential', mean: 2 };
    model.resources = [{ id: 'closed', label: 'Closed', installedCapacity: 1, capacity: 0, calendar: [], costPerHour: 0, overtimeCostPerHour: 0 }];
    (model.nodes[2] as ServiceNode).resources = [{ poolId: 'closed', units: 1 }];
    const run = simulate(model, { seed: 1 });
    expect(run.entities[0].status).toBe('reneged');
    expect(run.entities[0].endedAt).toBe(-Math.log1p(-uniform(1, 'input', 0, 'waiting', 0, 'patience')) * 2);
    expect(buildCouplingManifest(run, run).matchedStages.find(stage => stage.samplingId === 'waiting')?.sharedDrawKinds).toEqual(['patience']);
  });

  it('matches renamed graph IDs and labels by sampling identity, retaining exact zero-based raw-key scope', () => {
    const a = fixture(); const b = fixture();
    const rename = new Map(b.nodes.map(node => [node.id, `renamed-${node.id}`]));
    for (const node of b.nodes) {
      node.id = rename.get(node.id)!; node.label = 'New label';
      if ('next' in node) node.next = rename.get(node.next)!;
    }
    b.nodes.reverse(); b.seed = 888;
    const result = comparePaired(a, b, [12, 13]); const manifest = result.coupling;
    expect(result.paired).toBe(true); expect(manifest.unmatched).toEqual([]);
    expect(manifest.matchedSources).toEqual([{ samplingId: 'input', kind: 'source', baselineNodeId: 'src', candidateNodeId: 'renamed-src', baselineDrawKinds: ['class'], candidateDrawKinds: ['class'], sharedDrawKinds: ['class'], changes: [] }]);
    expect(manifest.matchedStages.find(stage => stage.samplingId === 'work')).toMatchObject({ baselineNodeId: 's', candidateNodeId: 'renamed-s', sharedDrawKinds: ['service'], changes: [] });
    expect(manifest.compatibility).toEqual({ sameRngVersion: true, sameSeed: true, sameExternalDemand: true, sameMeasurementPolicies: true });
    expect(manifest.rawKeys).toMatchObject({ encoding: 'JSON.stringify', ordinalBase: 0,
      arrival: ['RNG_VERSION', 'seed', 'sourceSamplingId', 'arrivalOrdinal', 'arrival'],
      class: ['RNG_VERSION', 'seed', 'sourceSamplingId', 'arrivalOrdinal', 'class'],
      stage: ['RNG_VERSION', 'seed', 'sourceSamplingId', 'arrivalOrdinal', 'stageSamplingId', 'visitOrdinal', 'kind'] });
    expect(manifest.rawKeys.replicationScope).toContain('replication index is not');
    expect(manifest.caveats.join(' ')).toContain('no executed draw, matched visit or path counts');
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('marks genuinely new stage identities unmatched even if labels and node IDs are unchanged', () => {
    const a = fixture(); const b = fixture(); b.nodes[2].samplingId = 'new-work';
    const result = comparePaired(a, b, [1]);
    expect(result.paired).toBe(true); // External demand still matches; a new service stream is disclosed.
    expect(result.coupling.matchedStages.map(stage => stage.samplingId)).not.toContain('work');
    expect(result.coupling.unmatched.map(item => [item.side, item.component.samplingId, item.reason])).toEqual([
      ['baseline', 'work', 'sampling-id-absent'], ['candidate', 'new-work', 'sampling-id-absent'],
    ]);
  });

  it('does not couple reused sampling IDs across different node kinds', () => {
    const a = fixture(); const b = fixture();
    b.nodes[2] = { id: 's', samplingId: 'work', label: 'Delay', kind: 'delay', next: 'out', duration: { kind: 'constant', value: 2 } };
    // A queue must target a service; bypass and remove it on this alternative.
    (b.nodes[0] as SourceNode).next = 's'; b.nodes = b.nodes.filter(node => node.id !== 'q');
    const manifest = comparePaired(a, b, [1]).coupling;
    expect(manifest.matchedStages.some(stage => stage.samplingId === 'work')).toBe(false);
    expect(manifest.unmatched.filter(item => item.reason === 'kind-changed').map(item => [item.side, item.component.kind, item.component.drawKinds])).toEqual([
      ['baseline', 'service', ['service']], ['candidate', 'delay', ['delay']],
    ]);
  });

  it('discloses transformed-duration changes while preserving potential shared raw service keys', () => {
    const a = fixture(); const b = fixture(); (b.nodes[2] as ServiceNode).duration = { kind: 'constant', value: 4 };
    const result = comparePaired(a, b, [1]);
    expect(result.coupling.matchedStages.find(stage => stage.samplingId === 'work')).toMatchObject({ sharedDrawKinds: ['service'], changes: ['distribution'] });
    expect(result.baseline.runs[0].summary.meanSojourn).toBe(2.5); expect(result.candidate.runs[0].summary.meanSojourn).toBe(5.5);
    expect(result.coupling.caveats.join(' ')).toContain('do not guarantee equal transformed durations');
  });

  it('reports both Poisson arrival and class keys, and does not imply paired demand when rates/classes change', () => {
    const a = fixture(); const b = fixture();
    (a.nodes[0] as SourceNode).arrival = { kind: 'poisson', segments: [{ start: 0, end: 20, perHour: 360 }] };
    (b.nodes[0] as SourceNode).arrival = { kind: 'poisson', segments: [{ start: 0, end: 20, perHour: 720 }] };
    (b.nodes[0] as SourceNode).classes[0].priority = 1;
    const result = comparePaired(a, b, [1, 2]);
    expect(result.paired).toBe(false); expect(result.delta.completed.samples).toBe(0);
    expect(result.coupling.compatibility.sameExternalDemand).toBe(false);
    expect(result.coupling.matchedSources[0]).toMatchObject({ sharedDrawKinds: ['arrival', 'class'], changes: ['arrival', 'classes'] });
    expect(result.coupling.caveats.join(' ')).toContain('External demand differs');
  });

  it('removes potential shared stage keys when no source sampling identity matches', () => {
    const a = fixture(); const b = fixture(); b.nodes[0].samplingId = 'new-input';
    const result = comparePaired(a, b, [1]);
    expect(result.paired).toBe(false); expect(result.coupling.matchedSources).toEqual([]);
    expect(result.coupling.matchedStages.find(stage => stage.samplingId === 'work')?.sharedDrawKinds).toEqual([]);
    expect(result.coupling.unmatched.filter(item => item.component.kind === 'source')).toHaveLength(2);
  });

  it('qualifies shared raw keys when measurement policies or actual run seeds differ', () => {
    const a = fixture(); const b = fixture(); b.warmup = 1;
    const result = comparePaired(a, b, [1]);
    expect(result.paired).toBe(false); expect(result.coupling.compatibility).toMatchObject({ sameExternalDemand: true, sameMeasurementPolicies: false });
    expect(result.coupling.caveats.join(' ')).toContain('policies differ');
    const differentSeeds = buildCouplingManifest(simulate(a, { seed: 1 }), simulate(a, { seed: 2 }));
    expect(differentSeeds.compatibility.sameSeed).toBe(false);
    expect(differentSeeds.matchedSources[0].sharedDrawKinds).toEqual([]);
    expect(differentSeeds.matchedStages.every(stage => stage.sharedDrawKinds.length === 0)).toBe(true);
  });

  it('reports enabled/disabled patience draws, resource/capacity changes and unchanged deterministic no-draw stages', () => {
    const a = fixture(); const b = fixture();
    (b.nodes[1] as QueueNode).patience = { kind: 'constant', value: 0 }; (b.nodes[1] as QueueNode).capacity = 0;
    (b.nodes[1] as QueueNode).discipline = 'priority'; (b.nodes[2] as ServiceNode).servers = 2;
    b.resources = [{ id: 'team', label: 'Team', installedCapacity: 1, capacity: 1, calendar: [], costPerHour: 0, overtimeCostPerHour: 0 }];
    (b.nodes[2] as ServiceNode).resources = [{ poolId: 'team', units: 1 }];
    const manifest = comparePaired(a, b, [1]).coupling;
    expect(manifest.matchedStages.find(stage => stage.samplingId === 'waiting')).toMatchObject({ baselineDrawKinds: [], candidateDrawKinds: ['patience'], sharedDrawKinds: [], changes: ['distribution', 'queuePolicy', 'capacity'] });
    expect(manifest.matchedStages.find(stage => stage.samplingId === 'work')).toMatchObject({ changes: ['capacity', 'resources'] });
    expect(manifest.matchedStages.find(stage => stage.samplingId === 'done')).toMatchObject({ sharedDrawKinds: [], changes: [] });
  });

  it('discloses changed route mappings and path/visit divergence without claiming observed matching visits', () => {
    const routed = (): SimulationModel => {
      const m = fixture(); (m.nodes[0] as SourceNode).next = 'route';
      m.nodes.push({ id: 'route', samplingId: 'branch', label: 'Branch', kind: 'route', branches: [{ to: 'q', probability: 1 }, { to: 'out', probability: 0 }] });
      return m;
    };
    const a = routed(); const b = routed();
    (b.nodes.find(node => node.kind === 'route') as RouteNode).branches = [{ to: 'q', probability: 0 }, { to: 'out', probability: 1 }];
    const result = comparePaired(a, b, [1], { maxTraceEntities: 10, maxTraceEvents: 100 });
    expect(result.coupling.matchedStages.find(stage => stage.samplingId === 'branch')).toMatchObject({ sharedDrawKinds: ['route'], changes: ['routing'] });
    expect(result.baseline.runs[0].stations[0].started).toBe(2); expect(result.candidate.runs[0].stations[0].started).toBe(0);
    expect(result.coupling.caveats.join(' ')).toContain('paths, visit counts');
    const reversed = routed(); (reversed.nodes.find(node => node.kind === 'route') as RouteNode).branches.reverse(); reversed.nodes.reverse();
    expect(comparePaired(a, reversed, [1]).coupling.matchedStages.find(stage => stage.samplingId === 'branch')?.changes).toEqual([]);
  });

  it('does not copy empirical samples, traces or observed draws into the bounded static manifest', () => {
    const a = fixture(); (a.nodes[2] as ServiceNode).duration = { kind: 'empirical', values: Array(10_000).fill(1.23456789012345) };
    const run = simulate(a); const manifest = buildCouplingManifest(run, run);
    expect(JSON.stringify(manifest).length).toBeLessThan(10_000);
    expect(JSON.stringify(manifest)).not.toContain('1.23456789012345');
    expect(Object.keys(manifest)).not.toContain('draws');
    const before = structuredClone(manifest); a.nodes[2].label = 'Changed input'; run.model.nodes[2].samplingId = 'later-edit';
    expect(manifest).toEqual(before);
  });
});

describe('run-bound export provenance', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts the actual RNG and all numeric caps, including zeros, into CSV/HTML/card content', () => {
    const options = { seed: 0, maxEvents: 12, maxEntities: 34, maxMicrosteps: 56, maxTraceEntities: 0, maxTraceEvents: 0 };
    const run = simulate(fixture(), options); const rows = parseCSV(resultCSV(run));
    expect(rows).toContainEqual(['identity', 'rng_version', 'keyed-murmur32-v1', '', 'actual run RNG']);
    const limits = rows.filter(row => row[0] === 'limits');
    expect(Object.fromEntries(limits.map(row => [row[1], Number(row[2])]))).toEqual({ maxEvents: 12, maxEntities: 34, maxMicrosteps: 56, maxTraceEntities: 0, maxTraceEvents: 0 });
    expect(limits.every(row => row[4].includes('zero is a literal cap'))).toBe(true);
    const html = resultReportHTML(run); expect(html).toContain('keyed-murmur32-v1');
    for (const key of Object.keys(zeroLimits)) expect(html).toContain(key);
    const card = resultCardContent(run); expect(card.seed).toBe('Seed 0'); expect(card.randomness).toBe('RNG keyed-murmur32-v1');
    expect(card.limits).toBe('Limits · maxEvents 12 · maxEntities 34 · maxMicrosteps 56 · trace entities 0 · trace events 0');
    expect(resultRows(run).find(row => row[1] === 'status')?.[2]).toBe('limited');
  });

  it('still escapes exported provenance through the existing CSV and HTML boundaries', () => {
    const run = simulate(fixture()); run.provenance = { ...run.provenance, rngVersion: '=FORMULA <script>bad</script>' };
    expect(resultCSV(run)).toContain("'=FORMULA");
    expect(resultReportHTML(run)).toContain('&lt;script&gt;'); expect(resultReportHTML(run)).not.toContain('<script>');
  });

  it('paints complete mandatory RNG/cap strings into the existing 1280×640 PNG and captures them before font work', async () => {
    const run = simulate(fixture(), { maxEvents: 10_000_000, maxEntities: 1_000_000, maxMicrosteps: 1_000_000, maxTraceEntities: 100_000, maxTraceEvents: 1_000_000 });
    const expected = resultCardContent(run); const painted: string[] = [];
    const context = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', fillRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
      measureText: (text: string) => ({ width: text.length * 7 }), fillText: (text: string) => painted.push(text) };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: BlobCallback) => callback(new Blob(['synthetic PNG encoder'], { type: 'image/png' })) };
    vi.stubGlobal('document', { fonts: { load: async () => { run.provenance = { rngVersion: 'later-mutation', limits: zeroLimits }; } }, createElement: () => canvas });
    await resultCardPNG(run);
    expect(canvas.width).toBe(1280); expect(canvas.height).toBe(640);
    expect(painted).toContain(expected.randomness); expect(painted).toContain(expected.limits);
    expect(painted.join(' ')).not.toContain('later-mutation');
  });
});

describe('fingerprint locale independence', () => {
  it('keeps mixed-case identifiers identical in real English and Turkish processes', async () => {
    const { execFileSync } = await import('node:child_process');
    const module = new URL('../src/model/identity.ts', import.meta.url).href;
    const model = fixture();
    (model.nodes[0] as SourceNode).classes = [
      { id: 'I', label: 'Upper', priority: 0, probability: .5 },
      { id: 'i', label: 'Lower', priority: 0, probability: .5 },
    ];
    const program = `import {modelHash,demandHash} from ${JSON.stringify(module)};const model=${JSON.stringify(model)};console.log(JSON.stringify([modelHash(model),demandHash(model,42)]));`;
    const hashes = ['en_US.UTF-8', 'tr_TR.UTF-8'].map(locale => execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale }, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim());
    expect(hashes[0]).toBe(hashes[1]);
  });
});
