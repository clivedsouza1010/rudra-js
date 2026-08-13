import { createHash } from 'node:crypto';
import type { SignalDigest } from './digest.js';
import type { GeneratedSpec } from './spec.js';

/**
 * Generation cache with single-flight de-duplication.
 *
 * Two distinct problems, one module:
 *
 *  - A generated component is stable for as long as the shopper's signals are.
 *    Re-generating it on every page view would put a model round-trip on the
 *    critical SSR path for no benefit, which is exactly the latency the
 *    architecture is trying to avoid.
 *  - Under concurrency, a cold key would otherwise fan out into N identical
 *    in-flight model calls — the classic cache stampede. Single-flight collapses
 *    them into one.
 */

export interface SpecCache {
  get(key: string): GeneratedSpec | undefined;
  set(key: string, value: GeneratedSpec): void;
  /** Returns the number of entries dropped. */
  clear(): number;
  readonly size: number;
}

interface Entry {
  value: GeneratedSpec;
  expiresAt: number;
}

export interface MemoryCacheOptions {
  ttlMs?: number;
  /** Hard ceiling on entries. Oldest insertions are evicted first. */
  maxEntries?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/**
 * Bounded TTL cache. Deliberately in-process and deliberately simple: for a
 * multi-instance deployment, implement `SpecCache` over Redis instead — the
 * generator does not care which it is given.
 */
export function createMemoryCache(options: MemoryCacheOptions = {}): SpecCache {
  const ttlMs = options.ttlMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 1_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      // Refresh insertion order so hot keys survive eviction.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    clear() {
      const dropped = entries.size;
      entries.clear();
      return dropped;
    },
    get size() {
      return entries.size;
    },
  };
}

/** A cache that stores nothing. Used to measure uncached generation latency. */
export function createNoopCache(): SpecCache {
  return {
    get: () => undefined,
    set: () => undefined,
    clear: () => 0,
    get size() {
      return 0;
    },
  };
}

/**
 * Derives the cache key from everything that can change the generated output —
 * and nothing else. Ordering is normalised so two payloads that differ only in
 * array order hit the same key.
 */
export function cacheKey(
  digest: SignalDigest,
  candidateSkus: string[],
  providerId: string,
  promptFingerprint: string,
): string {
  const material = JSON.stringify({
    v: 1,
    provider: providerId,
    prompt: promptFingerprint,
    surface: digest.surface,
    slot: digest.slot,
    locale: digest.locale,
    maxItems: digest.maxItems,
    currentSku: digest.currentSku ?? null,
    currentCategory: digest.currentCategory ?? null,
    searchQuery: digest.searchQuery ?? null,
    segment: digest.segment ?? null,
    liked: [...digest.likedSkus].sort(),
    disliked: [...digest.dislikedSkus].sort(),
    purchased: [...digest.purchasedSkus].sort(),
    cart: [...digest.cartSkus].sort(),
    // Bucket view counts so a single extra page view does not evict the entry.
    viewed: digest.topViewed
      .map((v) => `${v.sku}:${Math.floor(Math.log2(1 + v.views))}`)
      .sort(),
    searches: [...digest.recentSearches].sort(),
    affinity: digest.categoryAffinity.map((a) => a.category),
    candidates: [...candidateSkus].sort(),
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** Short, stable identifier for a prompt revision, so prompt edits bust the cache. */
export function fingerprintPrompt(system: string): string {
  return createHash('sha256').update(system).digest('hex').slice(0, 12);
}

/**
 * Collapses concurrent calls for the same key into a single execution.
 * The in-flight promise is removed as soon as it settles, so a failure does not
 * poison subsequent attempts.
 */
export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = task().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    get pending() {
      return inFlight.size;
    },
  };
}
