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
  browsing: 4,
  cart: 3,
  view: 1,
  dislike: -6,
} as const;

interface MergedView extends ViewedProduct {
  category?: string;
  weight: number;
}

function weightOf(signal: SkuSignal): number {
  return signal.weight ?? 1;
}

function recentUniqueSkus(signals: SkuSignal[], limit: number): string[] {
  const newestFirst = signals.toSorted((left, right) => (right.at ?? 0) - (left.at ?? 0));
  const skus: string[] = [];
  const seen = new Set<string>();

  for (const signal of newestFirst) {
    if (seen.has(signal.sku)) continue;
    seen.add(signal.sku);
    skus.push(signal.sku);
    if (skus.length >= limit) break;
  }

  return skus;
}

function categoryOf(signal: SkuSignal, candidatesBySku: Map<string, Product>): string | undefined {
  return signal.category ?? candidatesBySku.get(signal.sku)?.category;
}

function scoreCategories(input: TrackingInput): CategoryAffinity[] {
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const scores = new Map<string, number>();

  const add = (category: string | undefined, score: number): void => {
    if (!category) return;
    scores.set(category, (scores.get(category) ?? 0) + score);
  };
  const addSignal = (signal: SkuSignal, base: number): void => {
    add(categoryOf(signal, candidatesBySku), base * weightOf(signal));
  };

  const { signals } = input;
  for (const purchase of signals.lastPurchased) addSignal(purchase, SIGNAL_WEIGHTS.purchase);
  for (const like of signals.likes) addSignal(like, SIGNAL_WEIGHTS.like);
  for (const inCart of signals.cart) addSignal(inCart, SIGNAL_WEIGHTS.cart);
  for (const view of mergeViewsBySku(signals.mostViewed)) {
    addSignal(view, SIGNAL_WEIGHTS.view * Math.log2(1 + view.views));
  }
  for (const dislike of signals.dislikes) addSignal(dislike, SIGNAL_WEIGHTS.dislike);
  add(input.context.currentCategory, SIGNAL_WEIGHTS.browsing);

  const affinities: CategoryAffinity[] = [];
  for (const [category, score] of scores) {
    const rounded = Math.round(score * 100) / 100;
    if (rounded > 0) affinities.push({ category, score: rounded });
  }

  return affinities
    .toSorted((left, right) => right.score - left.score)
    .slice(0, DIGEST_LIMITS.affinity);
}

export function categoriesTouchedBySignals(input: TrackingInput): Set<string> {
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

function mergeViewsBySku(views: ViewSignal[]): MergedView[] {
  const totals = new Map<string, MergedView>();

  for (const view of views) {
    const total = totals.get(view.sku);
    if (!total) {
      const first: MergedView = { sku: view.sku, views: view.views, weight: weightOf(view) };
      if (view.dwellMs !== undefined) first.dwellMs = view.dwellMs;
      if (view.category !== undefined) first.category = view.category;
      totals.set(view.sku, first);
      continue;
    }

    total.views += view.views;
    if (view.dwellMs !== undefined) total.dwellMs = (total.dwellMs ?? 0) + view.dwellMs;
    if (view.category !== undefined) total.category ??= view.category;
    total.weight = Math.max(total.weight, weightOf(view));
  }

  return [...totals.values()];
}

function mostViewedProducts(viewSignals: ViewSignal[]): ViewedProduct[] {
  const top = mergeViewsBySku(viewSignals)
    .toSorted((left, right) => right.views - left.views)
    .slice(0, DIGEST_LIMITS.viewed);

  return top.map(({ sku, views, dwellMs }) =>
    dwellMs === undefined ? { sku, views } : { sku, views, dwellMs },
  );
}

function countByInteractionType(interactions: Interaction[]): InteractionCount[] {
  const countByType = new Map<string, number>();
  for (const { type } of interactions) countByType.set(type, (countByType.get(type) ?? 0) + 1);

  const counts: InteractionCount[] = [];
  for (const [type, count] of countByType) counts.push({ type, count });

  return counts
    .toSorted((left, right) => right.count - left.count)
    .slice(0, DIGEST_LIMITS.interactionTypes);
}

export function buildDigest(input: TrackingInput): SignalDigest {
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
    categoryAffinity: scoreCategories(input),
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
