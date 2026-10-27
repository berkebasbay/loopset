import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import type { HtmlTagDescriptor } from 'vite';
import { BRAND } from './src/brand.ts';

function socialMetadata(value: string | undefined): HtmlTagDescriptor[] {
  if (!value?.trim()) return [];
  const message = 'QUEUELAB_PUBLIC_URL must be an HTTPS domain origin at /, without credentials, a custom port, query or fragment.';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(message); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href !== `${url.origin}/` || !host.includes('.') || host.endsWith('.') || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host.replace(/^\[|\]$/g, ''))) throw new Error(message);
  const title = `${BRAND.name} — ${BRAND.tagline}`;
  const description = 'A free process and capacity simulator. Build a little world, find its bottleneck and compare plans.';
  const image = new URL('social-card.png', url).href;
  const alt = `${BRAND.name} with an actual miniature Factory scene and the words Build a little world. Try a better plan.`;
  const properties = {
    'og:type': 'website', 'og:site_name': BRAND.name, 'og:title': title,
    'og:description': description, 'og:url': url.href, 'og:image': image,
    'og:image:type': 'image/png', 'og:image:width': '1280', 'og:image:height': '640', 'og:image:alt': alt,
  };
  const twitter = { 'twitter:card': 'summary_large_image', 'twitter:title': title, 'twitter:description': description, 'twitter:image': image, 'twitter:image:alt': alt };
  return [
    { tag: 'link', attrs: { rel: 'canonical', href: url.href }, injectTo: 'head' },
    ...Object.entries(properties).map(([property, content]): HtmlTagDescriptor => ({ tag: 'meta', attrs: { property, content }, injectTo: 'head' })),
    ...Object.entries(twitter).map(([name, content]): HtmlTagDescriptor => ({ tag: 'meta', attrs: { name, content }, injectTo: 'head' })),
  ];
}

export default defineConfig({
  plugins: [react(), {
    name: 'queuelab-distribution-notices',
    generateBundle() {
      for (const fileName of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'public/fonts/OFL.txt']) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(fileName, import.meta.url), 'utf8') });
      }
    },
  }, {
    name: 'queuelab-social-metadata',
    apply: 'build',
    transformIndexHtml: () => socialMetadata(process.env.QUEUELAB_PUBLIC_URL),
  }],
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
