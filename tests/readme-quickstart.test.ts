import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from, `${start} is missing`).toBeGreaterThan(-1);
  expect(to, `${end} is missing`).toBeGreaterThan(from);
  return text.slice(from + start.length, to).trim();
};

describe('the quickstart in the README', () => {
  it('is the code that quickstart.test.tsx runs', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const test = readFileSync(join(REPO_ROOT, 'tests/quickstart.test.tsx'), 'utf8');

    const shown = between(readme, '```tsx\n', '```');
    const run = between(test, '// --- quickstart ---', '// --- end quickstart ---');

    expect(shown, 'the README shows code the test does not run').toBe(run);
  });
});
