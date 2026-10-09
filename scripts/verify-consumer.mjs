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

const DECLARATION = /\.d\.[cm]?ts$/;
const EMITTED = /^dist\/.+\.[cm]?js$/;

const RENDERER = ['react-dom'];

const MUST_NOT_RESOLVE = 'prettier';
const FORBIDDEN_PLACEHOLDER = '__FORBIDDEN_PACKAGE__';
const SUCCESS = '  render + isolation: ok';

const PLANTED = 'RudraNotDeclaredAnywhere';

const TSC = join(REPO_ROOT, 'node_modules/.bin/tsc');

const tscArgs = (config) => ['-p', config];

const run = (command, args, cwd) => {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    process.stdout.write(error.stdout ?? '');
    throw error;
  }
};

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

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'rudra-consumer-')));
const consumer = join(workspace, 'app');
const modules = join(consumer, 'node_modules');
const solo = join(workspace, 'solo');

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

    const paths = files.map((file) => file.path);
    const declarations = paths.filter((path) => DECLARATION.test(path));

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

  const external = PACKAGES.flatMap((packageName) => {
    const manifest = manifestOf(packageName);
    return Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
  }).filter((name) => !name.startsWith('@rudra-js/'));

  for (const name of new Set([...external, ...RENDERER, '@types/react', '@types/react-dom'])) {
    link(modules, name, join(REPO_ROOT, 'node_modules', name));
  }

  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module', version: '1.0.0' }, null, 2),
  );

  const fixture = readFileSync(join(REPO_ROOT, 'scripts/consumer-fixture.ts'), 'utf8');
  if (!fixture.includes(FORBIDDEN_PLACEHOLDER)) {
    throw new Error(`consumer-fixture.ts no longer holds ${FORBIDDEN_PLACEHOLDER}`);
  }

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

  const compilerOptions = {
    strict: true,
    noEmit: true,
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
      link(
        soloModules,
        dependency,
        DIRECTORY_OF.has(dependency)
          ? join(modules, '@rudra-js', DIRECTORY_OF.get(dependency))
          : join(REPO_ROOT, 'node_modules', dependency),
      );

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

  const programs = [
    {
      label: 'the consumer',
      failure: 'the consumer did not typecheck against the packed packages',
      config: tsconfig,
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

  const checkedOptions = (config) => {
    const resolved = JSON.parse(run(TSC, ['--showConfig', ...tscArgs(config)])).compilerOptions;
    for (const [option, expected] of Object.entries(REQUIRED_OPTIONS)) {
      if (JSON.stringify(resolved?.[option]) !== JSON.stringify(expected)) {
        throw new Error(
          `tsc ${option} is ${JSON.stringify(resolved?.[option])}, must be ${JSON.stringify(expected)}`,
        );
      }
    }

    const softened = Object.keys(resolved).filter(
      (option) => resolved[option] === false && REQUIRED_OPTIONS[option] !== false,
    );
    if (softened.length > 0) {
      throw new Error(`tsc has ${softened.join(', ')} switched off`);
    }
    return resolved;
  };

  const [resolved] = programs.map(({ config }) => checkedOptions(config));

  console.log(`  consumer: ${consumer}`);

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
