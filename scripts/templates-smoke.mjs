// Synthetic projects and isolated browser contexts; never use a personal profile.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { dismissLearningWelcome, openPanel, runPlan, headerProjectInput, canvasDropPoint } from './ui-actions.mjs';

const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use a separate loopback QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/templates/smoke');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chromium.executablePath() } : { channel: 'chrome' }) });
const checks = [], errors = []; let page, stage = 'startup';
const state = p => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = p => p.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !document.querySelector('.studio-world-picker select')?.disabled && !s.running && (s.workspaceMode === 'layout' || s.result?.status === 'completed' && !s.result.stale); });
const art = p => p.waitForFunction(() => { const h = document.querySelector('.world-scene'), f = JSON.parse(h?.getAttribute('data-facility') || '{}'); return h?.getAttribute('data-status') === 'ready' && !f.pending && !f.failed; });
const close = p => p.getByRole('button', { name: 'Close dialog', exact: true }).click();
async function fresh(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(origin.href); await dismissLearningWelcome(p); await ready(p); return { context, page: p };
}
async function download(p, name) {
  const next = p.waitForEvent('download'); await p.locator('.studio-save').click();
  const file = await next, target = path.join(out, name); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8'));
}
async function library(p) {
  const tray = p.locator('.facility-library'); if (!await tray.isVisible()) await p.locator('[data-build-opener]').click();
  await tray.locator('.library-tabs').getByRole('button', { name: '3D models', exact: true }).click(); return tray;
}
async function saveTemplate(p, name) {
  await p.locator('.studio-world-picker select').selectOption('save');
  await p.getByRole('textbox', { name: 'Template name', exact: true }).fill(name);
  await p.getByRole('button', { name: 'Save template', exact: true }).click();
  await p.getByText(`“${name}” was saved in your template library.`, { exact: true }).waitFor();
}
async function myTemplates(p) { await p.bringToFront(); await openPanel(p, 'worlds'); await p.getByRole('button', { name: /^My templates/ }).click(); await p.getByText('Loading templates…', { exact: true }).waitFor({ state: 'detached' }); }
const row = (p, name) => p.locator('.saved-template-list > li').filter({ has: p.getByRole('heading', { name, exact: true }) });
async function overflow(p) { assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); assert(await p.locator('.modal-body').evaluate(e => e.scrollWidth <= e.clientWidth + 1)); }
async function records(p) {
  return p.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('loopset-templates', 1); request.onerror = () => reject(String(request.error));
    request.onsuccess = () => { const db = request.result, tx = db.transaction(['templates', 'summaries']), a = tx.objectStore('templates').getAll(), b = tx.objectStore('summaries').getAll(); tx.oncomplete = () => { db.close(); resolve({ templates: a.result, summaries: b.result }); }; tx.onabort = () => { db.close(); reject(String(tx.error)); }; };
  }));
}
try {
  const desktop = await fresh(); page = desktop.page;
  stage = 'blank'; await page.locator('.studio-world-picker select').selectOption('blank'); await ready(page); await art(page);
  const blank = await download(page, 'blank.json'); assert.equal(blank.workspaceMode, 'layout'); assert.deepEqual(blank.model.nodes, []); assert.deepEqual(blank.model.resources, []); assert.deepEqual(blank.facility.objects, []); assert.equal((await state(page)).result, null);
  assert(await page.locator('.studio-command-actions .studio-primary').isDisabled());
  await page.screenshot({ path: path.join(out, 'blank.png') });
  const tray = await library(page); await tray.getByRole('searchbox').fill('Dispensing system');
  const tile = tray.getByRole('button', { name: 'Dispensing system · C01', exact: true }); await tile.click();
  const canvas = page.locator('.world-scene canvas');
  // Drag the tile label with real pointer motion, avoiding the browser's native image-file drag.
  const label = await tile.locator('.library-tile-label').boundingBox(), bounds = await canvas.boundingBox(), point = await canvasDropPoint(canvas);
  assert(label && bounds);
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2); await page.mouse.down();
  await page.mouse.move(label.x + label.width / 2 + 12, label.y + label.height / 2, { steps: 4 });
  await page.mouse.move(bounds.x + point.x, bounds.y + point.y, { steps: 12 });
  await page.mouse.move(bounds.x + point.x + 1, bounds.y + point.y, { steps: 2 }); await page.mouse.up();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).facility?.objects.length === 1); await art(page);
  const placed = await download(page, 'placed-layout.json'); assert.equal(placed.facility.objects.length, 1); assert.deepEqual(placed.model, blank.model);
  checks.push('Blank starts with no objects or process; native equipment drag changes only its layout');

  stage = 'save and reload'; await saveTemplate(page, 'Synthetic workshop'); await overflow(page);
  await page.screenshot({ path: path.join(out, 'saved-template.png') });
  const saved = await records(page); assert.equal(saved.templates.length, 1); assert.equal(saved.summaries.length, 1);
  await close(page); const unchanged = await download(page, 'after-template-save.json'); assert.equal(unchanged.id, placed.id); assert.equal(unchanged.revision, placed.revision);
  await page.locator('.workspace-footer').getByText(/^Saved in this browser/).first().waitFor(); await page.reload(); await ready(page);
  const restored = await download(page, 'layout-reloaded.json'); assert.equal(restored.id, placed.id); assert.deepEqual(restored.facility, placed.facility); assert.deepEqual(restored.model.nodes, []);
  await myTemplates(page); await page.locator('.templates-panel').getByRole('button', { name: 'Save as template', exact: true }).click(); await page.locator('.template-cancel-save').click(); assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Save as template'); await row(page, 'Synthetic workshop').getByRole('button', { name: 'Use template', exact: true }).click(); await ready(page);
  const first = await download(page, 'template-instance.json'); assert.notEqual(first.id, placed.id); assert.deepEqual(first.facility, placed.facility); assert.deepEqual(first.model, placed.model);
  await page.locator('.workspace-layout-footer').getByRole('button', { name: 'Start a process', exact: true }).click();
  const started = await download(page, 'started-process.json'); assert.equal(started.model.nodes.length, 4); assert.deepEqual(started.facility, first.facility);
  await page.getByRole('button', { name: 'Undo Start a process', exact: true }).click();
  assert.equal((await state(page)).workspaceMode, 'layout');
  await page.getByRole('button', { name: 'Redo Start a process', exact: true }).click(); await runPlan(page);
  await myTemplates(page); await row(page, 'Synthetic workshop').getByRole('button', { name: 'Use template', exact: true }).click(); await ready(page);
  const second = await download(page, 'second-instance.json'); assert.notEqual(first.id, second.id); assert.deepEqual(second.model.nodes, []); assert.deepEqual(second.facility, first.facility);
  assert.deepEqual((await records(page)).templates, saved.templates);
  checks.push('Template save preserves the source; reload, fresh independent reuse, process initialization and one-step Undo/Redo work');

  stage = 'portable import'; await myTemplates(page);
  const next = page.waitForEvent('download'); await row(page, 'Synthetic workshop').getByRole('button', { name: 'Download template: Synthetic workshop', exact: true }).click();
  const templateFile = path.join(out, 'portable-template.json'); await (await next).saveAs(templateFile);
  const portable = JSON.parse(await fs.readFile(templateFile, 'utf8')); assert.notEqual(portable.id, second.id); assert.deepEqual(portable.model, second.model);
  await page.getByLabel('Choose template project JSON', { exact: true }).setInputFiles(templateFile);
  await page.getByRole('button', { name: 'Save imported template', exact: true }).waitFor(); assert.equal((await records(page)).templates.length, 1);
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Imported workshop'); await page.getByRole('button', { name: 'Save imported template', exact: true }).click();
  await page.getByText('“Imported workshop” was saved in your template library.', { exact: true }).waitFor(); assert.equal((await records(page)).templates.length, 2);
  await page.getByRole('searchbox', { name: 'Search saved templates', exact: true }).fill('Imported'); assert.equal(await page.locator('.saved-template-list > li').count(), 1);
  await row(page, 'Imported workshop').getByRole('button', { name: 'Remove template: Imported workshop', exact: true }).click(); assert.equal((await records(page)).templates.length, 2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Remove template: Imported workshop'); assert.equal((await records(page)).templates.length, 2);
  await row(page, 'Imported workshop').getByRole('button', { name: 'Remove template: Imported workshop', exact: true }).click(); await page.getByRole('button', { name: 'Remove saved template', exact: true }).click();
  await page.getByText('Template removed. Existing projects were kept.', { exact: true }).waitFor(); assert.equal((await records(page)).templates.length, 1);
  await close(page); const afterRemove = await download(page, 'after-remove.json'); assert.equal(afterRemove.id, second.id);
  const reopened = await fresh(); await headerProjectInput(reopened.page).setInputFiles(templateFile); await ready(reopened.page);
  const separate = await download(reopened.page, 'separate-reopened.json'); assert.deepEqual(separate.facility, portable.facility); assert.deepEqual(separate.model, portable.model); await reopened.context.close();
  checks.push('Actual template JSON download, reviewed import, search, cancellation/removal and separate-context project reopening preserve content');

  stage = 'examples and numerical snapshot';
  for (const world of ['factory', 'festival', 'service']) { await page.locator('.studio-world-picker select').selectOption(world); await ready(page); assert.equal((await state(page)).world, world); }
  const original = await download(page, 'service-original.json'), result = (await state(page)).result;
  await saveTemplate(page, 'Synthetic service'); await row(page, 'Synthetic service').getByRole('button', { name: 'Use template', exact: true }).click(); await ready(page);
  const reused = await download(page, 'service-reused.json'); assert.notEqual(reused.id, original.id); assert.deepEqual(reused.model, original.model); assert.deepEqual((await state(page)).result.summary, result.summary);
  checks.push('All three example worlds still calculate; a process template preserves inputs and recorded numerical outcomes');

  stage = 'storage failure'; await myTemplates(page); await page.locator('.templates-panel').getByRole('button', { name: 'Save as template', exact: true }).click(); const beforeFailure = await records(page);
  await page.evaluate(() => { window.templateOriginalAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function (...args) { if (this.name === 'templates') throw new DOMException('Synthetic quota', 'QuotaExceededError'); return window.templateOriginalAdd.apply(this, args); }; });
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Failed synthetic save'); await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Browser storage is full' }).waitFor(); assert.deepEqual(await records(page), beforeFailure);
  await page.evaluate(() => { IDBObjectStore.prototype.add = window.templateOriginalAdd; delete window.templateOriginalAdd; });
  await close(page); checks.push('A real transaction abort reports quota failure and preserves all existing template records');

  stage = 'concurrent capacity';
  await page.evaluate(record => new Promise((resolve, reject) => {
    const request = indexedDB.open('loopset-templates', 1); request.onerror = () => reject(String(request.error)); request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['templates', 'summaries'], 'readwrite');
      const count = tx.objectStore('templates').count(); count.onsuccess = () => { for (let i = count.result; i < 49; i++) { const copy = { ...record, id: `template-${crypto.randomUUID()}` }, { payload, ...meta } = copy; tx.objectStore('templates').add(copy); tx.objectStore('summaries').add(meta); } };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(String(tx.error)); };
    };
  }), saved.templates[0]);
  const other = await desktop.context.newPage(); other.on('pageerror', e => errors.push(String(e))); await other.goto(origin.href); await dismissLearningWelcome(other); await ready(other);
  await myTemplates(page); await page.locator('.templates-panel').getByRole('button', { name: 'Save as template', exact: true }).click(); await myTemplates(other); await other.locator('.templates-panel').getByRole('button', { name: 'Save as template', exact: true }).click();
  for (const [p, name] of [[page, 'Concurrent A'], [other, 'Concurrent B']]) { await p.bringToFront(); await p.getByRole('textbox', { name: 'Template name', exact: true }).fill(name); }
  // Activate the two real form handlers together; background-tab frame throttling must not serialize this transaction race.
  await Promise.all([page, other].map(p => p.getByRole('button', { name: 'Save template', exact: true }).evaluate(button => button.click())));
  await Promise.all([page, other].map(p => p.waitForFunction(() => document.querySelector('.template-status') || document.querySelector('.templates-panel [role=alert]'), undefined, { polling: 100 })));
  const capped = await records(page); assert.equal(capped.templates.length, 50); assert.equal(capped.summaries.length, 50);
  assert.equal(capped.templates.filter(item => /^Concurrent [AB]$/.test(item.name)).length, 1);
  assert.match((await page.locator('.templates-panel').innerText()) + (await other.locator('.templates-panel').innerText()), /Keep up to 50 templates/);
  await other.close(); await desktop.context.close(); checks.push('Two simultaneous saves at 49 templates commit exactly one new record and preserve the 50-template cap');

  stage = 'mobile';
  for (const width of [320, 390]) {
    const mobile = await fresh(width); page = mobile.page; await openPanel(page, 'worlds'); await overflow(page);
    await page.locator('.template-blank').click(); await ready(page); assert.equal((await state(page)).workspaceMode, 'layout');
    const mobileTray = await library(page); await mobileTray.getByRole('button', { name: 'Save as template', exact: true }).click();
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Mobile room'); await page.getByRole('button', { name: 'Save template', exact: true }).click();
    await page.getByText('“Mobile room” was saved in your template library.', { exact: true }).waitFor(); await overflow(page);
    await page.screenshot({ path: path.join(out, `mobile-${width}.png`) }); await row(page, 'Mobile room').getByRole('button', { name: 'Use template', exact: true }).click(); await ready(page);
    await mobile.context.close();
  }
  checks.push('320/390px Templates, blank start and save/reuse are reachable without horizontal overflow');
  assert.deepEqual(errors, []);
  const receipt = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), `${stage}\n${error}\n${await page.locator('body').innerText()}`); }
  console.error(stage, String(error)); process.exitCode = 1;
} finally { await browser.close(); }
