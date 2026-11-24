import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SPEC_VERSION, generatedSpecSchema } from './component-spec.js';
import type { PromptPair } from './model-prompt.js';

export const cachedSpecSchema = z.object({
  spec: generatedSpecSchema,
  generatedAt: z.number(),
});

export type CachedSpec = z.infer<typeof cachedSpecSchema>;

export interface SpecCache {
  get(key: string): Promise<CachedSpec | undefined>;
  set(key: string, cached: CachedSpec): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface MemorySpecCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

function assertFiniteAtLeastZero(name: string, value: number): void {
  if (Number.isFinite(value) && value >= 0) return;

  const hint = Number.isNaN(value)
    ? ' (a common cause is Number() on an environment variable that is not set)'
    : '';
  throw new RangeError(`${name} must be a finite number of at least 0, received ${value}${hint}`);
}

interface CacheEntry {
  cached: CachedSpec;
  expiresAt: number;
}

export function createMemorySpecCache(options: MemorySpecCacheOptions = {}): SpecCache {
  const ttlMs = options.ttlMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 10_000;

  assertFiniteAtLeastZero('ttlMs', ttlMs);
  assertFiniteAtLeastZero('maxEntries', maxEntries);
  if (!Number.isSafeInteger(maxEntries)) {
    throw new RangeError(`maxEntries must be a whole number, received ${maxEntries}`);
  }

  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;

      const isExpired = entry.expiresAt <= now();
      entries.delete(key);
      if (isExpired) return undefined;
      entries.set(key, entry);
      return entry.cached;
    },

    async set(key, cached) {
      entries.delete(key);
      entries.set(key, { cached, expiresAt: now() + ttlMs });

      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(oldest);
      }
    },

    async delete(key) {
      entries.delete(key);
    },
  };
}

const nullStores = new WeakSet<SpecCache>();

export function createNullSpecCache(): SpecCache {
  const store: SpecCache = { get: async () => undefined, set: async () => {} };
  nullStores.add(store);
  return store;
}

export function isNullSpecCache(cache: SpecCache): boolean {
  return nullStores.has(cache);
}

export function specCacheKey(
  prompt: PromptPair,
  provider: { name: string; model: string },
): string {
  const material = JSON.stringify([
    SPEC_VERSION,
    provider.name,
    provider.model,
    prompt.system,
    prompt.user,
  ]);

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
