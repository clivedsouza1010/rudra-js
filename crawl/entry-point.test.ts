import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isEntryPoint } from './entry-point.js';

const here = fileURLToPath(import.meta.url);

describe('isEntryPoint', () => {
  it('is true when the entry is the module itself', () => {
    expect(isEntryPoint(import.meta.url, here)).toBe(true);
  });

  it('is false when the entry is another file', () => {
    expect(isEntryPoint(import.meta.url, join(dirname(here), 'entry-point.ts'))).toBe(false);
  });

  it('is true when the entry is a symlink to the module', () => {
    const link = join(mkdtempSync(join(tmpdir(), 'entry-point-')), 'link.ts');
    symlinkSync(here, link);

    expect(isEntryPoint(import.meta.url, link)).toBe(true);
  });

  it('is false when there is no entry', () => {
    expect(isEntryPoint(import.meta.url, undefined)).toBe(false);
  });
});
