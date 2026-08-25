import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      // Workspace-level checks that belong to no single package.
      'tests/**/*.test.ts',
    ],
  },
});
