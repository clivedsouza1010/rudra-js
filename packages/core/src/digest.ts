import type {
  Interaction,
  Product,
  PurchaseSignal,
  SkuSignal,
  TrackingInput,
  ViewSignal,
} from './tracking-input.js';

/**
 * Reduces a raw tracking payload to the compact, ordered, bounded view that
 * both the prompt builder and the deterministic fallback consume.
 *
 * Two jobs:
 *  1. Keep the prompt small and stable. Unbounded signal arrays would blow up
 *     token cost and make the cache key churn on noise.
 *  2. Give the fallback path the same evidence the model gets, so a degraded
 *     render is a weaker version of the same decision — not a different one.
 */

export interface CategoryAffinity {
  category: string;
  /** Unnormalised score; only the ordering is meaningful. */
  score: number;
}

export interface SignalDigest {
  userId: string;
  segment?: string;
  isReturning: boolean;
  surface: string;
  slot: string;
  locale: string;
  maxItems: number;
  currentSku?: string;
  currentCategory?: string;
  searchQuery?: string;

  likedSkus: string[];
  dislikedSkus: string[];
  purchasedSkus: string[];
  cartSkus: string[];
  topViewed: Array<{ sku: string; views: number; dwellMs?: number }>;
  recentSearches: string[];
  categoryAffinity: CategoryAffinity[];
  /** Interaction type -> count, for the long tail of site behaviour. */
  interactionCounts: Array<{ type: string; count: number }>;

  /** True when there is effectively nothing to personalise on. */
  isColdStart: boolean;
}

/** Caps chosen to keep the volatile prompt segment in the low hundreds of tokens. */
const LIMITS = {
  liked: 12,
  disliked: 12,
  purchased: 8,
  cart: 8,
  viewed: 10,
  searches: 5,
  affinity: 6,
  interactionTypes: 8,
} as const;

function byRecency(a: { at?: number }, b: { at?: number }): number {
  return (b.at ?? 0) - (a.at ?? 0);
}

function uniqueSkus(signals: SkuSignal[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const signal of [...signals].sort(byRecency)) {
    if (seen.has(signal.sku)) continue;
    seen.add(signal.sku);
    out.push(signal.sku);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Category affinity, weighted by how much intent each signal implies.
 * A purchase says more than a view; an explicit dislike subtracts.
 */
const WEIGHTS = {
  purchase: 5,
  like: 4,
  cart: 3,
  view: 1,
  dislike: -6,
} as const;

function categoryOf(
  signal: { sku: string; category?: string },
  catalogIndex: Map<string, Product>,
): string | undefined {
  return signal.category ?? catalogIndex.get(signal.sku)?.category;
}

function computeAffinity(
  input: TrackingInput,
  catalogIndex: Map<string, Product>,
): CategoryAffinity[] {
  const scores = new Map<string, number>();

  const add = (category: string | undefined, weight: number): void => {
    if (!category) return;
    scores.set(category, (scores.get(category) ?? 0) + weight);
  };

  const { signals } = input;
  for (const s of signals.lastPurchased) add(categoryOf(s, catalogIndex), WEIGHTS.purchase * (s.weight ?? 1));
  for (const s of signals.likes) add(categoryOf(s, catalogIndex), WEIGHTS.like * (s.weight ?? 1));
  for (const s of signals.cart) add(categoryOf(s, catalogIndex), WEIGHTS.cart * (s.weight ?? 1));
  for (const s of signals.mostViewed) {
    // Views are noisy, so their contribution grows sub-linearly with count.
    add(categoryOf(s, catalogIndex), WEIGHTS.view * Math.log2(1 + s.views) * (s.weight ?? 1));
  }
  for (const s of signals.dislikes) add(categoryOf(s, catalogIndex), WEIGHTS.dislike * (s.weight ?? 1));

  // The surface the user is standing on is itself a strong signal.
  if (input.context.currentCategory) add(input.context.currentCategory, WEIGHTS.like);

  return [...scores.entries()]
    .map(([category, score]) => ({ category, score: Math.round(score * 100) / 100 }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMITS.affinity);
}

function topViewed(views: ViewSignal[]): Array<{ sku: string; views: number; dwellMs?: number }> {
  const merged = new Map<string, { sku: string; views: number; dwellMs?: number }>();
  for (const view of views) {
    const existing = merged.get(view.sku);
    if (existing) {
      existing.views += view.views;
      if (view.dwellMs !== undefined) existing.dwellMs = (existing.dwellMs ?? 0) + view.dwellMs;
    } else {
      merged.set(view.sku, {
        sku: view.sku,
        views: view.views,
        ...(view.dwellMs !== undefined ? { dwellMs: view.dwellMs } : {}),
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.views - a.views).slice(0, LIMITS.viewed);
}

function countInteractions(interactions: Interaction[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const interaction of interactions) {
    counts.set(interaction.type, (counts.get(interaction.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, LIMITS.interactionTypes);
}

function purchasedSkus(purchases: PurchaseSignal[]): string[] {
  return uniqueSkus(purchases, LIMITS.purchased);
}

export function buildDigest(input: TrackingInput): SignalDigest {
  const catalogIndex = new Map(input.candidates.map((product) => [product.sku, product]));
  const { signals, context, user } = input;

  const likedSkus = uniqueSkus(signals.likes, LIMITS.liked);
  const dislikedSkus = uniqueSkus(signals.dislikes, LIMITS.disliked);
  const purchased = purchasedSkus(signals.lastPurchased);
  const cartSkus = uniqueSkus(signals.cart, LIMITS.cart);
  const viewed = topViewed(signals.mostViewed);

  const evidenceCount =
    likedSkus.length + dislikedSkus.length + purchased.length + cartSkus.length + viewed.length;

  return {
    userId: user.id,
    ...(user.segment !== undefined ? { segment: user.segment } : {}),
    isReturning: user.isReturning ?? purchased.length > 0,
    surface: context.surface,
    slot: context.slot,
    locale: context.locale,
    maxItems: context.maxItems,
    ...(context.currentSku !== undefined ? { currentSku: context.currentSku } : {}),
    ...(context.currentCategory !== undefined ? { currentCategory: context.currentCategory } : {}),
    ...(context.searchQuery !== undefined ? { searchQuery: context.searchQuery } : {}),
    likedSkus,
    dislikedSkus,
    purchasedSkus: purchased,
    cartSkus,
    topViewed: viewed,
    recentSearches: signals.recentSearches.slice(0, LIMITS.searches),
    categoryAffinity: computeAffinity(input, catalogIndex),
    interactionCounts: countInteractions(signals.interactions),
    isColdStart: evidenceCount === 0,
  };
}
