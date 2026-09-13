import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, normalisePhrasing, phraseIn } from './phrases.js';

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
