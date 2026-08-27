import { createComponentGenerator, createMemorySpecCache, type Product } from '@rudra-js/core';
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { generateCatalog } from './fixtures/catalog.js';
import { generateShoppers, type Shopper } from './fixtures/shoppers.js';
import { createRecordingProvider, createReplayProvider } from './provider/recording-provider.js';

const CATALOG_SEED = 1;
const SHOPPER_SEED = 9;
const MODEL = 'claude-opus-5';
const RECORDINGS = new URL('../recordings/', import.meta.url).pathname;

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
    return createRecordingProvider(createAnthropicProvider({ apiKey, model: MODEL }), RECORDINGS);
  }

  return createReplayProvider({
    directory: RECORDINGS,
    model: MODEL,
    onMiss: process.env['CI'] ? 'throw' : 'fallback',
  });
}

const generator = createComponentGenerator({
  provider: chooseProvider(),
  cache: createMemorySpecCache(),
});

export function getShopContext(): {
  catalog: Product[];
  findShopper: (id: string | undefined) => Shopper;
  generator: ReturnType<typeof createComponentGenerator>;
} {
  return {
    catalog,
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
