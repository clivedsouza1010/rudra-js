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
    ],
  },
});
