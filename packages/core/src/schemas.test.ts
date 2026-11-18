import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readManifest(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

describe('the schemas entry', () => {
  it('exports the built schemas files', () => {
    const manifest = readManifest('../package.json') as { exports: Record<string, unknown> };

    expect(manifest.exports['./schemas']).toEqual({
      types: './dist/schemas.d.ts',
      default: './dist/schemas.js',
    });
  });

  it('has a folder that points tools which ignore exports at the same built files', () => {
    expect(readManifest('../schemas/package.json')).toEqual({
      main: '../dist/schemas.js',
      types: '../dist/schemas.d.ts',
    });
  });
});
