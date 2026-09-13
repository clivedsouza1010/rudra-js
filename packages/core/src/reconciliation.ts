import { verify } from '@rudra-js/attested';
import { offeredCandidates } from './model-prompt.js';
import type {
  Block,
  GeneratedSpec,
  ProductReference,
  RecommendationBasis,
} from './component-spec.js';
import type { SignalDigest } from './signal-digest.js';
import type { Bundle, Product, TrackingInput } from './tracking-input.js';

/**
 * Reconciliation — the boundary between what the model said and what renders.
 *
 * Schema validation guarantees shape. It cannot guarantee truth: a well-formed
 * spec can still name a product that does not exist, one the shopper told us
 * they dislike, one that sold out since the candidate set was assembled, or
 * claim the shopper viewed something they never saw. This pass is where those
 * become impossible.
 *
 * Nothing here trusts the model. A generation that survives every rule and
 * still has nothing to show degrades to `isUsable: false`, and the caller renders
 * the deterministic component instead.
 *
 * Repair, not rejection, is the default. A slightly clipped headline is a better
 * outcome for the shopper than a discarded generation, so text is truncated and
 * unverifiable claims are downgraded. Only an empty result fails outright.
 */

/**
 * Length ceilings, applied by truncation. These live here rather than in the
 * schema because a provider's strict structured-output mode rejects string
 * length bounds — see the note in `component-spec.ts`.
 */
const CLAMP = {
  headline: 90,
  subheadline: 140,
  blockTitle: 80,
  reason: 120,
  badge: 24,
  ctaLabel: 32,
  bannerText: 160,
  copyBody: 420,
  rationale: 300,
  // Not rendered anywhere — this is the SKU as it reads back in a violation.
  violationSku: 32,
} as const;

/**
 * More than this and the component stops being a component.
 *
 * Exported because the fill pass has to read the same blocks this module will:
 * one past the cap never renders, so nothing is worth reserving for it.
 */
export const MAX_BLOCKS = 4;

export interface ReconcileResult {
  spec: GeneratedSpec;
  /** True when something survived that is worth rendering. */
  isUsable: boolean;
  /** Machine-readable notes on what was removed or changed, for evaluation. */
  violations: string[];
}

function clamp(value: string, limit: number): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= limit) return collapsed;

  // The ellipsis counts against the limit, so leave room for it. Otherwise a
  // clamped string is one character longer than the cap it was clamped to.
  const cut = collapsed.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:!?-]+$/, '')}…`;
}

function clampNullable(value: string | null, limit: number): string | null {
  if (value === null) return null;
  const clamped = clamp(value, limit);
  return clamped.length === 0 ? null : clamped;
}

interface Allowlist {
  /** SKUs the model may place. */
  allowed: Set<string>;
  /** SKUs that must never be placed, whatever the model decided. */
  blocked: Set<string>;
}

/**
 * SKUs that must never be recommended, whatever chose them.
 *
 * Exported because the deterministic selector applies the same rule when it
 * picks. Two copies of "never recommend these" would drift, and the pair that
 * drifted would be the model path and the fallback path — the two whose
 * comparability the whole evaluation depends on.
 */
export function neverRecommend(digest: SignalDigest): Set<string> {
  const blocked = new Set<string>([
    ...digest.dislikedSkus,
    ...digest.purchasedSkus,
    ...digest.cartSkus,
  ]);
  if (digest.currentSku) blocked.add(digest.currentSku);
  return blocked;
}

function buildAllowlist(input: TrackingInput, digest: SignalDigest): Allowlist {
  const allowed = new Set<string>();
  for (const product of input.candidates) {
    // An out-of-stock candidate is not a recommendation, it is a dead end.
    if (product.isInStock) allowed.add(product.sku);
  }

  // Blocked structurally rather than by asking the model nicely. The prompt
  // says not to place these; this is what makes it true when it ignores us.
  return { allowed, blocked: neverRecommend(digest) };
}

/**
 * Checks the model's stated reason for a pick against the shopper's actual
 * signals.
 *
 * `basis` is a factual claim — "you viewed this", "this goes with your cart" —
 * and the model has every incentive to reach for the most flattering one. A
 * claim we cannot support becomes `popular`, which asserts nothing, and the
 * prose that stated it is dropped along with it.
 */
function verifyBasis(basis: RecommendationBasis, product: Product, digest: SignalDigest): boolean {
  switch (basis) {
    case 'most_viewed':
      return digest.topViewed.some((viewed) => viewed.sku === product.sku);
    case 'complements_cart':
      return digest.cartSkus.length > 0;
    case 'complements_purchase':
      return digest.purchasedSkus.length > 0;
    case 'liked_category':
      return digest.categoryAffinity.some((affinity) => affinity.category === product.category);
    case 'similar_to_current':
      return digest.currentCategory === product.category;
    case 'popular':
      // Makes no claim about this shopper, so there is nothing to check.
      return true;
  }
}

/**
 * Free text that states something the renderer cannot check.
 *
 * The prompt bans prices, discounts, delivery dates, stock levels and ratings
 * because every one of them moves after the words are written, and a cohort
 * component is cached and served again later. `verifyBasis` checks the basis a
 * pick claims; nothing checks the sentences around it, so every string the
 * model writes is checked here — a heading is not a safer place for a claim
 * than the small print under it.
 *
 * These patterns are the first of three passes and the only one that names
 * which of the five kinds a sentence claimed, so they read the domain: "20%
 * off", not "20%"; "rated 4.8", not "rated". Past them the text still has to
 * stand up to @rudra-js/attested, which reads no domain at all and asks a
 * blunter question — is every numeral in this sentence one the shop handed us.
 * "a comfort rating of -5C" walks past every rule below and is then dropped as
 * `quantity`, because the 5 in it is a number the model made up.
 *
 * One rule per line, because each line is a separate judgement about where the
 * boundary sits and each one wants its own reason written next to it.
 */
const CLAIM_PATTERNS: { kind: string; patterns: RegExp[] }[] = [
  {
    // Customers scoring the product. "rated for winter use", "rated to -10C"
    // and "an IPX7 water rating" are about what the product can take.
    kind: 'rating',
    patterns: [
      /\breviews?\b|\breviewed\b/,
      /\b(?:\d+(?:\.\d+)?|three|four|five)[\s-]?stars?\b/,
      /\bstars?[\s-]?ratings?\b/,
      // A rating somebody gave it, rather than one it was built to.
      /\b(?:customer|shopper|buyer|user|average|overall)[\s-]ratings?\b/,
      // A score out of five is written as a decimal. A spec is "-5C" or "20,000mm".
      /\bratings?\s+of\s+[0-5]\.\d\b/,
      // The same score with the word "rating" nowhere near it: "4.8 out of 5".
      /\b[0-5](?:\.\d)?\s+out of\s+(?:5|five)\b/,
      /\b(?:highly|top|best|well|poorly|five|four)[\s-]rated\b/,
      // "rated 4.8" is a score. "rated 3 season" is what the tent is built for.
      /\brated\s+(?:[0-5]\.\d|(?:[0-5]|three|four|five)\s+(?:stars?|out of))\b/,
      // How many other people bought or liked it is a customer claim too.
      /\bbest[\s-]?sell(?:er|ers|ing)\b/,
      // The same claim in the words a model reaches for when "best" is banned.
      // Nothing honest needs "number one" in front of "seller".
      /\b(?:number one|no\.? ?1|#\s?1)[\s-]?sell(?:er|ers|ing)\b/,
      /\bloved by (?:thousands|hundreds|millions|\d)/,
    ],
  },
  {
    kind: 'price',
    patterns: [
      // No digit needed beside it. A currency sign has no other use in product
      // copy, and asking for one let "$thirty-nine and it is yours" through.
      /[$£€¥₹]/,
      /\b\d+(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|pounds?|euros?)\b/,
      // The same, spelled out. "pounds" is missing on purpose: a pack weighs two
      // of those, and the rule above already reads "two pounds" as money anyway.
      /\bdollars?\b|\beuros?\b/,
      // The same codes on the other side of the number: "USD 20", "EUR 5.99".
      /\b(?:usd|eur|gbp)\s?\d/,
      // The krona is spelled out rather than drawn, so it needs a number beside it.
      /\bkr\s?\d|\d\s?kr\b/,
      /\bpric(?:e|es|ed|ing)\b/,
      // A before-and-after is a price claim even with no currency on it.
      /\bwas\s+[$£€¥]?\s?\d[\d,.]*\s*[,;–—-]?\s*now\s+[$£€¥]?\s?\d/,
      // "does not feel cheap" is about quality. Only the comparison is money.
      /\bcheap(?:er|est)\b/,
      /\baffordable\b|\bbargain\b/,
      // "at no cost to comfort" is not money. "costs less" is.
      /\bcosts?\s+(?:less|more|only|just|about|around|[$£€¥]?\d)/,
      /\blow(?:er)?[\s-]cost\b/,
      // "saves weight" and "saves on weight" are both about grams.
      /\bsaves?\s+(?:you\s+)?(?:money|cash|[$£€¥]\s?\d)/,
    ],
  },
  {
    // A percentage in outdoor copy is a specification far more often than it is
    // money off, so it only counts beside a money word: "20% off", not
    // "100% recycled".
    kind: 'discount',
    patterns: [
      /\d+(?:\.\d+)?\s?(?:%|percent)\s*(?:off\b|discount|reduction|less\b)/,
      /\b(?:save|saving|savings|off|discount|extra|up to)\s+(?:up to\s+)?\d+(?:\.\d+)?\s?(?:%|percent)/,
      /\bdiscount(?:s|ed)?\b/,
      /\bsale\b|\bmarked down\b|\bdeal of\b/,
      /\bhalf[\s-]?(?:price|off)\b/,
      // Money off with no percent sign anywhere on it: "save 20 off".
      /\bsaves?\s+\d[\d.,]*\s+off\b/,
      // "extra clearance for thick socks" is room inside the shoe.
      /\bclearance\s+(?:sale|price|event|deal)\b|\bon clearance\b/,
      // "reduced weight" and "reduced to 900g" are specifications. Only a
      // reduced price, or a reduction with a date on it, is money off.
      /\bprice reduced\b|\breduced price\b|\breduced by \d+\s?(?:%|percent)|\breduced\s+(?:this|next|last)\s+week\b/,
    ],
  },
  {
    // When it turns up, not what turns up. "ships in a recycled box" and
    // "arrives flat-packed" describe the thing, so the verb alone is not enough
    // — it needs a day or a date beside it.
    kind: 'delivery',
    patterns: [
      /\bdelivery\b|\bshipping\b/,
      /\bnext[\s-]day\b|\bsame[\s-]day\b|\bovernight\b/,
      /\b(?:ships?|arrives?|arriving|delivered|by|before|in time for)\s+(?:on\s+)?(?:today|tomorrow|tonight|this week|next week|the weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      /\b(?:ships?|arrives?|arriving)\s+(?:in|within)\s+\d/,
      /\bin time for\b/,
    ],
  },
  {
    kind: 'stock',
    patterns: [
      /\b(?:in|out of|low on) stock\b/,
      /\blimited stock\b/,
      /\brestocked?\b|\bsold out\b/,
      // "the last few miles" is a distance, so a count needs "left" after it.
      /\b(?:only\s+)?(?:\d+|a few|a handful|a couple|one|few)\s+(?:left|remain(?:s|ing)?)\b/,
      /\bselling fast\b|\b(?:almost|nearly) gone\b|\bwhile stocks last\b/,
    ],
  },
];

/**
 * Letters that render as a Latin letter but are not one. A Cyrillic о in
 * "in stоck" would otherwise carry a stock claim straight past the rule written
 * for it, and the shopper would read the claim anyway.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  х: 'x',
  у: 'y',
  ѕ: 's',
  і: 'i',
  ј: 'j',
  ԁ: 'd',
  һ: 'h',
  ӏ: 'l',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ϲ: 'c',
};

/**
 * Characters that render as nothing: format characters, default-ignorable code
 * points and the controls. Cf and Default_Ignorable each hold characters the
 * other does not.
 *
 * The same class @rudra-js/attested strips in its own `hidden.ts`. The second copy
 * stays now that core calls attested, because it feeds core's own patterns and those
 * reach two things attested's phrase list does not hold at all: "20% οff" spelled
 * with a Greek omicron, and "PRİCED to move". Widening one and not the other is
 * still the mistake to watch for.
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

/**
 * The controls that do take room. Deleting these would read `Only 2\n3 left` as 23.
 *
 * No test pins this line, and none can: clamping collapses every run of whitespace
 * before a claim is screened, so nothing here ever sees one. It is kept so the class
 * reads the same in both copies.
 */
const SPACING = /[\t\n\v\f\r\u0085]/;

/**
 * Marks that hang on the character before them instead of taking a column of their
 * own. Dropped after composition, so an accented e keeps its accent while an
 * overline, which composes with nothing, cannot hide a word from its own rule.
 */
const MARKS = /[\p{Mn}\p{Me}]/gu;

/**
 * One shape for the text before the patterns read it, so a word that renders as
 * "in stock" is read as "in stock" however it was spelled.
 *
 * Only the reading is normalised. What renders is what the model wrote.
 */
function normaliseForClaims(text: string): string {
  const lowered = text
    .replace(INVISIBLE, (char) => (SPACING.test(char) ? char : ''))
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFC')
    .replace(MARKS, '');

  let folded = '';
  for (const char of lowered) folded += CONFUSABLES[char] ?? char;
  return folded;
}

/**
 * Wording attested's denylist catches that this project has already ruled is not a
 * claim, each one written next to the pattern that makes the call: "does not feel
 * cheap" is about quality, "the last few miles" is a distance.
 *
 * An allowance forgives a banned phrase sitting inside it, so an entry has to end
 * on a word that finishes the thought. "extra clearance for" was on this list and
 * is not any more: ending on a preposition forgave "clearance" for whatever came
 * after it, so "extra clearance for the weekend only" read as a sale and rendered.
 * Losing "extra clearance for thick socks" is the price of that, and a sentence
 * about room inside a shoe is a cheaper thing to lose than a sale nobody is having.
 *
 * Every spelling is its own entry for the same reason: a span has to cover the
 * banned word, so "doesn't feel cheap" is not covered by "does not feel cheap".
 *
 * Exported so a test can hold it against attested's own list. Nothing else keeps
 * the two in step: rename a phrase over there and an entry here becomes dead
 * weight without a word from anyone.
 */
export const ALLOWED_PHRASES = ['does not feel cheap', "doesn't feel cheap", 'last few miles'];

/** Only a string with one of these in it can stand behind a numeral. */
const DIGIT = /\p{Nd}/u;

/**
 * Anything attested reads as a numeral: the decimal digits, and the numeric
 * characters it cannot read at all — ½, ², Ⅲ — which it reports rather than
 * ignores, because no fact can back one.
 */
const NUMERAL = /[\p{Nd}\p{No}\p{Nl}]/u;

const NO_FACTS: readonly string[] = [];

/**
 * The shop's own numbers for this request, for attested to check numerals against.
 *
 * Categories and tags, off the candidates the model was actually shown, and nothing
 * else. The prompt also shows it a title and a rating, and bans it from repeating
 * either, so a numeral out of one of those is one it was told not to write. A
 * rating is the sharp case: 4.8 reads as a price, a stock count and a delivery time
 * as easily as it reads as a score, so handing one over blesses all four.
 *
 * `offeredCandidates` rather than `input.candidates`, because a product that is out
 * of stock or past the prompt's cap never reached the model. Standing behind its
 * numbers would let a tag on a product nobody can buy back a sentence about one
 * they can.
 *
 * The browsed category is not here either. It is whatever the host put in the
 * request rather than a row of its catalogue, so a host that passes a URL segment
 * through would be handing this list to whoever types the URL. A browsed category
 * the model can honestly repeat is a category some candidate is in, and that one
 * is already here.
 *
 * De-duplicated, and only the strings carrying a digit, because the rest can back
 * no numeral and this list is read again for every field.
 *
 * Pooled, and that is the soft part of the check. A numeral is a numeral here, so
 * one candidate's "40 litre" backs "take 40 off" written about another. The two
 * fields that name a product read `productFacts` instead; a headline is about the
 * page rather than one product, so there is no narrower list to give it.
 */
function hostFacts(input: TrackingInput): string[] {
  const facts = new Set<string>();
  for (const product of offeredCandidates(input)) {
    for (const fact of productFacts(product)) facts.add(fact);
  }
  return [...facts];
}

/**
 * The numbers the shop published about one product.
 *
 * A `reason` and a `badge` sit under a named product and are read as being about
 * it, so this is what they stand on. Off the pooled list, a badge reading "Only 2"
 * was backed by a "2 person" tag on a tent three cards away.
 */
function productFacts(product: Product): string[] {
  const facts: string[] = [];
  if (DIGIT.test(product.category)) facts.push(product.category);
  for (const tag of product.tags) {
    if (DIGIT.test(tag)) facts.push(tag);
  }
  return facts;
}

/** Names the first forbidden claim the text makes, or null when it makes none. */
function claimIn(text: string): string | null {
  const normalised = normaliseForClaims(text);
  for (const claim of CLAIM_PATTERNS) {
    for (const pattern of claim.patterns) {
      if (pattern.test(normalised)) return claim.kind;
    }
  }
  return null;
}

/**
 * The running state of one reconciliation pass: what has been placed, how much
 * of the item budget is left, and what was changed along the way.
 *
 * This is deliberately one named thing rather than three parameters threaded
 * through every function. The budget and the de-duplication set are global to a
 * spec, not to a block, which is the part that is easy to get wrong.
 */
function createPlacementTracker(maxItems: number, facts: readonly string[]) {
  const placedSkus = new Set<string>();
  const violations: string[] = [];
  let remaining = maxItems;

  return {
    violations,
    facts,
    get remaining() {
      return remaining;
    },
    hasPlaced: (sku: string) => placedSkus.has(sku),
    record(violation: string) {
      violations.push(violation);
    },
    place(sku: string) {
      placedSkus.add(sku);
      remaining -= 1;
    },
  };
}

type PlacementTracker = ReturnType<typeof createPlacementTracker>;

/**
 * Drops text that makes a claim we cannot check, and names what it claimed.
 *
 * Runs after clamping, so what is screened is exactly what would have rendered.
 * Dropping means what it means everywhere else here: this field becomes null
 * and the rest of the block carries on.
 *
 * Three passes, most specific first. Core's patterns name one of the five kinds.
 * `quantity` is the only proof in the stack: every numeral in the sentence has to
 * be one the shop supplied. `wording` is a second denylist, and the weakest, so it
 * answers last.
 *
 * `facts` defaults to every candidate's numbers. A field that names one product
 * passes that product's own.
 */
function screenClaim(
  value: string | null,
  field: string,
  tracker: PlacementTracker,
  facts: readonly string[] = tracker.facts,
): string | null {
  if (value === null) return null;

  const kind = claimIn(value);
  if (kind !== null) {
    tracker.record(`unverifiable-claim:${kind}:${field}`);
    return null;
  }

  // A sentence with no numeral in it has nothing for the quantity layer to weigh,
  // whatever the facts say, and reading the fact list to prove that again for
  // every field is most of what this screen costs on a shop with a spec sheet in
  // its tags. A test holds attested to that, since it is attested's promise.
  const weighed = NUMERAL.test(value) ? facts : NO_FACTS;

  const result = verify(value, { values: weighed, allowedPhrases: ALLOWED_PHRASES });
  if (!result.quantity.supported) {
    tracker.record(`unverifiable-claim:quantity:${field}`);
    return null;
  }
  if (!result.wording.supported) {
    tracker.record(`unverifiable-claim:wording:${field}`);
    return null;
  }

  return value;
}

/**
 * The same screen for a field that cannot be null. Emptying it hands the field
 * to the rule that already drops a block, or a whole generation, whose text
 * clamps to nothing — so a banner reading "20% off" disappears rather than
 * rendering blank.
 */
function screenRequired(value: string, field: string, tracker: PlacementTracker): string {
  return screenClaim(value, field, tracker) ?? '';
}

/**
 * Decides whether one SKU may be placed, and names the reason when it may not.
 * Does not consume budget — the caller does that once it commits.
 *
 * Order matters. The budget is checked last because it is the least specific
 * cause: a hallucinated SKU that arrives after the budget is spent is still a
 * hallucination, and reporting it as `budget:dropped` would understate how
 * often the model invents products. These strings are the evaluation signal,
 * so each one has to name the fault that actually fired.
 */
function rejectionFor(sku: string, allowlist: Allowlist, tracker: PlacementTracker): string | null {
  // A rejected SKU is whatever the model wrote, and the schema cannot bound it.
  const named = clamp(sku, CLAMP.violationSku);

  // Either hallucinated or out of stock. Either way it cannot render.
  if (!allowlist.allowed.has(sku)) return `unknown-sku:${named}`;
  if (allowlist.blocked.has(sku)) return `blocked-sku:${named}`;
  if (tracker.hasPlaced(sku)) return `duplicate-sku:${named}`;
  if (tracker.remaining <= 0) return `budget:dropped:${named}`;
  return null;
}

function reconcileItems(
  items: ProductReference[],
  allowlist: Allowlist,
  candidatesBySku: Map<string, Product>,
  digest: SignalDigest,
  tracker: PlacementTracker,
  ourReasons: ReadonlyMap<string, string>,
): ProductReference[] {
  const kept: ProductReference[] = [];

  for (const item of items) {
    const rejection = rejectionFor(item.sku, allowlist, tracker);
    if (rejection) {
      tracker.record(rejection);
      continue;
    }

    const product = candidatesBySku.get(item.sku);
    // rejectionFor already proved the SKU is an in-stock candidate.
    if (!product) continue;

    tracker.place(item.sku);

    const hasSupportedBasis = verifyBasis(item.basis, product, digest);
    if (!hasSupportedBasis) tracker.record(`unsupported-basis:${item.basis}:${item.sku}`);

    // Not the model's words, so there is nothing here to screen. The sentence has
    // to match, so a model reason that happens to read the same is still screened.
    const isOurs = item.reason !== null && ourReasons.get(item.sku) === item.reason;

    // Both fields below are read as being about this product, so they stand on
    // what the shop published about this product.
    const own = productFacts(product);

    kept.push({
      sku: item.sku,
      basis: hasSupportedBasis ? item.basis : 'popular',
      // The prose exists to state the basis. If the basis did not hold, the
      // prose is a claim we just decided is untrue.
      reason: hasSupportedBasis
        ? isOurs
          ? clampNullable(item.reason, CLAMP.reason)
          : screenClaim(
              clampNullable(item.reason, CLAMP.reason),
              `reason:${item.sku}`,
              tracker,
              own,
            )
        : null,
      // A badge is the shortest, loudest text on the card, and the schema's own
      // example for it was "Back in stock" — a stock claim. It renders, so it is
      // read for claims like every other sentence the model writes.
      badge: screenClaim(clampNullable(item.badge, CLAMP.badge), `badge:${item.sku}`, tracker, own),
      emphasis: item.emphasis,
    });
  }

  return kept;
}

// Three separate counts, not one score — cart beats views beats category
// regardless of how the counts compare, so they can't be summed.
interface BundleFit {
  cartHits: number;
  viewedHits: number;
  categoryHits: number;
}

function fitOf(
  bundle: Bundle,
  digest: SignalDigest,
  candidatesBySku: Map<string, Product>,
): BundleFit {
  const fit: BundleFit = { cartHits: 0, viewedHits: 0, categoryHits: 0 };

  for (const sku of bundle.skus) {
    if (digest.cartSkus.includes(sku)) fit.cartHits += 1;
    else if (digest.topViewed.some((viewed) => viewed.sku === sku)) fit.viewedHits += 1;
    else if (candidatesBySku.get(sku)?.category === digest.currentCategory) fit.categoryHits += 1;
  }

  return fit;
}

/** In the cart beats recently viewed, which beats the category being looked at. */
function isBetterFit(fit: BundleFit, best: BundleFit | undefined): boolean {
  if (!best) return true;
  if (fit.cartHits !== best.cartHits) return fit.cartHits > best.cartHits;
  if (fit.viewedHits !== best.viewedHits) return fit.viewedHits > best.viewedHits;
  return fit.categoryHits > best.categoryHits;
}

function chooseBundle(
  bundles: readonly Bundle[],
  allowlist: Allowlist,
  digest: SignalDigest,
  candidatesBySku: Map<string, Product>,
  tracker: PlacementTracker,
): Bundle | undefined {
  let best: Bundle | undefined;
  let bestFit: BundleFit | undefined;

  for (const bundle of bundles) {
    // A bundle needs room for every product at once.
    if (bundle.skus.length > tracker.remaining) continue;

    let isPlaceable = true;
    for (const sku of bundle.skus) {
      if (!allowlist.allowed.has(sku)) isPlaceable = false;
      if (digest.dislikedSkus.includes(sku)) isPlaceable = false;
      // Already shown by an earlier block — twice on a page looks broken.
      if (tracker.hasPlaced(sku)) isPlaceable = false;
    }
    if (!isPlaceable) continue;

    const fit = fitOf(bundle, digest, candidatesBySku);
    if (isBetterFit(fit, bestFit)) {
      best = bundle;
      bestFit = fit;
    }
  }

  return best;
}

/**
 * The set this shopper should get, decided before anything is placed.
 *
 * The generator needs the answer early, so it can keep the set's products out
 * of the grid and keep room for them. `chooseBundle` stays private: this hands
 * out the choice, not the machinery behind it.
 *
 * `spokenFor` is what the blocks above the bundle block will have placed by the
 * time it is reached. Placing it here first is what makes the two choices agree:
 * a set is only pre-chosen if reconciliation could still reach for it.
 */
export function bundleForShopper(
  input: TrackingInput,
  digest: SignalDigest,
  spokenFor: readonly string[],
): Bundle | undefined {
  const allowlist = buildAllowlist(input, digest);
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const tracker = createPlacementTracker(digest.maxItems, hostFacts(input));

  for (const sku of spokenFor) tracker.place(sku);

  return chooseBundle(input.bundles, allowlist, digest, candidatesBySku, tracker);
}

/**
 * The hero products these blocks will really place.
 *
 * A hero keeps the product the model named — its headline was written about
 * that product — so it spends a slot of the item budget the grid cannot have.
 * One this shopper cannot see is dropped below and spends nothing, so it is not
 * counted here either.
 */
export function placeableHeroSkus(
  blocks: readonly Block[],
  input: TrackingInput,
  digest: SignalDigest,
): string[] {
  const allowlist = buildAllowlist(input, digest);

  const skus: string[] = [];
  for (const block of blocks) {
    if (block.kind !== 'hero') continue;
    if (block.sku === null) continue;
    if (!allowlist.allowed.has(block.sku) || allowlist.blocked.has(block.sku)) continue;
    // Two heroes naming the same product: only the first one gets to place it.
    if (skus.includes(block.sku)) continue;
    skus.push(block.sku);
  }

  return skus;
}

function reconcileBlock(
  block: Block,
  allowlist: Allowlist,
  candidatesBySku: Map<string, Product>,
  digest: SignalDigest,
  bundles: readonly Bundle[],
  tracker: PlacementTracker,
  ourReasons: ReadonlyMap<string, string>,
): Block | null {
  switch (block.kind) {
    case 'hero': {
      let sku = block.sku;
      if (sku !== null) {
        const rejection = rejectionFor(sku, allowlist, tracker);
        if (rejection) {
          tracker.record(rejection);
          // A hero without its product is still a legitimate headline.
          sku = null;
        } else {
          tracker.place(sku);
        }
      }
      // Every other block kind disappears when its content clamps to nothing.
      // A hero with no headline and no product is the same empty region, and
      // it would otherwise render above real content.
      const headline = screenRequired(
        clamp(block.headline, CLAMP.headline),
        'hero-headline',
        tracker,
      );
      if (headline.length === 0 && sku === null) {
        tracker.record('empty-block:hero');
        return null;
      }
      return {
        kind: 'hero',
        headline,
        body: screenClaim(clampNullable(block.body, CLAMP.subheadline), 'hero-body', tracker),
        sku,
        ctaLabel: screenClaim(clampNullable(block.ctaLabel, CLAMP.ctaLabel), 'hero-cta', tracker),
      };
    }

    case 'grid': {
      const items = reconcileItems(
        block.items,
        allowlist,
        candidatesBySku,
        digest,
        tracker,
        ourReasons,
      );
      if (items.length === 0) {
        tracker.record('empty-block:grid');
        return null;
      }
      return {
        kind: 'grid',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'grid-title', tracker),
        // Never leave a grid wider than it has items to fill.
        columns: Math.min(block.columns, Math.max(2, items.length)) as 2 | 3 | 4,
        items,
      };
    }

    case 'carousel': {
      const items = reconcileItems(
        block.items,
        allowlist,
        candidatesBySku,
        digest,
        tracker,
        ourReasons,
      );
      if (items.length === 0) {
        tracker.record('empty-block:carousel');
        return null;
      }
      return {
        kind: 'carousel',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'carousel-title', tracker),
        items,
      };
    }

    case 'banner': {
      const text = screenRequired(clamp(block.text, CLAMP.bannerText), 'banner-text', tracker);
      if (text.length === 0) {
        tracker.record('empty-block:banner');
        return null;
      }
      return {
        kind: 'banner',
        tone: block.tone,
        text,
        ctaLabel: screenClaim(clampNullable(block.ctaLabel, CLAMP.ctaLabel), 'banner-cta', tracker),
      };
    }

    case 'copy': {
      const body = screenRequired(clamp(block.body, CLAMP.copyBody), 'copy-body', tracker);
      if (body.length === 0) {
        tracker.record('empty-block:copy');
        return null;
      }
      return {
        kind: 'copy',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'copy-title', tracker),
        body,
      };
    }

    case 'bundle': {
      const chosen = chooseBundle(bundles, allowlist, digest, candidatesBySku, tracker);
      if (!chosen) {
        tracker.record('no-bundle');
        return null;
      }

      for (const sku of chosen.skus) tracker.place(sku);

      return {
        kind: 'bundle',
        title: screenClaim(clampNullable(block.title, CLAMP.blockTitle), 'bundle-title', tracker),
        body: screenClaim(clampNullable(block.body, CLAMP.subheadline), 'bundle-body', tracker),
        ctaLabel: screenClaim(clampNullable(block.ctaLabel, CLAMP.ctaLabel), 'bundle-cta', tracker),
        // The model's bundleId is ignored on purpose.
        bundleId: chosen.id,
      };
    }
  }
}

/** True when a spec contains at least one block that actually shows a product. */
function showsAnyProduct(blocks: Block[]): boolean {
  return blocks.some(
    (block) =>
      (block.kind === 'grid' && block.items.length > 0) ||
      (block.kind === 'carousel' && block.items.length > 0) ||
      (block.kind === 'hero' && block.sku !== null) ||
      // A bundle shows products too, so it counts the same as grid/carousel/hero.
      (block.kind === 'bundle' && block.bundleId !== null),
  );
}

export function reconcileSpec(
  generated: GeneratedSpec,
  input: TrackingInput,
  digest: SignalDigest,
  /**
   * The reason this request wrote itself, by SKU: the host's own `reason` field
   * on a candidate, or the sentence the selector wrote when there was none.
   * Neither is the model's words, so neither is screened — screening the
   * selector's "More in Clearance" is this file marking its own homework, and
   * the deterministic component renders that sentence unscreened anyway.
   *
   * Only `fitToShopper` fills it, so in `per-shopper` mode it is empty and every
   * reason is the model's, including one that happens to read the same.
   */
  ourReasons: ReadonlyMap<string, string> = new Map(),
): ReconcileResult {
  const allowlist = buildAllowlist(input, digest);
  const candidatesBySku = new Map(input.candidates.map((product) => [product.sku, product]));
  const tracker = createPlacementTracker(digest.maxItems, hostFacts(input));

  if (generated.blocks.length > MAX_BLOCKS) {
    tracker.record(`too-many-blocks:${generated.blocks.length}`);
  }

  const blocks: Block[] = [];
  for (const block of generated.blocks.slice(0, MAX_BLOCKS)) {
    const reconciled = reconcileBlock(
      block,
      allowlist,
      candidatesBySku,
      digest,
      input.bundles,
      tracker,
      ourReasons,
    );
    if (reconciled !== null) blocks.push(reconciled);
  }

  const spec: GeneratedSpec = {
    tone: generated.tone,
    headline: screenRequired(clamp(generated.headline, CLAMP.headline), 'headline', tracker),
    subheadline: screenClaim(
      clampNullable(generated.subheadline, CLAMP.subheadline),
      'subheadline',
      tracker,
    ),
    blocks,
    rationale: screenRequired(clamp(generated.rationale, CLAMP.rationale), 'rationale', tracker),
  };

  // A component that recommends nothing is worse than no component at all.
  // Recorded separately: "no products survived" and "the model returned no
  // headline" are different failures and want different fixes.
  if (!showsAnyProduct(blocks)) tracker.record('unusable:no-products');
  if (spec.headline.length === 0) tracker.record('unusable:no-headline');
  const isUsable = showsAnyProduct(blocks) && spec.headline.length > 0;

  return { spec, isUsable, violations: tracker.violations };
}
