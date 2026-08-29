import { createHash } from 'node:crypto';
import { SPEC_VERSION, type GeneratedSpec } from './component-spec.js';
import type { SignalDigest } from './signal-digest.js';

/**
 * Where a generated component is kept between requests.
 *
 * A generation is stable for as long as the shopper's signals are, so asking a
 * model again on the next page view buys nothing and costs a round trip on the
 * render path — which is the latency this whole design exists to avoid.
 *
 * The store is a port rather than an implementation. A single process can use
 * the in-memory one; anything running more than one instance needs a shared
 * store, or each instance keeps its own copy and the hit rate divides by the
 * instance count.
 */

/**
 * Asynchronous on purpose. A synchronous `get` would look simpler and would
 * make the shared store the docs recommend impossible to write, since no Redis
 * or Memcached client can return a value without awaiting.
 */
/**
 * A stored generation, with the moment it was produced.
 *
 * The timestamp travels with the spec because it cannot be recovered later: a
 * component served from cache is not newly generated, and `generatedAt` is the
 * only way anything downstream can tell how stale what it is showing has become.
 */
export interface CachedSpec {
  spec: GeneratedSpec;
  /** Epoch milliseconds at which the model produced this. */
  generatedAt: number;
}

export interface SpecCache {
  get(key: string): Promise<CachedSpec | undefined>;
  set(key: string, cached: CachedSpec): Promise<void>;
}

export interface MemorySpecCacheOptions {
  /** How long an entry stays valid. Defaults to 60 seconds. */
  ttlMs?: number;
  /** Hard ceiling on entries. Least recently read is evicted first. */
  maxEntries?: number;
  /** Injectable clock, so tests do not have to wait. */
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

/**
 * A bounded in-process cache.
 *
 * `maxEntries` is generous relative to the default TTL for a reason: a ceiling
 * low enough to evict entries before they expire silently turns a longer TTL
 * into a setting that does nothing, and the person who raised it has no way to
 * tell.
 */
export function createMemorySpecCache(options: MemorySpecCacheOptions = {}): SpecCache {
  const ttlMs = options.ttlMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 10_000;

  // Checked rather than trusted, because the way these are usually supplied is
  // `Number(process.env.SOMETHING)`, and an unset or misspelled variable makes
  // that NaN. Every comparison against NaN is false, so the cache would then
  // never expire an entry and never evict one — it would grow forever while
  // serving a shopper the component they were given last week, and nothing
  // would report it. Failing at construction is the only loud option.
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

      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }

      // Re-insert so insertion order tracks recency of use, which is what makes
      // the eviction below least-recently-used rather than oldest-written.
      entries.delete(key);
      entries.set(key, entry);
      return entry.cached;
    },

    async set(key, cached) {
      entries.delete(key);
      entries.set(key, { cached, expiresAt: now() + ttlMs });

      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
  };
}

/**
 * A cache that stores nothing, so every request generates.
 *
 * This is not a stub. It is the control for any measurement of generation cost
 * or latency: with a cache in front, a benchmark reports how often it hit, not
 * what generating costs.
 */
export function createNullSpecCache(): SpecCache {
  return {
    async get() {
      return undefined;
    },
    async set() {
      // Deliberately nothing.
    },
  };
}

/** Stable JSON: object keys sorted, so key order in a digest cannot matter. */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : 1));

  return `{${entries.map(([name, fieldValue]) => `${JSON.stringify(name)}:${canonicalise(fieldValue)}`).join(',')}}`;
}

/**
 * Derives the cache key.
 *
 * The digest goes in **whole**, rather than as a hand-picked list of fields.
 * That is the entire point of this function. The previous implementation listed
 * the fields it thought mattered, and four of them drifted: they reached the
 * model but not the key, so two shoppers with genuinely different histories
 * collided and were served each other's component. Hashing the whole digest
 * makes that class of bug unreachable — a field cannot be forgotten here,
 * because nothing is named here.
 *
 * The cost is a lower hit rate than a hand-tuned key would give, since every
 * signal now moves the key. That is the right way round: a key that is too
 * specific wastes money, and a key that is too loose shows one shopper another
 * shopper's page. Raising the hit rate means deliberately coarsening the digest
 * itself, which is a decision to make against measurements rather than by
 * guessing here.
 *
 * Candidates enter as SKUs only. Their titles, prices and ratings reach the
 * model too, but including them would churn the key on every price change for
 * copy that would almost always come back the same. The consequence is bounded
 * and worth stating: within one TTL, a price change does not refresh the
 * generated copy. It cannot show a stale price — prices are read from the live
 * catalog at render time, never from the model.
 */
export function specCacheKey(
  digest: SignalDigest,
  candidateSkus: readonly string[],
  providerId: string,
): string {
  const material = canonicalise({
    // The spec's own version, so a shape change cannot read entries written by
    // the previous shape out of a shared store that outlives a deploy.
    specVersion: SPEC_VERSION,
    provider: providerId,
    digest,
    candidates: candidateSkus.toSorted(),
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

// Leaves out the fields that make a key personal: who the shopper is, what they
// liked, viewed or searched for. Candidates go too, because every shopper's list
// is different — that is safe because the SKUs in a cohort spec get replaced
// before the page is served.
export function cohortCacheKey(digest: SignalDigest, providerId: string): string {
  const material = canonicalise({
    specVersion: SPEC_VERSION,
    provider: providerId,
    segment: digest.segment ?? null,
    surface: digest.surface,
    slot: digest.slot,
    locale: digest.locale,
    maxItems: digest.maxItems,
    isColdStart: digest.isColdStart,
    topCategory: digest.categoryAffinity[0]?.category ?? null,
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
