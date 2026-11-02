import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
test('dev HTTP blocks private folders and overrides, including raw and filesystem URLs', async () => {
  const root = process.cwd(), name = `boundary-${randomUUID()}`, created = [];
  let server;
  try {
    for (const dir of ['.private', '.cache']) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
      const file = path.join(root, dir, `${name}.md`); await fs.writeFile(file, 'Synthetic private fixture', { flag: 'wx' }); created.push(file);
    }
    const override = path.join(root, `${name}.override.md`); await fs.writeFile(override, 'Synthetic override fixture', { flag: 'wx' }); created.push(override);
    server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await server.listen(); const address = server.httpServer.address(); assert.equal(typeof address.port, 'number');
    const origin = `http://127.0.0.1:${address.port}${server.config.base}`;
    assert.equal((await fetch(new URL('README.md', origin), { method: 'HEAD' })).status, 200);
    for (const file of created) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      for (const url of [new URL(relative, origin), new URL(`${relative}?raw`, origin), new URL(`@fs/${file.split(path.sep).join('/')}`, origin)]) assert.equal((await fetch(url, { method: 'HEAD' })).status, 403);
    }
  } finally { await server?.close(); for (const file of created) await fs.unlink(file); }
});
