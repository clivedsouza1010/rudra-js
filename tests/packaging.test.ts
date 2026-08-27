import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dirname as posixDirname,
  join as posixJoin,
  normalize as posixNormalize,
} from 'node:path/posix';
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
 *
 * `src` ships so those maps resolve and so go-to-definition lands on real code.
 * A consumer on `moduleResolution: node10` can therefore deep-import
 * `@rudra-js/core/src/tracking-input` and compile it under their own settings.
 * That is unsupported, not intended — the `exports` map is the contract.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = ['core', 'react', 'anthropic'] as const;

/** Everything a tarball may contain. Anything else is a packaging mistake. */
const ALLOWED = /^(LICENSE|README\.md|package\.json|dist\/.+|src\/.+\.tsx?)$/;
const IS_TEST_FILE = /\.(test|spec)\.|(^|\/)__(tests|mocks)__\//;

interface Manifest {
  version: string;
  main: string;
  types: string;
  peerDependencies?: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
}

function readManifest(packageName: string): Manifest {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'),
  ) as Manifest;
}

/**
 * The file list `npm publish` would upload, without uploading anything.
 *
 * `--ignore-scripts` because `prepack` builds, and a packaging test should read
 * the build the rest of the suite ran against rather than quietly making a new
 * one. It is also why the missing-`dist` guard below is worth keeping.
 */
function listPackedFiles(packageName: string): string[] {
  const directory = join(REPO_ROOT, 'packages', packageName);

  if (!existsSync(join(directory, 'dist'))) {
    throw new Error(`packages/${packageName}/dist is missing — run \`npm run build\` first`);
  }

  const output = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: directory,
    encoding: 'utf8',
    // stderr inherited: without it a failing pack surfaces as `Command failed`
    // or a JSON parse error, and npm's own diagnosis is lost.
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const [packed] = JSON.parse(output) as [{ files: { path: string }[] }];
  return packed.files.map((file) => file.path);
}

// Packed once per package rather than once per test: `npm pack` is a subprocess.
const PACKED = Object.fromEntries(PACKAGES.map((name) => [name, listPackedFiles(name)])) as Record<
  (typeof PACKAGES)[number],
  string[]
>;

const LICENCE_TEXT = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8');

describe.each(PACKAGES)('the @rudra-js/%s tarball', (packageName) => {
  const files = PACKED[packageName];

  it('carries the licence text, not just the licence field', () => {
    // "license": "MIT" in a manifest is metadata. The MIT licence itself asks
    // for the text to travel with the copies. npm force-includes a LICENSE that
    // exists, so this can only fail when the file itself is gone — which is the
    // regression that happened.
    expect(files).toContain('LICENSE');
    // A copy drifts silently: a new year or holder at the root leaves two stale
    // copies in the tarballs.
    expect(readFileSync(join(REPO_ROOT, 'packages', packageName, 'LICENSE'), 'utf8')).toBe(
      LICENCE_TEXT,
    );
  });

  it('carries its own README', () => {
    // This is the npm listing page. A package that ships none shows the
    // registry's placeholder.
    expect(files).toContain('README.md');
  });

  it('ships every entry point it declares', () => {
    const manifest = readManifest(packageName);
    const declared = [manifest.main, manifest.types, ...collectExportTargets(manifest.exports)];

    for (const target of new Set(declared)) {
      const path = target.replace(/^\.\//, '');
      if (path === 'package.json') continue;

      // An entry point that is not in the tarball is a package that cannot be
      // imported at all. Nothing else here would notice: the source maps prove
      // some of dist ships, not that index does.
      expect(files, `${target} is declared in package.json but not shipped`).toContain(path);
    }
  });

  it('resolves every source map it ships', () => {
    const shipped = new Set(files);
    const maps = files.filter((file) => file.endsWith('.map'));
    expect(maps.length).toBeGreaterThan(0);

    for (const map of maps) {
      const { sources } = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', packageName, map), 'utf8'),
      ) as { sources: string[] };

      for (const source of sources) {
        // npm reports POSIX paths whatever the platform, so the comparison has
        // to be POSIX too — `join` from `node:path` would produce backslashes
        // on Windows and mismatch every entry.
        const target = posixNormalize(posixJoin(posixDirname(map), source));

        // A map naming a file the tarball does not contain is worse than no map
        // at all: a debugger reports a missing file rather than stepping through
        // the shipped build.
        expect(shipped, `${map} points at ${target}, which is not in the tarball`).toContain(
          target,
        );
      }
    }
  });

  it('ships nothing but the build, the sources and the paperwork', () => {
    // `files: ["src"]` would ship everything under it — a fixture, a note, a
    // stray `.env`. Verified: npm applies the negations only to the globs they
    // name, so a bare directory entry is a standing invitation.
    expect(files.filter((file) => !ALLOWED.test(file))).toEqual([]);
  });

  it('ships no test file', () => {
    expect(files.filter((file) => IS_TEST_FILE.test(file))).toEqual([]);
  });

  it('exposes its own manifest, which tooling reads for the version', () => {
    expect(readManifest(packageName).exports['./package.json']).toBe('./package.json');
  });

  it('declares a peer range on core that the published core satisfies', () => {
    const manifest = readManifest(packageName);
    const range = manifest.peerDependencies?.['@rudra-js/core'];
    if (!range) return;

    // Inside the workspace this range is never evaluated — npm links
    // node_modules/@rudra-js/core straight at packages/core, so a range naming
    // a version that does not exist resolves anyway. A consumer installing both
    // gets ERESOLVE and nothing else in the pipeline sees it. release.yml
    // publishes both packages from one tag, so lockstep is the contract.
    expect(range).toBe(`^${readManifest('core').version}`);
  });

  it('builds before it packs, so a tarball is never source without a build', () => {
    // `dist` is gitignored. Publishing from a clean checkout without a build
    // now ships a full `src/` tree, which looks populated while every entry
    // point points at nothing.
    expect(readManifest(packageName)).toMatchObject({ scripts: { prepack: 'npm run build' } });
  });
});

function collectExportTargets(exports: Record<string, unknown>): string[] {
  return Object.values(exports).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : collectExportTargets((value ?? {}) as Record<string, unknown>),
  );
}

/** Only steps that actually run — a commented-out line is not a step. */
function stepsOf(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*- run: (.+)$/gm)].map((match) => match[1]!.trim());
}

describe('the release workflow', () => {
  const releaseWorkflow = readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
  const ciWorkflow = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

  it.each(PACKAGES)('publishes @rudra-js/%s with provenance', (packageName) => {
    // The directory alone is not evidence of publishing: any step can carry it.
    // Asserting the pair is what fails when a publish becomes an `echo`.
    expect(releaseWorkflow).toMatch(
      new RegExp(
        String.raw`run: npm publish [^\n]*--provenance[^\n]*\n\s*working-directory: packages/${packageName}\b`,
      ),
    );
  });

  it('runs the same checks a pull request runs', () => {
    // Asserted as a value rather than as a relation between two scrapes: a
    // check added to CI under a name this list does not have would otherwise be
    // invisible, and the test would keep claiming parity it no longer has.
    expect(stepsOf(ciWorkflow)).toEqual([
      'npm ci --ignore-scripts',
      'npm run build',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm test',
      'npm run verify:consumer',
    ]);

    for (const step of stepsOf(ciWorkflow)) {
      expect(stepsOf(releaseWorkflow), `release.yml is missing \`${step}\``).toContain(step);
    }
  });

  it('verifies before it publishes', () => {
    const steps = stepsOf(releaseWorkflow);
    const firstPublish = steps.findIndex((step) => step.startsWith('npm publish'));
    expect(firstPublish).toBeGreaterThan(-1);

    // A check that runs after the publish protects nothing.
    for (const step of stepsOf(ciWorkflow)) {
      expect(steps.indexOf(step), `\`${step}\` runs after publishing`).toBeLessThan(firstPublish);
    }
  });
});
