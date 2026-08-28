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
 * Anchored on the working directory, not `import.meta.url`: Next bundles server
 * modules, and Turbopack rejects `new URL('../recordings/', import.meta.url)`
 * as a module request outright. Vitest runs from the repository root instead, so
 * it passes the directory in — see `vitest.config.ts`.
 */
export const RECORDINGS_DIRECTORY =
  process.env['RUDRA_SHOP_RECORDINGS'] ?? join(process.cwd(), 'recordings');

/**
 * Core defaults to 1500ms, which a thinking model cannot meet — and since a
 * transcript is only written once a call resolves, every recording would fail.
 * Generous because the page degrades safely if it is exceeded.
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
  catalog: readonly Product[];
  /**
   * The whole population, so a caller can choose a shopper by what they have
   * done rather than by id — which is the difference between a test that
   * exercises the cold-start path and one that is merely named for it.
   */
  shoppers: readonly Shopper[];
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
