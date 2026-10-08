import { stripInvisible, stripMarks } from './hidden.js';

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
  'ends today',
  'ends tonight',
  'ends at midnight',
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
  'trending',
  'others are looking',
  'people are looking',
  'others are viewing',
  'people are viewing',
  'others are buying',
  'people are buying',
  'in other carts',
  'in other baskets',
  'money back',
  'eco friendly',
  'environmentally friendly',
  'planet friendly',
  'earth friendly',
  'nature friendly',
  'climate friendly',
  'carbon friendly',
  'good for the planet',
  'kind to the planet',
  'gentle on the environment',
  'ecological',
  'ecologically',
  'environmentally correct',
  'eco conscious',
  'environmentally conscious',
  'sustainable',
  'sustainably',
  'biodegradable',
  'compostable',
  'biobased',
  'energy efficient',
  'carbon neutral',
  'climate neutral',
  'net zero',
  'carbon negative',
  'carbon positive',
  'climate positive',
  'carbon offset',
  'zero waste',
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
  ϳ: 'j',
  ѵ: 'v',
};

// Capitals that lowercasing reads wrong: Ν becomes ν, which reads as v.
const CAPITALS: Record<string, string> = {
  Β: 'b',
  Ζ: 'z',
  Η: 'h',
  Μ: 'm',
  Ν: 'n',
  Υ: 'y',
  Ү: 'y',
  Ӏ: 'i',
  Ԛ: 'q',
  Ԝ: 'w',
  Ϻ: 'm',
  Ϝ: 'f',
  Ԍ: 'g',
};

const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;

export function normalisePhrasing(text: string, byLook = false): string {
  // NFKC would turn the lunate sigmas into ς and Σ, which the fold can't read as c.
  const compatible = stripInvisible(text).replace(/[ϲϹ]/g, 'c').normalize('NFKC');

  let cased = compatible;
  if (byLook) {
    cased = '';
    for (const char of compatible) cased += CAPITALS[char] ?? char;
  }
  const lowered = stripMarks(cased.toLowerCase().normalize('NFC'));

  let folded = '';
  for (const char of lowered) folded += CONFUSABLES[char] ?? char;

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

  end: number;
}

export interface Indexed {
  text: string;

  haystack: string;

  spots: number[];
}

export function indexPhrasing(text: string): Indexed {
  const tight: string[] = [];
  const spots: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';

    if (char === ' ' || char === '\n') continue;
    tight.push(char);
    spots.push(index);
  }

  return { text, haystack: tight.join(''), spots };
}

export function spansIn(indexed: Indexed, phrase: string): Span[] {
  const { text, haystack, spots } = indexed;

  const spans: Span[] = [];
  const needle = phrase.replaceAll(' ', '').replaceAll('\n', '');
  if (needle.length === 0) return spans;

  const guardStart = ASCII_WORD.test(needle[0] ?? '');
  const guardEnd = ASCII_WORD.test(needle[needle.length - 1] ?? '');

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return spans;

    const start = spots[at] ?? 0;
    const end = spots[at + needle.length - 1] ?? 0;
    const next = text[end + 1];

    const plural = next === 's' && !isGlued(text[end + 2]);

    const before = guardStart && isGlued(text[start - 1]);
    const after = guardEnd && isGlued(next) && !plural;
    if (!before && !after) spans.push({ start, end });

    from = at + 1;
  }
}
