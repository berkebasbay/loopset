// Synthetic browser checks; never use an owner's browser profile or projects.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { dismissLearningWelcome, openPanel, runPlan } from './ui-actions.mjs';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use a separate loopback QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/learning');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(process.env.QUEUELAB_SYSTEM_CHROME || !installed ? { channel: 'chrome' } : { executablePath: chromium.executablePath() }) });
const scope = process.env.QUEUELAB_LEARNING_SCOPE || 'all';
assert(['all', 'flows', 'edges'].includes(scope));
const checks = [], errors = []; let page, phase = 'first visit';
const state = p => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = p => p.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !s.running && s.result?.status === 'completed'; });
const coach = p => p.locator('.learning-coach');
const stage = (p, name) => p.locator(`[data-learning-stage="${name}"]`).waitFor();
const cap = p => p.locator('[data-learning-target="capacity-specialists"] input');
const saved = p => p.locator('.workspace-footer').getByText(/^Saved in this browser/).first().waitFor();
async function fresh(width = 1440, skip = false) {
  const context = await browser.newContext({ viewport: { width, height: width > 740 ? 1000 : 844 }, reducedMotion: 'reduce', acceptDownloads: true });
  const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e))); await p.goto(origin.href); await ready(p);
  if (skip) await dismissLearningWelcome(p); return { context, page: p };
}
async function start(p) {
  if (!await p.locator('[data-panel=learn]').count()) await p.getByRole('button', { name: 'Learn by doing', exact: true }).click();
  await p.getByRole('button', { name: 'Start my first experiment', exact: true }).click(); await stage(p, 'select');
}
async function change(p) {
  await coach(p).getByRole('button', { name: 'Open the Steps list', exact: true }).click();
  await p.locator('[data-learning-target="step-station-b"]').press('Enter'); await stage(p, 'edit');
  await p.getByRole('button', { name: 'Show the team setting', exact: true }).click();
  await cap(p).fill('3'); await cap(p).press('Enter'); await stage(p, 'run');
}
async function compare(p) {
  await coach(p).getByRole('button', { name: 'Run & compare', exact: true }).press('Enter');
  await p.locator('[data-panel=compare] [data-learning-stage=review]').waitFor();
}
async function keep(p) { await p.getByRole('button', { name: 'Keep this version', exact: true }).click(); await stage(p, 'save'); }
async function download(p, name) {
  const next = p.waitForEvent('download'); await p.locator('.studio-save').click(); const file = await next, target = path.join(out, `${name}.json`); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8'));
}
async function overflow(p) {
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const body = p.locator('.modal-body'); if (await body.count()) assert(await body.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
}
try {
  for (const width of scope === 'edges' ? [] : [1440, 390, 320]) {
    phase = `full exercise ${width}`; const c = await fresh(width); page = c.page;
    await page.locator('[data-panel=learn]').waitFor(); await page.locator('.learning-intro img').evaluate(img => img.decode()); await overflow(page);
    // Native modal keyboard containment before starting the lesson.
    for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')))); }
    await page.screenshot({ path: path.join(out, `welcome-${width}.png`) }); await start(page);
    const initial = await download(page, `practice-${width}`); assert.equal(initial.world, 'service'); assert.equal(initial.name, 'My first experiment');
    assert.deepEqual(initial.model, JSON.parse(await fs.readFile('public/templates/service.json', 'utf8')).model);
    await page.getByRole('button', { name: 'Minimize guide', exact: true }).click();
    assert(await page.locator('[data-learning-resume]').evaluate(el => el === document.activeElement));
    await page.locator('[data-learning-resume]').press('Enter'); await stage(page, 'select');
    await coach(page).getByRole('button', { name: 'Open the Steps list', exact: true }).click();
    await page.locator('[data-learning-target="step-station-b"]').press('Enter'); await stage(page, 'edit');
    await page.getByRole('button', { name: 'Show the team setting', exact: true }).click();
    assert.match(await cap(page).getAttribute('aria-describedby'), /-help learning-instruction$/);
    assert(await page.locator('.learning-field-hint').isVisible()); await overflow(page);
    await page.screenshot({ path: path.join(out, `edit-${width}.png`) });
    await cap(page).fill('invalid'); assert.equal(await coach(page).getAttribute('data-learning-stage'), 'edit');
    assert(await page.locator('[data-learning-target=run]').isDisabled()); await cap(page).press('Escape');
    await cap(page).fill('3'); await cap(page).press('Enter'); await stage(page, 'run');
    const changed = await download(page, `changed-${width}`);
    const expected = structuredClone(initial.model); expected.resources.find(pool => pool.id === 'specialists').capacity = 3;
    assert.deepEqual(changed.model, expected); assert.equal(changed.id, initial.id);
    await compare(page); assert.equal((await state(page)).result.stale, false); await overflow(page);
    await page.screenshot({ path: path.join(out, `review-${width}.png`) }); await keep(page);
    await page.locator('.template-save input').fill('My trained team'); await page.locator('.template-save button[type=submit]').press('Enter'); await stage(page, 'complete');
    assert.match(await page.locator('.learning-saved').innerText(), /Template saved: My trained team/);
    await page.locator('[data-template-id]').first().waitFor(); assert.equal(await page.locator('[data-template-id]').count(), 1); await overflow(page);
    await coach(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, `complete-${width}.png`) });
    assert.equal(await coach(page).evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.getByRole('button', { name: 'Explore this project', exact: true }).click(); await saved(page);
    await page.reload(); await ready(page); assert.equal(await page.locator('[data-panel=learn],.learning-coach').count(), 0);
    assert.deepEqual((await download(page, `reopened-${width}`)).model, changed.model);
    await openPanel(page, 'worlds'); await page.getByRole('button', { name: /^My templates/ }).click(); await page.locator('[data-template-id]').first().waitFor(); assert.equal(await page.locator('[data-template-id]').count(), 1);
    await c.context.close(); checks.push(`${width}px: five real steps, pending-field guard, keyboard/focus, native persisted template, reload and reduced motion`);
  }
  if (scope !== 'flows') {
  phase = 'resume and optional completion'; {
    const c = await fresh(); page = c.page; await start(page); await change(page); await saved(page); const before = await download(page, 'before-refresh');
    await page.reload(); await stage(page, 'run'); assert.deepEqual((await download(page, 'after-refresh')).model, before.model);
    assert.equal((await state(page)).result.stale, true); await compare(page); await keep(page);
    await page.getByRole('button', { name: 'Finish without saving a template', exact: true }).click(); await stage(page, 'complete');
    assert.match(await page.locator('.learning-saved').innerText(), /No template was saved/); await c.context.close();
    checks.push('Refresh resumes the preserved changed model and requires a real rerun; optional finish makes no saved-template claim');
  }
  phase = 'original project and history'; {
    const c = await fresh(1440, true); page = c.page;
    await page.locator('.studio-world-picker select').selectOption('service'); await ready(page);
    await page.locator('.facility-canvas-tools').getByRole('button', { name: 'Steps', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect Specialists', exact: true }).click();
    await cap(page).fill('4'); await cap(page).press('Enter'); await runPlan(page); await saved(page);
    const before = await download(page, 'original-custom'), beforeState = await state(page);
    const undoLabel = await page.getByRole('button', { name: /^Undo / }).getAttribute('aria-label');
    await page.evaluate(() => { const transaction = IDBDatabase.prototype.transaction; window.restoreProjectWrites = () => { IDBDatabase.prototype.transaction = transaction; }; IDBDatabase.prototype.transaction = function (...args) { if (this.name === 'queuelab-projects' && args[1] === 'readwrite') throw new DOMException('Synthetic storage failure', 'QuotaExceededError'); return transaction.apply(this, args); }; });
    await page.getByRole('button', { name: 'Learn by doing', exact: true }).click(); await page.getByRole('button', { name: 'Start my first experiment', exact: true }).click();
    await page.locator('.learning-intro [role=alert]').filter({ hasText: 'Your current work could not be saved' }).waitFor();
    assert.equal(await coach(page).count(), 0); assert.deepEqual((await state(page)).model, beforeState.model);
    await page.evaluate(() => window.restoreProjectWrites());
    await start(page); await page.getByRole('button', { name: 'Back to my previous project', exact: true }).click(); await ready(page);
    const returned = await download(page, 'returned-custom'); assert.equal(returned.id, before.id); assert.deepEqual(returned.model, before.model);
    assert.deepEqual((await state(page)).result, beforeState.result); assert.equal(await page.getByRole('button', { name: /^Undo / }).getAttribute('aria-label'), undoLabel);
    await page.getByRole('button', { name: /^Undo / }).click(); assert.equal((await download(page, 'original-undone')).model.resources.find(pool => pool.id === 'specialists').capacity, 2);
    await saved(page); await start(page);
    // Simulate a newer valid save from another tab while practice is open.
    await page.evaluate(id => new Promise((resolve, reject) => { const r = indexedDB.open('queuelab-projects', 2); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('projects', 'readwrite'), get = tx.objectStore('projects').get(id); get.onsuccess = () => { const record = get.result, p = JSON.parse(record.payload); p.name = 'Newer synthetic project'; p.revision++; tx.objectStore('projects').put({ ...record, revision: p.revision, payload: JSON.stringify(p) }); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; }), before.id);
    await page.getByRole('button', { name: 'Back to my previous project', exact: true }).click(); await ready(page);
    assert.equal((await download(page, 'newer-return')).name, 'Newer synthetic project');
    assert.equal(await page.getByRole('button', { name: /^Undo / }).count(), 0);
    await c.context.close(); checks.push('A failed preservation write blocks practice; original project, result and Undo survive practice; a newer externally saved original is reopened without stale history');
  }
  phase = 'save failure'; {
    const c = await fresh(); page = c.page; await start(page); await change(page); await compare(page); await keep(page);
    await page.locator('.template-save button[type=submit]').waitFor();
    await page.evaluate(() => { const transaction = IDBDatabase.prototype.transaction; window.restoreTemplateWrites = () => { IDBDatabase.prototype.transaction = transaction; }; IDBDatabase.prototype.transaction = function (...args) { if (this.name === 'loopset-templates' && args[1] === 'readwrite') throw new DOMException('Synthetic quota', 'QuotaExceededError'); return transaction.apply(this, args); }; });
    await page.locator('.template-save button[type=submit]').click(); await page.locator('.templates-panel [role=alert]').waitFor();
    await stage(page, 'save'); assert.equal(await page.locator('.learning-saved').count(), 0); assert.equal(await page.locator('[data-template-id]').count(), 0);
    await page.evaluate(() => window.restoreTemplateWrites()); await page.locator('.template-save button[type=submit]').click(); await stage(page, 'complete');
    await c.context.close(); checks.push('A failed IndexedDB template write cannot complete the lesson or claim a save; native retry succeeds');
  }
  phase = 'cancelled and failed practice loading'; {
    const c = await fresh(1440, true); page = c.page; const before = await download(page, 'before-load-failure');
    await page.route('**/templates/service.json?*', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.getByRole('button', { name: 'Learn by doing', exact: true }).click(); await page.getByRole('button', { name: 'Start my first experiment', exact: true }).click();
    await page.locator('.learning-intro [role=alert]').waitFor(); await page.unroute('**/templates/service.json?*');
    let release, seen; const gate = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { seen = resolve; });
    await page.route('**/templates/service.json?*', async route => { seen(); await gate; await route.fulfill({ contentType: 'application/json', body: await fs.readFile('public/templates/service.json', 'utf8') }).catch(() => {}); });
    await page.getByRole('button', { name: 'Start my first experiment', exact: true }).click(); await requested;
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); release();
    await page.locator('.studio-world-picker select').selectOption('blank'); await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).workspaceMode === 'layout');
    const blank = await download(page, 'after-cancelled-load'); assert.deepEqual(blank.model.nodes, []); assert.notEqual(blank.id, before.id);
    assert.equal(await coach(page).count(), 0); await page.unroute('**/templates/service.json?*'); await c.context.close();
    checks.push('HTTP errors stay actionable; Escape cancels practice loading and a late response cannot replace the newer blank project');
  }
  phase = 'independent exploration'; {
    const c = await fresh(); page = c.page; await start(page); await change(page);
    await page.getByRole('button', { name: /^Undo / }).click(); await stage(page, 'edit');
    const stations = page.getByRole('spinbutton', { name: 'Parallel stations', exact: true }); await stations.fill('4'); await stations.press('Enter'); await stage(page, 'off-track');
    const different = await download(page, 'independent-idea');
    await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
    assert.deepEqual((await download(page, 'after-leave')).model, different.model);
    await saved(page); await page.reload(); await ready(page); assert.equal(await page.locator('[data-panel=learn],.learning-coach').count(), 0);
    await c.context.close(); checks.push('Undo returns to the relevant task; unrelated model edits are preserved and leaving the guide never resets them');
  }
  }
  assert.deepEqual(errors, []); const receipt = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), scope, checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), `${phase}\n${error}\n${await page.locator('body').innerText()}`); }
  console.error(phase, error); process.exitCode = 1;
} finally { await browser.close(); }
