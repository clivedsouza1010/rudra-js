import { join } from 'node:path';
import { createComponentGenerator, createMemorySpecCache, type Product } from '@rudra-js/core';
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { generateCatalog } from './fixtures/catalog';
import { generateShoppers, type Shopper } from './fixtures/shoppers';
import { createRecordingProvider, createReplayProvider } from './provider/recording-provider';

const CATALOG_SEED = 1;
const SHOPPER_SEED = 9;

export const MODEL_ID = 'claude-opus-5';

/**
 * Where transcripts live, anchored on the working directory.
 *
 * Not on `import.meta.url`. Next bundles server modules, so at run time that
 * URL names a chunk under `.next/` rather than this file — and it does not even
 * get that far: Turbopack reads `new URL('../recordings/', import.meta.url)` as
 * a module request and fails the build with `Can't resolve '../recordings/'`.
 * `process.cwd()` is what Next documents for reading files at run time, and npm
 * runs a workspace script from the workspace's own directory — so `next dev`,
 * `next build` and `next start` all resolve this to `examples/shop/recordings`.
 *
 * Vitest neither bundles nor changes directory; it runs from the repository
 * root, so it passes the directory in. See the `env` block in
 * `vitest.config.ts`.
 */
export const RECORDINGS_DIRECTORY =
  process.env['RUDRA_SHOP_RECORDINGS'] ?? join(process.cwd(), 'recordings');

/**
 * How long the model gets before the page renders the deterministic component
 * instead.
 *
 * Core defaults this to 1500ms, which this shop cannot use: the model runs
 * adaptive thinking, and a full component spec does not come back inside a
 * second and a half. Every live call would abort at the deadline — and since a
 * transcript is written only once the call resolves, no recording could ever be
 * made, which takes record/replay with it.
 *
 * Generous on purpose. The page still degrades safely if it is exceeded, so the
 * only cost of a large number is a slow first render on a cache miss.
 */
const MODEL_TIMEOUT_MS = 60_000;

/**
 * One catalog and one population per process.
 *
 * Regenerating per request would put fixture generation inside every latency
 * measurement the later slices take.
 */
const catalog = generateCatalog(CATALOG_SEED);
const shoppers = generateShoppers(SHOPPER_SEED, catalog);
const byId = new Map(shoppers.map((shopper) => [shopper.id, shopper]));

function chooseProvider() {
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  // With a key, call the model and keep the transcript. Without one, replay —
  // and in CI a miss is an error, because a run that quietly falls back is a
  // run measuring something other than what it says.
  if (apiKey) {
    return createRecordingProvider(
      createAnthropicProvider({ apiKey, model: MODEL_ID }),
      RECORDINGS_DIRECTORY,
    );
  }

  return createReplayProvider({
    directory: RECORDINGS_DIRECTORY,
    model: MODEL_ID,
    onMiss: process.env['CI'] ? 'throw' : 'fallback',
  });
}

const generator = createComponentGenerator({
  provider: chooseProvider(),
  cache: createMemorySpecCache(),
  modelTimeoutMs: MODEL_TIMEOUT_MS,
});

export function getShopContext(): {
  catalog: Product[];
  /**
   * The whole population, so a caller can choose a shopper by what they have
   * done rather than by id — which is the difference between a test that
   * exercises the cold-start path and one that is merely named for it.
   */
  shoppers: Shopper[];
  findShopper: (id: string | undefined) => Shopper;
  generator: ReturnType<typeof createComponentGenerator>;
} {
  return {
    catalog,
    shoppers,
    // An unknown shopper is a first-time visitor, which is a real state the
    // framework handles — not an error worth failing a page over.
    findShopper: (id) =>
      byId.get(id ?? '') ?? {
        id: 'anonymous',
        segment: 'new',
        isReturning: false,
        likedSkus: [],
        viewedSkus: [],
        cartSkus: [],
        searches: [],
      },
    generator,
  };
}
