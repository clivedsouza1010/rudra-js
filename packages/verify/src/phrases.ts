/** Claims with no value behind them. Stored in the form `normalisePhrasing` produces. */
export const BANNED_PHRASES: readonly string[] = [
  'cheap',
  'cheaper',
  'cheapest',
  'affordable',
  'bargain',
  'great value',
  'best value',
  'low price',
  'lower price',
  'lowest price',
  'best price',
  'price drop',
  'reduced price',
  'sale',
  'marked down',
  'half price',
  'half off',
  'discount',
  'discounted',
  'clearance',
  'free delivery',
  'free shipping',
  'free returns',
  'fast delivery',
  'next day',
  'same day',
  'overnight delivery',
  'in stock',
  'out of stock',
  'low stock',
  'limited stock',
  'back in stock',
  'restocked',
  'sold out',
  'selling fast',
  'while stocks last',
  'almost gone',
  'nearly gone',
  'last chance',
  'hurry',
  'act fast',
  'do not miss',
  "don't miss",
  'best seller',
  'best selling',
  'bestseller',
  'bestselling',
  'top rated',
  'highly rated',
  'five star',
  'star rating',
  'customer favourite',
  'customer favorite',
  'money back guarantee',
];

/** One shape for text and phrases, so a line break or a hyphen cannot hide a claim. */
export function normalisePhrasing(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[-_\u2010-\u2015]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ASCII_WORD = /[a-z0-9]/;

function isGlued(char: string | undefined): boolean {
  return char !== undefined && ASCII_WORD.test(char);
}

/** Both arguments must already be normalised. */
// The word-gap rule only guards an ASCII edge, so `cheap` misses `cheapskate`
// while a Japanese phrase — which has no word gaps to find — still matches.
export function phraseIn(text: string, phrase: string): boolean {
  if (phrase.length === 0) return false;

  const guardStart = ASCII_WORD.test(phrase[0] ?? '');
  const guardEnd = ASCII_WORD.test(phrase[phrase.length - 1] ?? '');

  let from = 0;
  for (;;) {
    const at = text.indexOf(phrase, from);
    if (at === -1) return false;

    const before = guardStart && isGlued(text[at - 1]);
    const after = guardEnd && isGlued(text[at + phrase.length]);
    if (!before && !after) return true;

    from = at + 1;
  }
}
