import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'bench/**/*.test.ts',
      'crawl/**/*.test.ts',
      'examples/*/src/**/*.test.ts',
      'examples/*/src/**/*.test.tsx',
    ],
    env: {
      RUDRA_SHOP_RECORDINGS: fileURLToPath(new URL('examples/shop/recordings/', import.meta.url)),
      RUDRA_REPLAY_ONLY: '1',
    },
  },
});
