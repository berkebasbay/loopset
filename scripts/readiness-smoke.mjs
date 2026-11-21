import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { requiredScreenshot, prepareCIView, browserArgs, dismissLearningWelcome, openPanel } from './ui-actions.mjs';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Use an isolated loopback origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/readiness');
await fs.mkdir(out, { recursive: true });
let installed = true; try { await fs.access(chromium.executablePath()); } catch { installed = false; }
const browser = await chromium.launch({ headless: true, args: browserArgs, ...(process.env.QUEUELAB_SYSTEM_CHROME || !installed ? { channel: 'chrome' } : { executablePath: chromium.executablePath() }) });
const checks = [], errors = []; let page, stage = 'startup';
const state = p => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = p => p.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !s.running && s.result?.status === 'completed'; });
const saved = p => p.locator('.workspace-footer').getByText(/^Saved in this browser/).first().waitFor({ state: 'attached' });
async function download(p, name) {
  const next = p.waitForEvent('download'); await p.locator('.studio-save').click(); const file = await next, target = path.join(out, `${name}.json`); await file.saveAs(target); return JSON.parse(await fs.readFile(target, 'utf8'));
}
try {
  stage = 'graphics begin only after entry'; {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    const graphics = url => /\/scene\/WorldScene\.tsx$|\/assets\/WorldScene-[^/]+\.js$/.test(new URL(url).pathname);
    const requests = []; page.on('request', request => { if (graphics(request.url())) requests.push(request.url()); });
    await page.goto(new URL('?learn=1', origin).href); await ready(page);
    await page.locator('[data-panel=learn]').waitFor(); await page.locator('.learning-intro img').evaluate(img => img.decode());
    assert.equal(requests.length, 0, 'The welcome must not fetch a temporary graphics module.');
    await Promise.all([page.waitForRequest(request => graphics(request.url())), page.getByRole('button', { name: 'Try it with me', exact: true }).click()]);
    assert.equal((await state(page)).world, 'service'); assert.equal(requests.length, 1);
    await context.close(); checks.push('The welcome loads no temporary graphics module; choosing the example starts its real 3D module on demand');
  }
  stage = 'without WebGL'; {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', acceptDownloads: true });
    await context.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; window.restoreTestContext = () => { HTMLCanvasElement.prototype.getContext = get; }; HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith('webgl') || kind === 'experimental-webgl' ? null : get.call(this, kind, ...args); }; });
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    await page.goto(new URL('?learn=1', origin).href); await ready(page); await prepareCIView(page); await page.getByRole('button', { name: 'Try it with me', exact: true }).click();
    await page.locator('[data-learning-stage=select]').waitFor(); await page.locator('.scene-text-fallback').waitFor();
    await requiredScreenshot(page, { path: path.join(out, 'no-webgl-lesson.png') });
    await page.getByRole('link', { name: 'Skip to lesson', exact: true }).focus(); await page.keyboard.press('Enter');
    assert(await page.locator('[data-learning-heading]').evaluate(e => e === document.activeElement));
    await page.locator('.scene-text-fallback [data-station-id=station-b]').click();
    await page.getByRole('spinbutton', { name: 'People on this team', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Apply change', exact: true }).click();
    await page.getByRole('button', { name: 'Try this change', exact: true }).click(); await page.locator('[data-learning-stage=review]').waitFor();
    assert.equal((await state(page)).result.summary.completed, 86);
    await page.getByRole('button', { name: 'Got it. Next', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name your example', exact: true }).fill('Without 3D');
    await page.getByRole('button', { name: 'Save my example', exact: true }).click(); await page.locator('[data-learning-stage=complete]').waitFor();
    await page.getByRole('button', { name: 'Open the full workspace', exact: true }).click(); await saved(page);
    const retained = await download(page, 'without-webgl'); const before = (await state(page)).result;
    await page.evaluate(() => window.restoreTestContext()); await page.getByRole('button', { name: 'Retry 3D world', exact: true }).click();
    await page.locator('.world-scene[data-status=ready]').waitFor(); assert.equal(await page.locator('.scene-text-fallback').count(), 0);
    assert.deepEqual((await state(page)).result, before); assert.deepEqual((await download(page, 'after-webgl-retry')).model, retained.model);
    await requiredScreenshot(page, { path: path.join(out, 'recovered-3d.png') }); await context.close();
    checks.push('No WebGL: real DOM selection, edit, calculation, template ACK and download work; Retry restores 3D without changing the model or result');
  }
  stage = 'graphics module fails to load'; {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    await page.route(url => /\/scene\/WorldScene\.tsx$|\/assets\/WorldScene-[^/]+\.js$/.test(url.pathname), route => route.abort('failed'));
    await page.goto(new URL('?learn=1', origin).href); await ready(page); await prepareCIView(page);
    await page.getByRole('button', { name: 'Try it with me', exact: true }).click();
    await page.locator('[data-learning-stage=select]').waitFor();
    await page.locator('.scene-unavailable .scene-text-fallback').waitFor();
    await requiredScreenshot(page, { path: path.join(out, 'no-graphics-lesson.png') });
    await page.locator('.scene-unavailable [data-station-id=station-b]').press('Enter');
    await page.getByRole('spinbutton', { name: 'People on this team', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Apply change', exact: true }).click();
    await page.getByRole('button', { name: 'Try this change', exact: true }).click();
    await page.locator('[data-learning-stage=review]').waitFor(); assert.equal((await state(page)).result.summary.completed, 86);
    await page.getByRole('button', { name: 'Got it. Next', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name your example', exact: true }).fill('Without graphics module');
    await page.getByRole('button', { name: 'Save my example', exact: true }).click();
    await page.locator('[data-learning-stage=complete]').waitFor();
    await requiredScreenshot(page, { path: path.join(out, 'without-graphics-module.png') }); await context.close();
    checks.push('A failed lazy graphics module leaves the lesson, actual calculations and template save usable');
  }
  stage = 'guided entry preserves saved work'; {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error))); await page.goto(origin.href); await dismissLearningWelcome(page); await prepareCIView(page); await saved(page);
    await page.getByRole('link', { name: 'Skip to workspace', exact: true }).focus(); await page.keyboard.press('Enter');
    assert(await page.locator('#workspace').evaluate(e => e === document.activeElement));
    const original = await download(page, 'before-guided-entry');
    await page.goto(new URL('?learn=1&keep=example', origin).href); await ready(page); await prepareCIView(page); await page.locator('[data-panel=learn]').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('learn'), null); assert.equal(new URL(page.url()).searchParams.get('keep'), 'example');
    await page.getByRole('button', { name: 'Explore on my own', exact: true }).click();
    const after = await download(page, 'after-guided-entry');
    for (const key of Object.keys(original).filter(key => key !== 'savedAt')) assert.deepEqual(after[key], original[key]);
    await page.reload(); await ready(page); await prepareCIView(page); assert.equal(await page.locator('[data-panel=learn]').count(), 0);
    await context.close(); checks.push('Explicit ?learn=1 opens the welcome once, preserves the saved project and other query parameters, and does not reopen on reload');
  }
  for (const width of [1440, 390]) {
    stage = `pending edit ${width}`;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
    page = await context.newPage(); page.on('pageerror', error => errors.push(String(error))); await page.goto(origin.href); await dismissLearningWelcome(page); await prepareCIView(page);
    await page.locator('.facility-canvas-tools').getByRole('button', { name: 'Steps', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect Packing', exact: true }).click();
    const field = page.getByRole('spinbutton', { name: 'Mean processing time', exact: true });
    const size = () => page.locator('.world-scene').evaluate(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
    const stations = page.getByRole('spinbutton', { name: 'Parallel stations', exact: true });
    const originalStations = await stations.inputValue();
    await stations.fill(String(Number(originalStations) + 1)); await stations.press('Enter');
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).result?.stale);
    const before = await size(), { revision, result: numerical } = await state(page);
    await field.fill(''); await page.locator('.ease-pending-banner').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await size(), before); assert.deepEqual((await state(page)).result, numerical);
    await requiredScreenshot(page, { path: path.join(out, `pending-${width}.png`) });
    const tabs = page.locator('.studio-inspector-tabs');
    const properties = tabs.getByRole('button', { name: 'Properties', exact: true });
    const undo = page.locator('.studio-edit-history').getByRole('button', { name: /^Undo / });
    assert(await undo.isDisabled());
    await properties.press('Control+z');
    assert.equal(await field.inputValue(), ''); assert.equal((await state(page)).revision, revision);
    assert.equal(await properties.getAttribute('aria-pressed'), 'true');
    assert.equal(await tabs.locator('button[aria-pressed=false]').count(), 3);
    for (const button of [tabs.getByRole('button', { name: 'Steps', exact: true }), page.locator('.facility-canvas-tools').getByRole('button', { name: 'Steps', exact: true }), tabs.locator('[data-object-details-close]')]) {
      await button.click();
      assert.equal(await field.inputValue(), '');
      assert.equal(await properties.getAttribute('aria-pressed'), 'true');
    }
    await openPanel(page, 'compare');
    const compare = page.locator('[data-panel=compare]');
    assert(await compare.getByRole('button', { name: 'Run & compare', exact: true }).isDisabled());
    assert.match(await compare.locator('#comparison-pending').innerText(), /apply or cancel/i);
    assert.deepEqual((await state(page)).result, numerical);
    await compare.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await field.press('Escape'); await page.locator('.ease-pending-banner').waitFor({ state: 'detached' });
    await undo.click();
    await stations.and(page.locator(`[aria-valuenow="${originalStations}"]`)).waitFor();
    assert.equal(await stations.inputValue(), originalStations);
    assert.equal((await state(page)).revision, revision + 1);
    await tabs.getByRole('button', { name: 'Steps', exact: true }).click();
    assert.equal(await tabs.getByRole('button', { name: 'Steps', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Scenario settings', exact: true }).click();
    const length = page.getByRole('spinbutton', { name: 'Run length', exact: true });
    const initialLength = await length.inputValue();
    await length.fill(''); await length.press('Escape'); assert.equal(await length.inputValue(), initialLength);
    await length.press('Escape'); await page.locator('[data-panel=scenario]').waitFor({ state: 'detached' });
    await context.close();
    checks.push(`${width}px: unfinished inspector edits survive navigation and block Undo and comparison. Escape restores a dirty value and closes a clean dialog.`);
  }
  assert.deepEqual(errors, []); const receipt = { passed: true, at: new Date().toISOString(), browser: browser.version(), checks, errors };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(out, 'failure.txt'), `${stage}\n${error}\n${await page.locator('body').innerText().catch(() => '')}`).catch(e => console.warn('Failure text unavailable:', e)); }
  console.error(stage, error); process.exitCode = 1;
} finally { await browser.close(); }
