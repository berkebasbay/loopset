// Functional UX regression checks. Every browser context and model is synthetic.
import { chromium, firefox, webkit } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openPanel, primaryRunButton, headerProjectInput } from './ui-actions.mjs';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['localhost', '127.0.0.1'].includes(origin.hostname), 'Use a loopback QA server.');
const kind = process.env.QUEUELAB_BROWSER || 'chromium', phase = process.env.QUEUELAB_UX_PHASE || 'core';
assert(['chromium', 'firefox', 'webkit'].includes(kind));
const viewportWidth = Number(process.env.QUEUELAB_UX_WIDTH || 1440), viewportHeight = Number(process.env.QUEUELAB_UX_HEIGHT || 900);
assert(Number.isInteger(viewportWidth) && viewportWidth >= 320 && viewportWidth <= 4000);
assert(Number.isInteger(viewportHeight) && viewportHeight >= 400 && viewportHeight <= 3000);
const worlds = (process.env.QUEUELAB_UX_WORLDS || 'factory,festival,service').split(',');
assert(worlds.length > 0 && worlds.every(world => ['factory', 'festival', 'service'].includes(world)));
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || `.private/evidence/ux-smoke-${kind}-${phase}`);
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.cache/tmp', { recursive: true }); process.env.TMPDIR = path.resolve('.cache/tmp');
const browser = await { chromium, firefox, webkit }[kind].launch({ headless: true, ...(kind === 'chromium' && process.env.QUEUELAB_SYSTEM_CHROME ? { channel: 'chrome' } : {}) });
const receipt = { origin: origin.href, browser: browser.version(), engine: kind, phase, viewport: { width: viewportWidth, height: viewportHeight }, worlds, checks: [], files: [], errors: [] };
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const ready = page => page.waitForFunction(() => { const s = JSON.parse(window.render_game_to_text?.() || '{}'); return !s.running && s.result?.status === 'completed' && !s.result.stale; });
const close = page => page.getByRole('button', { name: 'Close dialog', exact: true }).click();
const check = (ids, name, evidence) => receipt.checks.push({ ids, name, evidence });
async function screenshot(page, name) { await page.screenshot({ path: path.join(out, name) }); return name; }
async function saveDownload(page, button, name) {
  const pending = page.waitForEvent('download'); await button.click(); const download = await pending; const file = path.join(out, name); await download.saveAs(file);
  const bytes = await fs.readFile(file); receipt.files.push({ name, suggested: download.suggestedFilename(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); return bytes;
}
const projectJSON = async (page, name) => JSON.parse((await saveDownload(page, page.locator('.studio-save'), name)).toString());
async function inspect(page, label, intent = 'single') {
  await page.locator('.studio-rail').getByRole('button', { name: 'Steps', exact: true }).click();
  if (intent === 'toggle') await page.getByRole('checkbox', { name: `Select ${label} for group editing`, exact: true }).check();
  else await page.getByRole('button', { name: `Inspect ${label}`, exact: true }).click();
}
async function field(page, name, value, scope = page) { const input = scope.getByRole('spinbutton', { name, exact: true }); await input.fill(String(value)); await input.press('Enter'); return input; }
async function fresh(world = 'factory', width = viewportWidth, height = viewportHeight) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', acceptDownloads: true }); const page = await context.newPage();
  page.on('pageerror', error => receipt.errors.push(String(error))); await page.goto(origin.href); await ready(page);
  if (world !== 'factory') { await page.locator('.studio-world-picker select').selectOption(world); await ready(page); }
  const pause = page.getByRole('button', { name: 'Pause replay', exact: true }); if (await pause.count()) await pause.click(); return { context, page };
}
async function core() {
 for (const world of worlds) {
  const { context, page } = await fresh(world);
  try {
   if (viewportWidth <= 740) {
    const before = await state(page);
    await page.getByRole('button', { name: 'Edit selected step', exact: true }).click();
    const target = page.getByRole('spinbutton', { name: 'Parallel stations', exact: true });
    await target.focus();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await target.evaluate(node => node === document.activeElement), 'Opening the mobile inspector must preserve a subsequent field focus.');
    assert.equal((await state(page)).revision, before.revision);
    assert.equal((await state(page)).result.hash, before.result.hash);
   }
   const original = await projectJSON(page, `${world}-original.json`), originalState = await state(page);
   await page.getByRole('button', { name: 'Scenario settings', exact: true }).click();
   const unit = page.getByRole('combobox', { name: 'Unit for Run length', exact: true });
   await unit.selectOption('hours'); assert.equal(await page.getByRole('spinbutton', { name: 'Run length', exact: true }).inputValue(), '1');
   await unit.selectOption('seconds'); assert.equal((await state(page)).revision, originalState.revision);
   const input = page.getByRole('spinbutton', { name: 'Run length', exact: true }); await input.fill(''); await input.press('Enter'); assert.equal((await state(page)).revision, originalState.revision); await input.press('Escape'); assert.equal(await input.inputValue(), '3600');
   await page.getByRole('button', { name: '8 hours', exact: true }).click(); await page.getByRole('button', { name: 'Apply run length', exact: true }).click(); await close(page);
   const extended = await projectJSON(page, `${world}-extended.json`); assert.equal(extended.model.horizon, 28800); assert.deepEqual(extended.model.nodes, original.model.nodes); assert.deepEqual(extended.model.resources, original.model.resources);
   await page.getByRole('button', { name: /^Undo / }).click(); assert.deepEqual((await projectJSON(page, `${world}-undo-length.json`)).model, original.model);
   check([1, 2, 5, 8, 26], `${world}: one-panel run length, display-only units, buffered invalid text, explicit keep and one Undo`, `${world}-extended.json`);
   const source = original.model.nodes.find(n => n.kind === 'source'); await inspect(page, source.label);
   if (source.arrival.kind === 'poisson') await page.getByRole('button', { name: '2×', exact: true }).click();
   else if (source.arrival.kind === 'fixed') await field(page, 'Arrivals / hour', source.arrival.perHour * 2);
   const demand = await projectJSON(page, `${world}-demand.json`), changedSource = demand.model.nodes.find(n => n.id === source.id);
   if (source.arrival.kind === 'poisson') assert.deepEqual(changedSource.arrival.segments, source.arrival.segments.map(period => ({ ...period, perHour: period.perHour * 2 })));
   assert.equal(changedSource.samplingId, source.samplingId); assert.deepEqual(changedSource.classes, source.classes);
   await page.getByRole('button', { name: /^Undo / }).click();
   check([3, 4, 19], `${world}: source rate/intensity preserves period boundaries/classes/sampling; process list selects Properties`, `${world}-demand.json`);
   const station = original.model.nodes.filter(n => n.kind === 'service').at(-1); await inspect(page, station.label); await field(page, 'Parallel stations', station.servers + 1);
   const stationOnly = await projectJSON(page, `${world}-station-only.json`); assert.deepEqual(stationOnly.model.resources, original.model.resources);
   for (const requirement of station.resources) {
    const pool = original.model.resources.find(pool => pool.id === requirement.poolId), team = page.locator('.ease-team').filter({ hasText: pool.label }); if (await team.getAttribute('open') === null) await team.locator('summary').first().click();
    const desired = pool.capacity + requirement.units; if (desired > pool.installedCapacity) { await team.locator('.quality-team-details>summary').click(); await field(page, 'Installed unit limit', desired, team); }
    await field(page, 'Base available units', desired, team);
   }
   const edited = await projectJSON(page, `${world}-edited.json`); assert.equal(edited.model.nodes.find(n => n.id === station.id).servers, station.servers + 1);
   await screenshot(page, `${world}-properties.png`);
   check([9, 11, 12, 13, 14], `${world}: pure parallel count; explicit team controls with requirements, affected stages and modeled cost`, `${world}-station-only.json`);
   await page.getByRole('button', { name: 'Rename project', exact: true }).click(); await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(`${world} alternate`); await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter');
   assert.equal((await state(page)).result.hash, originalState.result.hash);
   await primaryRunButton(page).click(); await ready(page); const calculated = await state(page); assert.equal(calculated.result.status, 'completed');
   const dialog = page.getByRole('dialog', { name: 'Compare plans', exact: true }); await dialog.waitFor();
   assert.deepEqual(await page.locator('.ease-plan-name').allTextContents(), [original.name, `${world} alternate`]);
   assert.match(await page.locator('.ease-input-diff').innerText(), /Parallel stations/); assert.equal(calculated.result.summary.arrivals, originalState.result.summary.arrivals);
   const s = calculated.result.summary; assert.equal(s.arrivals, s.completed + s.inSystem + s.balked + s.reneged);
   if (world === 'factory') { assert.equal(s.completed, 77); assert.equal(s.cost, 96); }
   await screenshot(page, `${world}-comparison.png`);
   const scenarioName = page.getByRole('textbox', { name: 'Scenario name', exact: true }); await scenarioName.fill(`${world} trial`); await page.getByRole('button', { name: 'Save current plan', exact: true }).click();
   await scenarioName.fill(`${world} original`); await page.getByRole('button', { name: 'Save baseline', exact: true }).click();
   const row = page.locator('.scenario-list li').filter({ hasText: `${world} original` }); await row.getByRole('button', { name: 'Restore', exact: true }).click(); await close(page);
   const restored = await projectJSON(page, `${world}-restored.json`); assert.deepEqual(restored.model, original.model);
   await page.getByRole('button', { name: /^Undo / }).click(); const portable = await projectJSON(page, `${world}-portable.json`); assert.equal(portable.scenarios.length, 2); assert.deepEqual(portable.model, edited.model);
   check([27, 31, 32, 33, 43], `${world}: immutable names/input/outcome differences; visible named scenarios, restore and Undo`, `${world}-portable.json`);
   await openPanel(page, 'insights'); assert.equal(await page.locator('.ease-bottleneck').count(), 1); await page.locator('.ease-metric-help summary').click(); await page.locator('.ease-report-chooser summary').click();
   const runBytes = await saveDownload(page, page.getByRole('button', { name: 'Download run JSON', exact: true }), `${world}-run.json`), run = JSON.parse(runBytes.toString()); assert.equal(run.summary.completed, calculated.result.summary.completed); assert.equal(run.modelHash, calculated.result.hash);
   const csv = await saveDownload(page, page.getByRole('button', { name: 'Download results CSV', exact: true }), `${world}-results.csv`); assert(csv.toString().includes(run.id)); assert(csv.toString().includes(run.modelHash));
   if (world === 'factory') {
    const png = await saveDownload(page, page.getByRole('button', { name: 'Download result PNG', exact: true }), `${world}-result.png`); assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const html = await saveDownload(page, page.getByRole('button', { name: 'Download report HTML', exact: true }), `${world}-report.html`); assert(html.toString().includes(run.id)); assert(html.toString().includes(run.modelHash));
   }
   await screenshot(page, `${world}-results.png`); await close(page);
   check([28, 30, 46, 48], `${world}: observed bottleneck, reachable metric scope and real identity-bound report files`, `${world}-run.json`);
   const reopening = await fresh(); try { const freshState = await state(reopening.page); await headerProjectInput(reopening.page).setInputFiles({ name: 'portable.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) }); await ready(reopening.page); const reopened = await projectJSON(reopening.page, `${world}-reopened.json`); assert.equal(reopened.id, portable.id); assert.deepEqual(reopened.model, portable.model); assert.deepEqual(reopened.scenarios, portable.scenarios); assert.notEqual((await state(reopening.page)).result.hash, freshState.result.hash); } finally { await reopening.context.close(); }
   check([41, 42], `${world}: actual project JSON opens through reviewed Files flow in a fresh context`, `${world}-reopened.json`);
  } catch (error) { await screenshot(page, `${world}-failure.png`); await fs.writeFile(path.join(out, `${world}-failure.txt`), `${error}\n${await page.locator('body').innerText()}`); await fs.writeFile(path.join(out, `${world}-failure-state.json`), JSON.stringify({ error: String(error), state: await state(page), focus: await page.evaluate(() => document.activeElement?.outerHTML) }, null, 2)); throw error; }
  finally { await context.close(); }
 }
}
async function editor() {
 const {context,page}=await fresh();
 try {
  const original=await projectJSON(page,'editor-original.json'),station=original.model.nodes.filter(n=>n.kind==='service').at(-1);
  await openPanel(page,'model');await page.locator('.ease-process-actions>details').first().locator('summary').click();await page.getByRole('combobox',{name:'Copy step',exact:true}).selectOption('after');await page.getByRole('button',{name:'Create copy',exact:true}).click();await close(page);
  const copied=await projectJSON(page,'editor-copied.json'),newStep=copied.model.nodes.find(n=>!original.model.nodes.some(old=>old.id===n.id));assert(newStep);assert.notEqual(newStep.samplingId,station.samplingId);assert.deepEqual(newStep.duration,station.duration);assert.equal(newStep.next,station.next);assert.equal(copied.model.nodes.find(n=>n.id===station.id).next,newStep.id);assert.deepEqual(copied.model.resources,original.model.resources);
  await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'editor-copy-undo.json')).model,original.model);check([21],'Copy settings creates new sampling identity, real after splice and one Undo','editor-copied.json');
  await openPanel(page,'model');for(const n of original.model.nodes.filter(n=>n.kind==='service'))await page.getByRole('checkbox',{name:`Select ${n.label} for group editing`,exact:true}).check();
  const bulk=page.locator('.ease-process-actions>details').filter({hasText:'Shared settings for selected steps'});await bulk.locator('summary').click();const value=bulk.getByRole('spinbutton',{name:'Parallel stations',exact:true});await value.fill('5');await value.press('Enter');await value.fill('');await bulk.getByRole('button',{name:'Cancel change',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ease-process-actions input[role=spinbutton]')?.value==='1');assert.equal(await value.inputValue(),'1');await page.waitForFunction(()=>!document.querySelector('.ease-process-actions [data-pending="true"]'));
  assert.equal(await primaryRunButton(page).isDisabled(),false);await value.fill('3');await value.press('Enter');await bulk.getByRole('button',{name:'Apply to selected steps',exact:true}).click();await close(page);
  const grouped=await projectJSON(page,'editor-bulk.json');assert(grouped.model.nodes.filter(n=>n.kind==='service').every(n=>n.servers===3));assert.deepEqual(grouped.model.resources,original.model.resources);await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'editor-bulk-undo.json')).model,original.model);check([20,26],'Bulk commit names selection, changes only requested fields, cancel clears partial buffer; one Undo','editor-bulk.json');
  await editorValidation(page,original);
  const before=await projectJSON(page,'editor-before-preview.json');await inspect(page,station.label);await page.locator('.ease-quick-properties>details').filter({hasText:'Next process step'}).locator('summary').click();await page.getByRole('combobox',{name:'Destination step',exact:true}).selectOption(original.model.nodes.find(n=>n.kind==='service').id);
  const staged=await projectJSON(page,'editor-staged-connection.json');assert.deepEqual(staged.model,before.model);await page.locator('.studio-rail').getByRole('button',{name:'Add step',exact:true}).click();assert.match(await page.locator('.build-link-preview').innerText(),new RegExp(station.label));
  const anchor=original.model.nodes.find(n=>n.kind==='service');await page.getByRole('combobox',{name:'Add after',exact:true}).selectOption(anchor.id);await screenshot(page,'editor-insertion-preview.png');assert.deepEqual((await projectJSON(page,'editor-preview.json')).model,before.model);
  await page.locator('.build-prefab').first().click();const inserted=await projectJSON(page,'editor-inserted.json'),created=inserted.model.nodes.find(n=>!before.model.nodes.some(old=>old.id===n.id));assert(created);assert.equal(inserted.model.nodes.find(n=>n.id===anchor.id).next,created.id);assert.equal(created.next,anchor.next);await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'editor-insert-undo.json')).model,before.model);check([12,22,23],'Latest insertion preview matches text; preview does not edit, actual graph splice and Undo verified','editor-inserted.json');
 } catch(error){await screenshot(page,'editor-failure.png');await fs.writeFile(path.join(out,'editor-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}
}
async function editorValidation(page,original){
 await openPanel(page,'model');await page.getByRole('button',{name:/^Resources \(/}).click();const base=page.getByRole('spinbutton',{name:'Base scheduled units',exact:true}).nth(1),installed=page.getByRole('spinbutton',{name:'Installed units',exact:true}).nth(1);await base.fill('2');await base.press('Enter');await installed.fill('1');await installed.press('Enter');await page.locator('.ql-validation').getByRole('button',{name:'Go to field',exact:true}).first().click();await page.waitForFunction(id=>document.activeElement?.closest('[data-pool-id]')?.getAttribute('data-pool-id')===id,original.model.resources[1].id);assert.equal(await page.evaluate(()=>document.activeElement.labels[0].textContent),'Base scheduled units');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('1');await page.keyboard.press('Enter');
 await page.getByRole('button',{name:/^Process steps \(/}).click();await page.getByRole('combobox',{name:'New step type',exact:true}).selectOption('delay');await page.locator('.ql-step-navigation').getByRole('button',{name:'Add step',exact:true}).click();await page.getByRole('combobox',{name:'Delay distribution',exact:true}).selectOption('triangular');await field(page,'Delay min (seconds)',60);await page.locator('.ql-validation').getByRole('button',{name:'Go to field',exact:true}).first().click();await page.waitForFunction(()=>document.activeElement?.labels?.[0]?.textContent==='Delay min (seconds)');await screenshot(page,'editor-validation-focus.png');await field(page,'Delay min (seconds)',15);
 await page.locator('.ql-step-navigation ol button').filter({hasText:original.model.nodes.find(n=>n.kind==='source').label}).click();await page.locator('summary').filter({hasText:'Visitor and job classes'}).click();const source=original.model.nodes.find(n=>n.kind==='source'),share=page.getByRole('spinbutton',{name:'Class 1 share (%)',exact:true}),percentage=source.classes[0].probability*100;await share.fill(String(percentage-10));await share.press('Enter');await close(page);
 const repair=await projectJSON(page,'editor-percentage-repair.json');assert.equal(repair.format,'queuelab-unvalidated-draft');assert.equal(repair.project.model.nodes.find(n=>n.id===source.id).classes[0].probability,(percentage-10)/100);
 await openPanel(page,'model');await page.locator('.ql-validation').getByRole('button',{name:'Go to field',exact:true}).first().click();await page.waitForFunction(()=>document.activeElement?.labels?.[0]?.textContent==='Class 1 share (%)');await field(page,'Class 1 share (%)',percentage);await page.getByRole('combobox',{name:'New step type',exact:true}).selectOption('route');await page.locator('.ql-step-navigation').getByRole('button',{name:'Add step',exact:true}).click();await close(page);
 const routed=await projectJSON(page,'editor-routed.json'),route=routed.model.nodes.find(n=>n.kind==='route'&&!original.model.nodes.some(old=>old.id===n.id));assert(route);await inspect(page,route.label);const routeInput=page.locator('.ease-quick-properties input[role="spinbutton"]').first();await routeInput.fill('90');await routeInput.press('Enter');await routeInput.fill('');await page.locator('.ease-quick-properties').getByRole('button',{name:'Cancel change',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ease-quick-properties input[role=spinbutton]')?.value==='100');assert.equal(await routeInput.inputValue(),'100');await page.waitForFunction(()=>!document.querySelector('.ease-quick-properties [data-pending="true"]'));assert.equal(await primaryRunButton(page).isDisabled(),false);assert.deepEqual((await projectJSON(page,'editor-route-cancel.json')).model,routed.model);
 check([18,24,25,26],'Field errors target correct pool/delay/percentage; 90% stored as0.9 repair draft, raw route cancel preserves model','editor-percentage-repair.json');
}

async function projectJSONAfterDialog(page,name){await close(page);return projectJSON(page,name);}
async function lab() {
 const {context,page}=await fresh();
 try{
  const original=await projectJSON(page,'lab-original.json'),initial=await state(page);
  await page.locator('.ease-replay-jump>summary').click();await field(page,'Jump to time',12.5);await page.getByRole('button',{name:'Go',exact:true}).click();await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).time===750);assert.deepEqual((await state(page)).result.summary,initial.result.summary);
  await page.getByRole('button',{name:'Recorded end',exact:true}).click();assert.equal((await state(page)).time,3600);await page.getByRole('spinbutton',{name:'Jump to time',exact:true}).fill('99999');await page.getByRole('spinbutton',{name:'Jump to time',exact:true}).press('Enter');await page.getByRole('button',{name:'Go',exact:true}).click();assert.equal((await state(page)).time,3600);await page.getByRole('spinbutton',{name:'Jump to time',exact:true}).press('Escape');await page.locator('.ease-replay-jump>summary').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('.ease-replay-jump').getAttribute('open'),null);
  await page.getByRole('button',{name:'View',exact:true}).click();await page.getByRole('combobox',{name:'World detail',exact:true}).selectOption('low');await page.getByRole('checkbox',{name:'Reduce motion',exact:true}).uncheck();await close(page);assert.deepEqual((await state(page)).result.summary,initial.result.summary);assert.deepEqual((await projectJSON(page,'lab-view-only.json')).model,original.model);check([38,39,40,53],'Recorded jump/end/range rejection, Escape, view and motion preserve numerical model/results','lab-view-only.json');
  const packing=original.model.nodes.filter(n=>n.kind==='service').at(-1);await inspect(page,packing.label);await field(page,'Mean processing time',60);await primaryRunButton(page).click();await ready(page);const candidate=await projectJSONAfterDialog(page,'lab-candidate.json');await page.getByRole('button',{name:'Compare plans',exact:true}).click();await page.getByRole('button',{name:'Repeat this comparison',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Compare two plans',exact:true}).getAttribute('aria-selected'),'true');await field(page,'Runs per plan',2);await page.getByRole('button',{name:'Run experiment',exact:true}).click();await page.getByRole('heading',{name:'Same demand. Paired differences.',exact:true}).waitFor();assert.match(await page.locator('.lab-receipt').innerText(),/4/);await screenshot(page,'lab-paired.png');
  await page.getByRole('tab',{name:'Test resource capacities',exact:true}).click();await page.getByRole('combobox',{name:'How to enter candidate capacities',exact:true}).selectOption('range');await field(page,'Ending capacity',2);await page.getByRole('spinbutton',{name:'Minimum mean completed',exact:true}).fill('0');assert.match(await page.locator('.ease-search-scope').innerText(),/does not change station counts/);assert.match(await page.getByText('Capacities to evaluate:',{exact:false}).innerText(),/1, 2/);await page.getByRole('button',{name:'Evaluate candidates',exact:true}).click();await page.getByRole('button',{name:'Apply verified capacity',exact:true}).waitFor();assert.match(await page.locator('.lab-receipt').innerText(),/6/);await screenshot(page,'lab-capacity-search.png');await close(page);assert.deepEqual((await projectJSON(page,'lab-model-after-experiments.json')).model,candidate.model);check([34,35,36,37],'Captured paired plan, unchanged default seeds, real4-runpair and6-runrange/held-out search; no implicit model edits','lab-model-after-experiments.json');
 }catch(error){await screenshot(page,'lab-failure.png');await fs.writeFile(path.join(out,'lab-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}
}

async function validationPhase(){const {context,page}=await fresh();try{const original=await projectJSON(page,'validation-original.json');await editorValidation(page,original);}catch(error){await screenshot(page,'validation-failure.png');await fs.writeFile(path.join(out,'validation-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}}

async function files() {
 const {context,page}=await fresh();
 const csvFile=(text)=>({name:'synthetic-times.csv',mimeType:'text/csv',buffer:Buffer.from(text)});
 try {
  const original=await projectJSON(page,'files-original.json');await openPanel(page,'data');let dialog=page.getByRole('dialog',{name:'Files & reports',exact:true});await dialog.getByRole('tab',{name:'Import data',exact:true}).click();
  async function loadCSV(text){await dialog.getByLabel('Arrival CSV file',{exact:true}).setInputFiles(csvFile(text));await dialog.getByRole('combobox',{name:'Time column',exact:true}).selectOption('0');await dialog.getByRole('combobox',{name:'Unit in this file',exact:true}).selectOption('minutes');await dialog.getByRole('button',{name:'Preview conversion',exact:true}).click();}
  await loadCSV('minute_stamp,note\n0,first\n0.5,second\n1,third\n');await dialog.getByRole('tab',{name:'Reports',exact:true}).click();await dialog.getByRole('tab',{name:'Import data',exact:true}).click();const preview=dialog.locator('.ql-import-preview').filter({hasText:'3. Review converted values'});await preview.getByRole('button',{name:'Cancel CSV import',exact:true}).click();await close(page);assert.deepEqual((await projectJSON(page,'files-cancelled.csv.json')).model,original.model);
  await openPanel(page,'data');dialog=page.getByRole('dialog',{name:'Files & reports',exact:true});await dialog.getByRole('tab',{name:'Import data',exact:true}).click();await loadCSV('minute_stamp,note\n0,first\n0.5,second\n1,third\n');await screenshot(page,'files-csv-preview.png');await dialog.getByRole('button',{name:'Apply 3 rows',exact:true}).click();await close(page);
  const applied=await projectJSON(page,'files-applied.json'),source=applied.model.nodes.find(n=>n.kind==='source');assert.deepEqual(source.arrival,{kind:'schedule',times:[0,30,60]});assert.equal(source.samplingId,original.model.nodes.find(n=>n.kind==='source').samplingId);check([44,45],'Explicit column/minute mapping, tab-persistent preview, cancel preserves model; actualapplied seconds0/30/60','files-applied.json');
  await openPanel(page,'data');dialog=page.getByRole('dialog',{name:'Files & reports',exact:true});await dialog.getByRole('tab',{name:'Import data',exact:true}).click();await loadCSV('minute_stamp\n0\n3\n2\n');await dialog.locator('.ql-operation-status [role=alert]').waitFor();assert.match(await dialog.locator('.ql-operation-status').innerText(),/non-decreasing/);await close(page);assert.deepEqual((await projectJSON(page,'files-invalid-preserved.json')).model,applied.model);
  await page.evaluate(async template=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('queuelab-projects',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise((resolve,reject)=>{const tx=db.transaction(['projects','meta'],'readwrite');for(let i=0;i<45;i++){const p=structuredClone(template);p.id=`synthetic-library-${String(i).padStart(2,'0')}`;p.name=i===0?'Far oldest match':`Synthetic library ${i}`;p.revision=0;delete p.savedAt;const savedAt=new Date(Date.UTC(2020,0,1,0,0,i)).toISOString();tx.objectStore('projects').put({id:p.id,revision:0,savedAt,payload:JSON.stringify(p)});tx.objectStore('meta').put({key:`project-summary:${p.id}`,id:p.id,name:p.name,revision:0,savedAt});}tx.objectStore('projects').put({id:'future-preserved',revision:0,savedAt:'2020-01-01T00:00:00.000Z',payload:'{"schemaVersion":99}'});tx.objectStore('meta').put({key:'project-summary:future-preserved',id:'future-preserved',name:'Future preserved',revision:0,savedAt:'2020-01-01T00:00:00.000Z'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}},original);
  await openPanel(page,'data');dialog=page.getByRole('dialog',{name:'Files & reports',exact:true});await dialog.getByRole('tab',{name:'Projects',exact:true}).click();await dialog.getByRole('searchbox',{name:'Search saved projects',exact:true}).fill('Far oldest match');await dialog.getByRole('button',{name:'Search library',exact:true}).click();await dialog.locator('.ql-saved-projects li').filter({hasText:'Far oldest match'}).waitFor();assert.match(await dialog.innerText(),/All indexed summaries were searched/);await screenshot(page,'files-library.png');
  await dialog.getByRole('searchbox',{name:'Search saved projects',exact:true}).fill('Future preserved');await dialog.getByRole('button',{name:'Search library',exact:true}).click();await dialog.locator('.ql-saved-projects li').filter({hasText:'Future preserved'}).getByRole('button',{name:'Review & open',exact:true}).click();await dialog.locator('.ql-operation-status [role=alert]').waitFor();
  const retained=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('queuelab-projects',2);r.onsuccess=()=>resolve(r.result);});try{return await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('future-preserved');r.onsuccess=()=>resolve(r.result.payload);});}finally{db.close();}});assert.equal(retained,'{"schemaVersion":99}');await close(page);assert.deepEqual((await projectJSON(page,'files-library-preserved.json')).model,applied.model);check([42,47,48],'Metadata search finds oldest itembeyond20, explicitcomplete scope; damagedfuturepayload/currentdraft preserved','files-library-preserved.json');
  await openPanel(page,'insights');await page.locator('.ease-report-chooser>summary').click();const popupEvent=page.waitForEvent('popup');await page.getByRole('button',{name:'Print / save as PDF',exact:true}).click();const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');assert((await popup.locator('body').innerText()).includes((await state(page)).result.hash));await fs.writeFile(path.join(out,'print-report.html'),await popup.content());await popup.close();await close(page);check([46],'Print/PDF route opens the recorded run HTML; no physical print/PDFsave claimed','print-report.html');
 }catch(error){await screenshot(page,'files-failure.png');await fs.writeFile(path.join(out,'files-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}
}

async function routeCancelPhase(){const {context,page}=await fresh();try{await openPanel(page,'model');await page.getByRole('combobox',{name:'New step type',exact:true}).selectOption('route');await page.locator('.ql-step-navigation').getByRole('button',{name:'Add step',exact:true}).click();await close(page);const before=await projectJSON(page,'route-before.json'),route=before.model.nodes.find(n=>n.kind==='route');await inspect(page,route.label);const input=page.locator('.ease-quick-properties input[role=spinbutton]').first();await input.fill('90');await input.press('Enter');await input.fill('');await page.locator('.ease-quick-properties').getByRole('button',{name:'Cancel change',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ease-quick-properties input[role=spinbutton]')?.value==='100');assert.equal(await primaryRunButton(page).isDisabled(),false);assert.deepEqual((await projectJSON(page,'route-after-cancel.json')).model,before.model);await screenshot(page,'route-cancel.png');check([18,26],'Staged route shares and raw invalid text cancel completely without a model edit','route-after-cancel.json');}catch(error){await screenshot(page,'route-failure.png');throw error;}finally{await context.close();}}
async function previewPhase(){const {context,page}=await fresh();try{const before=await projectJSON(page,'preview-original.json'),station=before.model.nodes.filter(n=>n.kind==='service').at(-1),anchor=before.model.nodes.find(n=>n.kind==='service');await inspect(page,station.label);await page.locator('.ease-quick-properties>details').filter({hasText:'Next process step'}).locator('summary').click();await page.getByRole('combobox',{name:'Destination step',exact:true}).selectOption(anchor.id);assert.deepEqual((await projectJSON(page,'preview-staged-link.json')).model,before.model);await page.locator('.studio-rail').getByRole('button',{name:'Add step',exact:true}).click();assert.match(await page.locator('.build-link-preview').innerText(),new RegExp(station.label));await page.getByRole('combobox',{name:'Add after',exact:true}).selectOption(anchor.id);await screenshot(page,'preview-insertion.png');assert.deepEqual((await projectJSON(page,'preview-no-mutation.json')).model,before.model);await page.locator('.build-prefab').first().click();const inserted=await projectJSON(page,'preview-inserted.json'),created=inserted.model.nodes.find(n=>!before.model.nodes.some(old=>old.id===n.id));assert(created);assert.equal(inserted.model.nodes.find(n=>n.id===anchor.id).next,created.id);assert.equal(created.next,anchor.next);await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'preview-undo.json')).model,before.model);check([12,22,23],'Preview priority, explicit insertion target, unchanged preview model and actualsplice/Undo','preview-inserted.json');}catch(error){await screenshot(page,'preview-failure.png');await fs.writeFile(path.join(out,'preview-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}}

async function libraryPhase(){const {context,page}=await fresh();try{const original=await projectJSON(page,'library-original.json');await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('queuelab-projects',2);r.onsuccess=()=>resolve(r.result);});await new Promise((resolve,reject)=>{const tx=db.transaction(['projects','meta'],'readwrite');tx.objectStore('projects').put({id:'future-preserved',revision:0,savedAt:'2020-01-01T00:00:00.000Z',payload:'{"schemaVersion":99}'});tx.objectStore('meta').put({key:'project-summary:future-preserved',id:'future-preserved',name:'Future preserved',revision:0,savedAt:'2020-01-01T00:00:00.000Z'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();});await openPanel(page,'data');const dialog=page.getByRole('dialog',{name:'Files & reports',exact:true});await dialog.getByRole('searchbox',{name:'Search saved projects',exact:true}).fill('Future preserved');await dialog.getByRole('button',{name:'Search library',exact:true}).click();await dialog.locator('.ql-saved-projects li').filter({hasText:'Future preserved'}).getByRole('button',{name:'Review & open',exact:true}).click();await dialog.locator('.ql-operation-status [role=alert]').waitFor();await screenshot(page,'library-damaged-record.png');const preserved=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('queuelab-projects',2);r.onsuccess=()=>resolve(r.result);});try{return await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('future-preserved');r.onsuccess=()=>resolve(r.result.payload);});}finally{db.close();}});assert.equal(preserved,'{"schemaVersion":99}');await close(page);assert.deepEqual((await projectJSON(page,'library-after-rejected-open.json')).model,original.model);check([42,47,48],'Actual libraryreview rejectsfuture/damagedpayloadwithout deletingrecord or replacingdraft','library-after-rejected-open.json');await openPanel(page,'insights');await page.locator('.ease-report-chooser>summary').click();const popupEvent=page.waitForEvent('popup');await page.getByRole('button',{name:'Print / save as PDF',exact:true}).click();const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');assert((await popup.locator('body').innerText()).includes((await state(page)).result.hash));await fs.writeFile(path.join(out,'print-report.html'),await popup.content());await popup.close();await close(page);check([46],'Print/PDF route opens the actual recordedreportHTML; physicalPDFsave notclaimed','print-report.html');}catch(error){await screenshot(page,'library-failure.png');await fs.writeFile(path.join(out,'library-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}}

async function profilesPhase(){const {context,page}=await fresh('service');try{const original=await projectJSON(page,'profiles-original.json'),source=original.model.nodes.find(n=>n.kind==='source'),initial=await state(page);await inspect(page,source.label);await page.locator('.ease-quick-properties summary').filter({hasText:/^Preview an arrival profile$/}).click();const profile=page.getByRole('combobox',{name:'Preview an arrival profile',exact:true});for(const kind of ['regular','peak','waves']){await profile.selectOption(kind);assert.equal((await state(page)).revision,initial.revision);}assert.deepEqual((await projectJSON(page,'profiles-preview-unchanged.json')).model,original.model);await page.getByRole('button',{name:'Apply profile',exact:true}).click();const applied=await projectJSON(page,'profiles-waves.json'),changed=applied.model.nodes.find(n=>n.id===source.id);assert.equal(changed.arrival.kind,'poisson');assert.equal(changed.arrival.segments.length,4);assert.equal(changed.samplingId,source.samplingId);assert.deepEqual(applied.model.resources,original.model.resources);const expected=node=>node.arrival.segments.reduce((sum,p)=>sum+(p.end-p.start)*p.perHour/3600,0);assert(Math.abs(expected(source)-expected(changed))<1e-9);await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'profiles-undo.json')).model,original.model);check([3,6,7],'Regular/peakhour/waves preview no edits; explicitwaves preserve demand expectation, identity and one Undo','profiles-waves.json');
 await page.getByRole('button',{name:'Scenario settings',exact:true}).click();await page.getByRole('button',{name:'8 hours',exact:true}).click();await page.getByRole('combobox',{name:'Arrival and shift plan',exact:true}).selectOption('repeat');await screenshot(page,'profiles-repeat-preview.png');await page.getByRole('button',{name:'Apply run length',exact:true}).click();await close(page);const repeated=await projectJSON(page,'profiles-repeated.json');assert.equal(repeated.model.horizon,28800);assert.equal(repeated.model.nodes.find(n=>n.id===source.id).arrival.segments.length,source.arrival.segments.length*8);for(const pool of original.model.resources)assert.equal(repeated.model.resources.find(n=>n.id===pool.id).calendar.length,pool.calendar.length*8);await page.getByRole('button',{name:/^Undo /}).click();
 await page.getByRole('button',{name:'Scenario settings',exact:true}).click();await page.getByRole('button',{name:'30 min',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Apply run length',exact:true}).isDisabled(),true);await page.getByRole('combobox',{name:'Arrival and shift plan',exact:true}).selectOption('crop');await page.getByRole('button',{name:'Apply run length',exact:true}).click();await close(page);const cropped=await projectJSON(page,'profiles-cropped.json');assert.equal(cropped.model.horizon,1800);assert(cropped.model.nodes.find(n=>n.id===source.id).arrival.segments.every(p=>p.end<=1800&&p.start<p.end));assert(cropped.model.resources.every(pool=>pool.calendar.every(p=>p.end<=1800)));await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'profiles-crop-undo.json')).model,original.model);check([1,5,6,15],'Explicitrepeatextendsarrival/shiftperiods; shrinkKeeprejected; explicitcropandUndo preserve original data','profiles-repeated.json');
 }catch(error){await screenshot(page,'profiles-failure.png');await fs.writeFile(path.join(out,'profiles-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}}

async function guardsPhase(){const {context,page}=await fresh();try{const original=await projectJSON(page,'guards-original.json'),accepted=(await state(page)).result;const huge=structuredClone(original);huge.model.horizon=365*86400;huge.model.nodes.find(n=>n.kind==='source').arrival={kind:'fixed',perHour:10000000};await headerProjectInput(page).setInputFiles({name:'large-cancel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(huge))});await primaryRunButton(page).click();await page.getByRole('button',{name:'Cancel calculation',exact:true}).click();await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text());return !s.running&&s.latestAttempt?.status==='cancelled';});assert.equal((await state(page)).result.hash,accepted.hash);assert.deepEqual((await projectJSON(page,'guards-cancelled-draft.json')).model,huge.model);check([26,38,48],'Actual large-worker cancellation preserves edited draft and last completed result','guards-cancelled-draft.json');
 const burst=structuredClone(original),source=burst.model.nodes.find(n=>n.kind==='source'),sink=burst.model.nodes.find(n=>n.kind==='sink');burst.model.horizon=1;burst.model.warmup=0;burst.model.resources=[];source.arrival={kind:'schedule',times:Array(100000).fill(0)};source.next='instant-0';const delays=Array.from({length:11},(_,i)=>({id:`instant-${i}`,samplingId:`instant-${i}`,label:`Synthetic instant stage ${i+1}`,kind:'delay',duration:{kind:'constant',value:0},next:i===10?sink.id:`instant-${i+1}`}));burst.model.nodes=[source,...delays,sink];await headerProjectInput(page).setInputFiles({name:'timestamp-limit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(burst))});await primaryRunButton(page).click();await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text());return !s.running&&s.latestAttempt?.status==='limited';});const limited=await state(page);assert.equal(limited.result.hash,accepted.hash);assert.match(limited.latestAttempt.reason,/Timestamp transition budget/);await page.getByRole('button',{name:'Review incomplete run',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Reports',exact:true}).getAttribute('aria-selected'),'true');const attempt=page.locator('section[aria-label="Latest incomplete attempt"]');const bytes=await saveDownload(page,attempt.getByRole('button',{name:'Download run JSON',exact:true}),'guards-limited-run.json');const report=JSON.parse(bytes.toString());assert.equal(report.status,'limited');assert.equal(report.provenance.limits.maxMicrosteps,1000000);assert.equal(report.summary.arrivals,report.summary.completed+report.summary.inSystem+report.summary.balked+report.summary.reneged);await screenshot(page,'guards-incomplete-report.png');check([24,46,48],'Actual timestamp safety limit remains explicitly incomplete; prior accepted result preserved and realpartialJSON exported','guards-limited-run.json');
 }catch(error){await screenshot(page,'guards-failure.png');await fs.writeFile(path.join(out,'guards-failure.txt'),`${error}\n${await page.locator('body').innerText()}`);throw error;}finally{await context.close();}}

async function printPhase(){const {context,page}=await fresh();try{const snapshot=await state(page);await openPanel(page,'insights');await page.locator('.ease-report-chooser>summary').click();const event=page.waitForEvent('popup');await page.getByRole('button',{name:'Print / save as PDF',exact:true}).click();const report=await event;await report.waitForLoadState('domcontentloaded');assert((await report.locator('body').innerText()).includes(snapshot.result.hash));assert((await report.locator('body').innerText()).includes(String(snapshot.result.summary.completed)));await fs.writeFile(path.join(out,'actual-print-report.html'),await report.content());await report.close();check([46],'Actualprint/PDFreportwindowcontainsrecordedmodelhashandcompletedcount; noOSPDFsaveclaim','actual-print-report.html');}finally{await context.close();}}

async function navigationPhase(){const {context,page}=await fresh();try{const original=await projectJSON(page,'navigation-original.json'),packing=original.model.nodes.filter(n=>n.kind==='service').at(-1),first=original.model.nodes.find(n=>n.kind==='service');await inspect(page,first.label);const before=await state(page);await openPanel(page,'insights');await page.getByRole('dialog').getByRole('button',{name:packing.label,exact:true}).click();await page.waitForFunction(id=>JSON.parse(window.render_game_to_text()).selected===id,packing.id);assert.equal((await state(page)).revision,before.revision);assert.equal((await state(page)).result.hash,before.result.hash);await page.locator('.quality-duration-options>summary').click();await page.getByRole('combobox',{name:'How to change the duration',exact:true}).selectOption('fixed');assert.equal((await state(page)).revision,before.revision);await page.getByRole('button',{name:'Convert to a fixed duration at this mean',exact:true}).click();const fixed=await projectJSON(page,'navigation-fixed-duration.json');assert.equal(fixed.model.nodes.find(n=>n.id===packing.id).duration.kind,'constant');assert.equal(fixed.model.nodes.find(n=>n.id===packing.id).samplingId,packing.samplingId);await page.getByRole('button',{name:/^Undo /}).click();assert.deepEqual((await projectJSON(page,'navigation-undo-fixed.json')).model,original.model);check([10,29],'ResultrowopenscorrectPropertieswithoutmodelchange; fixedconversion explicitandUndo restoresoriginalshape','navigation-fixed-duration.json');}finally{await context.close();}}

async function qualityPhase() {
 const { context, page } = await fresh();
 try {
  const original = await projectJSON(page, 'quality-original.json'), initial = await state(page);
  const packing = original.model.nodes.find(node => node.id === 'station-c');
  const mean = (packing.duration.min + packing.duration.mode + packing.duration.max) / 3;
  const meanInput = page.getByRole('spinbutton', { name: 'Mean processing time', exact: true });
  assert.equal(await meanInput.inputValue(), String(mean));
  assert.equal(await meanInput.locator('..').locator('.ease-number-reading').innerText(), String(Number(mean.toPrecision(6))));
  const canvasHeight = await page.locator('[data-testid="world-scene"]').evaluate(node => node.getBoundingClientRect().height);
  await meanInput.fill('');
  await page.locator('.ease-pending-banner').waitFor();
  assert.equal(await page.locator('[data-testid="world-scene"]').evaluate(node => node.getBoundingClientRect().height), canvasHeight);
  assert.equal((await state(page)).revision, initial.revision);
  await meanInput.press('Escape');
  await meanInput.focus(); await meanInput.press('Tab');
  const unit = page.getByRole('combobox', { name: 'Unit for Mean processing time', exact: true });
  await unit.selectOption('minutes'); await unit.selectOption('hours'); await unit.selectOption('seconds');
  assert.deepEqual((await projectJSON(page, 'quality-display-only.json')).model, original.model);
  assert.equal((await state(page)).revision, initial.revision);
  assert.equal((await state(page)).result.hash, initial.result.hash);
  await meanInput.press('ArrowUp'); await meanInput.press('Enter');
  const increased = await projectJSON(page, 'quality-arrow-increment.json');
  const changed = increased.model.nodes.find(node => node.id === packing.id);
  assert.equal(changed.duration.kind, 'triangular');
  assert(Math.abs((changed.duration.min + changed.duration.mode + changed.duration.max) / 3 - mean - 1) < 1e-10);
  assert.equal(changed.samplingId, packing.samplingId);
  await page.getByRole('button', { name: /^Undo / }).click();
  assert.deepEqual((await projectJSON(page, 'quality-undo-precision.json')).model, original.model);
  await page.getByRole('button', { name: 'Scenario settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Unit for Run length', exact: true }).selectOption('seconds');
  const length = page.getByRole('spinbutton', { name: 'Run length', exact: true });
  await length.fill('1000000'); await length.press('Enter'); await length.press('ArrowUp'); await length.press('Enter');
  assert.equal(await length.inputValue(), '1000001');
  await length.press('Tab'); assert.equal(await length.inputValue(), '1000001');
  await page.getByRole('button', { name: 'Cancel change', exact: true }).click(); await close(page);
  assert.deepEqual((await projectJSON(page, 'quality-long-time-cancel.json')).model, original.model);
  check(['B4'], 'Rounded time display, focus/blur, units and precise arrow increments preserve canonical model and distribution', 'quality-arrow-increment.json');

  const navigationRevision = (await state(page)).revision;
  await page.getByRole('button', { name: 'Scenario settings', exact: true }).click();
  await page.getByRole('button', { name: /^Change arrivals/ }).click();
  assert.equal((await state(page)).selected, original.model.nodes.find(node => node.kind === 'source').id);
  await page.getByRole('button', { name: 'Scenario settings', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Packing team', exact: true }).click();
  assert.equal((await state(page)).selected, packing.id);
  const team = page.locator('.ease-team').filter({ hasText: 'Packing team' });
  assert(await team.getByRole('spinbutton', { name: 'Base available units', exact: true }).isVisible());
  assert.equal((await state(page)).revision, navigationRevision);
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  assert.equal(await page.locator('.quality-guide-progress li').count(), 3);
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await page.getByRole('heading', { name: 'Run the changed plan', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Go to Run', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches('.studio-command-actions .studio-primary'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual((await projectJSON(page, 'quality-guide-navigation.json')).model, original.model);
  check(['B1', 'B3'], 'Scenario shortcuts inspect the right source/team; staffing visible; optional three-step guide reaches Run without changing the model', 'quality-guide-navigation.json');

  await page.locator('[data-testid="world-scene"][data-status="ready"]').waitFor();
  const scene = page.locator('[data-testid="world-scene"]');
  const beforeZoom = await scene.getAttribute('data-camera');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('[data-testid="world-scene"]')?.getAttribute('data-camera') !== previous, beforeZoom);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const manualCamera = JSON.parse(await scene.getAttribute('data-camera'));
  await field(page, 'Parallel stations', 2);
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="world-scene"]').dataset.capacityCopies).find(item => item.id === 'station-c')?.count === 2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(JSON.parse(await scene.getAttribute('data-camera')), manualCamera);
  await page.getByRole('complementary', { name: 'Check team capacity', exact: true }).waitFor();
  const stationOnly = await projectJSON(page, 'quality-station-only.json');
  assert.deepEqual(stationOnly.model.resources, original.model.resources);
  assert.match(await page.locator('.quality-capacity-note').innerText(), /1 base unit available/);
  await screenshot(page, 'quality-capacity-and-camera.png');
  check(['A1', 'A6', 'B3'], 'Manual zoom survives station-count edit; separate base team limit is explained without auto-increasing resources', 'quality-station-only.json');
  await page.getByRole('button', { name: 'Show the whole world', exact: true }).click();
  const canvas = page.locator('[data-testid="world-canvas"]'), box = await canvas.boundingBox();
  await canvas.click({ position: { x: 25, y: box.height - 18 } });
  await scene.locator('button[data-station-id="station-c"]').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fittedCamera = await scene.getAttribute('data-camera');
  await field(page, 'Parallel stations', 100);
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="world-scene"]').dataset.capacityCopies).find(item => item.id === 'station-c')?.count === 100);
  assert.notDeepEqual(JSON.parse(await scene.getAttribute('data-camera')), JSON.parse(fittedCamera));
  const beforePan = await scene.getAttribute('data-camera');
  await page.mouse.move(box.x + 25, box.y + box.height - 18); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height - 40, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(previous => document.querySelector('[data-testid="world-scene"]')?.getAttribute('data-camera') !== previous, beforePan);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pannedCamera = JSON.parse(await scene.getAttribute('data-camera'));
  await field(page, 'Parallel stations', 200);
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="world-scene"]').dataset.capacityCopies).find(item => item.id === 'station-c')?.count === 200);
  assert.deepEqual(JSON.parse(await scene.getAttribute('data-camera')), pannedCamera);
  await screenshot(page, 'quality-camera-growth.png');
  check(['A1', 'A6'], 'An ordinary canvas click keeps auto framing; genuine pointer pan disables auto framing and survives further capacity growth', 'quality-camera-growth.png');
 } catch (error) {
  await screenshot(page, 'quality-failure.png');
  await fs.writeFile(path.join(out, 'quality-failure.txt'), `${error}\n${await page.locator('body').innerText()}`);
  throw error;
 } finally { await context.close(); }
}

try {
 if (phase === 'core') await core(); else if(phase === 'editor') await editor(); else if(phase==='lab') await lab(); else if(phase==='editor-validation')await validationPhase(); else if(phase==='files')await files(); else if(phase==='route-cancel')await routeCancelPhase(); else if(phase==='preview')await previewPhase(); else if(phase==='library')await libraryPhase(); else if(phase==='profiles')await profilesPhase(); else if(phase==='guards')await guardsPhase(); else if(phase==='print')await printPhase(); else if(phase==='navigation')await navigationPhase(); else if(phase==='quality')await qualityPhase(); else throw new Error(`Unknown phase ${phase}`);
 assert.deepEqual(receipt.errors, []); console.log(JSON.stringify({ checks: receipt.checks.length, files: receipt.files.length, errors: receipt.errors }));
} finally { await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2)); await browser.close(); }
