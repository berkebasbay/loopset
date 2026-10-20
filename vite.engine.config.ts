import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-engine',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: { entry: 'src/public-api.ts', formats: ['es'], fileName: () => 'queuelab.js' },
  },
  plugins: [{
    name: 'queuelab-license-notices',
    generateBundle() {
      for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(new URL(name, import.meta.url), 'utf8') });
      }
      // TypeScript emits declarations; normalize their relative specifiers for
      // native NodeNext consumers as well as bundler-based TypeScript projects.
      const root = resolve('.cache/engine-types');
      const declarations = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? declarations(join(folder, entry.name)) : entry.name.endsWith('.d.ts') ? [join(folder, entry.name)] : []);
      for (const file of declarations(root)) {
        const source = readFileSync(file, 'utf8').replace(/(from\s+['"]|import\(['"])(\.[^'"]+)(['"])/g, (match, prefix: string, specifier: string, quote: string) => {
          const target = resolve(dirname(file), specifier);
          const suffix = existsSync(`${target}.d.ts`) ? '.js' : existsSync(join(target, 'index.d.ts')) ? '/index.js' : '';
          return suffix ? `${prefix}${specifier}${suffix}${quote}` : match;
        });
        this.emitFile({ type: 'asset', fileName: `types/${relative(root, file).replaceAll('\\', '/')}`, source });
      }
    },
  }],
});
