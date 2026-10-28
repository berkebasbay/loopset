import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { headerProjectInput, runPlan, canvasDropPoint } from './ui-actions.mjs';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['localhost', '127.0.0.1'].includes(origin.hostname), 'Use an isolated QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/facility-redesign/workspace');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chromium.executablePath() } : { channel: 'chrome' }) });
const checks = [], errors = [];
const state = p => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = p => p.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !document.querySelector('.studio-world-picker select')?.disabled && !s.running && s.result?.status === 'completed' && !s.result.stale; });
async function artwork(p) { await p.waitForFunction(() => { const e = document.querySelector('.world-scene'), s = JSON.parse(e?.getAttribute('data-facility') || '{}'); return e?.getAttribute('data-status') === 'ready' && s.pending === 0 && s.failed === 0; }); }
async function fresh(width) { const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true }); const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e))); await page.goto(origin.href); await ready(page); await artwork(page); const pause = page.getByRole('button', { name: 'Pause replay', exact: true }); if (await pause.count()) await pause.click(); return { context, page }; }
async function download(p, name) { const next = p.waitForEvent('download'); await p.locator('.studio-save').click(); const file = await next, target = path.join(out, name); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8')); }
async function findModel(p) { const tray = p.locator('.facility-library'); if (!await tray.isVisible()) await p.locator('[data-build-opener]').click(); await tray.locator('.library-tabs').getByRole('button', { name: '3D models', exact: true }).click(); await tray.getByRole('searchbox', { name: 'Search equipment and objects', exact: true }).fill('Dispensing system'); const tile = tray.getByRole('button', { name: 'Dispensing system · C01', exact: true }); await tile.click(); return { tray, tile }; }
let page;
try {
  const desktop = await fresh(1440); page = desktop.page;
  const initial = await download(page, 'initial-workshop.json'), before = await state(page);
  assert.equal(initial.facility.objects.length, 57); assert(await page.locator('.facility-library').isVisible());
  const panel = await page.locator('.studio-library-dock').boundingBox(), canvasBounds = await page.locator('.studio-canvas').boundingBox(); assert(panel.x + panel.width <= canvasBounds.x + 1, 'The library must own space instead of covering the working canvas.');
  const requests = []; page.on('request', r => requests.push(r.url()));
  const { tray, tile } = await findModel(page); assert.equal(await tray.getByLabel('Use as', { exact: true }).inputValue(), 'visual');
  assert.equal(requests.filter(url => /\.glb(?:\?|$)/.test(url)).length, 0, 'Searching/selecting catalogue metadata must not fetch models.');
  const primary = await tray.getByRole('button', { name: 'Place object', exact: true }).boundingBox(), dock = await tray.boundingBox();
  assert(primary.y >= dock.y && primary.y + primary.height <= dock.y + dock.height, 'The placement action must remain inside the visible dock.');
  const foot = await tray.locator('.library-footnote').boundingBox(); assert(foot.y + foot.height <= dock.y + dock.height + 1, 'Project limits must not be clipped below the panel.');
  await page.screenshot({ path: path.join(out, '01-browse.png') });
  const canvas = page.locator('.world-scene canvas'); await tile.dragTo(canvas, { targetPosition: await canvasDropPoint(canvas) }); await artwork(page);
  const placed = await download(page, 'placed-equipment.json'); assert.equal(placed.facility.objects.length, 58); assert.deepEqual(placed.model, initial.model); assert.equal((await state(page)).result.hash, before.result.hash);
  assert(await tray.isVisible(), 'The desktop library stays available for repeated building.');
  await page.screenshot({ path: path.join(out, '02-placed.png') }); checks.push('Fresh workshop, persistent dock, visible placement/limits, metadata-only browse and equipment drag defaults to visual placement');
  await page.locator('.facility-object-browser summary').click();
  await page.getByRole('searchbox', { name: 'Find a placed object', exact: true }).fill('Back wall 1');
  await page.locator('.facility-object-list').getByRole('button', { name: 'Back wall 1', exact: true }).press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-facility-heading]') && document.activeElement.textContent === 'Back wall 1');
  checks.push('Keyboard selection in the bounded placed-object browser keeps focus on the selected object heading');
  await tray.getByLabel('Use as', { exact: true }).selectOption('process'); await tray.getByLabel('Processing time (seconds)', { exact: true }).fill('75'); await tray.getByLabel('Team for this cell', { exact: true }).selectOption('none');
  await tray.getByRole('button', { name: 'Add processing step', exact: true }).click();
  const process = await download(page, 'explicit-process.json'); assert.equal(process.model.nodes.length, initial.model.nodes.length + 1); assert.equal(process.facility.objects.length, 58); assert.equal(process.model.resources.length, initial.model.resources.length);
  await runPlan(page); checks.push('Equipment becomes a numerical step only after explicit mode/time/team choice and the changed plan calculates');
  await tray.getByRole('button', { name: 'Close asset library', exact: true }).click();
  await page.locator('.facility-workflow-tools').getByRole('button', { name: 'Tools', exact: true }).click(); assert(await page.getByRole('button', { name: /Model editor/ }).isVisible()); checks.push('Advanced professional tools remain accessible from the new navigation');
  await page.reload(); await ready(page);
  const restored = await download(page, 'restored-after-reload.json'); assert.deepEqual(restored.model, process.model); assert.deepEqual(restored.facility, process.facility);
  checks.push('Existing saved facility survives the new startup experience and a real reload');
  const manifest = JSON.parse(await fs.readFile('public/assets/facility/manifest.json', 'utf8')), box = manifest.assets.find(a => a.id === 'box_corrugated_brown_b08');
  const limited = structuredClone(initial); limited.id = 'synthetic-placement-limit'; limited.name = 'Synthetic long facility title '.repeat(6).slice(0, 160);
  limited.facility.objects = Array.from({ length: 500 }, (_, i) => ({ id: `fixture-${i}`, name: `Synthetic carton ${i}`, assetId: box.id, assetVersion: box.version, x: -36 + i % 25 * 3, z: -28 + Math.floor(i / 25) * 3, y: 0, rotation: 0, scale: 1 }));
  await headerProjectInput(page).setInputFiles({ name: 'synthetic-limit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(limited)) }); await ready(page); await artwork(page);
  const limitChoice = await findModel(page); assert(await limitChoice.tray.getByRole('button', { name: 'Place object', exact: true }).isDisabled());
  assert.match(await limitChoice.tray.locator('.library-footnote').innerText(), /500 placed objects/);
  assert(await limitChoice.tray.getByRole('searchbox').isEnabled());
  const title = page.locator('.quality-world-brief p'), titleRect = await title.boundingBox(), toolbarRect = await page.locator('.facility-canvas-tools').boundingBox(); assert.equal(await title.getAttribute('title'), limited.name); assert(titleRect.y + titleRect.height < toolbarRect.y);
  checks.push('A full 500-object facility renders and explains its placement limit while the catalogue stays browsable; long titles stay clear of tools');
  const teams = structuredClone(limited); teams.id = 'synthetic-team-limit';
  for (let i = teams.model.resources.length; i < 50; i++) teams.model.resources.push({ id: `fixture-team-${i}`, label: `Synthetic team ${i}`, installedCapacity: 1, capacity: 1, costPerHour: 0, overtimeCostPerHour: 0, calendar: [] });
  await headerProjectInput(page).setInputFiles({ name: 'synthetic-teams.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(teams)) }); await ready(page);
  const teamChoice = await findModel(page); await teamChoice.tray.getByLabel('Use as', { exact: true }).selectOption('process');
  assert(await teamChoice.tray.getByRole('button', { name: 'Add processing step', exact: true }).isDisabled()); assert.equal(await teamChoice.tile.getAttribute('draggable'), 'false');
  assert.match(await teamChoice.tray.locator('.library-footnote').innerText(), /50 teams/);
  await teamChoice.tray.getByLabel('Team for this cell', { exact: true }).selectOption('none'); assert(await teamChoice.tray.getByRole('button', { name: 'Add processing step', exact: true }).isEnabled()); assert.equal(await teamChoice.tile.getAttribute('draggable'), 'true');
  checks.push('Team, numerical-step and placed-object limits remain separate, with matching button and drag guards');
  await desktop.context.close();
  const mobile = await fresh(390); page = mobile.page;
  const mobileInitial = await download(page, 'mobile-initial.json'); const choice = await findModel(page);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile workspace must not overflow horizontally.');
  const mobilePrimary = choice.tray.getByRole('button', { name: 'Place object', exact: true }); await mobilePrimary.click();
  const elevation = page.getByRole('spinbutton', { name: 'Elevation', exact: true }); await elevation.fill('1.2'); await elevation.press('Enter');
  const mobilePlaced = await download(page, 'mobile-placed.json'); assert.equal(mobilePlaced.facility.objects.length, 58); assert.equal(mobilePlaced.facility.objects.at(-1).y, 1.2); assert.deepEqual(mobilePlaced.model, mobileInitial.model);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('.facility-object-browser').getAttribute('open'), null);
  await page.screenshot({ path: path.join(out, '03-mobile.png'), fullPage: true });
  checks.push('Narrow-screen library, explicit visual placement and precise inspector edits work without horizontal overflow'); await mobile.context.close();
  assert.deepEqual(errors, []);
  const result = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} catch (e) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), String(e) + '\n' + await page.locator('body').innerText()); } console.error(String(e)); process.exitCode = 1; }
finally { await browser.close(); }
