import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const PACKAGES = readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

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

const LICENCE_TEXT = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8');

describe.each(PACKAGES)('the @rudra-js/%s tarball', (packageName) => {
  const files = listPackedFiles(packageName);

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

describe('the published packages', () => {
  it('all carry one version, because one tag publishes all three', () => {
    const versions = PACKAGES.map((packageName) => readManifest(packageName).version);
    const listed = PACKAGES.map(
      (packageName, index) => `@rudra-js/${packageName} ${versions[index]}`,
    ).join(', ');

    expect([...new Set(versions)], listed).toHaveLength(1);
  });
});

function collectExportTargets(exports: Record<string, unknown>): string[] {
  return Object.values(exports).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : collectExportTargets((value ?? {}) as Record<string, unknown>),
  );
}

interface WorkflowStep {
  run?: string;
  keys: string[];
}

/** Every step of one job, as its key names plus its `run:` line. */
function stepsOf(workflow: string, jobName: string): WorkflowStep[] {
  const lines = workflow.split('\n');
  const jobAt = lines.indexOf(`  ${jobName}:`);
  if (jobAt === -1) throw new Error(`no \`${jobName}:\` job found`);

  const steps: WorkflowStep[] = [];
  let inSteps = false;
  for (const line of lines.slice(jobAt + 1)) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) break;
    if (!inSteps) {
      inSteps = indent === 4 && text === 'steps:';
      continue;
    }
    if (indent <= 4) break;
    if (indent === 6) {
      if (!text.startsWith('- ')) throw new Error(`expected a step, got \`${text}\``);
      steps.push({ keys: [] });
    }
    if (indent > 8) continue;

    const step = steps.at(-1);
    if (!step) throw new Error(`\`${text}\` sits before the first step`);
    const field = text.replace(/^- /, '');
    const key = field.slice(0, field.indexOf(':'));
    step.keys.push(key);
    if (key === 'run') step.run = field.slice(key.length + 1).trim();
  }
  if (!inSteps) throw new Error(`the \`${jobName}\` job has no steps`);

  return steps;
}

/**
 * The `- run:` steps of one job, not the whole workflow.
 *
 * `ci.yml` carries a second job (`shop`) that builds the example, which the
 * release workflow must not be held to — it publishes packages, not an
 * example app. Scoping the slice to `verify` keeps this a value assertion
 * instead of a substring search: the expected array below still has to match
 * exactly, it just no longer has to also enumerate every other job in the
 * file.
 */
function jobStepsOf(workflow: string, jobName: string): string[] {
  const commands: string[] = [];
  for (const step of stepsOf(workflow, jobName)) {
    if (step.run !== undefined) commands.push(step.run);
  }
  return commands;
}

function jobKeysOf(workflow: string, jobName: string): string[] {
  const lines = workflow.split('\n');
  const jobAt = lines.indexOf(`  ${jobName}:`);
  if (jobAt === -1) throw new Error(`no \`${jobName}:\` job found`);

  const keys: string[] = [];
  for (const line of lines.slice(jobAt + 1)) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) break;
    if (indent === 4) keys.push(text.slice(0, text.indexOf(':')));
  }
  return keys;
}

describe('the release workflow', () => {
  const releaseWorkflow = readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
  const ciWorkflow = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

  it('takes its Node from a version trusted publishing accepts', () => {
    const pinned = readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8').trim();

    const parts = pinned.split('.');
    expect(parts.length, `.nvmrc is "${pinned}"; it must name an exact version`).toBe(3);

    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    expect(Number.isInteger(major) && Number.isInteger(minor), `.nvmrc is "${pinned}"`).toBe(true);

    const tooOld = major < 22 || (major === 22 && minor < 14);
    expect(tooOld, `.nvmrc is ${pinned}; trusted publishing needs 22.14 or newer`).toBe(false);

    for (const workflow of ['release.yml', 'rehearsal.yml']) {
      const text = readFileSync(join(REPO_ROOT, '.github/workflows', workflow), 'utf8');
      expect(text, `${workflow} does not take its Node from .nvmrc`).toContain(
        'node-version-file: .nvmrc',
      );
    }
  });

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
    //
    // Scoped to the `verify` job rather than the whole file: `ci.yml` also
    // carries a `shop` job that builds the example, and release must not be
    // held to that — it publishes packages, not an example app.
    expect(jobStepsOf(ciWorkflow, 'verify')).toEqual([
      'npm ci --ignore-scripts',
      'npm run build',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm test',
      'npm run verify:consumer',
    ]);

    for (const step of jobStepsOf(ciWorkflow, 'verify')) {
      expect(
        jobStepsOf(releaseWorkflow, 'publish'),
        `release.yml is missing \`${step}\``,
      ).toContain(step);
    }
  });

  it('is what `npm run check` runs, after the install', () => {
    const { scripts } = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const checks = jobStepsOf(ciWorkflow, 'verify');
    const afterInstall = checks.slice(checks.indexOf('npm ci --ignore-scripts') + 1);

    expect(scripts['check']?.split(' && ')).toEqual(afterInstall);
  });

  it('verifies before it publishes', () => {
    const steps = jobStepsOf(releaseWorkflow, 'publish');
    const firstPublish = steps.findIndex((step) => step.startsWith('npm publish'));
    expect(firstPublish).toBeGreaterThan(-1);

    // A check that runs after the publish protects nothing.
    for (const step of jobStepsOf(ciWorkflow, 'verify')) {
      expect(steps.indexOf(step), `\`${step}\` runs after publishing`).toBeLessThan(firstPublish);
    }
  });

  it('forgives no step, and skips none before the publish', () => {
    const steps = stepsOf(releaseWorkflow, 'publish');
    const firstPublish = steps.findIndex((step) => step.run?.startsWith('npm publish'));
    expect(firstPublish).toBeGreaterThan(-1);

    for (const step of steps.slice(0, firstPublish)) {
      const name = step.run ?? step.keys.join(' ');
      expect(step.keys, `\`${name}\` carries an if:`).not.toContain('if');
    }

    for (const step of steps) {
      const name = step.run ?? step.keys.join(' ');
      expect(step.keys, `\`${name}\` carries continue-on-error`).not.toContain('continue-on-error');
    }

    expect(
      jobKeysOf(releaseWorkflow, 'publish'),
      'the publish job carries continue-on-error',
    ).not.toContain('continue-on-error');
  });
});

describe('the README', () => {
  it('lists every package that gets published', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const heading = readme.indexOf('## Packages');
    expect(heading, 'the README has no ## Packages heading').toBeGreaterThan(-1);

    const section = readme.slice(heading).split('\n## ')[0]!;
    const tableRows = section.split('\n').filter((line) => line.startsWith('|'));
    const table = tableRows.join('\n');

    for (const name of PACKAGES) {
      expect(table, `@rudra-js/${name} is published but not in the README table`).toContain(
        `[\`@rudra-js/${name}\`](packages/${name})`,
      );
    }
  });
});
