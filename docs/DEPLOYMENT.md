# Static hosting

The browser demo is published at **https://berkebasbay.github.io/loopset/**. The `Publish demo` workflow checks each `main` revision before building and deploying its static files. Pull requests run `Verify changes`. No provider token, API key or backend is required.

The deployed `build-info.json` records its source commit and application version. Check that identity when reporting a hosted issue.

Build with Node.js 24 and the lockfile:

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:headless
npm run preview
```

`dist/` is the complete static application. Simulations run in the browser; no account, paid API, application backend or database server is required. To serve the built files on loopback:

```sh
node scripts/serve-local.mjs dist 4173
```

## Hosting requirements

Serve over HTTPS with correct JavaScript worker, font, image and model MIME types. `QUEUELAB_PUBLIC_URL` sets both the canonical URL and deployment base, including a slash-terminated subpath such as `/loopset/`. Models, fonts, previews and workers must load from that same deployment base.

An illustrative production header policy is:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

`connect-src 'self'` permits the locally served model/asset fetches. Inline styles are used by the scene and report layout. The model decoder needs WebAssembly compilation; inline JavaScript and JavaScript eval are unnecessary in a production build. Apply headers in the selected host's configuration and verify the real deployment. Host logging, terms and costs are separate from the application's lack of analytics or model upload.

For a manual Pages-compatible build:

```sh
QUEUELAB_PUBLIC_URL=https://berkebasbay.github.io/loopset/ npm run build
```

The Pages workflow reads the configured site URL automatically. To add a custom domain later, configure it in the repository's Pages settings and DNS, then rebuild; a domain-root deployment uses `/`. Project JSON transfers work between the previous and new origins. The build option itself does not register a domain.

## Promotion and rollback

Identify releases by their source commit and retain the previous build for rollback. Check the deployed entry, workers, three worlds, project files and reports after changing hosting or build settings. Custom hosts should retain earlier content-hashed assets while existing tabs use them.

Browser storage is origin-specific. Changing host, port or browser does not move existing projects; use portable JSON. Rollback must preserve IndexedDB and downloaded files rather than deleting data or forcing an unsupported schema to load. Check the served `build-info.json` when diagnosing a hosted revision.
