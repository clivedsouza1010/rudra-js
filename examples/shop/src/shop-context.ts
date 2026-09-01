import { join } from 'node:path';
import {
  createComponentGenerator,
  createMemorySpecCache,
  type Bundle,
  type ComponentProvider,
  type Product,
} from '@rudra-js/core';
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { generateBundles } from './fixtures/bundles';
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
const bundles = generateBundles(catalog);
const shoppers = generateShoppers(SHOPPER_SEED, catalog);
const byId = new Map(shoppers.map((shopper) => [shopper.id, shopper]));

/**
 * Says why a call failed, which nothing else will.
 *
 * The generator degrades on any provider rejection and reports only a reason
 * code, and the adapter deliberately keeps the vendor's message out of the
 * error it throws — that message can quote a shopper's own search terms back,
 * and an adopter's logs should not collect them. An operator running this
 * example needs the detail, so it is logged here rather than widened there.
 */
function withVisibleFailures(provider: ComponentProvider): ComponentProvider {
  return {
    name: provider.name,
    model: provider.model,
    async generate(request) {
      try {
        return await provider.generate(request);
      } catch (error) {
        console.error('[rudra] provider failed:', error instanceof Error ? error.message : error);
        throw error;
      }
    },
  };
}

function chooseProvider() {
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  // With a key, call the model and keep the transcript. Without one, replay —
  // and in CI a miss is an error, because a run that quietly falls back is a
  // run measuring something other than what it says.
  if (apiKey) {
    return createRecordingProvider(
      withVisibleFailures(
        createAnthropicProvider({
          apiKey,
          model: MODEL_ID,
          // An identity-linked key belongs to a person across several workspaces,
          // so the API cannot infer which one a request acts in.
          ...(process.env['ANTHROPIC_WORKSPACE_ID']
            ? { workspaceId: process.env['ANTHROPIC_WORKSPACE_ID'] }
            : {}),
        }),
      ),
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
  // Without this a failed model call is invisible: the generator degrades to
  // the deterministic component by design and says nothing, so the page looks
  // right and the terminal stays silent.
  onEvent: (event) => {
    const detail = event.degradedReason ? ` (${event.degradedReason})` : '';
    console.log(`[rudra] ${event.source}${detail} in ${event.elapsedMs}ms`);
  },
  modelTimeoutMs: MODEL_TIMEOUT_MS,
});

export function getShopContext(): {
  catalog: readonly Product[];
  // Every set the shop sells together. buildTrackingInput narrows this down
  // to what a given page's candidates can support.
  bundles: readonly Bundle[];
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
    bundles,
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
