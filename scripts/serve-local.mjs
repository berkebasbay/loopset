// Dependency-free static delivery only; simulations and project data stay in the browser.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = await realpath(resolve(process.argv[2] ?? 'dist'));
const port = Number(process.argv[3] ?? 4173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a local port between1024 and65535.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.gz': 'application/gzip', '.hdr': 'application/octet-stream' };
const compressed = new Map();
createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404); response.end(); return; }
    const extension = extname(file), headers = { 'Content-Type': types[extension] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    const mayCompress = ['.html', '.js', '.css', '.json', '.ttf', '.svg'].includes(extension);
    if (mayCompress) headers.Vary = 'Accept-Encoding';
    let bytes;
    if (mayCompress && /(?:^|,)\s*gzip\s*(?:,|$)/i.test(request.headers['accept-encoding'] ?? '')) {
      // Only immutable packaged files are cached. GLB.gz files are sent as files;
      // CatalogStore handles their decoding and fallback explicitly.
      bytes = compressed.get(file);
      if (!bytes) { bytes = gzipSync(await readFile(file), { level: 9 }); compressed.set(file, bytes); }
      headers['Content-Encoding'] = 'gzip';
    } else bytes = await readFile(file);
    headers['Content-Length'] = String(bytes.length); response.writeHead(200, headers); response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log(`QueueLab: http://localhost:${port}/ (Ctrl+C to stop)`));
