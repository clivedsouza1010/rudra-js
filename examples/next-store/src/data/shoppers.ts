import type { TrackingInputDraft, TrackingSignals } from '@rudra/core';
import { candidatesFor, getProduct } from '@/data/catalog';

/**
 * Sample tracking payloads.
 *
 * This is the framework's only input. In a real deployment these signals come
 * from whatever the host already runs — an event stream, a CDP, a warehouse
 * query — and are handed to `generate()` as one JSON object. rudra-js stores
 * nothing and collects nothing.
 *
 * The three shoppers are chosen to exercise visibly different generation paths:
 * a strong single-category history, a cold start with no signals at all, and a
 * cross-category shopper with an explicit dislike to honour.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface Shopper {
  id: string;
  label: string;
  /** Shown in the demo UI so the generated output can be read against its cause. */
  description: string;
  segment?: string;
  isReturning: boolean;
  signals: Partial<TrackingSignals>;
}

/** Relative to call time, so the demo always looks recent. */
const ago = (ms: number): number => Date.now() - ms;

export const SHOPPERS: Shopper[] = [
  {
    id: 'u-trail-regular',
    label: 'Trail regular',
    description:
      'Deep single-category history: bought trail shoes and gels, keeps returning to the hydration vest without buying it.',
    segment: 'endurance',
    isReturning: true,
    signals: {
      likes: [
        { sku: 'TR-102', at: ago(3 * DAY) },
        { sku: 'TR-104', at: ago(20 * MINUTE) },
      ],
      lastPurchased: [
        { sku: 'TR-101', at: ago(28 * DAY), quantity: 1, price: 139 },
        { sku: 'NU-502', at: ago(9 * DAY), quantity: 2, price: 32 },
      ],
      mostViewed: [
        { sku: 'TR-104', views: 7, dwellMs: 96_000, at: ago(18 * MINUTE) },
        { sku: 'TR-102', views: 3, dwellMs: 41_000, at: ago(2 * DAY) },
        { sku: 'NU-501', views: 2, dwellMs: 12_000, at: ago(4 * DAY) },
      ],
      recentSearches: ['hydration vest', 'ultra pack 8l'],
      interactions: [
        { type: 'size_guide_opened', sku: 'TR-104', at: ago(17 * MINUTE) },
        { type: 'review_read', sku: 'TR-104', at: ago(16 * MINUTE) },
        { type: 'scroll_depth', sku: 'TR-104', value: 0.92, at: ago(16 * MINUTE) },
      ],
    },
  },
  {
    id: 'u-cold-start',
    label: 'Cold start',
    description:
      'First session, no signals of any kind. Exercises the restraint path: the component should not invent familiarity.',
    isReturning: false,
    signals: {},
  },
  {
    id: 'u-winter-planner',
    label: 'Winter planner',
    description:
      'Cross-category: hardshell purchased, tent in cart, fleece explicitly disliked. The dislike must never be recommended.',
    segment: 'expedition',
    isReturning: true,
    signals: {
      likes: [{ sku: 'CP-402', at: ago(2 * DAY) }],
      dislikes: [{ sku: 'OW-303', at: ago(6 * DAY) }],
      lastPurchased: [{ sku: 'OW-301', at: ago(11 * DAY), quantity: 1, price: 289 }],
      cart: [{ sku: 'CP-401', at: ago(35 * MINUTE) }],
      mostViewed: [
        { sku: 'CP-402', views: 5, dwellMs: 74_000, at: ago(30 * MINUTE) },
        { sku: 'CP-404', views: 4, dwellMs: 33_000, at: ago(28 * MINUTE) },
        { sku: 'HK-202', views: 2, dwellMs: 15_000, at: ago(3 * DAY) },
      ],
      recentSearches: ['3 season sleep system', 'sleeping bag -7'],
      interactions: [
        { type: 'wishlist_added', sku: 'CP-404', at: ago(27 * MINUTE) },
        { type: 'comparison_opened', value: 'CP-402 vs CP-404', at: ago(26 * MINUTE) },
        { type: 'shipping_estimate', at: ago(25 * MINUTE) },
      ],
    },
  },
];

export const SHOPPERS_BY_ID = new Map(SHOPPERS.map((shopper) => [shopper.id, shopper]));

export const DEFAULT_SHOPPER_ID = SHOPPERS[0]!.id;

export function getShopper(id: string | undefined): Shopper {
  return (id ? SHOPPERS_BY_ID.get(id) : undefined) ?? SHOPPERS_BY_ID.get(DEFAULT_SHOPPER_ID)!;
}

export interface BuildInputArgs {
  shopperId?: string;
  currentSku?: string;
  surface?: string;
  slot?: string;
  maxItems?: number;
}

/**
 * Assembles the one JSON object the framework consumes: who the shopper is,
 * where they are, what they have done, and which products may be shown.
 */
export function buildTrackingInput({
  shopperId,
  currentSku,
  surface = 'pdp',
  slot = 'pdp-recommendations',
  maxItems = 4,
}: BuildInputArgs): TrackingInputDraft {
  const shopper = getShopper(shopperId);
  const current = currentSku ? getProduct(currentSku) : undefined;

  return {
    schemaVersion: '1',
    user: {
      id: shopper.id,
      ...(shopper.segment ? { segment: shopper.segment } : {}),
      isReturning: shopper.isReturning,
    },
    context: {
      surface,
      slot,
      ...(currentSku ? { currentSku } : {}),
      ...(current ? { currentCategory: current.category } : {}),
      locale: 'en-US',
      maxItems,
    },
    signals: shopper.signals,
    candidates: candidatesFor(currentSku),
  };
}
