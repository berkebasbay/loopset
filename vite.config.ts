import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [react(), {
    name: 'queuelab-distribution-notices',
    generateBundle() {
      for (const fileName of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'public/fonts/OFL.txt']) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(fileName, import.meta.url), 'utf8') });
      }
    },
  }],
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
