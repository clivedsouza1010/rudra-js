import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SPEC_VERSION, generatedSpecSchema } from './component-spec.js';
import { buildPrompt } from './model-prompt.js';
import type { SignalDigest } from './signal-digest.js';
import { FIELD_LIMITS, parseTrackingInput } from './tracking-input.js';

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

export function createNullSpecCache(): SpecCache {
  return { get: async () => undefined, set: async () => {} };
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  const sorted = Object.entries(value as Record<string, unknown>).toSorted(([left], [right]) =>
    left < right ? -1 : 1,
  );
  const fields: string[] = [];
  for (const [name, fieldValue] of sorted) {
    if (fieldValue === undefined) continue;
    fields.push(`${JSON.stringify(name)}:${canonicalise(fieldValue)}`);
  }
  return `{${fields.join(',')}}`;
}

const ODD_TEXT = String.fromCodePoint(
  0x22,
  0x5c,
  0x0a,
  0x09,
  0x08,
  0x0c,
  0x0d,
  0x07,
  0x1b,
  0xdc00,
  0xd800,
  0x7f,
  0xad,
  0xfff9,
  0xffff,
  0xe000,
  0xf0000,
  0x2028,
  0x2029,
  0x34f,
  0x200d,
  0xfe0e,
  0xfe0f,
);

const FULL_DIGEST: Required<SignalDigest> = {
  userId: 'sample',
  segment: ODD_TEXT,
  isReturning: true,
  surface: 'sample',
  slot: 'sample',
  locale: 'en-US',
  maxItems: 2,
  currentSku: 'a'.repeat(FIELD_LIMITS.shortText * 2),
  currentCategory: `${'a'.repeat(FIELD_LIMITS.shortText * 2 - 5)}${String.fromCodePoint(0x7f)}`,
  searchQuery: `${String.fromCodePoint(0x07).repeat(FIELD_LIMITS.shortText)}a`,
  likedSkus: ['sample', 'other'],
  dislikedSkus: ['sample', 'other'],
  purchasedSkus: ['sample', 'other'],
  cartSkus: ['sample', 'other'],
  topViewed: [
    { sku: 'sample', views: 1, dwellMs: 1 },
    { sku: 'other', views: 1, dwellMs: 1 },
  ],
  recentSearches: ['sample', 'other'],
  categoryAffinity: [
    { category: 'sample', score: 1 },
    { category: 'other', score: 1 },
  ],
  interactionCounts: [
    { type: 'sample', count: 1 },
    { type: 'other', count: 1 },
  ],
  isColdStart: true,
};

const EMPTY_DIGEST: SignalDigest = {
  userId: 'sample',
  isReturning: false,
  surface: 'sample',
  slot: 'sample',
  locale: 'en-US',
  maxItems: 1,
  likedSkus: [],
  dislikedSkus: [],
  purchasedSkus: [],
  cartSkus: [],
  topViewed: [],
  recentSearches: [],
  categoryAffinity: [],
  interactionCounts: [],
  isColdStart: false,
};

const SAMPLE_INPUT = parseTrackingInput({
  user: { id: 'sample' },
  context: { surface: 'sample' },
  candidates: Array.from({ length: 62 }, (_unused, index) => ({
    sku: `sample-${index}`,
    title: `Sample ${index}`,
    category: `sample-${index % 3}`,
    price: 1,
    isInStock: index > 0,
    ...(index === 1
      ? {}
      : {
          rating: (index % 11) / 2,
          tags: ['sample', 'other'],
          reason: 'sample',
          imageUrl: '/sample.png',
        }),
  })),
});

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(
    JSON.stringify([FULL_DIGEST, EMPTY_DIGEST].map((digest) => buildPrompt(SAMPLE_INPUT, digest))),
  )
  .digest('hex')
  .slice(0, 16);

function withoutDwellAndScores(digest: SignalDigest) {
  return {
    ...digest,
    topViewed: digest.topViewed.map(({ dwellMs: _dwellMs, ...view }) => view),
    categoryAffinity: digest.categoryAffinity.map(({ score: _score, ...affinity }) => affinity),
  };
}

export function specCacheKey(
  digest: SignalDigest,
  candidateSkus: readonly string[],
  provider: { name: string; model: string },
): string {
  const material = canonicalise({
    specVersion: SPEC_VERSION,
    prompt: PROMPT_FINGERPRINT,
    provider,
    digest: withoutDwellAndScores(digest),
    candidates: candidateSkus.toSorted(),
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
