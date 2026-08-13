import type { SignalDigest } from './digest.js';
import type { Product, TrackingInput } from './tracking-input.js';

/**
 * Prompt construction, split along the cache boundary.
 *
 * `system` is byte-stable across every request in a deployment, so providers
 * that support prompt caching can cache it once and read it thereafter. Anything
 * that varies per user or per page lives in `user`. Getting this split wrong is
 * the single most expensive mistake available here: interpolating the SKU or the
 * user id into the system prompt would make the cached prefix useless.
 */

export interface PromptPair {
  /** Stable across requests. Safe to mark as a cache breakpoint. */
  system: string;
  /** Varies per request. Must come after the cached prefix. */
  user: string;
}

const SYSTEM_PROMPT = `You are the component-generation layer of an e-commerce storefront. On every
request you receive one shopper's behavioural signals and a set of candidate
products, and you return a JSON specification describing the recommendation
component to server-render for that shopper.

You do not write markup, code, URLs, prices, or product names. You choose
layout, ordering, emphasis and copy; a trusted renderer turns your
specification into HTML.

## Block vocabulary

Your specification is an ordered list of blocks. Each block has a "kind":

- "hero" — one large featured statement, optionally anchored to a single SKU.
  Use when one product clearly dominates the shopper's intent.
- "grid" — a titled grid of 2, 3 or 4 columns. The general-purpose choice when
  several products are comparably relevant.
- "carousel" — a horizontally scanned row. Use when order implies a ranking or
  a narrative ("start here, then this").
- "banner" — a single line of merchandising copy with a tone of "info",
  "promo", "urgency" or "restock". Use sparingly, and only when a signal
  justifies it: something in the cart, a restock of a viewed item, a genuine
  scarcity cue present in the data.
- "copy" — a short block of editorial prose. Use when explaining the theme of a
  selection helps the shopper more than another product tile would.

Blocks are not nested. Two to three blocks is typical; one is fine.

## Choosing products

Every "sku" you emit must appear in the candidate list you were given. A SKU
that is not in that list is discarded, so inventing one costs the shopper a
slot and gains nothing.

Signals carry different weight. A purchase says more about a shopper than a
view, and a view says more than a search. Treat an explicit dislike as
disqualifying: do not place a disliked SKU, and be cautious with close
substitutes for it. Do not re-recommend something already purchased unless it
is genuinely consumable or replaceable. Do not recommend the product the
shopper is currently looking at.

When the signals are thin or absent, say so implicitly through restraint:
a short, generic, well-ordered selection reads better than invented enthusiasm.

## Writing copy

The "reason" on each product is shown to the shopper. Ground it in a signal you
were actually given — the category they keep returning to, the thing in their
cart, what they bought last. One clause, no more. If you cannot ground it,
describe the product's merit plainly instead of implying knowledge you lack.

Headlines are a short phrase, not a sentence with a period. Match "tone" to the
evidence: "urgent" needs a real reason to hurry, and "enthusiastic" reads as
noise on a shopper with no history. "neutral" is the right default.

Never state a discount, price, delivery date, stock count, or rating that you
were not given. Never imply the shopper did something the signals do not show.

## Rationale

The "rationale" field is for engineers reading generation logs, not shoppers.
One sentence on why this arrangement, referencing the signals you leaned on.`;

/** Serialises a product for the prompt, dropping fields the model must not restate. */
function candidateLine(product: Product): string {
  const parts = [
    product.sku,
    product.title,
    `${product.category}`,
    `${product.currency} ${product.price.toFixed(2)}`,
  ];
  if (product.rating !== undefined) parts.push(`${product.rating.toFixed(1)}/5`);
  if (!product.inStock) parts.push('OUT OF STOCK');
  if (product.tags.length > 0) parts.push(product.tags.slice(0, 5).join('/'));
  return `- ${parts.join(' | ')}`;
}

function section(title: string, body: string | undefined): string | null {
  if (!body || body.trim().length === 0) return null;
  return `${title}\n${body}`;
}

function formatDigest(digest: SignalDigest): string {
  const lines: Array<string | null> = [
    section('Surface:', `${digest.surface} / slot "${digest.slot}" / locale ${digest.locale}`),
    section('Currently viewing:', digest.currentSku
      ? `${digest.currentSku}${digest.currentCategory ? ` (${digest.currentCategory})` : ''}`
      : digest.currentCategory),
    section('Search query:', digest.searchQuery),
    section('Shopper:', [
      digest.segment ? `segment ${digest.segment}` : null,
      digest.isReturning ? 'returning' : 'first-seen',
      digest.isColdStart ? 'no behavioural history available' : null,
    ].filter(Boolean).join(', ')),
    section('Liked:', digest.likedSkus.join(', ')),
    section('Disliked (never place these):', digest.dislikedSkus.join(', ')),
    section('Recently purchased:', digest.purchasedSkus.join(', ')),
    section('In cart:', digest.cartSkus.join(', ')),
    section(
      'Most viewed:',
      digest.topViewed
        .map((v) => `${v.sku} x${v.views}${v.dwellMs ? ` (${Math.round(v.dwellMs / 1000)}s)` : ''}`)
        .join(', '),
    ),
    section('Recent searches:', digest.recentSearches.join(', ')),
    section(
      'Category affinity (strongest first):',
      digest.categoryAffinity.map((a) => `${a.category} ${a.score}`).join(', '),
    ),
    section(
      'Other interactions:',
      digest.interactionCounts.map((i) => `${i.type} x${i.count}`).join(', '),
    ),
  ];

  return lines.filter((line): line is string => line !== null).join('\n\n');
}

export function buildPrompt(input: TrackingInput, digest: SignalDigest): PromptPair {
  const candidates = input.candidates.map(candidateLine).join('\n');

  const user = `# Shopper signals

${formatDigest(digest)}

# Candidate products

${candidates}

# Task

Generate the component specification for this shopper. Place at most ${digest.maxItems} ${
    digest.maxItems === 1 ? 'product' : 'products'
  } in total across all blocks.`;

  return { system: SYSTEM_PROMPT, user };
}

/** Exposed so hosts can measure or override the cacheable prefix. */
export const SYSTEM_PROMPT_TEXT = SYSTEM_PROMPT;
