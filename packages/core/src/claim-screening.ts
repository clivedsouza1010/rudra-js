import { offeredCandidates } from './model-prompt.js';
import type { Product, TrackingInput } from './tracking-input.js';

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
      // The words a model reaches for when "best" is banned. Each branch carries its own
      // \b — one in front of the group demands a word character before the #, never there.
      /(?:\bnumber one|\bno\.? ?1|#\s?1)[\s-]?sell(?:er|ers|ing)\b/,
      /\bloved by (?:thousands|hundreds|millions|\d)/,
    ],
  },
  {
    kind: 'price',
    patterns: [
      // No digit beside it: asking for one let "$thirty-nine and it is yours" through.
      /[$£€¥₹]/,
      /\b\d+(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|pounds?|euros?)\b/,
      // The same spelled out. "pounds" is left off on purpose — a pack weighs two of those.
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

/** Letters that render as a Latin letter but are not one — a Cyrillic о in "in stоck". */
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
 * Characters that render as nothing: format characters, default-ignorable code points and the
 * controls. Cf and Default_Ignorable each hold characters the other does not.
 * A second copy of the class in attested's `hidden.ts`, pinned to it by a test.
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

/** The controls that do take room. Deleting these would read `Only 2\n3 left` as 23. */
const SPACING = /[\t\n\v\f\r\u0085]/;

/**
 * Marks that hang on the character before them instead of taking a column of their own.
 * Dropped after composition, so an accented e keeps its accent while an overline,
 * which composes with nothing, cannot hide a word from its own rule.
 */
const MARKS = /[\p{Mn}\p{Me}]/gu;

/** Only the reading is normalised. What renders is what the model wrote. */
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
 * Wording attested bans that this project has already ruled is not a claim. An allowance
 * forgives a banned phrase sitting inside it, so an entry ending on a preposition — "extra
 * clearance for" — forgives whatever follows it. Exported so a test can hold the list
 * against attested's own.
 */
export const ALLOWED_PHRASES = ['does not feel cheap', "doesn't feel cheap", 'last few miles'];

/** Only a string with one of these in it can stand behind a numeral. */
const DIGIT = /\p{Nd}/u;

/** A fact whose whole content is a number in exponent notation. attested lays those out in place. */
const BARE_EXPONENT = /^[+-]?\d+(?:\.\d+)?[eE]([+-]?\d+)$/;

/** Wide enough for every finite JavaScript number, and for anything a shop sells. */
const MAX_EXPONENT = 1000;

// `1e2000000000` is twelve characters and lays out into a run long enough to end the process.
// attested caps that itself, but it is a peer dependency and a host's copy of it may be older.
function canLayOut(fact: string): boolean {
  const match = BARE_EXPONENT.exec(fact.trim());
  if (match === null) return true;
  return Math.abs(Number(match[1] ?? '')) <= MAX_EXPONENT;
}

/**
 * The numbers the shop published about one product: its category and tags, only the strings
 * carrying a digit. Exported so a test can pin what never reaches attested.
 */
export function productFacts(product: Product): string[] {
  const facts: string[] = [];
  if (DIGIT.test(product.category) && canLayOut(product.category)) facts.push(product.category);
  for (const tag of product.tags) {
    if (DIGIT.test(tag) && canLayOut(tag)) facts.push(tag);
  }
  return facts;
}

export interface HostFacts {
  pooled: string[];
  bySku: Map<string, string[]>;
}

/**
 * The shop's own numbers for this request, for attested to check numerals against.
 *
 * `offeredCandidates` rather than `input.candidates` — out of stock or past the prompt's cap
 * means a product the model never saw. A title and a rating it is shown but told never to
 * repeat, so a numeral out of one is one it was told not to write. The browsed category comes
 * from the request rather than the catalogue, so a host passing a URL segment through would
 * hand this list to whoever types the URL.
 *
 * `pooled` is the soft part of the check: one candidate's "40 litre" backs "take 40 off"
 * written about another. A `reason` and a `badge` read `bySku`, because they sit under a
 * named product — off the pooled list, a badge reading "Only 2" stood on a tent's tag.
 */
export function hostFacts(input: TrackingInput): HostFacts {
  const pooled = new Set<string>();
  const bySku = new Map<string, string[]>();

  for (const product of offeredCandidates(input)) {
    const own = productFacts(product);
    bySku.set(product.sku, own);
    for (const fact of own) pooled.add(fact);
  }

  return { pooled: [...pooled], bySku };
}

export function claimIn(text: string): string | null {
  const normalised = normaliseForClaims(text);
  for (const claim of CLAIM_PATTERNS) {
    for (const pattern of claim.patterns) {
      if (pattern.test(normalised)) return claim.kind;
    }
  }
  return null;
}
