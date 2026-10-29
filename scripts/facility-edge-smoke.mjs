import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dismissLearningWelcome, headerProjectInput, runPlan } from './ui-actions.mjs';

const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['localhost', '127.0.0.1'].includes(origin.hostname));
const phase = process.env.QUEUELAB_FACILITY_PHASE || 'all';
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/facility-builder/edges');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chromium.executablePath() } : { channel: 'chrome' }) });
const errors = [], checks = [], profiles = [];
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = page => page.waitForFunction(() => { const state = JSON.parse(window.render_game_to_text?.() || '{}'); return !document.querySelector('.studio-world-picker select')?.disabled && !state.running && state.result?.status === 'completed' && !state.result.stale; });
async function fresh(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin.href); await dismissLearningWelcome(page); await ready(page);
  // Use the original numerical fixture for these compatibility checks.
  if (width > 740) { await page.locator('.studio-world-picker select').selectOption('factory'); await ready(page); }
  const pause = page.getByRole('button', { name: 'Pause replay', exact: true }); if (await pause.count()) await pause.click();
  return { context, page };
}
async function download(page, name) {
  const pending = page.waitForEvent('download'); await page.locator('.studio-save').click(); const file = await pending;
  const target = path.join(out, name); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8'));
}
async function openLibrary(page) {
  if (!await page.locator('.facility-library').isVisible()) await page.locator('[data-build-opener]').click();
  return page.locator('.facility-library');
}
async function search(page, query) {
  const tray = await openLibrary(page); await tray.locator('.library-tabs').getByRole('button', { name: '3D models', exact: true }).click();
  await tray.locator('.library-category select').selectOption(''); await tray.getByRole('searchbox', { name: 'Search equipment and objects', exact: true }).fill(query); return tray;
}
async function importProject(page, project) {
  await headerProjectInput(page).setInputFiles({ name: 'synthetic-facility.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const current = await state(page); if (current.result?.stale || !current.result) await runPlan(page); await ready(page);
}
let currentPage;
try {
  if (phase === 'all' || phase === 'showcase') {
    const { context, page } = await fresh(); currentPage = page;
    const tray = await openLibrary(page); await tray.getByRole('button', { name: 'Templates', exact: true }).click(); await page.locator('[data-starter-id=workshop]').click(); await page.getByRole('button', { name: 'Open this template', exact: true }).click(); await ready(page);
    await page.waitForFunction(() => document.querySelector('.world-scene')?.getAttribute('data-status') === 'ready');
    const project = await download(page, 'workshop-example.json'), expected = JSON.parse(await fs.readFile('public/templates/workshop.json', 'utf8')); assert.deepEqual(project.facility, expected.facility); assert.deepEqual(project.model, expected.model); assert.notEqual(project.id, expected.id); assert.equal(project.facility.scenery, false);
    await page.screenshot({ path: path.join(out, 'workshop-example.png') }); checks.push('Previewed attributed workshop template opens, calculates and renders a complete editable facility'); await context.close();
  }
  if (phase === 'all' || phase === 'mapping') {
    const { context, page } = await fresh(); currentPage = page;
    const project = await download(page, 'mapping-original.json'); project.id = 'synthetic-drop-mapping'; project.name = 'Synthetic process drop';
    const services = project.model.nodes.filter(node => node.kind === 'service'); for (const node of services) node.servers = 1; services[0].servers = 2;
    for (const node of project.model.nodes) project.layout[node.id] = { x: node.kind === 'sink' ? 10 : 0, z: node.kind === 'source' ? -8 : node.kind === 'queue' ? -4 : 0 };
    await importProject(page, project);
    await page.waitForFunction(() => document.querySelector('.world-scene')?.getAttribute('data-status') === 'ready');
    const tray = await search(page, 'Workbench standard');
    const tile = tray.getByRole('button', { name: 'Workbench standard · E01', exact: true }); await tile.click();
    await tray.getByLabel('Use as', { exact: true }).selectOption('process');
    const snapshot = JSON.parse(await page.locator('.world-scene').getAttribute('data-camera'));
    const camera = new THREE.OrthographicCamera(snapshot.left, snapshot.right, snapshot.top, snapshot.bottom, .1, 3000);
    camera.position.fromArray(snapshot.position); camera.lookAt(new THREE.Vector3().fromArray(snapshot.target)); camera.zoom = snapshot.zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const point = new THREE.Vector3(5, 0, 8).project(camera), canvas = page.locator('.world-scene canvas'), bounds = await canvas.boundingBox();
    const target = { x: (point.x + 1) * bounds.width / 2, y: (1 - point.y) * bounds.height / 2 };
    assert(target.x > 0 && target.x < bounds.width && target.y > 0 && target.y < bounds.height, 'Synthetic target must be on the actual canvas.');
    await tile.dragTo(canvas, { targetPosition: target });
    await page.waitForFunction(count => JSON.parse(window.render_game_to_text()).model.length === count + 1, services.length);
    const placed = await download(page, 'mapping-placed.json'), oldIds = new Set(project.model.nodes.map(node => node.id));
    const added = placed.model.nodes.filter(node => !oldIds.has(node.id)); assert.equal(added.length, 1);
    // Independent reference for this two-knot case: new visual x = model x + 1.8.
    assert(Math.abs(placed.layout[added[0].id].x - 3.2) < 1e-6); assert.equal(placed.layout[added[0].id].z, 8);
    await page.screenshot({ path: path.join(out, 'mapping.png') }); checks.push('Real process drag/drop honours candidate-layout coordinates with parallel stations'); await context.close();
  }
  if (phase === 'all' || phase === 'mobile') {
    const { context, page } = await fresh(390); currentPage = page;
    const tray = await search(page, 'Shelf basic'); await tray.getByRole('button', { name: 'Shelf basic · A01', exact: true }).click();
    await tray.getByRole('button', { name: 'Place object', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Elevation', exact: true }).fill('1.2'); await page.getByRole('spinbutton', { name: 'Elevation', exact: true }).press('Enter');
    const mobile = await download(page, 'mobile.json'); assert.equal(mobile.facility.objects.at(-1).y, 1.2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Facility controls must not create horizontal page overflow.');
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true }); checks.push('Narrow-screen catalogue, DOM placement and precise numeric elevation'); await context.close();
  }
  if (phase === 'all' || phase === 'quota') {
    const { context, page } = await fresh(); currentPage = page;
    const project = await download(page, 'quota-base.json'); project.id = 'synthetic-node-quota';
    const sink = project.model.nodes.find(node => node.kind === 'sink'), previous = project.model.nodes.find(node => 'next' in node && node.next === sink.id);
    const count = 100 - project.model.nodes.length; previous.next = 'quota-delay-0';
    for (let i = 0; i < count; i++) {
      project.model.nodes.push({ id: `quota-delay-${i}`, samplingId: `quota-sample-${i}`, label: `Synthetic delay ${i + 1}`, kind: 'delay', next: i + 1 < count ? `quota-delay-${i + 1}` : sink.id, duration: { kind: 'constant', value: 1 } });
      project.layout[`quota-delay-${i}`] = { x: -10 + i % 10 * 2, z: 10 + Math.floor(i / 10) * 2 };
    }
    await importProject(page, project);
    const tray = await search(page, 'Shelf basic'); await tray.getByRole('button', { name: 'Shelf basic · A01', exact: true }).click();
    assert(await tray.getByRole('button', { name: 'Place object', exact: true }).isEnabled());
    await tray.locator('.library-options summary').click();
    assert(await tray.getByRole('button', { name: 'Use on selected step', exact: true }).isEnabled());
    await tray.getByRole('button', { name: 'Place object', exact: true }).click();
    const placed = await download(page, 'quota-visual.json'); assert.equal(placed.model.nodes.length, 100); assert.equal(placed.facility.objects.length, 1); assert.deepEqual(placed.model, project.model);
    checks.push('Full numerical node quota still permits independent visual placement and appearance edits'); await context.close();
  }
  if (phase === 'all' || phase === 'context') {
    const { context, page } = await fresh(); currentPage = page;
    await page.waitForFunction(() => document.querySelector('.world-scene')?.getAttribute('data-status') === 'ready');
    const before = await download(page, 'context-before.json');
    const supported = await page.locator('.world-scene canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'), extension = gl.getExtension('WEBGL_lose_context'); if (!extension) return false; extension.loseContext(); return true; });
    assert(supported, 'This synthetic context must support a scoped WebGL-loss test.');
    await page.locator('.scene-asset-warning').waitFor(); await page.locator('.scene-asset-warning button').click();
    await page.waitForFunction(() => document.querySelector('.world-scene')?.getAttribute('data-status') === 'ready');
    const after = await download(page, 'context-after.json'); assert.deepEqual(after.model, before.model); assert.deepEqual(after.facility, before.facility); assert.equal(after.revision, before.revision);
    checks.push('Scoped WebGL context loss and Retry rebuild rendering without changing the project'); await context.close();
  }
  if (phase === 'all' || phase === 'guards') {
    const { context, page } = await fresh(); currentPage = page;
    await page.waitForFunction(() => document.querySelector('.world-scene')?.getAttribute('data-status') === 'ready');
    await context.route('**/assets/facility/water_cooler_a01.glb', route => route.abort('failed'));
    let tray = await search(page, 'Water cooler'); await tray.getByRole('button', { name: 'Water cooler · A01', exact: true }).click();
    await tray.getByRole('button', { name: 'Place object', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('.world-scene').dataset.facility).failed === 1);
    const failed = await download(page, 'failed-art-preserved.json'); assert.equal(failed.facility.objects.length, 1);
    await page.getByRole('button', { name: 'Remove object', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.scene-asset-warning'));
    assert.equal((await download(page, 'failed-art-removed.json')).facility.objects.length, 0);
    await context.unroute('**/assets/facility/water_cooler_a01.glb');
    let release; const held = new Promise(resolve => { release = resolve; });
    await context.route('**/assets/facility/water_cooler_a01.glb', async route => { await held; await route.continue(); });
    tray = await search(page, 'Water cooler'); await tray.getByRole('button', { name: 'Water cooler · A01', exact: true }).click();
    await tray.getByRole('button', { name: 'Place object', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('.world-scene').dataset.facility).pending === 1);
    await page.getByRole('button', { name: 'Remove object', exact: true }).click();
    const response = page.waitForResponse(response => response.url().endsWith('/water_cooler_a01.glb') && response.status() === 200);
    release(); await (await response).finished(); await page.waitForTimeout(1000);
    const after = await download(page, 'late-art-no-ghost.json'); assert.equal(after.facility.objects.length, 0);
    await page.screenshot({ path: path.join(out, 'late-art.png') }); checks.push('Failed artwork preserves data, removal clears warnings, delayed completion cannot recreate deleted objects'); await context.close();
  }
  if (phase === 'all' || phase === 'profiles') {
    const manifest = JSON.parse(await fs.readFile('dist/assets/facility/manifest.json', 'utf8'));
    const bench = manifest.assets.find(asset => asset.id === 'furniture_workbench_standard_e01');
    for (const [name, assets] of [['repeated', Array(100).fill(bench)], ['mixed', manifest.assets.filter(asset => asset.category !== 'structure').slice(0, 32)]]) {
      const { context, page } = await fresh(); currentPage = page;
      const project = await download(page, `${name}-base.json`), original = await state(page);
      project.id = `synthetic-${name}-facility`; project.facility = { version: 1, scenery: false, nodeAssets: {}, objects: assets.map((asset, i) => ({ id: `fixture-${i}`, name: `Synthetic object ${i}`, assetId: asset.id, assetVersion: asset.version, x: -18 + i % 10 * 4, z: 9 + Math.floor(i / 10) * 4, y: 0, rotation: i % 4 * 90, scale: 1 })) };
      await importProject(page, project);
      await page.waitForFunction(count => { const host = document.querySelector('.world-scene'), state = JSON.parse(host?.getAttribute('data-facility') || '{}'); return state.objects === count && !state.pending && !state.failed && host.getAttribute('data-status') === 'ready'; }, assets.length);
      const current = await state(page); assert.deepEqual(current.result.summary, original.result.summary);
      const stats = await page.locator('.world-scene').evaluate(host => ({ facility: JSON.parse(host.dataset.facility), cache: JSON.parse(host.dataset.assetCache), renderer: JSON.parse(host.dataset.rendererResources) }));
      if (name === 'repeated') assert(stats.facility.uniqueModels === 1 && stats.renderer.calls < 200, 'Repeated objects must use shared instanced drawing.');
      assert(stats.cache.estimatedBytes <= 304 * 1024 * 1024); assert.equal(stats.facility.failed, 0);
      profiles.push({ name, objects: assets.length, ...stats }); await page.screenshot({ path: path.join(out, `${name}.png`) }); await context.close();
    }
    checks.push('Repeated/mixed synthetic facilities preserve results and bounded shared model resources');
  }
  assert.deepEqual(errors, []);
  const receipt = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), phase, checks, profiles, errors };
  await fs.writeFile(path.join(out, `receipt-${phase}.json`), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) { await currentPage.screenshot({ path: path.join(out, `failure-${phase}.png`) }).catch(() => {}); await fs.writeFile(path.join(out, `failure-${phase}.txt`), String(error) + '\n' + await currentPage.locator('body').innerText()); }
  console.error(String(error)); process.exitCode = 1;
} finally { await browser.close(); }
