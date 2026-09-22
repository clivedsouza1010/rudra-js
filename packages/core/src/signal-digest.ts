import type {
  Interaction,
  Product,
  SkuSignal,
  TrackingInput,
  ViewSignal,
} from './tracking-input.js';

export interface CategoryAffinity {
  category: string;

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

  isColdStart: boolean;
}

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

const SIGNAL_WEIGHTS = {
  purchase: 5,
  like: 4,
  cart: 3,
  view: 1,
  dislike: -6,
} as const;

const effectiveWeight = (signal: { weight?: number | undefined }): number => signal.weight ?? 1;

function byMostRecent(
  left: { at?: number | undefined },
  right: { at?: number | undefined },
): number {
  return (right.at ?? 0) - (left.at ?? 0);
}

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
      SIGNAL_WEIGHTS.purchase * effectiveWeight(purchase),
    );
  }
  for (const like of signals.likes) {
    addScore(categoryOf(like, candidatesBySku), SIGNAL_WEIGHTS.like * effectiveWeight(like));
  }
  for (const inCart of signals.cart) {
    addScore(categoryOf(inCart, candidatesBySku), SIGNAL_WEIGHTS.cart * effectiveWeight(inCart));
  }

  for (const view of mergeViewsBySku(signals.mostViewed)) {
    const scaledViews = Math.log2(1 + view.views);
    addScore(categoryOf(view, candidatesBySku), SIGNAL_WEIGHTS.view * scaledViews * view.weight);
  }
  for (const dislike of signals.dislikes) {
    addScore(
      categoryOf(dislike, candidatesBySku),
      SIGNAL_WEIGHTS.dislike * effectiveWeight(dislike),
    );
  }

  addScore(input.context.currentCategory, SIGNAL_WEIGHTS.like);

  const affinities: CategoryAffinity[] = [];
  for (const [category, score] of scoreByCategory) {
    const rounded = Math.round(score * 100) / 100;
    if (rounded > 0) affinities.push({ category, score: rounded });
  }

  return affinities
    .toSorted((left, right) => right.score - left.score)
    .slice(0, DIGEST_LIMITS.affinity);
}

export function engagedCategories(input: TrackingInput): Set<string> {
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const { signals } = input;
  const categories = new Set<string>();

  for (const signal of [
    ...signals.lastPurchased,
    ...signals.likes,
    ...signals.cart,
    ...signals.mostViewed,
  ]) {
    const category = categoryOf(signal, candidatesBySku);
    if (category) categories.add(category);
  }

  return categories;
}

interface MergedView extends ViewedProduct {
  category?: string;
  weight: number;
}

function mergeViewsBySku(views: ViewSignal[]): MergedView[] {
  const totalsBySku = new Map<string, MergedView>();

  for (const view of views) {
    const running = totalsBySku.get(view.sku);
    if (running) {
      running.views += view.views;
      if (view.dwellMs !== undefined) running.dwellMs = (running.dwellMs ?? 0) + view.dwellMs;
      if (view.category !== undefined) running.category ??= view.category;
      running.weight = Math.max(running.weight, effectiveWeight(view));
      continue;
    }
    totalsBySku.set(view.sku, {
      sku: view.sku,
      views: view.views,
      ...(view.dwellMs !== undefined ? { dwellMs: view.dwellMs } : {}),
      ...(view.category !== undefined ? { category: view.category } : {}),
      weight: effectiveWeight(view),
    });
  }

  return [...totalsBySku.values()];
}

function mostViewedProducts(views: ViewSignal[]): ViewedProduct[] {
  const top = mergeViewsBySku(views)
    .toSorted((left, right) => right.views - left.views)
    .slice(0, DIGEST_LIMITS.viewed);

  return top.map(({ sku, views: count, dwellMs }) =>
    dwellMs === undefined ? { sku, views: count } : { sku, views: count, dwellMs },
  );
}

function countByInteractionType(interactions: Interaction[]): InteractionCount[] {
  const countByType = new Map<string, number>();

  for (const interaction of interactions) {
    countByType.set(interaction.type, (countByType.get(interaction.type) ?? 0) + 1);
  }

  const counts = [...countByType.entries()].map(([type, count]) => ({ type, count }));

  return counts
    .toSorted((left, right) => right.count - left.count)
    .slice(0, DIGEST_LIMITS.interactionTypes);
}

export function buildDigest(input: TrackingInput): SignalDigest {
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const { signals, context, user } = input;

  const likedSkus = recentUniqueSkus(signals.likes, DIGEST_LIMITS.liked);
  const dislikedSkus = recentUniqueSkus(signals.dislikes, DIGEST_LIMITS.disliked);
  const purchasedSkus = recentUniqueSkus(signals.lastPurchased, DIGEST_LIMITS.purchased);
  const cartSkus = recentUniqueSkus(signals.cart, DIGEST_LIMITS.cart);
  const topViewed = mostViewedProducts(signals.mostViewed);

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

export function toCohortDigest(digest: SignalDigest): SignalDigest {
  const top = digest.categoryAffinity[0];

  const cohort: SignalDigest = {
    userId: 'cohort',
    isReturning: false,
    surface: digest.surface,
    slot: digest.slot,
    locale: digest.locale,
    maxItems: digest.maxItems,
    likedSkus: [],
    dislikedSkus: [],
    purchasedSkus: [],
    cartSkus: [],
    topViewed: [],
    recentSearches: [],
    categoryAffinity: top ? [{ category: top.category, score: 0 }] : [],
    interactionCounts: [],
    isColdStart: digest.isColdStart,
  };

  if (digest.segment !== undefined) cohort.segment = digest.segment;
  if (digest.currentCategory !== undefined) cohort.currentCategory = digest.currentCategory;

  return cohort;
}
