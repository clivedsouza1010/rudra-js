import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the react entry', () => {
  it('loads without node:crypto, so a browser bundle can take it', () => {
    const run = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'browser-without-node-crypto.mjs')],
      { encoding: 'utf8' },
    );

    expect(run.status, run.stderr || String(run.error)).toBe(0);
    expect(run.stderr).not.toContain('the react entry imported');
    expect(run.stdout.trim()).toBe('function');
  });
});
