import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, normalisePhrasing, phraseIn, phraseSpans } from './phrases.js';

describe('normalisePhrasing', () => {
  it('lowercases', () => {
    expect(normalisePhrasing('SELLING FAST')).toBe('selling fast');
  });

  it('lowercases the Turkish dotted capital I to a plain i', () => {
    // Locale-independent toLowerCase leaves a combining dot behind, and a host's
    // own ban on `ücretsiz kargo` then misses every all-caps promo badge.
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
    // U+FE0F and U+FE00 are category Mn, so a class of Cf alone kept them and
    // `fr<VS16>ee shipping` walked past the built-in entry.
    expect(normalisePhrasing('fr️ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr︀ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr\u{e0100}ee shipping')).toBe('free shipping');
  });

  it('drops the combining grapheme joiner and the Mongolian variation selectors', () => {
    expect(normalisePhrasing('fr͏ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr᠋ee shipping')).toBe('free shipping');
  });

  it('still drops a format character that is not default-ignorable', () => {
    // Cf and Default_Ignorable_Code_Point each hold characters the other does not,
    // so the class has to be the union of the two and not either one alone.
    expect(normalisePhrasing('fr؀ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr￹ee shipping')).toBe('free shipping');
    expect(normalisePhrasing('fr\u{13430}ee shipping')).toBe('free shipping');
  });

  it('folds a letter that renders as a Latin one but is not', () => {
    // Cyrillic о and е.
    expect(normalisePhrasing('In stоck')).toBe('in stock');
    expect(normalisePhrasing('Frеe delivery')).toBe('free delivery');
  });

  it('folds fullwidth and ligature forms', () => {
    expect(normalisePhrasing('ＦＲＥＥ ＳＨＩＰＰＩＮＧ')).toBe('free shipping');
  });

  it('turns a hyphen into a space, so best-selling and best selling are one phrase', () => {
    expect(normalisePhrasing('best-selling')).toBe('best selling');
    expect(normalisePhrasing('next\u2013day')).toBe('next day');
  });

  it('collapses runs of whitespace, so a line break inside a phrase still reads', () => {
    expect(normalisePhrasing('selling\n  fast')).toBe('selling fast');
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

  it('will not match an English phrase glued inside a longer word', () => {
    expect(phraseIn('a cheapskate buy', 'cheap')).toBe(false);
    expect(phraseIn('wholesale only', 'sale')).toBe(false);
  });

  it('matches the plural of a listed phrase', () => {
    // The glue guard used to make every entry singular-only, so `discounts` walked past.
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
    // Pressed against a SKU, where a word-gap rule on every phrase would stop catching.
    expect(phraseIn('tr101在庫あり', '在庫')).toBe(true);
  });

  it('matches a phrase a space was dropped into', () => {
    // 送料 無料 reads as 送料無料 to anyone, and a space is free in Japanese.
    expect(phraseIn('送料 無料', '送料無料')).toBe(true);
    expect(phraseIn('f r e e delivery', 'free delivery')).toBe(true);
  });

  it('finds nothing for an empty phrase', () => {
    expect(phraseIn('anything at all', '')).toBe(false);
  });
});

describe('phraseSpans', () => {
  it('indexes the text it was handed, not the space-free one it matches against', () => {
    // The spans are what decides containment, so the two coordinate systems must
    // never be mixed. Short strings hide this; a leading space does not.
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

  it('finds nothing for an empty phrase', () => {
    expect(phraseSpans('anything at all', '')).toEqual([]);
  });
});

describe('BANNED_PHRASES', () => {
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
    // The README prints a whole result, `checked` included, and that number drifts.
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
