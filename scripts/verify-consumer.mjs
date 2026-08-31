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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = ['core', 'react', 'anthropic'];

/**
 * Needed to render, but not a dependency of anything published: nothing under
 * `packages/react/src` imports it. The consumer brings its own renderer, the
 * way a host application does.
 */
const RENDERER = ['react-dom'];

/** Resolvable from the repo root and from nowhere the consumer can legally reach. */
const MUST_NOT_RESOLVE = 'prettier';

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

  writeFileSync(
    join(consumer, 'consumer.ts'),
    `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  bundleSchema,
  createComponentGenerator,
  parseTrackingInput,
  productSchema,
  type ComponentSpec,
} from '@rudra-js/core';
import { RudraComponent, defaultFormatBundlePrice, type ProductCatalog } from '@rudra-js/react';
import { createAnthropicProvider } from '@rudra-js/anthropic';

const products = [
  productSchema.parse({
    sku: 'TR-101',
    title: 'Switchback Trail Shoe',
    category: 'Trail Running',
    price: 174,
    currency: 'USD',
    isInStock: true,
    tags: [],
  }),
  productSchema.parse({
    sku: 'TR-102',
    title: 'Switchback Trail Sock',
    category: 'Trail Running',
    price: 26,
    currency: 'USD',
    isInStock: true,
    tags: [],
  }),
];
const catalog: ProductCatalog = products;

// A set the shop sells together, validated the way a host validates one.
const bundles = [
  bundleSchema.parse({
    id: 'BUN-1',
    skus: ['TR-101', 'TR-102'],
    price: 180,
    label: 'Trail starter set',
  }),
];

const input = parseTrackingInput({
  user: { id: 'shopper-1' },
  context: { surface: 'pdp' },
  candidates: [
    { sku: 'TR-101', title: 'Switchback Trail Shoe', category: 'Trail Running', price: 174 },
    { sku: 'TR-102', title: 'Switchback Trail Sock', category: 'Trail Running', price: 26 },
  ],
  bundles,
});

const spec: ComponentSpec = await createComponentGenerator().generate(input);
const markup = renderToStaticMarkup(
  createElement(RudraComponent, { spec, products: catalog, locale: 'en-US' }),
);

if (!markup.includes('$174.00')) {
  throw new Error(\`rendered markup has no price in it: \${markup.slice(0, 200)}\`);
}

// The bundle half of the public surface: the block kind, the \`bundles\` prop,
// and the shop's own name and price for the set.
const bundleSpec: ComponentSpec = {
  ...spec,
  blocks: [{ kind: 'bundle', title: 'Get set up', body: null, ctaLabel: null, bundleId: 'BUN-1' }],
};
const bundleMarkup = renderToStaticMarkup(
  createElement(RudraComponent, {
    spec: bundleSpec,
    products: catalog,
    bundles,
    locale: 'en-US',
  }),
);

for (const expected of ['Trail starter set', '$180.00']) {
  if (!bundleMarkup.includes(expected)) {
    throw new Error(\`rendered bundle has no \${expected} in it: \${bundleMarkup.slice(0, 300)}\`);
  }
}

const [firstBundle] = bundles;
if (!firstBundle) {
  throw new Error('bundleSchema.parse returned nothing');
}
const bundlePrice = defaultFormatBundlePrice(
  firstBundle,
  new Map(products.map((entry) => [entry.sku, entry])),
  'en-US',
);
if (bundlePrice !== '$180.00') {
  throw new Error(\`defaultFormatBundlePrice returned \${bundlePrice}\`);
}

// Proves the package's entry point and types resolve for a real consumer under
// nodenext, without ever making a network call.
const anthropicProvider = createAnthropicProvider({
  apiKey: 'not-a-real-key',
  fetch: async () => new Response('{}'),
});
if (typeof anthropicProvider.name !== 'string' || typeof anthropicProvider.model !== 'string') {
  throw new Error('@rudra-js/anthropic provider has no name/model strings');
}

// The consumer must not be able to reach the repository's own dependency tree —
// if it can, an undeclared dependency in a published package resolves here and
// this whole check reports a false green.
// Held in a variable so the specifier is not a literal: tsc resolves literals,
// and would report this deliberate miss as a compile error.
const forbidden: string = '${MUST_NOT_RESOLVE}';
let leaked = true;
try {
  await import(forbidden);
} catch {
  leaked = false;
}
if (leaked) {
  throw new Error(
    "the consumer resolved '${MUST_NOT_RESOLVE}', so it is not isolated from the repo — " +
      'this check cannot be trusted until that is fixed',
  );
}

console.log('  render + isolation: ok');
`,
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
