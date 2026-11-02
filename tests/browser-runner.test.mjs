import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('browser runner refuses an occupied port and leaves the existing server alive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'loopset-browser-'));
  const server = createServer((_request, response) => response.end('existing-server'));
  try {
    await fs.writeFile(path.join(root, 'index.html'), '<div id="root"></div>');
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/browser-checks.mjs'], { env: { ...process.env, QUEUELAB_BROWSER_PORT: String(port), QUEUELAB_BROWSER_DIST: root, QUEUELAB_EVIDENCE_DIR: path.join(root, 'evidence') }, timeout: 40000 }), error => error.code === 1 && /Port .* is already in use/.test(error.stderr));
    assert.equal(await fetch(`http://127.0.0.1:${port}/`).then(r => r.text()), 'existing-server');
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
