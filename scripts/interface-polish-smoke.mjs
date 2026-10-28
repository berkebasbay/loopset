import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openPanel, runPlan } from './ui-actions.mjs';
const origin = new URL(process.env.QUEUELAB_URL || 'http://127.0.0.1:4173/');
assert(['127.0.0.1','localhost'].includes(origin.hostname), 'Use an isolated QA origin.');
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/interface-polish/checks');
await fs.mkdir(out,{recursive:true}); await fs.mkdir('.cache/tmp',{recursive:true}); process.env.TMPDIR=path.resolve('.cache/tmp');
let installed=true;try{await fs.access(chromium.executablePath())}catch{installed=false}
const browser=await chromium.launch({headless:true,...(installed?{executablePath:chromium.executablePath()}:{channel:'chrome'})});
const errors=[],checks=[];let page,stage='start';
const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
async function ready(p){await p.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text?.()||'{}');return !s.running&&s.result?.status==='completed'&&!s.result.stale})}
async function fresh(width=1440,height=960){const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',acceptDownloads:true});const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(origin.href);await ready(p);const pause=p.getByRole('button',{name:'Pause replay',exact:true});if(await pause.count())await pause.click();return{context,page:p}}
async function download(p,name){const next=p.waitForEvent('download');await p.locator('.studio-save').click();const file=await next,target=path.join(out,name);await file.saveAs(target);return JSON.parse(await fs.readFile(target,'utf8'))}
async function screenshot(name){await page.screenshot({path:path.join(out,name+'.png')})}
async function overflow(p){assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const dialog=p.getByRole('dialog');if(await dialog.count())assert(await dialog.evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=-1));}
try{
 const desktop=await fresh();page=desktop.page;const original=await download(page,'original.json');
 stage='exact-input';await page.getByRole('button',{name:'Show selection properties',exact:true}).click();
 const mean=page.getByRole('spinbutton',{name:'Mean processing time',exact:true}),exact=await mean.inputValue();
 assert(exact.length>9);assert.equal(await mean.evaluate(e=>getComputedStyle(e).color),'rgba(0, 0, 0, 0)');
 await mean.focus();assert.equal(await mean.inputValue(),exact);assert.equal(await mean.locator('..').locator('.ease-number-reading').evaluate(e=>getComputedStyle(e).visibility),'hidden');
 await mean.press('Tab');assert.deepEqual((await download(page,'unmodified-readout.json')).model,original.model);
 await mean.fill('invalid');await mean.press('Enter');assert.equal(await mean.getAttribute('aria-invalid'),'true');assert(await page.locator('.studio-command-actions .studio-primary').isDisabled());await screenshot('invalid-input');
 await mean.press('Escape');await mean.press('Tab');assert.deepEqual((await download(page,'cancelled-input.json')).model,original.model);
 checks.push('Compact numeric readout remains separate from exact focused input; invalid drafts and Escape preserve the numerical model');
 stage='recorded-label';await page.locator('[data-panel-opener="rename"]').click();await page.getByRole('textbox',{name:'Project name',exact:true}).fill('Polish verification');await page.getByRole('button',{name:'Rename',exact:true}).click();
 await openPanel(page,'insights');assert.equal(await page.locator('.insight-run-heading h3').innerText(),original.name);const stats=await page.locator('.insight-summary').boundingBox(),explanation=await page.locator('.ease-bottleneck').boundingBox();assert(stats.y<explanation.y);await screenshot('recorded-results');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 const stations=page.getByRole('spinbutton',{name:'Parallel stations',exact:true});await stations.fill('2');await stations.press('Enter');await runPlan(page);await openPanel(page,'insights');assert.equal(await page.locator('.insight-run-heading h3').innerText(),'Polish verification');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 checks.push('Results lead with recorded metrics and preserve the captured run label across a later project rename');
 stage='experiments';await openPanel(page,'experiments');const runs=page.getByRole('spinbutton',{name:'Runs per plan',exact:true});await runs.fill('2');await runs.press('Enter');await page.getByRole('button',{name:'Run experiment',exact:true}).click();await page.locator('.lab-results').waitFor();assert((await page.locator('.lab-table tbody tr').count())>0);await screenshot('experiment-results');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 checks.push('Polished experiment controls still execute and display real repeated-run results');
 stage='dialogs';for(const panel of ['data','model','budget','history','worlds','help','compare']){await openPanel(page,panel);await overflow(page);const heading=await page.locator('.modal-heading').boundingBox();await page.locator('.modal-body').evaluate(e=>e.scrollTop=e.scrollHeight);const after=await page.locator('.modal-heading').boundingBox();assert(Math.abs(after.y-heading.y)<1);assert(await page.getByRole('button',{name:'Close dialog',exact:true}).isVisible());await page.keyboard.press('Escape');assert(!await page.getByRole('dialog').count());}
 checks.push('All professional dialogs retain reachable headers, keyboard dismissal and viewport bounds');
 stage='forced-colors';await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});if(!await page.locator('.studio-properties').isVisible())await page.getByRole('button',{name:'Show selection properties',exact:true}).click();
 const forced=page.getByRole('spinbutton',{name:'Mean processing time',exact:true});assert.notEqual(await forced.evaluate(e=>getComputedStyle(e).color),'rgba(0, 0, 0, 0)');assert.equal(await forced.locator('..').locator('.ease-number-reading').evaluate(e=>getComputedStyle(e).display),'none');await screenshot('forced-colors');await desktop.context.close();
 checks.push('Forced colors uses a single native exact-value readout rather than overlapping presentation text');
 stage='short-viewport';const short=await fresh(1440,700);page=short.page;await page.locator('.library-tile').first().click();const cta=await page.getByRole('button',{name:'Place object',exact:true}).boundingBox();assert(cta.y>=0&&cta.y+cta.height<=700);await overflow(page);await screenshot('short-workspace');await short.context.close();
 checks.push('The library adapts to short desktop windows while keeping Place object visible');
 for(const width of [320,390]){stage=`mobile-${width}`;const mobile=await fresh(width,900);page=mobile.page;await openPanel(page,'model');await overflow(page);
 const picker=page.getByRole('combobox',{name:'Selected process step',exact:true});await picker.selectOption('station-a');assert(await page.getByRole('textbox',{name:'Step name',exact:true}).isVisible());await page.getByRole('button',{name:'Manage steps',exact:true}).click();assert(await page.locator('.ql-step-navigation').isVisible());await page.getByRole('button',{name:'Hide step list',exact:true}).click();await screenshot(`mobile-${width}-model`);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 for(const panel of ['data','compare','insights','experiments']){await openPanel(page,panel);await overflow(page);await page.getByRole('button',{name:'Close dialog',exact:true}).click()}
 await mobile.context.close()}
 checks.push('320px and390px layouts keep selected settings, full step management, files, results and experiments accessible without page overflow');
 stage='mobile-repair';const repair=await fresh(390,900);page=repair.page;const fixture=await download(page,'repair-base.json');await openPanel(page,'model');
 const picker=page.getByRole('combobox',{name:'Selected process step',exact:true});
 for(const node of [...fixture.model.nodes].reverse()){await picker.selectOption(node.id);await page.getByRole('button',{name:'Delete step',exact:true}).click();await page.getByRole('button',{name:'Delete and leave references disconnected',exact:true}).click()}
 assert.equal((await state(page)).model.length,0);
 const manage=page.getByRole('button',{name:'Manage steps',exact:true});assert(await manage.isVisible());await page.getByRole('button',{name:'Review process steps',exact:true}).first().click();
 await page.waitForFunction(()=>document.activeElement?.matches('.ql-step-navigation select')&&document.activeElement.getBoundingClientRect().top>=0&&document.activeElement.getBoundingClientRect().bottom<=innerHeight);
 await screenshot('mobile-empty-repair');await repair.context.close();checks.push('Global validation repair opens hidden mobile step management and focuses an add control for an empty synthetic model');
 assert.deepEqual(errors,[]);const receipt={passed:true,at:new Date().toISOString(),origin:origin.href,browser:browser.version(),checks,errors};await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(e){await fs.writeFile(path.join(out,'partial.json'),JSON.stringify({stage,checks,errors,error:String(e)},null,2));if(page&&!page.isClosed()){await screenshot('failure').catch(()=>{});await fs.writeFile(path.join(out,'failure.txt'),stage+'\n'+e+'\n'+await page.locator('body').innerText())}console.error(stage+'\n'+e);process.exitCode=1}finally{await browser.close()}
