import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, indexPhrasing, normalisePhrasing, spansIn } from './phrases.js';

function phraseSpans(text: string, phrase: string) {
  return spansIn(indexPhrasing(text), phrase);
}

function phraseIn(text: string, phrase: string) {
  return phraseSpans(text, phrase).length > 0;
}

describe('normalisePhrasing', () => {
  it('lowercases', () => {
    expect(normalisePhrasing('SELLING FAST')).toBe('selling fast');
  });

  it('lowercases the Turkish dotted capital I to a plain i', () => {
    expect(normalisePhrasing('ÜCRETSİZ KARGO')).toBe('ücretsiz kargo');
  });

  it('composes accents, so a decomposed é is the same phrase as a composed one', () => {
    expect(normalisePhrasing('U\u0301ltimas unidades')).toBe('últimas unidades');
  });

  it('drops invisible characters', () => {
    expect(normalisePhrasing('F\u00adree delivery')).toBe('free delivery');
    expect(normalisePhrasing('in\u200bstock')).toBe('instock');
    expect(normalisePhrasing('شحن\u200fمجاني')).toBe('شحنمجاني');
  });

  it('drops a variation selector, which renders as nothing but is not a format character', () => {
    expect(normalisePhrasing('fr️ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr︀ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr\u{e0100}ee shipping')).toBe('free shipping');
  });

  it('drops the combining grapheme joiner and the Mongolian variation selectors', () => {
    expect(normalisePhrasing('fr͏ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr᠋ee shipping')).toBe('free shipping');
  });

  it('still drops a format character that is not default-ignorable', () => {
    expect(normalisePhrasing('fr؀ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr￹ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr\u{13430}ee shipping')).toBe('free shipping');
  });

  it('folds a letter that renders as a Latin one but is not', () => {
    expect(normalisePhrasing('In stоck')).toBe('in stock');
    expect(normalisePhrasing('Frеe delivery')).toBe('free delivery');
  });

  it('folds every letter on the look-alike table, not just the two above', () => {
    const lookAlikes: [string, string][] = [
      ['\u03f2', 'c'],
      ['\u03f9', 'c'],
      ['\u0430', 'a'],
      ['\u0432', 'b'],
      ['\u0435', 'e'],
      ['\u043a', 'k'],
      ['\u043c', 'm'],
      ['\u043d', 'h'],
      ['\u043e', 'o'],
      ['\u0440', 'p'],
      ['\u0441', 'c'],
      ['\u0442', 't'],
      ['\u0443', 'y'],
      ['\u0445', 'x'],
      ['\u0455', 's'],
      ['\u0456', 'i'],
      ['\u0458', 'j'],
      ['\u0501', 'd'],
      ['\u04bb', 'h'],
      ['\u04cf', 'l'],
      ['\u03b1', 'a'],
      ['\u03b5', 'e'],
      ['\u03b9', 'i'],
      ['\u03ba', 'k'],
      ['\u03bd', 'v'],
      ['\u03bf', 'o'],
      ['\u03c1', 'p'],
      ['\u03c4', 't'],
      ['\u03c5', 'u'],
      ['\u03c7', 'x'],
      ['\u03f3', 'j'],
      ['\u0475', 'v'],
    ];
    for (const [written, latin] of lookAlikes) {
      expect(normalisePhrasing(written), `U+${written.codePointAt(0)?.toString(16)}`).toBe(latin);
    }
  });

  it('reads each look-alike capital as the letter it looks like', () => {
    const capitals: [string, string][] = [
      ['\u0392', 'b'],
      ['\u0396', 'z'],
      ['\u0397', 'h'],
      ['\u039C', 'm'],
      ['\u039D', 'n'],
      ['\u03A5', 'y'],
      ['\u04AE', 'y'],
      ['\u04C0', 'i'],
      ['\u051A', 'q'],
      ['\u051C', 'w'],
      ['\u037F', 'j'],
      ['\u03DC', 'f'],
      ['\u03FA', 'm'],
      ['\u0474', 'v'],
      ['\u050C', 'g'],
    ];
    for (const [written, latin] of capitals) {
      const label = `U+${written.codePointAt(0)?.toString(16)}`;
      expect(normalisePhrasing(written, true), label).toBe(latin);
    }
  });

  it('folds fullwidth and ligature forms', () => {
    expect(normalisePhrasing('ＦＲＥＥ ＳＨＩＰＰＩＮＧ')).toBe('free shipping');
  });

  it('turns a hyphen or an underscore into a space, so best-selling is best selling', () => {
    expect(normalisePhrasing('best-selling')).toBe('best selling');
    expect(normalisePhrasing('next\u2013day')).toBe('next day');
    expect(normalisePhrasing('free_shipping')).toBe('free shipping');
    for (const dash of '-_\u2010\u2011\u2012\u2013\u2014\u2015') {
      expect(normalisePhrasing(`best${dash}selling`), dash).toBe('best selling');
    }
  });

  it('keeps a line break as a line break, because an allowance may not cross one', () => {
    expect(normalisePhrasing('selling\n  fast')).toBe('selling\nfast');
    expect(normalisePhrasing('not\n\n---\n\nin stock')).toBe('not\nin stock');
    expect(normalisePhrasing('selling\u2028fast')).toBe('selling\nfast');
    expect(normalisePhrasing('selling\u2029fast')).toBe('selling\nfast');
  });

  it('drops a combining mark that composes with nothing', () => {
    expect(normalisePhrasing('fr̅ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('s̃old out')).toBe('sold out');
  });

  it('drops a control character, which renders as nothing at all', () => {
    expect(normalisePhrasing('fr\u0008ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr\u001dee shipping')).toBe('free shipping');
  });

  it('collapses runs of whitespace', () => {
    expect(normalisePhrasing('selling   fast')).toBe('selling fast');
    expect(normalisePhrasing('送料\u3000無料')).toBe('送料 無料');
  });

  it('turns a typographic apostrophe into a plain one', () => {
    expect(normalisePhrasing('don\u2019t miss')).toBe("don't miss");
  });

  it('trims', () => {
    expect(normalisePhrasing('  cheap  ')).toBe('cheap');
  });
});

describe('phraseIn', () => {
  it('finds a phrase that is there', () => {
    expect(phraseIn('this one is selling fast', 'selling fast')).toBe(true);
  });

  it('does not find a phrase that is not', () => {
    expect(phraseIn('built for long days', 'selling fast')).toBe(false);
  });

  it('will not match an English phrase glued inside a longer word or a part number', () => {
    expect(phraseIn('a cheapskate buy', 'cheap')).toBe(false);
    expect(phraseIn('wholesale only', 'sale')).toBe(false);
    expect(phraseIn('sku sale2 in the list', 'sale')).toBe(false);
    expect(phraseIn('tr101cheap', 'cheap')).toBe(false);
  });

  it('matches the plural of a listed phrase', () => {
    expect(phraseIn('extra discounts on every pair', 'discount')).toBe(true);
    expect(phraseIn('bargains like this go quick', 'bargain')).toBe(true);
    expect(phraseIn('one of our best sellers', 'best seller')).toBe(true);
  });

  it('still guards a longer word that merely starts with the plural', () => {
    expect(phraseIn('our cheapskates club', 'cheap')).toBe(false);
  });

  it('still matches an English phrase against punctuation', () => {
    expect(phraseIn('(cheap)', 'cheap')).toBe(true);
    expect(phraseIn('cheap, and light', 'cheap')).toBe(true);
  });

  it('keeps looking after a glued hit', () => {
    expect(phraseIn('a cheapskate, but cheap', 'cheap')).toBe(true);
  });

  it('matches a phrase in a script that writes no word gaps', () => {
    expect(phraseIn('この商品は在庫あり', '在庫')).toBe(true);
    expect(phraseIn('tr101在庫あり', '在庫')).toBe(true);
  });

  it('matches a phrase a space was dropped into', () => {
    expect(phraseIn('送料 無料', '送料無料')).toBe(true);
    expect(phraseIn('f r e e delivery', 'free delivery')).toBe(true);
  });

  it('finds nothing for an empty phrase', () => {
    expect(phraseIn('anything at all', '')).toBe(false);
  });
});

describe('phraseSpans', () => {
  it('indexes the text it was handed, not the space-free one it matches against', () => {
    expect(phraseSpans('back in stock today', 'in stock')).toEqual([{ start: 5, end: 12 }]);
    expect(phraseSpans('送料 無料', '送料無料')).toEqual([{ start: 0, end: 4 }]);
  });

  it('ends the span at the last character the phrase matched and no further', () => {
    expect(phraseSpans('one of our best sellers', 'best seller')).toEqual([{ start: 11, end: 21 }]);
  });

  it('collects every accepted hit, not just the first', () => {
    expect(phraseSpans('back in stock. also in stock elsewhere.', 'in stock')).toEqual([
      { start: 5, end: 12 },
      { start: 20, end: 27 },
    ]);
  });

  it('leaves out a hit the word-gap guard rejects', () => {
    expect(phraseSpans('a cheapskate, but cheap', 'cheap')).toEqual([{ start: 18, end: 22 }]);
  });

  it('collects a hit that overlaps the one before it, because each is its own claim', () => {
    expect(phraseSpans('在庫在庫在庫', '在庫在庫')).toEqual([
      { start: 0, end: 3 },
      { start: 2, end: 5 },
    ]);
  });

  it('finds nothing for an empty phrase', () => {
    expect(phraseSpans('anything at all', '')).toEqual([]);
  });
});

describe('indexPhrasing', () => {
  it('reads every phrase off one index, each against the offsets it was built from', () => {
    const indexed = indexPhrasing('free delivery. a sale, and the last few pairs');
    expect(spansIn(indexed, 'free delivery')).toEqual([{ start: 0, end: 12 }]);
    expect(spansIn(indexed, 'sale')).toEqual([{ start: 17, end: 20 }]);
    expect(spansIn(indexed, 'last few')).toEqual([{ start: 31, end: 38 }]);
    expect(spansIn(indexed, 'free shipping')).toEqual([]);
  });
});

describe('BANNED_PHRASES', () => {
  it('holds exactly these phrases, because a typo in one matches nothing and says nothing', () => {
    expect(BANNED_PHRASES).toEqual([
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
    ]);
  });

  it('holds no phrase with a digit in it, because layer one owns those', () => {
    for (const phrase of BANNED_PHRASES) {
      expect(/\d/.test(phrase), `${phrase} carries a digit`).toBe(false);
    }
  });

  it('is stored in the form the matcher compares against', () => {
    for (const phrase of BANNED_PHRASES) {
      expect(normalisePhrasing(phrase), `${phrase} is not normalised`).toBe(phrase);
    }
  });

  it('is the size the README tells a reader to expect', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(`checked: ${BANNED_PHRASES.length},`);
  });

  it('covers the claims the brief names', () => {
    const named = [
      'cheap',
      'bargain',
      'sale',
      'best selling',
      'selling fast',
      'in stock',
      'free delivery',
    ];
    for (const phrase of named) {
      expect(BANNED_PHRASES, `${phrase} is missing`).toContain(phrase);
    }
  });
});
