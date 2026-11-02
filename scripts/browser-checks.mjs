// Own only this preview and its isolated synthetic browser checks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const checks = [
  ['first-use', 'scripts/learning-smoke.mjs', {}],
  ['recovery-and-entry', 'scripts/readiness-smoke.mjs', {}],
  ['templates', 'scripts/templates-smoke.mjs', {}],
  ['original-worlds', 'scripts/ux-smoke.mjs', { QUEUELAB_UX_PHASE: 'core' }],
];
const selectedChecks = process.env.QUEUELAB_BROWSER_SUITE ? checks.filter(([name]) => name === process.env.QUEUELAB_BROWSER_SUITE) : checks;
assert(selectedChecks.length > 0, 'Unknown browser suite.');
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.QUEUELAB_BROWSER_PORT || 4173);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Choose a loopback test port between 1024 and 65535.');
const base = process.env.QUEUELAB_PUBLIC_URL ? new URL(process.env.QUEUELAB_PUBLIC_URL).pathname : '/';
assert(base.startsWith('/') && base.endsWith('/'), 'Use a slash-terminated deployment path.');
const origin = `http://127.0.0.1:${port}${base}`;
const out = path.resolve(process.env.QUEUELAB_EVIDENCE_DIR || '.private/evidence/browser-checks');
await fs.mkdir(out, { recursive: true });
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--base', base, '--outDir', process.env.QUEUELAB_BROWSER_DIST || 'dist'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let current, interrupted = false;
const stop = () => { interrupted = true; current?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
async function close(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await ended; } finally { clearTimeout(timer); }
}
try {
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Preview did not start within 30 seconds: ${stripVTControlCharacters(output)}`)), 30000);
    const fail = error => { clearTimeout(timer); reject(error); };
    server.once('error', fail);
    server.once('exit', code => fail(new Error(`Preview exited (${code}): ${output}`)));
    server.stdout.on('data', data => { output = (output + data).slice(-4096); if (stripVTControlCharacters(output).includes('Local:')) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', data => { output = (output + data).slice(-4096); });
  });
  const response = await fetch(origin, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'The owned preview must serve the built application.');
  assert.match(await response.text(), /id=["']root["']/);
  for (const [name, script, extra] of selectedChecks) {
    assert(!interrupted, 'Browser checks interrupted.');
    console.log(`Browser check: ${name}`);
    current = spawn(process.execPath, [script], { cwd: root, env: { ...process.env, ...extra, QUEUELAB_URL: origin, QUEUELAB_EVIDENCE_DIR: path.join(out, name) }, stdio: 'inherit' });
    const [code, signal] = await once(current, 'exit'); current = null;
    assert.equal(code, 0, `${name} failed${signal ? ` (${signal})` : ''}.`);
  }
  console.log(`Browser checks passed: ${selectedChecks.map(([name]) => name).join(', ')}.`);
} finally {
  await close(current); await close(server);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
