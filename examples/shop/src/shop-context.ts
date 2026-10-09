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

export const RECORDINGS_DIRECTORY =
  process.env['RUDRA_SHOP_RECORDINGS'] || join(process.cwd(), 'recordings');

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

export function chooseProvider(): ComponentProvider {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const mode = process.env['RUDRA_SHOP_MODE'] || 'replay';
  const replayOnly = process.env['RUDRA_REPLAY_ONLY'];

  if (mode !== 'replay' && mode !== 'record') {
    throw new Error(`RUDRA_SHOP_MODE is "${mode}": it must be "replay" or "record"`);
  }
  if (replayOnly && mode === 'record') {
    throw new Error(
      'RUDRA_REPLAY_ONLY is set and RUDRA_SHOP_MODE is record: refusing to start, because replay only means no model calls',
    );
  }
  if (replayOnly && apiKey) {
    throw new Error(
      'RUDRA_REPLAY_ONLY is set and so is ANTHROPIC_API_KEY: refusing to start, because replay only means no model calls ' +
        '(the key may be coming from examples/shop/.env.local)',
    );
  }
  if (mode === 'replay') {
    return createReplayProvider({
      directory: RECORDINGS_DIRECTORY,
      name: 'anthropic',
      model: MODEL_ID,
    });
  }
  if (!apiKey) {
    throw new Error(
      'RUDRA_SHOP_MODE is record but ANTHROPIC_API_KEY is not set: recording calls the model, so it needs a key ' +
        '(export one, or put it in examples/shop/.env.local)',
    );
  }

  const workspaceId = process.env['ANTHROPIC_WORKSPACE_ID'];
  return createRecordingProvider(
    createAnthropicProvider({ apiKey, model: MODEL_ID, ...(workspaceId ? { workspaceId } : {}) }),
    RECORDINGS_DIRECTORY,
  );
}

const CACHE_TTL_MS = 60 * 60 * 1000;

export const specCache = createMemorySpecCache({ ttlMs: CACHE_TTL_MS });

export const generator = createComponentGenerator({
  provider: chooseProvider(),
  cache: specCache,
  onEvent: (event) => {
    const detail = event.degradedReason ? ` (${event.degradedReason})` : '';
    const why = event.error instanceof Error ? `: ${event.error.message}` : '';
    console.log(`[rudra] ${event.source}${detail}${why} in ${event.elapsedMs}ms`);
  },
  modelTimeoutMs: MODEL_TIMEOUT_MS,
});
