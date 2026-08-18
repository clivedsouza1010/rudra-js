import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS,
  parseTrackingInput,
  safeParseTrackingInput,
  type TrackingInputDraft,
} from './tracking-input.js';

const aProduct = {
  sku: 'TR-102',
  title: 'Switchback Trail Shoe GTX',
  category: 'Trail Running',
  price: 174,
};

/** The smallest payload the contract accepts: a user, a surface, one candidate. */
function minimalPayload(overrides: Partial<TrackingInputDraft> = {}): TrackingInputDraft {
  return {
    user: { id: 'shopper-1' },
    context: { surface: 'pdp' },
    candidates: [aProduct],
    ...overrides,
  };
}

describe('parseTrackingInput', () => {
  it('accepts the minimal payload', () => {
    const input = parseTrackingInput(minimalPayload());

    expect(input.user.id).toBe('shopper-1');
    expect(input.context.surface).toBe('pdp');
    expect(input.candidates).toHaveLength(1);
  });

  it('treats a payload with no signals block as cold start, not an error', () => {
    const input = parseTrackingInput(minimalPayload());

    expect(input.signals.likes).toEqual([]);
    expect(input.signals.dislikes).toEqual([]);
    expect(input.signals.mostViewed).toEqual([]);
    expect(input.signals.lastPurchased).toEqual([]);
    expect(input.signals.cart).toEqual([]);
    expect(input.signals.recentSearches).toEqual([]);
    expect(input.signals.interactions).toEqual([]);
  });

  it('applies the documented defaults so a host need not restate them', () => {
    const input = parseTrackingInput(minimalPayload());

    expect(input.schemaVersion).toBe('1');
    expect(input.context.slot).toBe('recommendations');
    expect(input.context.locale).toBe('en-US');
    expect(input.context.maxItems).toBe(4);
    expect(input.candidates[0]?.currency).toBe('USD');
    expect(input.candidates[0]?.inStock).toBe(true);
    expect(input.candidates[0]?.tags).toEqual([]);
  });

  it('defaults a view signal to a single view', () => {
    const input = parseTrackingInput(
      minimalPayload({ signals: { mostViewed: [{ sku: 'TR-104' }] } }),
    );

    expect(input.signals.mostViewed[0]?.views).toBe(1);
  });

  it('rejects a payload with no candidates, because nothing could be recommended', () => {
    const result = safeParseTrackingInput(minimalPayload({ candidates: [] }));

    expect(result.success).toBe(false);
  });

  it.each([
    ['a missing user id', { user: { id: '' } }],
    ['a missing surface', { context: { surface: '' } }],
  ])('rejects %s', (_label, overrides) => {
    const result = safeParseTrackingInput(minimalPayload(overrides as Partial<TrackingInputDraft>));

    expect(result.success).toBe(false);
  });

  it('throws rather than returning a partial result, so a caller bug is loud', () => {
    expect(() => parseTrackingInput({ user: { id: 'shopper-1' } })).toThrow();
  });
});

/**
 * These bounds are what stop a host-supplied string from becoming an unbounded
 * prompt, and therefore an unbounded model bill. They are load-bearing, not
 * defensive.
 */
describe('field limits', () => {
  const tooLong = (limit: number) => 'x'.repeat(limit + 1);

  it('rejects an over-long search query', () => {
    const result = safeParseTrackingInput(
      minimalPayload({ context: { surface: 'pdp', searchQuery: tooLong(FIELD_LIMITS.searchQuery) } }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects an over-long interaction type', () => {
    const result = safeParseTrackingInput(
      minimalPayload({ signals: { interactions: [{ type: tooLong(FIELD_LIMITS.identifier) }] } }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects an over-long recent search', () => {
    const result = safeParseTrackingInput(
      minimalPayload({ signals: { recentSearches: [tooLong(FIELD_LIMITS.searchQuery)] } }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects more candidates than a single prompt should ever carry', () => {
    const tooMany = Array.from({ length: FIELD_LIMITS.candidates + 1 }, (_unused, index) => ({
      ...aProduct,
      sku: `SKU-${index}`,
    }));

    const result = safeParseTrackingInput(minimalPayload({ candidates: tooMany }));

    expect(result.success).toBe(false);
  });

  it('rejects more signals in one category than the cap allows', () => {
    const tooMany = Array.from({ length: FIELD_LIMITS.signalsPerCategory + 1 }, (_unused, index) => ({
      sku: `SKU-${index}`,
    }));

    const result = safeParseTrackingInput(minimalPayload({ signals: { likes: tooMany } }));

    expect(result.success).toBe(false);
  });

  it('rejects a meta record with more entries than the cap allows', () => {
    const meta = Object.fromEntries(
      Array.from({ length: FIELD_LIMITS.metaEntries + 1 }, (_unused, index) => [`key-${index}`, index]),
    );

    const result = safeParseTrackingInput(
      minimalPayload({ signals: { interactions: [{ type: 'filter_applied', meta }] } }),
    );

    expect(result.success).toBe(false);
  });

  it('accepts a meta record exactly at the cap', () => {
    const meta = Object.fromEntries(
      Array.from({ length: FIELD_LIMITS.metaEntries }, (_unused, index) => [`key-${index}`, index]),
    );

    const result = safeParseTrackingInput(
      minimalPayload({ signals: { interactions: [{ type: 'filter_applied', meta }] } }),
    );

    expect(result.success).toBe(true);
  });

  it('accepts a value exactly at the limit', () => {
    const result = safeParseTrackingInput(
      minimalPayload({
        context: { surface: 'pdp', searchQuery: 'x'.repeat(FIELD_LIMITS.searchQuery) },
      }),
    );

    expect(result.success).toBe(true);
  });
});

/**
 * The contract rejects unrecognised fields rather than dropping them. A lenient
 * schema turns a host's typo into a shopper with no history and no error
 * anywhere, which is the exact failure this module exists to prevent.
 */
describe('unknown fields', () => {
  it('rejects an unknown top-level field', () => {
    const result = safeParseTrackingInput({ ...minimalPayload(), unexpected: 'value' });

    expect(result.success).toBe(false);
  });

  it('rejects a misspelled signal category instead of silently returning cold start', () => {
    const result = safeParseTrackingInput(
      minimalPayload({ signals: { recentSeraches: ['hydration vest'] } as never }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects an unknown field on a nested object', () => {
    const result = safeParseTrackingInput(
      minimalPayload({ user: { id: 'shopper-1', tier: 'gold' } as never }),
    );

    expect(result.success).toBe(false);
  });

  it('still accepts arbitrary keys inside interaction meta, which is a record by design', () => {
    const result = safeParseTrackingInput(
      minimalPayload({
        signals: { interactions: [{ type: 'filter_applied', meta: { anythingAtAll: 'ok' } }] },
      }),
    );

    expect(result.success).toBe(true);
  });
});
