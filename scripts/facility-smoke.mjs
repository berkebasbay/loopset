// Real browser interactions using synthetic projects and isolated contexts only.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { headerProjectInput, openPanel, runPlan, canvasDropPoint } from './ui-actions.mjs';

const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use a separate loopback QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/facility-builder/smoke');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
const executable = chromium.executablePath();
let installed = true; try { await fs.access(executable); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(process.env.QUEUELAB_SYSTEM_CHROME || !installed ? { channel: 'chrome' } : { executablePath: executable }) });
const errors = [], checks = [];
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = page => page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !s.running && s.result?.status === 'completed' && !s.result.stale; });
async function fresh(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin.href); await ready(page);
  // Use the original numerical fixture for these compatibility checks.
  await page.locator('.studio-world-picker select').selectOption('factory'); await ready(page);
  const pause = page.getByRole('button', { name: 'Pause replay', exact: true }); if (await pause.count()) await pause.click();
  return { context, page };
}
async function download(page, name) {
  const pending = page.waitForEvent('download'); await page.locator('.studio-save').click();
  const file = await pending, target = path.join(out, name); await file.saveAs(target);
  return JSON.parse(await fs.readFile(target, 'utf8'));
}
async function field(page, name, value) {
  const input = page.getByRole('spinbutton', { name, exact: true }); await input.fill(String(value)); await input.press('Enter');
}
async function library(page) {
  const section = page.locator('.facility-library');
  if (!await section.isVisible()) await page.locator('[data-build-opener]').click();
  return section;
}
let page;
try {
  const first = await fresh(); page = first.page;
  const original = await download(page, 'original.json'), baseline = await state(page);
  await page.screenshot({ path: path.join(out, '01-start.png') });
  const tray = await library(page); await tray.locator('.library-tabs').getByRole('button', { name: '3D models', exact: true }).click();
  await page.screenshot({ path: path.join(out, '02-library.png') });
  await tray.locator('.library-category select').selectOption('storage');
  await tray.getByRole('searchbox', { name: 'Search equipment and objects', exact: true }).fill('Shelf basic');
  await tray.getByRole('button', { name: 'Shelf basic · A01', exact: true }).click();
  await page.screenshot({ path: path.join(out, '03-choice.png') });
  await tray.getByRole('button', { name: 'Place object', exact: true }).click();
  await field(page, 'Rotation (degrees)', 90); await field(page, 'Scale', 2); await field(page, 'Elevation', 1.2);
  await page.waitForFunction(() => { const s = JSON.parse(document.querySelector('.world-scene')?.getAttribute('data-facility') || '{}'); return s.objects === 1 && !s.pending; });
  const placed = await download(page, 'placed.json');
  assert.equal(placed.facility.objects.length, 1); assert.equal(placed.facility.objects[0].rotation, 90); assert.equal(placed.facility.objects[0].scale, 2); assert.equal(placed.facility.objects[0].y, 1.2);
  assert.deepEqual(placed.model, original.model); assert.equal((await state(page)).result.hash, baseline.result.hash); assert.equal((await state(page)).result.stale, false);
  await page.screenshot({ path: path.join(out, '04-placed.png') }); checks.push('Real placement, transform, download and unchanged numerical snapshot');
  if (!process.argv.includes('--capture')) {
    await page.getByRole('button', { name: 'Duplicate object', exact: true }).click();
    assert.equal((await download(page, 'duplicate.json')).facility.objects.length, 2);
    await page.getByRole('button', { name: 'Remove object', exact: true }).click();
    assert.equal((await download(page, 'removed.json')).facility.objects.length, 1);
    await page.getByRole('button', { name: /^Undo / }).click(); assert.equal((await download(page, 'undo-remove.json')).facility.objects.length, 2);
    await page.getByRole('button', { name: /^Redo / }).click(); assert.equal((await download(page, 'redo-remove.json')).facility.objects.length, 1);
    checks.push('Object duplication/removal and logical Undo/Redo');
    await library(page); await tray.locator('.library-tabs').getByRole('button', { name: '3D models', exact: true }).click();
    await tray.getByRole('searchbox', { name: 'Search equipment and objects', exact: true }).fill('Rack bulk storage');
    const rack = tray.getByRole('button', { name: 'Rack bulk storage · A03', exact: true });
    const canvas = page.locator('.world-scene canvas');
    await rack.dragTo(canvas, { targetPosition: await canvasDropPoint(canvas) });
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).facility?.objects.length === 2);
    const dragged = await download(page, 'dragged.json'); assert.equal(dragged.facility.objects.length, 2); assert.deepEqual(dragged.model, original.model);
    checks.push('Native HTML drag/drop from the library onto the actual camera plane');
    await library(page); await tray.locator('.library-tabs').getByRole('button', { name: 'Process cells', exact: true }).click();
    await tray.getByRole('button', { name: 'Inspection cell', exact: true }).click();
    await tray.getByRole('button', { name: 'Add process cell', exact: true }).click();
    const cell = await download(page, 'cell.json'); assert.equal(cell.model.nodes.length, original.model.nodes.length + 2); assert.equal(cell.model.resources.length, original.model.resources.length + 1);
    await tray.getByRole('button', { name: 'Close asset library', exact: true }).click(); await runPlan(page);
    await openPanel(page, 'compare'); await page.getByRole('textbox', { name: 'Scenario name', exact: true }).fill('Original facility'); await page.getByRole('button', { name: 'Save baseline', exact: true }).click(); await page.getByRole('textbox', { name: 'Scenario name', exact: true }).fill('Synthetic facility'); await page.getByRole('button', { name: 'Save current plan', exact: true }).click(); await page.keyboard.press('Escape');
    const portable = await download(page, 'portable.json'); assert.deepEqual(portable.scenarios.at(-1).facility, portable.facility); assert.equal(portable.scenarios.find(s => s.name === 'Original facility').facility, undefined); checks.push('Functional cell, explicit team, real calculation/comparison and facility scenario');
    const reopened = await fresh();
    await headerProjectInput(reopened.page).setInputFiles({ name: 'portable.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) }); await ready(reopened.page);
    const actual = await download(reopened.page, 'reopened.json'); assert.deepEqual(actual.facility, portable.facility); assert.deepEqual(actual.model, portable.model); assert.deepEqual(actual.scenarios, portable.scenarios);
    await reopened.page.screenshot({ path: path.join(out, '05-reopened.png') }); await reopened.context.close(); checks.push('Actual project JSON review/reopen in a separate fresh browser context');
    for (const world of ['festival', 'service']) {
      await page.locator('.studio-world-picker select').selectOption(world); await ready(page);
      const next = await download(page, `${world}.json`); assert.equal(next.world, world); assert.equal((await state(page)).result.status, 'completed');
    }
    checks.push('Existing Festival and Service worlds still calculate');
  }
  assert.deepEqual(errors, []);
  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  const receipt = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), scripts, checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), String(error) + '\n' + await page.locator('body').innerText()); }
  console.error(String(error)); process.exitCode = 1;
} finally { await browser.close(); }
