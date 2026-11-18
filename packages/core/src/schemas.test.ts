import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CoreManifest {
  files: string[];
  exports: Record<string, { types: string; default: string }>;
}

interface FolderManifest {
  main: string;
  types: string;
}

function readManifest<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

const manifest = readManifest<CoreManifest>('../package.json');
const folder = readManifest<FolderManifest>('../schemas/package.json');
const entry = manifest.exports['./schemas'];

describe('the schemas folder, for tools that ignore package exports', () => {
  it('points at the same code as the ./schemas export', () => {
    expect(posix.join('schemas', folder.main)).toBe(posix.join(entry?.default ?? ''));
  });

  it('points at the same types as the ./schemas export', () => {
    expect(posix.join('schemas', folder.types)).toBe(posix.join(entry?.types ?? ''));
  });

  it('ships with the package', () => {
    expect(manifest.files).toContain('schemas');
  });
});
