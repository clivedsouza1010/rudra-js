import { offeredCandidates } from './model-prompt.js';
import type { Product, TrackingInput } from './tracking-input.js';

const CLAIM_PATTERNS: { kind: string; patterns: RegExp[] }[] = [
  {
    kind: 'rating',
    patterns: [
      /\breviews?\b|\breviewed\b/,
      /\b(?:\d+(?:\.\d+)?|three|four|five)[\s-]?stars?\b/,
      /\bstars?[\s-]?ratings?\b/,

      /\b(?:customer|shopper|buyer|user|average|overall)[\s-]ratings?\b/,

      /\bratings?\s+of\s+[0-5]\.\d\b/,

      /\b[0-5](?:\.\d)?\s+out of\s+(?:5|five)\b/,
      /\b(?:highly|top|best|well|poorly|five|four)[\s-]rated\b/,

      /\brated\s+(?:[0-5]\.\d|(?:[0-5]|three|four|five)\s+(?:stars?|out of))\b/,

      /\bbest[\s-]?sell(?:er|ers|ing)\b/,

      /(?:\bnumber one|\bno\.? ?1|#\s?1)[\s-]?sell(?:er|ers|ing)\b/,
      /\bloved by (?:thousands|hundreds|millions|\d)/,
    ],
  },
  {
    kind: 'price',
    patterns: [
      /[$£€¥₹]/,
      /\b\d+(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|pounds?|euros?)\b/,

      /\bdollars?\b|\beuros?\b/,

      /\b(?:usd|eur|gbp)\s?\d/,

      /\bkr\s?\d|\d\s?kr\b/,
      /\bpric(?:e|es|ed|ing)\b/,

      /\bwas\s+[$£€¥]?\s?\d[\d,.]*\s*[,;–—-]?\s*now\s+[$£€¥]?\s?\d/,

      /\bcheap(?:er|est)\b/,
      /\baffordable\b|\bbargain\b/,

      /\bcosts?\s+(?:less|more|only|just|about|around|[$£€¥]?\d)/,
      /\blow(?:er)?[\s-]cost\b/,

      /\bsaves?\s+(?:you\s+)?(?:money|cash|[$£€¥]\s?\d)/,
    ],
  },
  {
    kind: 'discount',
    patterns: [
      /\d+(?:\.\d+)?\s?(?:%|percent)\s*(?:off\b|discount|reduction|less\b)/,
      /\b(?:save|saving|savings|off|discount|extra|up to)\s+(?:up to\s+)?\d+(?:\.\d+)?\s?(?:%|percent)/,
      /\bdiscount(?:s|ed)?\b/,
      /\bsale\b|\bmarked down\b|\bdeal of\b/,
      /\bhalf[\s-]?(?:price|off)\b/,

      /\bsaves?\s+\d[\d.,]*\s+off\b/,

      /\bclearance\s+(?:sale|price|event|deal)\b|\bon clearance\b/,

      /\bprice reduced\b|\breduced price\b|\breduced by \d+\s?(?:%|percent)|\breduced\s+(?:this|next|last)\s+week\b/,
    ],
  },
  {
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

      /\b(?:only\s+)?(?:\d+|a few|a handful|a couple|one|few)\s+(?:left|remain(?:s|ing)?)\b/,
      /\bselling fast\b|\b(?:almost|nearly) gone\b|\bwhile stocks last\b/,
    ],
  },
];

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

const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

const SPACING = /[\t\n\v\f\r\u0085]/;

const MARKS = /[\p{Mn}\p{Me}]/gu;

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

export const ALLOWED_PHRASES = ['does not feel cheap', "doesn't feel cheap", 'last few miles'];

const DIGIT = /\p{Nd}/u;

const BARE_EXPONENT = /^[+-]?\d+(?:\.\d+)?[eE]([+-]?\d+)$/;

const MAX_EXPONENT = 1000;

function canLayOut(fact: string): boolean {
  const match = BARE_EXPONENT.exec(fact.trim());
  if (match === null) return true;
  return Math.abs(Number(match[1] ?? '')) <= MAX_EXPONENT;
}

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
