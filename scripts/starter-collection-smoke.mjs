// Isolated, synthetic end-to-end checks for the curated collection.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openPanel, runPlan } from './ui-actions.mjs';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use a separate loopback QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/template-collection/smoke');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chromium.executablePath() } : { channel: 'chrome' }) });
const inventory = JSON.parse(await fs.readFile('src/templates/inventory.json', 'utf8')), references = JSON.parse(await fs.readFile('public/templates/reference-results.json', 'utf8'));
const fixtures = Object.fromEntries(await Promise.all(Object.keys(inventory).map(async id => [id, JSON.parse(await fs.readFile(`public/templates/${id}.json`, 'utf8'))])));
const checks = [], errors = []; let page, stage = 'startup';
const state = p => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = p => p.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !document.querySelector('.studio-world-picker select')?.disabled && !s.running && s.result?.status === 'completed' && !s.result.stale; });
const artwork = p => p.waitForFunction(() => { const h = document.querySelector('.world-scene'), f = JSON.parse(h?.getAttribute('data-facility') || '{}'); return h?.getAttribute('data-status') === 'ready' && f.pending === 0 && f.failed === 0; });
async function fresh(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e))); await p.goto(origin.href); await ready(p); return { context, page: p };
}
async function download(p, name) {
  const next = p.waitForEvent('download'); await p.locator('.studio-save').click(); const file = await next, target = path.join(out, `${name}.json`); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8'));
}
async function gallery(p) { await openPanel(p, 'worlds'); await p.getByRole('button', { name: 'Starter templates', exact: true }).click(); await p.locator('.starter-card').first().waitFor(); }
async function detail(p, id) { await p.locator(`[data-starter-id="${id}"]`).click(); await p.locator('.starter-brief h3').waitFor(); }
async function openDetail(p) { await p.getByRole('button', { name: 'Open this template', exact: true }).click(); await p.getByRole('dialog', { name: 'Templates', exact: true }).waitFor({ state: 'detached' }); await ready(p); }
async function overflow(p) { assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); const body = p.locator('.modal-body'); if (await body.count()) assert(await body.evaluate(e => e.scrollWidth <= e.clientWidth + 1)); }
try {
  const desktop = await fresh(); page = desktop.page; await artwork(page);
  stage = 'gallery'; const requests = []; page.on('request', r => requests.push(r.url()));
  await gallery(page); assert.equal(await page.locator('.starter-card').count(), 12); assert(await page.locator('.template-blank').isVisible());
  await page.getByRole('combobox', { name: 'All templates', exact: true }).selectOption('logistics'); assert.equal(await page.locator('.starter-card').count(), 4);
  await page.getByRole('combobox', { name: 'All templates', exact: true }).selectOption('');
  await page.getByRole('searchbox', { name: 'Search starter templates', exact: true }).fill('rework'); assert.equal(await page.locator('.starter-card').count(), 1);
  await page.getByRole('searchbox', { name: 'Search starter templates', exact: true }).fill('');
  await page.screenshot({ path: path.join(out, 'gallery.png') }); await detail(page, 'quality'); await overflow(page);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Quality & Rework');
  assert.equal(requests.filter(url => /\/templates\/[^/]+\.json/.test(url)).length, 0, 'Browsing and previewing must not fetch starter project payloads.');
  assert.equal(requests.filter(url => /\.glb(?:\?|$)/.test(url)).length, 0, 'Browsing starter previews must not load their 3D models.');
  await page.screenshot({ path: path.join(out, 'detail.png') }); await openDetail(page);
  assert.equal(requests.filter(url => /\/templates\/[^/]+\.json/.test(url)).length, 1);
  checks.push('Twelve previews, Blank, search, four-category filtering, keyboard detail focus and selected-only project loading');

  for (const [id, fixture] of Object.entries(fixtures)) {
    stage = `template ${id}`; await page.locator('.studio-world-picker select').selectOption(id); await ready(page); await artwork(page);
    const base = await download(page, `${id}-original`); assert.equal(base.name, fixture.name); assert.notEqual(base.id, fixture.id); assert.deepEqual(base.model, fixture.model); assert.deepEqual(base.facility, fixture.facility); assert.deepEqual(base.scenarios, fixture.scenarios);
    assert.deepEqual((await state(page)).result.summary, references.templates[id][0].runs[0].summary);
    for (const index of [1, 2]) {
      await page.getByRole('button', { name: 'Project brief', exact: true }).click(); await page.getByRole('dialog', { name: 'Project brief', exact: true }).waitFor();
      const plan = page.locator('.project-brief-plan').filter({ has: page.getByRole('heading', { name: fixture.scenarios[index].name, exact: true }) });
      await plan.getByRole('button', { name: 'Apply this plan', exact: true }).click(); await page.getByRole('dialog', { name: 'Project brief', exact: true }).waitFor({ state: 'detached' });
      const draft = await download(page, `${id}-trial-${index}`); assert.equal(draft.id, base.id); assert.deepEqual(draft.model, fixture.scenarios[index].model); assert.deepEqual(draft.facility, fixture.scenarios[index].facility);
      assert.equal((await state(page)).result.stale, true); await runPlan(page);
      assert.deepEqual((await state(page)).result.summary, references.templates[id][index].runs[0].summary);
      await page.getByRole('button', { name: /^Undo / }).click();
      const undone = await download(page, `${id}-undo-${index}`); assert.deepEqual(undone.model, base.model); assert.deepEqual(undone.facility, base.facility);
    }
    checks.push(`${id}: actual base and two scenario calculations, complete portable data and one-step Undo preserve expected inputs and results`);
  }
  stage = 'pending field'; await page.locator('.studio-world-picker select').selectOption('factory'); await ready(page);
  await page.getByRole('button', { name: 'Show selection properties', exact: true }).click();
  const mean = page.getByRole('spinbutton', { name: 'Mean processing time', exact: true }), beforeDraft = await state(page);
  await mean.fill('invalid'); await page.locator('.studio-world-picker select').selectOption('quality');
  assert.equal((await state(page)).revision, beforeDraft.revision); assert.equal((await state(page)).result.hash, beforeDraft.result.hash); assert.equal(await mean.inputValue(), 'invalid');
  await mean.press('Escape'); await desktop.context.close(); checks.push('An unfinished numeric field blocks template replacement and remains available for repair');

  stage = 'load failures'; const failure = await fresh(); page = failure.page; const before = await download(page, 'before-failed-load');
  const pattern = '**/templates/quality.json?*';
  await page.route(pattern, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await gallery(page); await detail(page, 'quality'); await page.getByRole('button', { name: 'Open this template', exact: true }).click();
  await page.locator('.templates-panel [role=alert]').filter({ hasText: 'could not be opened' }).waitFor(); assert(await page.locator('.studio-world-picker select').isEnabled());
  await page.unroute(pattern); await page.route(pattern, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixtures.factory) }));
  await page.getByRole('button', { name: 'Open this template', exact: true }).click(); await page.locator('.templates-panel [role=alert]').filter({ hasText: 'does not match' }).waitFor();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); const after = await download(page, 'after-failed-load'); assert.equal(after.id, before.id); assert.deepEqual(after.model, before.model);
  await page.unroute(pattern);
  await page.route(pattern, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await gallery(page); await detail(page, 'quality'); await page.getByRole('button', { name: 'Open this template', exact: true }).click();
  await page.locator('.templates-panel [role=alert]').waitFor(); await page.unroute(pattern);
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' }); await ready(page);
  assert.equal((await download(page, 'after-retry')).name, 'Quality & Rework');
  let release, seen; const gate = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { seen = resolve; });
  await page.route(pattern, async route => { seen(); await gate; await route.fulfill({ contentType: 'application/json', body: await fs.readFile('public/templates/quality.json', 'utf8') }).catch(() => {}); });
  await gallery(page); await detail(page, 'quality'); await page.getByRole('button', { name: 'Open this template', exact: true }).click(); await requested;
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); assert(await page.locator('.studio-world-picker select').isEnabled());
  await page.locator('.studio-world-picker select').selectOption('blank'); release();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).workspaceMode === 'layout');
  await page.unroute(pattern); const blank = await download(page, 'after-cancelled-load'); assert.deepEqual(blank.model.nodes, []); assert.deepEqual(blank.facility.objects, []);
  await failure.context.close(); checks.push('HTTP and integrity errors preserve the project; Escape aborts a delayed load and immediately restores navigation without a late replacement');

  stage = 'mobile';
  for (const width of [320, 390]) {
    const mobile = await fresh(width); page = mobile.page; await gallery(page); await overflow(page);
    await page.locator('[data-starter-id=festival]').scrollIntoViewIfNeeded(); await detail(page, 'festival');
    await page.waitForFunction(() => document.querySelector('.modal-body')?.scrollTop === 0);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Festival Gate'); await overflow(page);
    await page.screenshot({ path: path.join(out, `mobile-${width}-detail.png`) }); await openDetail(page);
    await page.getByRole('button', { name: 'Project brief', exact: true }).click(); await overflow(page);
    await page.screenshot({ path: path.join(out, `mobile-${width}-brief.png`) });
    await page.locator('.project-brief-plan').filter({ has: page.getByRole('heading', { name: 'Peak security cover', exact: true }) }).getByRole('button', { name: 'Apply this plan', exact: true }).click();
    await runPlan(page); assert.deepEqual((await state(page)).result.summary, references.templates.festival[1].runs[0].summary);
    await mobile.context.close();
  }
  checks.push('320/390px bottom-card detail starts at the top, with readable gallery/brief and an actual applied scenario calculation');
  assert.deepEqual(errors, []); const receipt = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), templates: 12, alternatives: 24, checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), `${stage}\n${error}\n${await page.locator('body').innerText()}`); }
  console.error(stage, String(error)); process.exitCode = 1;
} finally { await browser.close(); }
