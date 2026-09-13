import { stripInvisible, stripMarks } from './hidden.js';

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
  'price dropped',
  'just dropped',
  'price cut',
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
  'free postage',
  'free returns',
  'ships free',
  'fast delivery',
  'next day',
  'same day',
  'overnight delivery',
  'arrives tomorrow',
  'delivered tomorrow',
  'by tomorrow',
  'in stock',
  'out of stock',
  'low stock',
  'limited stock',
  'running low',
  'running out',
  'back in stock',
  'restocked',
  'sold out',
  'selling out',
  'almost sold out',
  'nearly sold out',
  'selling fast',
  'going fast',
  'going quick',
  'flying off',
  'while stocks last',
  'almost gone',
  'nearly gone',
  'few left',
  'last few',
  'last chance',
  'limited time',
  'today only',
  'ends soon',
  'hurry',
  'act fast',
  'do not miss',
  "don't miss",
  'best seller',
  'best selling',
  'bestseller',
  'bestselling',
  'most popular',
  'popular pick',
  'top pick',
  'top rated',
  'highly rated',
  'highest rated',
  'rated highest',
  'best rated',
  'five star',
  'star rating',
  'customer favourite',
  'customer favorite',
  'money back',
];

/**
 * Letters that render as a Latin letter but are not one. Folded so a Cyrillic о in
 * "in stоck" cannot walk a claim past its own entry on the list. Both the text and
 * the phrase are folded, so a genuine Cyrillic phrase still matches itself.
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

/** A run of whitespace holding one of these is a break the shopper sees. */
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

/** One shape for text and phrases, so a hyphen or a stray mark cannot hide a claim. */
export function normalisePhrasing(text: string): string {
  // Marks come off after composition, so an accented e keeps its accent while an
  // overline, which composes with nothing, does not hide `free` from its own entry.
  const lowered = stripMarks(stripInvisible(text).normalize('NFKC').toLowerCase().normalize('NFC'));

  let folded = '';
  for (const char of lowered) folded += CONFUSABLES[char] ?? char;

  // A line break survives as itself. Matching reads straight through it, and only
  // the allowance in verify.ts cares, because it will not forgive across a break.
  return folded
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[-_\u2010-\u2015]+/g, ' ')
    .replace(/\s+/g, (run) => (LINE_BREAK.test(run) ? '\n' : ' '))
    .trim();
}

const ASCII_WORD = /[a-z0-9]/;

function isGlued(char: string | undefined): boolean {
  return char !== undefined && ASCII_WORD.test(char);
}

export interface Span {
  start: number;
  /** The last character of the match, not one past it. */
  end: number;
}

/** Both arguments must already be normalised. Spans index the text passed in. */
// The word-gap rule only guards an ASCII edge, so `cheap` misses `cheapskate`
// while a Japanese phrase — which has no word gaps to find — still matches.
export function phraseSpans(text: string, phrase: string): Span[] {
  // Matching runs with every space dropped, because 送料 無料 is 送料無料 to anyone
  // and a space is free. `spots` carries each character back to where it really sat,
  // so the word-gap guard still reads the neighbours the shopper sees.
  const tight: string[] = [];
  const spots: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    // A line break reads like a space here, so a claim split over two lines is caught.
    if (char === ' ' || char === '\n') continue;
    tight.push(char);
    spots.push(index);
  }

  const spans: Span[] = [];
  const needle = phrase.replaceAll(' ', '').replaceAll('\n', '');
  if (needle.length === 0) return spans;

  const guardStart = ASCII_WORD.test(needle[0] ?? '');
  const guardEnd = ASCII_WORD.test(needle[needle.length - 1] ?? '');
  const haystack = tight.join('');

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return spans;

    const start = spots[at] ?? 0;
    const end = spots[at + needle.length - 1] ?? 0;
    const next = text[end + 1];
    // A trailing s is a plural, not a different word: `discount` catches `discounts`.
    const plural = next === 's' && !isGlued(text[end + 2]);

    const before = guardStart && isGlued(text[start - 1]);
    const after = guardEnd && isGlued(next) && !plural;
    if (!before && !after) spans.push({ start, end });

    from = at + 1;
  }
}

export function phraseIn(text: string, phrase: string): boolean {
  return phraseSpans(text, phrase).length > 0;
}
