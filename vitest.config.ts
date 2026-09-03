import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      // Workspace-level checks that belong to no single package. Both
      // extensions, so a .tsx test here is never typechecked but silently
      // never run.
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'bench/**/*.test.ts',
      'crawl/**/*.test.ts',
      'examples/*/src/**/*.test.ts',
      'examples/*/src/**/*.test.tsx',
    ],
    env: {
      // The shop anchors its recordings on `process.cwd()`, because Next
      // bundles server modules and `import.meta.url` then points into `.next/`.
      // Vitest runs from this directory instead, so it has to be told where the
      // shop is — otherwise every replay is a miss and the guard that watches
      // for a silent fallback never arms.
      RUDRA_SHOP_RECORDINGS: fileURLToPath(new URL('examples/shop/recordings/', import.meta.url)),
    },
  },
});
