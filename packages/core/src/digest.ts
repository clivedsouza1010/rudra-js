import type {
  Interaction,
  Product,
  PurchaseSignal,
  SkuSignal,
  TrackingInput,
  ViewSignal,
} from './tracking-input.js';

/**
 * Reduces a validated tracking payload to the compact, ordered, bounded view
 * that everything downstream reads.
 *
 * Two jobs:
 *  1. Keep the volatile part of a prompt small and stable. The contract lets a
 *     host send 500 signals per category; a prompt cannot afford them, and the
 *     long tail is noise anyway.
 *  2. Give the deterministic path the same evidence the model gets, so a
 *     degraded render is a weaker version of the same decision rather than an
 *     unrelated one.
 */

export interface CategoryAffinity {
  category: string;
  /** Unnormalised. Only the ordering is meaningful — do not show this to anyone. */
  score: number;
}

export interface ViewedProduct {
  sku: string;
  views: number;
  dwellMs?: number;
}

export interface InteractionCount {
  type: string;
  count: number;
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
  topViewed: ViewedProduct[];
  recentSearches: string[];
  categoryAffinity: CategoryAffinity[];
  interactionCounts: InteractionCount[];

  /** True when there is no behavioural evidence to personalise on. */
  isColdStart: boolean;
}

/**
 * How much of each signal category survives into the digest. Chosen to keep the
 * per-shopper part of a prompt in the low hundreds of tokens.
 */
export const DIGEST_LIMITS = {
  liked: 12,
  disliked: 12,
  purchased: 8,
  cart: 8,
  viewed: 10,
  searches: 5,
  affinity: 6,
  interactionTypes: 8,
} as const;

/**
 * How much intent each kind of signal implies. A purchase says more about a
 * shopper than a view; an explicit dislike says the most, and says it in the
 * opposite direction.
 */
const SIGNAL_WEIGHTS = {
  purchase: 5,
  like: 4,
  cart: 3,
  view: 1,
  dislike: -6,
} as const;

/** Most recent first. A signal with no timestamp sorts last. */
function byMostRecent(
  left: { at?: number | undefined },
  right: { at?: number | undefined },
): number {
  return (right.at ?? 0) - (left.at ?? 0);
}

/** The most recent `limit` SKUs, each appearing once. */
function recentUniqueSkus(signals: SkuSignal[], limit: number): string[] {
  const skus: string[] = [];
  const alreadySeen = new Set<string>();

  for (const signal of signals.toSorted(byMostRecent)) {
    if (alreadySeen.has(signal.sku)) continue;
    alreadySeen.add(signal.sku);
    skus.push(signal.sku);
    if (skus.length >= limit) break;
  }

  return skus;
}

/**
 * A signal may name its own category; otherwise we look the SKU up in the
 * candidate set. A signal for a product that is not a candidate today and
 * carries no category simply contributes nothing.
 */
function categoryOf(
  signal: { sku: string; category?: string | undefined },
  candidatesBySku: Map<string, Product>,
): string | undefined {
  return signal.category ?? candidatesBySku.get(signal.sku)?.category;
}

function computeCategoryAffinity(
  input: TrackingInput,
  candidatesBySku: Map<string, Product>,
): CategoryAffinity[] {
  const scoreByCategory = new Map<string, number>();

  const addScore = (category: string | undefined, score: number): void => {
    if (!category) return;
    scoreByCategory.set(category, (scoreByCategory.get(category) ?? 0) + score);
  };

  const { signals } = input;

  for (const purchase of signals.lastPurchased) {
    addScore(
      categoryOf(purchase, candidatesBySku),
      SIGNAL_WEIGHTS.purchase * (purchase.weight ?? 1),
    );
  }
  for (const like of signals.likes) {
    addScore(categoryOf(like, candidatesBySku), SIGNAL_WEIGHTS.like * (like.weight ?? 1));
  }
  for (const inCart of signals.cart) {
    addScore(categoryOf(inCart, candidatesBySku), SIGNAL_WEIGHTS.cart * (inCart.weight ?? 1));
  }
  // Merged first, deliberately — see `mergeViewsBySku`. Views are noisy and
  // repeat cheaply, so the tenth view counts for far less than the second, and
  // log scaling keeps a single obsessive session from drowning out a purchase.
  for (const view of mergeViewsBySku(signals.mostViewed)) {
    const scaledViews = Math.log2(1 + view.views);
    addScore(
      categoryOf(view, candidatesBySku),
      SIGNAL_WEIGHTS.view * scaledViews * (view.weight ?? 1),
    );
  }
  for (const dislike of signals.dislikes) {
    addScore(categoryOf(dislike, candidatesBySku), SIGNAL_WEIGHTS.dislike * (dislike.weight ?? 1));
  }

  // The category the shopper is standing in right now is itself evidence.
  addScore(input.context.currentCategory, SIGNAL_WEIGHTS.like);

  return [...scoreByCategory.entries()]
    .map(([category, score]) => ({
      category,
      score: Math.round(score * 100) / 100,
    }))
    .filter((affinity) => affinity.score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, DIGEST_LIMITS.affinity);
}

interface MergedView extends ViewedProduct {
  category?: string;
  weight?: number;
}

/**
 * Collapses every view record for one SKU into a single running total.
 *
 * This has to happen before any scoring. A host is free to emit one record per
 * page view rather than a running count, and scoring each record separately
 * would let thirty `views: 1` records outweigh one `views: 30` record six times
 * over, defeating the sub-linear scaling in `computeCategoryAffinity` entirely.
 * Merging first makes the score depend on how much someone looked, not on how
 * their tracking pipeline happens to batch.
 *
 * Where records disagree on `weight`, the strongest wins.
 */
function mergeViewsBySku(views: ViewSignal[]): MergedView[] {
  const totalsBySku = new Map<string, MergedView>();

  for (const view of views) {
    const running = totalsBySku.get(view.sku);
    if (running) {
      running.views += view.views;
      if (view.dwellMs !== undefined) running.dwellMs = (running.dwellMs ?? 0) + view.dwellMs;
      if (view.category !== undefined) running.category ??= view.category;
      if (view.weight !== undefined) running.weight = Math.max(running.weight ?? 0, view.weight);
      continue;
    }
    totalsBySku.set(view.sku, {
      sku: view.sku,
      views: view.views,
      ...(view.dwellMs !== undefined ? { dwellMs: view.dwellMs } : {}),
      ...(view.category !== undefined ? { category: view.category } : {}),
      ...(view.weight !== undefined ? { weight: view.weight } : {}),
    });
  }

  return [...totalsBySku.values()];
}

/** The most-viewed few, as the digest reports them. */
function mostViewedProducts(views: ViewSignal[]): ViewedProduct[] {
  return mergeViewsBySku(views)
    .toSorted((left, right) => right.views - left.views)
    .slice(0, DIGEST_LIMITS.viewed)
    .map(({ sku, views: viewCount, dwellMs }) => ({
      sku,
      views: viewCount,
      ...(dwellMs !== undefined ? { dwellMs } : {}),
    }));
}

/** The open-vocabulary long tail, reduced to "which kinds, and how often". */
function countByInteractionType(interactions: Interaction[]): InteractionCount[] {
  const countByType = new Map<string, number>();

  for (const interaction of interactions) {
    countByType.set(interaction.type, (countByType.get(interaction.type) ?? 0) + 1);
  }

  return [...countByType.entries()]
    .map(([type, count]) => ({ type, count }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, DIGEST_LIMITS.interactionTypes);
}

function recentPurchasedSkus(purchases: PurchaseSignal[]): string[] {
  return recentUniqueSkus(purchases, DIGEST_LIMITS.purchased);
}

export function buildDigest(input: TrackingInput): SignalDigest {
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const { signals, context, user } = input;

  const likedSkus = recentUniqueSkus(signals.likes, DIGEST_LIMITS.liked);
  const dislikedSkus = recentUniqueSkus(signals.dislikes, DIGEST_LIMITS.disliked);
  const purchasedSkus = recentPurchasedSkus(signals.lastPurchased);
  const cartSkus = recentUniqueSkus(signals.cart, DIGEST_LIMITS.cart);
  const topViewed = mostViewedProducts(signals.mostViewed);

  // Searches say what a shopper wants; they do not say they engaged with any
  // product, so they do not lift a shopper out of cold start on their own.
  const evidenceCount =
    likedSkus.length +
    dislikedSkus.length +
    purchasedSkus.length +
    cartSkus.length +
    topViewed.length;

  return {
    userId: user.id,
    ...(user.segment !== undefined ? { segment: user.segment } : {}),
    isReturning: user.isReturning ?? purchasedSkus.length > 0,

    surface: context.surface,
    slot: context.slot,
    locale: context.locale,
    maxItems: context.maxItems,
    ...(context.currentSku !== undefined ? { currentSku: context.currentSku } : {}),
    ...(context.currentCategory !== undefined ? { currentCategory: context.currentCategory } : {}),
    ...(context.searchQuery !== undefined ? { searchQuery: context.searchQuery } : {}),

    likedSkus,
    dislikedSkus,
    purchasedSkus,
    cartSkus,
    topViewed,
    recentSearches: signals.recentSearches.slice(0, DIGEST_LIMITS.searches),
    categoryAffinity: computeCategoryAffinity(input, candidatesBySku),
    interactionCounts: countByInteractionType(signals.interactions),

    isColdStart: evidenceCount === 0,
  };
}
