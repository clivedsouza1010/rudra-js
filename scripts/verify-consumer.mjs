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
 * It lives outside the vitest suite on purpose. It packs and extracts every
 * package twice and runs tsc over each of them, which is slower than the entire
 * unit suite; folding it in would make `vitest --watch` re-run all of that on
 * every keystroke.
 *
 * The consumer MUST sit outside the repository. Built inside it — even under
 * `node_modules/` — Node and tsc walk up to the repo's own `node_modules`, and
 * every root devDependency becomes resolvable. A package importing something it
 * never declared then renders perfectly, which is the exact defect this exists
 * to catch.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

/** Every extension TypeScript emits a declaration under, so a dual build cannot slip past. */
const DECLARATION = /\.d\.[cm]?ts$/;
const EMITTED = /^dist\/.+\.[cm]?js$/;

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

/** Planted in each published declaration by the control below. Nothing anywhere declares it. */
const PLANTED = 'RudraNotDeclaredAnywhere';

const TSC = join(REPO_ROOT, 'node_modules/.bin/tsc');

// One set of arguments for `--showConfig`, for the control and for the run, so a
// weaker config or an extra flag put in the way of one is put in the way of the rest.
const tscArgs = (config) => ['-p', config];

const run = (command, args, cwd) => {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    // The output is captured here rather than inherited, so a failure shows nothing without this.
    process.stdout.write(error.stdout ?? '');
    throw error;
  }
};

/**
 * Written apart from the config below so the two have to agree. Weaken any of
 * these and the typecheck still exits 0 while a real defect in a published
 * declaration goes unseen. Values are spelled the way `tsc --showConfig` reports them.
 */
const REQUIRED_OPTIONS = {
  skipLibCheck: false,
  module: 'nodenext',
  moduleResolution: 'nodenext',
  strict: true,
  types: [],
  lib: ['es2022', 'dom'],
  verbatimModuleSyntax: true,
  exactOptionalPropertyTypes: true,
};

const manifestOf = (packageName) =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'));

const DIRECTORY_OF = new Map(PACKAGES.map((name) => [manifestOf(name).name, name]));

/**
 * Everything someone installing this one package ends up with: its dependencies
 * and peers, and theirs after that, because npm installs those too. Anything
 * outside this set is something the package never declared.
 */
const closureOf = (packageName) => {
  const closure = new Set();
  const walk = (directory) => {
    const manifest = manifestOf(directory);
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (closure.has(name)) continue;
      closure.add(name);
      if (DIRECTORY_OF.has(name)) walk(DIRECTORY_OF.get(name));
    }
  };
  walk(packageName);
  return closure;
};

const link = (into, name, source) => {
  if (name.includes('/')) mkdirSync(join(into, name.split('/')[0]), { recursive: true });
  symlinkSync(source, join(into, name), 'dir');
};

// Realpathed so our paths and tsc's spell the same directory: on macOS the temp
// directory sits behind a symlink.
const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'rudra-consumer-')));
const consumer = join(workspace, 'app');
const modules = join(consumer, 'node_modules');
const solo = join(workspace, 'solo');

// Type-stripping so the fixture can stay one file in both roles.
const runConsumer = (file) =>
  spawnSync('node', ['--experimental-strip-types', file], { cwd: consumer, encoding: 'utf8' });

try {
  mkdirSync(join(modules, '@rudra-js'), { recursive: true });

  // `--ignore-scripts` so this reads the build every other check ran against,
  // rather than quietly making a different one through `prepack`.
  const tarballs = new Map();
  const shipped = new Map();
  for (const packageName of PACKAGES) {
    const [{ filename, files }] = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', workspace],
        join(REPO_ROOT, 'packages', packageName),
      ),
    );

    tarballs.set(packageName, filename);
    // npm's own account of what ships, rather than a walk of what we extracted:
    // a walk can only ever agree with itself about which files count.
    const paths = files.map((file) => file.path);
    const declarations = paths.filter((path) => DECLARATION.test(path));

    // Anchor that list to something other than itself. Every module a package
    // ships has a declaration beside it, so a list that quietly stopped covering
    // some of them fails here by name instead of just printing a smaller count.
    const untyped = paths
      .filter((path) => EMITTED.test(path))
      .filter((path) => !declarations.includes(path.replace(/\.([cm]?)js$/, '.d.$1ts')));
    if (untyped.length > 0) {
      throw new Error(`@rudra-js/${packageName} ships no declaration for ${untyped.join(', ')}`);
    }
    shipped.set(packageName, declarations);

    const destination = join(modules, '@rudra-js', packageName);
    mkdirSync(destination, { recursive: true });
    // Tarball entries live under `package/`.
    run('tar', ['-xzf', join(workspace, filename), '-C', destination, '--strip-components=1']);
  }

  // Peers are the consumer's job to provide and dependencies are npm's, so
  // provide both the way an install does — and derive them from the manifests,
  // because a hardcoded list stops being the truth the moment someone adds one.
  const external = PACKAGES.flatMap((packageName) => {
    const manifest = manifestOf(packageName);
    return Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
  }).filter((name) => !name.startsWith('@rudra-js/'));

  for (const name of new Set([...external, ...RENDERER, '@types/react', '@types/react-dom'])) {
    link(modules, name, join(REPO_ROOT, 'node_modules', name));
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
  const compilerOptions = {
    strict: true,
    noEmit: true,
    // Off is the point: this is the only place the published declarations are
    // checked, and a public type leaning on an ambient global or an undeclared
    // package only shows up here.
    skipLibCheck: false,
    target: 'es2022',
    lib: ['es2022', 'dom'],
    module: 'nodenext',
    moduleResolution: 'nodenext',
    verbatimModuleSyntax: true,
    exactOptionalPropertyTypes: true,
    types: [],
  };

  const tsconfig = join(consumer, 'tsconfig.json');
  writeFileSync(tsconfig, JSON.stringify({ compilerOptions, include: ['consumer.ts'] }, null, 2));

  // The consumer reaches each package's entry and nothing else, so every other
  // published declaration would go unopened. Give each package a tree of its own
  // holding only what its manifest declares, and check everything it ships in
  // there: beside its siblings a package can lean on a dependency it never
  // declared and nothing shows, because some other package brought that along.
  const soloConfigs = new Map();
  for (const packageName of PACKAGES) {
    const root = join(solo, packageName);
    const soloModules = join(root, 'node_modules');
    const destination = join(soloModules, '@rudra-js', packageName);
    mkdirSync(destination, { recursive: true });
    run('tar', [
      '-xzf',
      join(workspace, tarballs.get(packageName)),
      '-C',
      destination,
      '--strip-components=1',
    ]);

    for (const dependency of closureOf(packageName)) {
      // A sibling points at the consumer's copy of itself: what that sibling
      // publishes is checked properly in its own pass below.
      link(
        soloModules,
        dependency,
        DIRECTORY_OF.has(dependency)
          ? join(modules, '@rudra-js', DIRECTORY_OF.get(dependency))
          : join(REPO_ROOT, 'node_modules', dependency),
      );

      // The types a consumer installs alongside an untyped peer, react being the one here.
      const types = `@types/${dependency}`;
      if (existsSync(join(REPO_ROOT, 'node_modules', types))) {
        link(soloModules, types, join(REPO_ROOT, 'node_modules', types));
      }
    }

    const config = join(root, 'tsconfig.json');
    writeFileSync(
      config,
      JSON.stringify(
        {
          compilerOptions,
          files: shipped
            .get(packageName)
            .map((path) => join('node_modules', '@rudra-js', packageName, path)),
        },
        null,
        2,
      ),
    );
    soloConfigs.set(packageName, config);
  }

  // Every tsc program this runs, and the declarations each one has to be caught
  // reading. A pass is a claim about nothing unless tsc could have failed.
  const programs = [
    {
      label: 'the consumer',
      failure: 'the consumer did not typecheck against the packed packages',
      config: tsconfig,
      // tsc only opens a package's types when something imports them, so the
      // consumer run reporting each entry is what proves it resolved to the
      // packed types. Read from the packed manifest: this is a claim about what shipped.
      reports: PACKAGES.map((packageName) => {
        const root = join(modules, '@rudra-js', packageName);
        return join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).types);
      }),
    },
    ...PACKAGES.map((packageName) => ({
      label: `@rudra-js/${packageName} on its own`,
      failure: `a declaration published by @rudra-js/${packageName} did not typecheck`,
      config: soloConfigs.get(packageName),
      reports: shipped
        .get(packageName)
        .map((path) => join(solo, packageName, 'node_modules', '@rudra-js', packageName, path)),
    })),
  ];

  const typecheck = (config) =>
    spawnSync(TSC, tscArgs(config), { cwd: dirname(config), encoding: 'utf8' });

  // Check what tsc resolves for the exact arguments it is run on, not the object
  // above: `--showConfig` also sees an `extends` base and a command-line flag.
  const checkedOptions = (config) => {
    const resolved = JSON.parse(run(TSC, ['--showConfig', ...tscArgs(config)])).compilerOptions;
    for (const [option, expected] of Object.entries(REQUIRED_OPTIONS)) {
      if (JSON.stringify(resolved?.[option]) !== JSON.stringify(expected)) {
        throw new Error(
          `tsc ${option} is ${JSON.stringify(resolved?.[option])}, must be ${JSON.stringify(expected)}`,
        );
      }
    }

    // `strict` is an umbrella and every flag under it can still be switched off by
    // name. skipLibCheck is the only thing here meant to be off.
    const softened = Object.keys(resolved).filter(
      (option) => resolved[option] === false && REQUIRED_OPTIONS[option] !== false,
    );
    if (softened.length > 0) {
      throw new Error(`tsc has ${softened.join(', ')} switched off`);
    }
    return resolved;
  };

  // Every config, not only the consumer's. The per-package passes are the sole
  // check on most of these files, so a softer one there hides just as much.
  const [resolved] = programs.map(({ config }) => checkedOptions(config));

  console.log(`  consumer: ${consumer}`);

  // Plant the exact defect this script exists to catch — a published type leaning
  // on a name nothing declares — in every declaration under guard, and require the
  // pass that owns it to come back reporting it. A file missing from the report
  // was never read.
  const plants = new Map();
  for (const { reports } of programs) {
    for (const file of reports) plants.set(file, readFileSync(file, 'utf8'));
  }
  for (const [file, original] of plants) {
    writeFileSync(file, `${original}\nexport declare const planted: ${PLANTED};\n`);
  }
  const controls = programs.map(({ config }) => typecheck(config));
  for (const [file, original] of plants) {
    writeFileSync(file, original);
  }

  for (const [index, { label, config, reports }] of programs.entries()) {
    // tsc writes its diagnostics to stdout, which is captured here rather than inherited.
    const lines = (controls[index].stdout ?? '').split('\n');
    for (const file of reports) {
      const path = relative(dirname(config), file);
      if (!lines.some((line) => line.startsWith(`${path}(`) && line.includes(PLANTED))) {
        throw new Error(`control: ${label} never reported a defect planted in ${path}`);
      }
    }
  }

  for (const { config, failure } of programs) {
    const result = typecheck(config);
    if (result.status !== 0) {
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      throw new Error(failure);
    }
  }

  const declarations = [...shipped.values()].flat().length;
  console.log(
    `  typecheck (${resolved.moduleResolution}, skipLibCheck ${resolved.skipLibCheck ? 'on' : 'off'}, ${declarations} declarations, each package alone): ok`,
  );

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
