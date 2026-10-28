import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use an isolated QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/facility-redesign/navigation');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chromium.executablePath() } : { channel: 'chrome' }) });
const errors = [], checks = []; let page;
async function fresh(width) { const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true }); const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e))); await p.goto(origin.href); await p.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !s.running && s.result?.status === 'completed' && !s.result.stale; }); const pause = p.getByRole('button', { name: 'Pause replay', exact: true }); if (await pause.count()) await pause.click(); return { context, page: p }; }
async function download(p, name) { const next = p.waitForEvent('download'); await p.locator('.studio-save').click(); const file = await next, target = path.join(out, name); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8')); }
try {
  const mobile = await fresh(390); page = mobile.page;
  assert.equal(await page.locator('#object-properties').count(), 0);
  await page.getByRole('button', { name: 'Show selection properties', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-object-details-close') && document.querySelector('#object-properties').getBoundingClientRect().top >= -1 && document.querySelector('#object-properties').getBoundingClientRect().top < innerHeight);
  assert(await page.evaluate(() => scrollY > 0));
  await page.screenshot({ path: path.join(out, 'mobile-properties.png') });
  checks.push('Mobile properties opening reveals the inspector in the viewport and moves keyboard focus to its controls'); await mobile.context.close();
  const desktop = await fresh(1440); page = desktop.page;
  const before = await download(page, 'before.json'), services = before.model.nodes.filter(node => node.kind === 'service'), from = services[0], to = services.at(-1);
  await page.locator('.facility-canvas-tools').getByRole('button', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: `Inspect ${from.label}`, exact: true }).click();
  await page.getByRole('button', { name: '02 Define process', exact: true }).click();
  assert(await page.locator('.facility-library').isVisible());
  await page.getByRole('button', { name: 'Connect selected step', exact: true }).click();
  assert(!await page.locator('.facility-library').isVisible());
  await page.locator('.ease-connect-review').getByRole('combobox', { name: 'Destination step', exact: true }).selectOption(to.id);
  await page.waitForFunction(({ from, to }) => { const v = JSON.parse(document.querySelector('.world-scene')?.getAttribute('data-flow-guide') || '{}').viewing; return v?.from === from && v?.to === to; }, { from: from.id, to: to.id });
  const after = await download(page, 'preview.json'); assert.deepEqual(after.model, before.model); assert.equal(after.revision, before.revision);
  await page.locator('.ease-connect-review').getByRole('button', { name: 'Cancel change', exact: true }).click();
  await page.waitForFunction(({ from, to }) => JSON.parse(document.querySelector('.world-scene')?.getAttribute('data-edges') || '[]').some(edge => edge.from === from && edge.to === to), { from: from.id, to: from.next });
  await page.locator('.ease-connect-review').getByRole('combobox', { name: 'Destination step', exact: true }).selectOption(from.id);
  await page.waitForFunction(id => { const v = JSON.parse(document.querySelector('.world-scene')?.getAttribute('data-flow-guide') || '{}').viewing; return v?.from === id && v?.to === id && v.coincident; }, from.id);
  await page.screenshot({ path: path.join(out, 'self-loop-preview.png') });
  await page.locator('.ease-connect-review').getByRole('button', { name: 'Cancel change', exact: true }).click();
  await page.waitForFunction(({ from, to }) => JSON.parse(document.querySelector('.world-scene')?.getAttribute('data-edges') || '[]').some(edge => edge.from === from && edge.to === to), { from: from.id, to: from.next });
  await page.screenshot({ path: path.join(out, 'connect-preview.png') });
  checks.push('Connect closes the insertion library and previews requested forward/self-loop destinations and restores cancellation without editing the numerical model'); await desktop.context.close();
  assert.deepEqual(errors, []); const receipt = { passed: true, at: new Date().toISOString(), origin: origin.href, browser: browser.version(), checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (e) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), String(e) + '\n' + await page.locator('body').innerText()); } console.error(String(e)); process.exitCode = 1; }
finally { await browser.close(); }
