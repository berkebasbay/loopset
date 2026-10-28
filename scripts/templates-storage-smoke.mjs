import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use a separate loopback QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/templates/storage');
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chromium.executablePath() } : { channel: 'chrome' }) });
const checks = [], errors = [];
try {
  // Valid measured-sample/scenario data approaches the byte cap with fewer than 50 templates.
  const project = JSON.parse(await fs.readFile('examples/service.json', 'utf8'));
  project.name = 'Synthetic measured plan';
  for (const node of project.model.nodes) if (node.kind === 'service') node.duration = { kind: 'empirical', values: Array(10000).fill(30.123456789) };
  project.scenarios = Array.from({ length: 4 }, (_, i) => ({ id: `scenario-${i}`, name: `Synthetic ${i}`, createdAt: '2026-01-01T00:00:00.000Z', model: structuredClone(project.model), world: project.world, layout: project.layout }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }), page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error))); await page.goto(origin.href);
  await page.locator('.studio-world-picker select').selectOption('save');
  await page.getByLabel('Choose template project JSON', { exact: true }).setInputFiles({ name: 'synthetic-measurements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole('button', { name: 'Save imported template', exact: true }).click();
  await page.getByText('“Synthetic measured plan” was saved in your template library.', { exact: true }).waitFor();
  const seeded = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('loopset-templates', 1); request.onerror = () => reject(String(request.error));
    request.onsuccess = () => { const db = request.result, tx = db.transaction(['templates', 'summaries'], 'readwrite'), get = tx.objectStore('templates').getAll(); let bytes;
      get.onsuccess = () => { const record = get.result[0]; bytes = record.bytes; for (let i = 1; i < 11; i++) { const copy = { ...record, id: `template-${crypto.randomUUID()}` }, { payload, ...meta } = copy; tx.objectStore('templates').add(copy); tx.objectStore('summaries').add(meta); } };
      tx.oncomplete = () => { db.close(); resolve(bytes); }; tx.onabort = () => { db.close(); reject(String(tx.error)); };
    };
  }));
  assert(seeded * 11 < 50 * 1024 * 1024 && seeded * 12 > 50 * 1024 * 1024);
  await page.getByLabel('Choose template project JSON', { exact: true }).setInputFiles({ name: 'synthetic-measurements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole('button', { name: 'Save imported template', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Keep up to 50 templates and 50 MB' }).waitFor();
  const counts = await page.evaluate(() => new Promise(resolve => { const request = indexedDB.open('loopset-templates', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction(['templates', 'summaries']), a = tx.objectStore('templates').count(), b = tx.objectStore('summaries').count(); tx.oncomplete = () => { db.close(); resolve([a.result, b.result]); }; }; }));
  assert.deepEqual(counts, [11, 11]); checks.push('50 MiB payload cap rejects a twelfth valid 4.4 MB template atomically, below the 50-template count limit'); await context.close();

  for (const mode of ['unavailable', 'newer']) {
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }), p = await isolated.newPage(); p.on('pageerror', e => errors.push(String(e)));
    await p.goto(origin.href);
    if (mode === 'unavailable') await p.evaluate(() => { const open = indexedDB.open.bind(indexedDB); indexedDB.open = function (name, version) { if (name === 'loopset-templates') throw new DOMException('Synthetic unavailable storage', 'SecurityError'); return open(name, version); }; });
    else await p.evaluate(() => new Promise(resolve => { const request = indexedDB.open('loopset-templates', 2); request.onupgradeneeded = () => request.result.createObjectStore('future-data'); request.onsuccess = () => { request.result.close(); resolve(); }; }));
    await p.locator('.studio-world-picker select').selectOption('save');
    await p.getByRole('alert').filter({ hasText: mode === 'unavailable' ? 'Template storage is unavailable' : 'newer template library' }).waitFor();
    await p.getByRole('button', { name: 'Starter templates', exact: true }).click(); await p.locator('.template-blank').click();
    await p.waitForFunction(() => JSON.parse(window.render_game_to_text()).workspaceMode === 'layout');
    checks.push(`${mode} template storage reports a recoverable error while built-in Blank remains usable`); await isolated.close();
  }
  assert.deepEqual(errors, []); const receipt = { passed: true, at: new Date().toISOString(), checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
