import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isEntryPoint } from './entry-point.js';

const here = fileURLToPath(import.meta.url);

const directories: string[] = [];
const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), 'entry-point-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('isEntryPoint', () => {
  it('is true when the entry is the module itself', () => {
    expect(isEntryPoint(import.meta.url, here)).toBe(true);
  });

  it('is false when the entry is another file', () => {
    expect(isEntryPoint(import.meta.url, join(dirname(here), 'entry-point.ts'))).toBe(false);
  });

  it('is true when the entry is a symlink to the module', () => {
    const link = join(scratch(), 'link.ts');
    symlinkSync(here, link);

    expect(isEntryPoint(import.meta.url, link)).toBe(true);
  });

  it('is false when there is no entry', () => {
    expect(isEntryPoint(import.meta.url, undefined)).toBe(false);
  });

  it('is false when the entry names a path that is not there', () => {
    const missing = join(scratch(), 'gone.ts');
    expect(isEntryPoint(import.meta.url, missing)).toBe(false);
  });
});
