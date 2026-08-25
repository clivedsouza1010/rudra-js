import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What actually reaches a consumer.
 *
 * Everything else in this repo tests the source. A published package is the
 * subset of that source `npm pack` decides to include, and nothing else in CI
 * looks at it — which is how both packages spent their whole life declaring MIT
 * with no licence text in the tarball, and shipping 34 source maps that pointed
 * at a `src/` directory they did not carry.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = ['core', 'react'] as const;

interface PackedFile {
  path: string;
}

/** The file list `npm publish` would upload, without uploading anything. */
function packedFiles(packageName: string): string[] {
  const directory = join(REPO_ROOT, 'packages', packageName);

  expect(
    existsSync(join(directory, 'dist')),
    `packages/${packageName}/dist is missing — run \`npm run build\` before the tests`,
  ).toBe(true);

  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const [packed] = JSON.parse(output) as [{ files: PackedFile[] }];
  return packed.files.map((file) => file.path);
}

describe.each(PACKAGES)('the @rudra/%s tarball', (packageName) => {
  const files = packedFiles(packageName);

  it('carries the licence text, not just the licence field', () => {
    // "license": "MIT" in a manifest is metadata. The MIT licence itself asks
    // for the text to travel with the copies.
    expect(files).toContain('LICENSE');
  });

  it('carries its own README', () => {
    // This is the npm listing page. A package that ships none shows the
    // registry's placeholder.
    expect(files).toContain('README.md');
  });

  it('resolves every source map it ships', () => {
    const shipped = new Set(files);
    const maps = files.filter((file) => file.endsWith('.map'));
    expect(maps.length).toBeGreaterThan(0);

    for (const map of maps) {
      const { sources } = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', packageName, map), 'utf8'),
      ) as {
        sources: string[];
      };
      const directory = map.slice(0, map.lastIndexOf('/'));

      for (const source of sources) {
        // A map naming a file the tarball does not contain is worse than no map
        // at all: a debugger reports a missing file rather than stepping through
        // the shipped build.
        const target = normalize(join(directory, source));
        expect(shipped, `${map} points at ${target}, which is not in the tarball`).toContain(
          target,
        );
      }
    }
  });

  it('ships no test file', () => {
    expect(files.filter((file) => file.includes('.test.'))).toEqual([]);
  });

  it('exposes its own manifest, which tooling reads for the version', () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };

    expect(manifest.exports['./package.json']).toBe('./package.json');
  });
});

describe('the release workflow', () => {
  const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');

  it.each(PACKAGES)('publishes @rudra/%s', (packageName) => {
    // A package with no publish step is not a package anyone can install, and
    // nothing else fails when one is missing.
    expect(workflow).toContain(`working-directory: packages/${packageName}`);
  });

  it('runs every check a pull request runs', () => {
    const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const checks = [
      ...ci.matchAll(/run: (npm (?:run )?(?:build|typecheck|lint|format:check|test))/g),
    ].map((match) => match[1]);

    expect(checks.length).toBeGreaterThan(4);
    for (const check of checks) {
      // A release held to a lower standard than a pull request is how an
      // unformatted or failing build reaches the registry.
      expect(workflow, `release.yml is missing \`${check}\``).toContain(check);
    }
  });
});

it('keeps the repo root out of the packages', () => {
  // A stray `files` entry that escapes the package directory is the classic way
  // a secret reaches a registry.
  for (const packageName of PACKAGES) {
    for (const file of packedFiles(packageName)) {
      expect(relative('.', file).startsWith('..')).toBe(false);
    }
  }
});
