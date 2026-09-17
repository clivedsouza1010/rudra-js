import { join } from 'node:path';
import {
  createComponentGenerator,
  createMemorySpecCache,
  type ComponentProvider,
} from '@rudra-js/core';
import { createAnthropicProvider } from '@rudra-js/anthropic';
import { generateBundles } from './fixtures/bundles';
import { generateCatalog } from './fixtures/catalog';
import { generateShoppers, type Shopper } from './fixtures/shoppers';
import { createRecordingProvider, createReplayProvider } from './provider/recording-provider';

const CATALOG_SEED = 1;
const SHOPPER_SEED = 9;

export const MODEL_ID = 'claude-opus-5';

// Anchored on the working directory because Turbopack rejects `import.meta.url` here.
export const RECORDINGS_DIRECTORY =
  process.env['RUDRA_SHOP_RECORDINGS'] || join(process.cwd(), 'recordings');

// Core defaults to 1500ms, which is under this model's thinking time.
const MODEL_TIMEOUT_MS = 60_000;

export const catalog = generateCatalog(CATALOG_SEED);
export const bundles = generateBundles(catalog);
export const shoppers = generateShoppers(SHOPPER_SEED, catalog);

const byId = new Map(shoppers.map((shopper) => [shopper.id, shopper]));

const ANONYMOUS_SHOPPER: Shopper = {
  id: 'anonymous',
  segment: 'new',
  isReturning: false,
  likedSkus: [],
  viewedSkus: [],
  cartSkus: [],
  searches: [],
};

export function findShopper(id: string | undefined): Shopper {
  return byId.get(id ?? '') ?? ANONYMOUS_SHOPPER;
}

// The adapter keeps the vendor's message out of its error on purpose, so log it here.
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

export function chooseProvider(): ComponentProvider {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const mode = process.env['RUDRA_SHOP_MODE'] || 'replay';

  if (mode !== 'replay' && mode !== 'record') {
    throw new Error(`RUDRA_SHOP_MODE is "${mode}": it must be "replay" or "record"`);
  }

  if (process.env['RUDRA_REPLAY_ONLY']) {
    if (mode === 'record') {
      throw new Error(
        'RUDRA_REPLAY_ONLY is set and RUDRA_SHOP_MODE is record: refusing to start, because replay only means no model calls',
      );
    }
    if (apiKey) {
      throw new Error(
        'RUDRA_REPLAY_ONLY is set and so is ANTHROPIC_API_KEY: refusing to start, because replay only means no model calls ' +
          '(the key may be coming from examples/shop/.env.local)',
      );
    }
    return withVisibleFailures(
      createReplayProvider({ directory: RECORDINGS_DIRECTORY, model: MODEL_ID }),
    );
  }

  if (mode === 'record') {
    if (!apiKey) {
      throw new Error(
        'RUDRA_SHOP_MODE is record but ANTHROPIC_API_KEY is not set: recording calls the model, so it needs a key ' +
          '(export one, or put it in examples/shop/.env.local)',
      );
    }
    return withVisibleFailures(
      createRecordingProvider(
        createAnthropicProvider({
          apiKey,
          model: MODEL_ID,
          ...(process.env['ANTHROPIC_WORKSPACE_ID']
            ? { workspaceId: process.env['ANTHROPIC_WORKSPACE_ID'] }
            : {}),
        }),
        RECORDINGS_DIRECTORY,
      ),
    );
  }

  return createReplayProvider({ directory: RECORDINGS_DIRECTORY, model: MODEL_ID });
}

const CACHE_TTL_MS = 60 * 60 * 1000;

export const specCache = createMemorySpecCache({ ttlMs: CACHE_TTL_MS });

export const generator = createComponentGenerator({
  provider: chooseProvider(),
  cache: specCache,
  onEvent: (event) => {
    const detail = event.degradedReason ? ` (${event.degradedReason})` : '';
    console.log(`[rudra] ${event.source}${detail} in ${event.elapsedMs}ms`);
  },
  modelTimeoutMs: MODEL_TIMEOUT_MS,
});
