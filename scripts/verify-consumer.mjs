/**
 * Installs what we would publish, and uses it the way a consumer would.
 *
 * `tests/packaging.test.ts` asserts what is in a tarball. That is not the same
 * as the tarball working: a manifest can name every right file and still be
 * unimportable, because resolution reads fields the file list knows nothing
 * about. This script closes that gap by building a consumer outside the
 * repository and making it resolve, typecheck against, and render the packed
 * packages.
 *
 * It lives outside the vitest suite on purpose. It packs, extracts and runs
 * `tsc` twice, which is slower than the entire unit suite; folding it in would
 * make `vitest --watch` re-run all of that on every keystroke.
 *
 * The consumer MUST sit outside the repository. Built inside it — even under
 * `node_modules/` — Node and tsc walk up to the repo's own `node_modules`, and
 * every root devDependency becomes resolvable. A package importing something it
 * never declared then renders perfectly, which is the exact defect this exists
 * to catch.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

/**
 * Needed to render, but not a dependency of anything published: nothing under
 * `packages/react/src` imports it. The consumer brings its own renderer, the
 * way a host application does.
 */
const RENDERER = ['react-dom'];

/** Resolvable from the repo root and from nowhere the consumer can legally reach. */
const MUST_NOT_RESOLVE = 'prettier';
const FORBIDDEN_PLACEHOLDER = '__FORBIDDEN_PACKAGE__';
const SUCCESS = '  render + isolation: ok';

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const manifestOf = (packageName) =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'));

const workspace = mkdtempSync(join(tmpdir(), 'rudra-consumer-'));
const consumer = join(workspace, 'app');
const modules = join(consumer, 'node_modules');

// Type-stripping so the fixture can stay one file in both roles.
const runConsumer = (file) =>
  spawnSync('node', ['--experimental-strip-types', file], { cwd: consumer, encoding: 'utf8' });

try {
  mkdirSync(join(modules, '@rudra-js'), { recursive: true });

  // `--ignore-scripts` so this reads the build every other check ran against,
  // rather than quietly making a different one through `prepack`.
  for (const packageName of PACKAGES) {
    const [{ filename }] = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', workspace],
        join(REPO_ROOT, 'packages', packageName),
      ),
    );

    const destination = join(modules, '@rudra-js', packageName);
    mkdirSync(destination, { recursive: true });
    // Tarball entries live under `package/`.
    run('tar', ['-xzf', join(workspace, filename), '-C', destination, '--strip-components=1']);
  }

  // Peers are the consumer's job to provide, so provide them the way a consumer
  // does — and derive them from the manifests, because a hardcoded list stops
  // being the truth the moment someone adds a peer.
  const peers = PACKAGES.flatMap((packageName) =>
    Object.keys(manifestOf(packageName).peerDependencies ?? {}),
  ).filter((name) => !name.startsWith('@rudra-js/'));

  for (const name of new Set([...peers, ...RENDERER, '@types/react', '@types/react-dom'])) {
    if (name.includes('/')) mkdirSync(join(modules, name.split('/')[0]), { recursive: true });
    symlinkSync(join(REPO_ROOT, 'node_modules', name), join(modules, name), 'dir');
  }

  // Without `"type": "module"` every import below fails typechecking under
  // `verbatimModuleSyntax` with an error that reads like a packaging defect
  // rather than a harness bug.
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module', version: '1.0.0' }, null, 2),
  );

  const fixture = readFileSync(join(REPO_ROOT, 'scripts/consumer-fixture.ts'), 'utf8');
  // Checking only the substituted copy passes for free once there is nothing left to substitute.
  if (!fixture.includes(FORBIDDEN_PLACEHOLDER)) {
    throw new Error(`consumer-fixture.ts no longer holds ${FORBIDDEN_PLACEHOLDER}`);
  }

  // Read the file back and check that, not the string we meant to write.
  const writeConsumer = (file, specifier) => {
    const path = join(consumer, file);
    writeFileSync(path, fixture.replaceAll(FORBIDDEN_PLACEHOLDER, specifier));
    const written = readFileSync(path, 'utf8');
    if (written.includes(FORBIDDEN_PLACEHOLDER)) {
      throw new Error(`${file} still holds ${FORBIDDEN_PLACEHOLDER}: nothing was substituted`);
    }
    if (!written.includes(`const forbidden: string = '${specifier}';`)) {
      throw new Error(`${file} does not declare: const forbidden: string = '${specifier}';`);
    }
  };

  writeConsumer('consumer.ts', MUST_NOT_RESOLVE);
  writeConsumer('malformed.ts', `${MUST_NOT_RESOLVE}%zz`);

  // NodeNext only. Under `bundler` resolution every one of these checks passes
  // whatever the package does, because bundler resolution is strictly more
  // permissive — it cannot fail on a specifier Node would reject.
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          // Off is the point: this is the only place the published .d.ts files
          // are checked, and a public type leaning on an ambient global or an
          // undeclared package only shows up here.
          skipLibCheck: false,
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          module: 'nodenext',
          moduleResolution: 'nodenext',
          verbatimModuleSyntax: true,
          exactOptionalPropertyTypes: true,
          types: [],
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    ),
  );

  console.log(`  consumer: ${consumer}`);
  run(join(REPO_ROOT, 'node_modules/.bin/tsc'), ['-p', join(consumer, 'tsconfig.json')]);
  console.log('  typecheck (nodenext, skipLibCheck off): ok');

  const rendered = runConsumer('consumer.ts');
  process.stdout.write(rendered.stdout);
  if (rendered.status !== 0 || !rendered.stdout.includes(SUCCESS)) {
    process.stderr.write(rendered.stderr);
    throw new Error('the consumer did not render and report isolation');
  }

  // The line above is a claim about nothing unless the consumer also fails when it should.
  const mustFail = (label, file) => {
    const result = runConsumer(file);
    if (result.status === 0 || result.stdout.includes(SUCCESS)) {
      throw new Error(`control '${label}': the consumer reported isolation anyway`);
    }
  };

  mustFail('an import failure that is not a resolution miss', 'malformed.ts');

  const planted = join(modules, MUST_NOT_RESOLVE);
  symlinkSync(join(REPO_ROOT, 'node_modules', MUST_NOT_RESOLVE), planted, 'dir');
  mustFail(`${MUST_NOT_RESOLVE} resolves`, 'consumer.ts');
  rmSync(planted);

  // Resolving and then missing an import of its own: the error names the leaked package in
  // the importer path, so an unanchored message test reads that leak as isolation.
  mkdirSync(planted);
  writeFileSync(
    join(planted, 'package.json'),
    JSON.stringify({ name: MUST_NOT_RESOLVE, version: '1.0.0', type: 'module', main: 'index.js' }),
  );
  writeFileSync(join(planted, 'index.js'), "import 'rudra-js-not-installed';\n");
  mustFail(`${MUST_NOT_RESOLVE} resolves but cannot load`, 'consumer.ts');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
