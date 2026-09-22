import { createHash } from 'node:crypto';
import { SPEC_VERSION, type GeneratedSpec } from './component-spec.js';
import { SYSTEM_PROMPT } from './model-prompt.js';
import type { SignalDigest } from './signal-digest.js';

export interface CachedSpec {
  spec: GeneratedSpec;

  generatedAt: number;
}

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

      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }

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

    async delete(key) {
      entries.delete(key);
    },
  };
}

export function createNullSpecCache(): SpecCache {
  return {
    async get() {
      return undefined;
    },
    async set() {
    },
  };
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : 1));

  return `{${entries.map(([name, fieldValue]) => `${JSON.stringify(name)}:${canonicalise(fieldValue)}`).join(',')}}`;
}

const PROMPT_FINGERPRINT = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 16);

export function specCacheKey(
  digest: SignalDigest,
  candidateSkus: readonly string[],
  provider: { name: string; model: string },
): string {
  const material = canonicalise({
    specVersion: SPEC_VERSION,
    prompt: PROMPT_FINGERPRINT,
    provider,
    digest,
    candidates: candidateSkus.toSorted(),
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export function cohortCacheKey(
  digest: SignalDigest,
  candidateSkus: readonly string[],
  provider: { name: string; model: string },
): string {
  const material = canonicalise({
    specVersion: SPEC_VERSION,
    prompt: PROMPT_FINGERPRINT,
    provider,
    segment: digest.segment ?? null,
    surface: digest.surface,
    slot: digest.slot,
    locale: digest.locale,
    maxItems: digest.maxItems,
    isColdStart: digest.isColdStart,

    currentCategory: digest.currentCategory ?? null,
    topCategory: digest.categoryAffinity[0]?.category ?? null,

    candidates: candidateSkus.toSorted(),
  });

  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
