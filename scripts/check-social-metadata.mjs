import {build,loadConfigFromFile} from 'vite';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const out=path.resolve(process.env.QUEUELAB_EVIDENCE_DIR||'.private/evidence/social-metadata');await fs.mkdir(out,{recursive:true});
await fs.mkdir(path.resolve('.cache/tmp'),{recursive:true});process.env.TMPDIR=path.resolve('.cache/tmp');
const previous=process.env.QUEUELAB_PUBLIC_URL;
const report={scope:'Local build markup/format validation; no public host or platform crawler was contacted.',rejected:[]};
try{
  const loaded=await loadConfigFromFile({command:'build',mode:'production'},path.resolve('vite.config.ts'));
  const plugin=loaded.config.plugins.flat(Infinity).find(p=>p?.name==='queuelab-social-metadata');
  assert(plugin&&typeof plugin.transformIndexHtml==='function');
  const tags=value=>{if(value===undefined)delete process.env.QUEUELAB_PUBLIC_URL;else process.env.QUEUELAB_PUBLIC_URL=value;return plugin.transformIndexHtml('');};
  assert.deepEqual(tags(undefined),[]);assert.deepEqual(tags('  '),[]);
  for(const value of ['http://queuelab.example/','https://localhost/','https://x.localhost/','https://x.localhost./','https://x.local./','https://127.0.0.1/','https://[::1]/','https://someone:synthetic-secret@queuelab.example/','https://queuelab.example/subpath','https://queuelab.example/bad.path/','https://queuelab.example/?token=synthetic-secret','https://queuelab.example/#draft','https://queuelab.example/?','https://queuelab.example/#','https://queuelab.example:8443/']){
    assert.throws(()=>tags(value),error=>error.message.includes('QUEUELAB_PUBLIC_URL must')&&!error.message.includes('synthetic-secret'));
    report.rejected.push(value.replace(/synthetic-secret/g,'SYNTHETIC_REDACTED'));
  }
  process.env.QUEUELAB_PUBLIC_URL='https://queuelab.example';
  await build({configFile:path.resolve('vite.config.ts'),logLevel:'silent',build:{outDir:path.join(out,'valid-build'),emptyOutDir:true}});
  const html=await fs.readFile(path.join(out,'valid-build/index.html'),'utf8');
  for(const expected of ['rel="canonical" href="https://queuelab.example/"','property="og:url" content="https://queuelab.example/"','property="og:image" content="https://queuelab.example/social-card.png"','name="twitter:card" content="summary_large_image"','property="og:image:width" content="1280"','property="og:image:height" content="640"'])assert(html.includes(expected),expected);
  process.env.QUEUELAB_PUBLIC_URL='https://queuelab.example/loopset/';
  await build({configFile:path.resolve('vite.config.ts'),logLevel:'silent',base:'/loopset/',build:{outDir:path.join(out,'subpath-build'),emptyOutDir:true}});
  const subpath=await fs.readFile(path.join(out,'subpath-build/index.html'),'utf8');
  for(const expected of ['href="https://queuelab.example/loopset/"','content="https://queuelab.example/loopset/social-card.png"','src="/loopset/assets/','href="/loopset/favicon.svg"'])assert(subpath.includes(expected),expected);
  const local=await fs.readFile('dist/index.html','utf8');assert(!local.includes('og:url')&&!local.includes('rel="canonical"'),'Unconfigured working preview must not invent a public origin');
  const png=await fs.readFile('public/social-card.png');assert(png.length<1_000_000);assert.equal(png.readUInt32BE(16),1280);assert.equal(png.readUInt32BE(20),640);
  report.status='passed';report.defaultOrigin='unset, no canonical/OG URL';report.configuredOrigin='https://queuelab.example/ (reserved test fixture, not a deployment)';report.imageBytes=png.length;
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('PASS: optional/explicit build metadata, 15 rejected formats; root and subpath metadata, non-leaking errors and 1280x640 artwork under1MB.');
}finally{if(previous===undefined)delete process.env.QUEUELAB_PUBLIC_URL;else process.env.QUEUELAB_PUBLIC_URL=previous;}
