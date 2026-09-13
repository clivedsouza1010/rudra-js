import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, normalisePhrasing, phraseIn } from './phrases.js';

describe('normalisePhrasing', () => {
  it('lowercases', () => {
    expect(normalisePhrasing('SELLING FAST')).toBe('selling fast');
  });

  it('turns a hyphen into a space, so best-selling and best selling are one phrase', () => {
    expect(normalisePhrasing('best-selling')).toBe('best selling');
    expect(normalisePhrasing('next–day')).toBe('next day');
  });

  it('collapses runs of whitespace, so a line break inside a phrase still reads', () => {
    expect(normalisePhrasing('selling\n  fast')).toBe('selling fast');
  });

  it('turns a typographic apostrophe into a plain one', () => {
    expect(normalisePhrasing('don’t miss')).toBe("don't miss");
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
