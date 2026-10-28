import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildStarter } from '../src/templates/definitions';
import { starterTemplates, type StarterId } from '../src/templates/catalogue';
import { loadStarter } from '../src/templates/load';
import inventory from '../src/templates/inventory.json';
import references from '../public/templates/reference-results.json';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { modelHash } from '../src/model/identity';
import { validateProject } from '../src/model/validate';
import { knownAssetReference } from '../src/catalog/registry';
import { openProjectJSON, serializeProject } from '../src/storage/projectFile';
import type { SimulationModel } from '../src/model/types';

const expectedArrivals: Partial<Record<StarterId, number>> = { workshop: 60, machining: 72, quality: 96, packing: 200, fulfillment: 120, returns: 140, parcel: 150, repair: 68, print: 48 };
const singleJob = (model: SimulationModel) => {
  const copy = structuredClone(model); const source = copy.nodes.find(node => node.kind === 'source')!;
  source.arrival = { kind: 'schedule', times: [0] }; return copy;
};

describe('curated starter collection', () => {
  it('contains twelve distinct process configurations and preserves the original three numerical contracts', () => {
    expect(starterTemplates).toHaveLength(12);
    const signatures = starterTemplates.map(item => {
      const model = buildStarter(item.id).model;
      // Exclude names/IDs so renaming a duplicated model cannot satisfy this coverage check.
      return JSON.stringify({ horizon: model.horizon, nodes: model.nodes.map(node => {
        const { id: _id, samplingId: _sampling, label: _label, ...rest } = node;
        return { ...rest, ...('next' in rest ? { next: model.nodes.findIndex(n => n.id === rest.next) } : {}), ...(node.kind === 'route' ? { branches: node.branches.map(branch => ({ to: model.nodes.findIndex(n => n.id === branch.to), probability: branch.probability })) } : {}), ...(node.kind === 'source' ? { classes: node.classes.map(c => ({ probability: c.probability, priority: c.priority })) } : {}), ...(node.kind === 'service' ? { resources: node.resources.map(r => ({ pool: model.resources.findIndex(p => p.id === r.poolId), units: r.units })) } : {}) };
      }), pools: model.resources.map(({ id: _id, label: _label, ...pool }) => pool) });
    });
    expect(new Set(signatures).size).toBe(12);
    for (const world of ['factory', 'festival', 'service'] as const) expect(buildStarter(world).model).toEqual(createExample(world).model);
    expect(buildStarter('workshop').model).not.toEqual(buildStarter('factory').model);
  });
  for (const item of starterTemplates) it(`${item.id}: portable content, artwork, three seeds and both alternatives satisfy the contract`, () => {
    const project = buildStarter(item.id), file = readFileSync(`public/templates/${item.id}.json`, 'utf8'), meta = inventory[item.id];
    expect(validateProject(project).filter(issue => issue.severity === 'error')).toEqual([]);
    expect(openProjectJSON(file)).toEqual(project); expect(openProjectJSON(serializeProject(project))).toEqual(project);
    expect(Buffer.byteLength(file)).toBe(meta.bytes); expect(createHash('sha256').update(file).digest('hex')).toBe(meta.sha256);
    expect(project.facility!.objects.length).toBe(meta.objects); expect(project.model.nodes.length).toBe(meta.steps);
    expect(meta.objects).toBeGreaterThanOrEqual(20); expect(meta.objects).toBeLessThanOrEqual(130); expect(meta.bytes).toBeLessThan(250_000);
    for (const asset of [...project.facility!.objects, ...Object.values(project.facility!.nodeAssets)]) expect(knownAssetReference(asset.assetId, asset.assetVersion)).toBe(true);
    expect(project.scenarios).toHaveLength(3);
    expect(new Set(project.scenarios!.map(scenario => modelHash(scenario.model))).size).toBe(3);
    for (const [index, scenario] of project.scenarios!.entries()) {
      expect(scenario.model.nodes.map(n => n.samplingId)).toEqual(project.model.nodes.map(n => n.samplingId));
      expect(scenario.layout).toEqual(project.layout);
      for (const asset of scenario.facility!.objects) expect(knownAssetReference(asset.assetId, asset.assetVersion)).toBe(true);
      for (const seed of [4207, 4208, 4209]) {
        const run = simulate(scenario.model, { seed }), s = run.summary;
        expect(run.status).toBe('completed'); expect(run.trace.complete).toBe(true);
        expect(s.arrivals).toBe(s.completed + s.inSystem + s.balked + s.reneged);
        if (expectedArrivals[item.id]) expect(s.arrivals).toBe(expectedArrivals[item.id]);
        for (const station of run.stations) {
          const node = scenario.model.nodes.find(n => n.id === station.nodeId)!;
          if (node.kind === 'service') expect(station.busySeconds).toBeLessThanOrEqual(node.servers * scenario.model.horizon + 1e-7);
        }
        for (const pool of run.pools) expect(pool.busyUnitSeconds).toBeLessThanOrEqual(pool.scheduledUnitSeconds + pool.overtimeUnitSeconds + 1e-7);
        const reference = references.templates[item.id][index].runs.find(r => r.seed === seed)!;
        expect(run.modelHash).toBe(reference.modelHash); expect(s).toEqual(reference.summary);
      }
    }
  });
  it('matches an independently calculated one-job workshop timeline and equal-headcount labor budget', () => {
    const p = buildStarter('workshop'), original = singleJob(p.model), shortCure = singleJob(p.scenarios![2].model);
    for (const model of [original, shortCure]) { const machine = model.nodes.find(n => n.id === 'machine')!; if (machine.kind === 'service') machine.duration = { kind: 'constant', value: 180 }; }
    // 90 preparation + 180 machining + 300/120 unattended cure + 70 finishing.
    expect(simulate(original).entities[0].endedAt).toBe(640);
    expect(simulate(shortCure).entities[0].endedAt).toBe(460);
    for (const scenario of p.scenarios!) expect(simulate(scenario.model).summary.cost).toBeCloseTo(3 * 26 * 2, 10);
  });
  it('matches the one-job slow machining path independently of queueing', () => {
    const model = singleJob(buildStarter('machining').model), route = model.nodes.find(n => n.kind === 'route')!, slow = model.nodes.find(n => n.id === 'slow')!;
    route.branches = [{ to: 'q-slow', probability: 1 }]; if (slow.kind === 'service') slow.duration = { kind: 'constant', value: 300 };
    expect(simulate(model).entities[0].endedAt).toBe(60 + 300 + 45);
  });
  it('keeps a stable rework loop with positive repair time and absorption consistent with the geometric model', () => {
    const model = buildStarter('quality').model, source = model.nodes.find(n => n.kind === 'source')!;
    model.horizon = 720_000; source.arrival = { kind: 'schedule', times: Array.from({ length: 2000 }, (_, i) => i * 300) };
    const result = simulate(model);
    expect(result.status).toBe('completed'); expect(result.summary.completed).toBe(2000);
    const inspectionVisits = result.stations.find(s => s.nodeId === 'inspect')!.started;
    // E[inspection visits] = 1/(1-.12); the tolerance exceeds five sampling standard errors.
    expect(Math.abs(inspectionVisits / 2000 - 1 / .88)).toBeLessThan(.05);
  });
  it('compares equal print-time means and equal demand counts without confusing release smoothing with capacity', () => {
    const print = buildStarter('print'), before = print.model.nodes.find(n => n.id === 'print')!, after = print.scenarios![1].model.nodes.find(n => n.id === 'print')!;
    expect(before.kind === 'service' && before.duration).toEqual({ kind: 'empirical', values: [300, 300, 600, 1200, 3600] });
    expect(after.kind === 'service' && after.duration).toEqual({ kind: 'constant', value: 6000 / 5 });
    for (const id of ['fulfillment', 'parcel'] as const) {
      const p = buildStarter(id); expect(p.scenarios![2].model.resources).toEqual(p.model.resources);
      expect(simulate(p.scenarios![2].model).summary.arrivals).toBe(simulate(p.model).summary.arrivals);
    }
  });
});

describe('bounded starter loading', () => {
  const response = (id: StarterId) => new Response(readFileSync(`public/templates/${id}.json`));
  it('loads only the selected project and returns independent identities without mutating its sampling inputs', async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async url => { urls.push(String(url)); return response('quality'); };
    const first = await loadStarter('quality', fetcher), second = await loadStarter('quality', fetcher);
    expect(urls).toHaveLength(2); expect(urls.every(url => url.includes('/templates/quality.json?v='))).toBe(true);
    expect(first.id).not.toBe(second.id); expect(first.model).toEqual(second.model); expect(first.scenarios).toEqual(second.scenarios);
    first.facility!.objects[0].x = 90; expect(first.facility).not.toEqual(second.facility);
  });
  it('rejects HTTP errors, wrong files, oversized streams and modified content', async () => {
    await expect(loadStarter('factory', async () => new Response('', { status: 404 }))).rejects.toThrow();
    await expect(loadStarter('factory', async () => response('workshop'))).rejects.toThrow();
    await expect(loadStarter('factory', async () => new Response('x'.repeat(inventory.factory.bytes + 1)))).rejects.toThrow();
    const altered = readFileSync('public/templates/factory.json', 'utf8').replace('Little Factory', 'Little Factorz');
    await expect(loadStarter('factory', async () => new Response(altered))).rejects.toThrow();
  });
  it('passes cancellation to the request and cannot produce a project after an aborted response', async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = async (_url, init) => { expect(init?.signal).toBe(controller.signal); return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); };
    const pending = loadStarter('factory', fetcher, controller.signal); controller.abort(); await expect(pending).rejects.toThrow();
  });
});
