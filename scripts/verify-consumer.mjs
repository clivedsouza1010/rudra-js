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

import { execFileSync } from 'node:child_process';
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
const FORBIDDEN_DECLARATION = `const forbidden: string = '${FORBIDDEN_PLACEHOLDER}';`;

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const manifestOf = (packageName) =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'));

const workspace = mkdtempSync(join(tmpdir(), 'rudra-consumer-'));
const consumer = join(workspace, 'app');
const modules = join(consumer, 'node_modules');

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
  // The isolation check passes when the import fails, so a fixture the script stops
  // substituting checks nothing. Match the declaration; a bare name match is weaker.
  if (!fixture.includes(FORBIDDEN_DECLARATION)) {
    throw new Error(`consumer-fixture.ts no longer declares: ${FORBIDDEN_DECLARATION}`);
  }

  writeFileSync(
    join(consumer, 'consumer.ts'),
    fixture.replaceAll(FORBIDDEN_PLACEHOLDER, MUST_NOT_RESOLVE),
  );

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

  // Type-stripping so the fixture can stay one file in both roles.
  process.stdout.write(run('node', ['--experimental-strip-types', 'consumer.ts'], consumer));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
