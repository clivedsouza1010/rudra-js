import { describe, expect, it } from 'vitest';
import { numeralsIn } from './numerals.js';
import { normalisePhrasing } from './phrases.js';

/**
 * The decoder's premise is that Unicode writes decimal digits in complete sets of
 * ten. Three blocks tested by hand hid the fact that adjacent sets abut, which read
 * every digit of the maths block after the first ten as a nine. This sweeps the lot.
 */

const IS_DIGIT = /^\p{Nd}$/u;

interface Run {
  start: number;
  end: number;
}

function digitRuns(): Run[] {
  const runs: Run[] = [];
  let start = -1;

  for (let code = 0; code <= 0x10ffff; code += 1) {
    // A lone surrogate is not a digit and is not worth constructing.
    const digit =
      code >= 0xd800 && code <= 0xdfff ? false : IS_DIGIT.test(String.fromCodePoint(code));

    if (digit && start === -1) start = code;
    if (!digit && start !== -1) {
      runs.push({ start, end: code - 1 });
      start = -1;
    }
  }
  if (start !== -1) runs.push({ start, end: 0x10ffff });

  return runs;
}

function readingOf(code: number): string | undefined {
  const [numeral] = numeralsIn(String.fromCodePoint(code));
  return numeral?.forms[0];
}

const RUNS = digitRuns();

describe('every decimal digit in Unicode', () => {
  it('sits in a run whose length is a whole number of digit sets', () => {
    for (const run of RUNS) {
      const length = run.end - run.start + 1;
      expect(length % 10, `U+${run.start.toString(16)} runs ${length} long`).toBe(0);
    }
  });

  it('reads as its offset into its own set of ten', () => {
    for (const run of RUNS) {
      for (let code = run.start; code <= run.end; code += 1) {
        const expected = String((code - run.start) % 10);
        expect(readingOf(code), `U+${code.toString(16).toUpperCase()}`).toBe(expected);
      }
    }
  });

  it('agrees with Unicode itself wherever Unicode states the ASCII digit', () => {
    // An oracle the reader does not share: NFKD folds the maths, fullwidth and
    // enclosed digits to ASCII, and those are the blocks where the seam bug bit.
    let checked = 0;

    for (const run of RUNS) {
      for (let code = run.start; code <= run.end; code += 1) {
        const folded = String.fromCodePoint(code).normalize('NFKD');
        if (!/^[0-9]$/.test(folded)) continue;

        checked += 1;
        expect(readingOf(code), `U+${code.toString(16).toUpperCase()}`).toBe(folded);
      }
    }

    // 50 of them are the maths block alone, which is where the bug lived.
    expect(checked).toBeGreaterThan(60);
  });
});

/**
 * A character that takes no column of its own can split a number into two the host did
 * supply, or split a banned phrase off its own entry. The class that drops them was
 * `\p{Cf}`, which left every variation selector in; widening it to the default-ignorable
 * code points still left the controls and the combining marks. Both layers sweep the
 * whole of Unicode here rather than trusting a hand-written list.
 */
const SPACING_CONTROL = /[\t\n\v\f\r\u0085]/;

function weightlessCodePoints(): number[] {
  const hangs = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Mn}\p{Me}\p{Cc}]/u;

  const found: number[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const char = String.fromCodePoint(code);
    if (SPACING_CONTROL.test(char)) continue;
    if (hangs.test(char)) found.push(code);
  }
  return found;
}

const WEIGHTLESS = weightlessCodePoints();

describe('every character that takes no room on the page', () => {
  it('is a class worth sweeping, not a handful', () => {
    expect(WEIGHTLESS.length).toBeGreaterThan(3000);
  });

  it('cannot split one number into two the host did supply', () => {
    for (const code of WEIGHTLESS) {
      const text = `1${String.fromCodePoint(code)}3`;
      const [numeral, ...rest] = numeralsIn(text);
      expect(numeral?.token, `U+${code.toString(16).toUpperCase()}`).toBe('13');
      expect(rest, `U+${code.toString(16).toUpperCase()}`).toEqual([]);
    }
  });

  it('cannot split a phrase off its own entry on the denylist', () => {
    for (const code of WEIGHTLESS) {
      if (composesOnto('r', code)) continue;
      const text = `fr${String.fromCodePoint(code)}ee shipping`;
      expect(normalisePhrasing(text), `U+${code.toString(16).toUpperCase()}`).toBe('free shipping');
    }
  });

  it('is almost all of the class, so the exception above hides nothing', () => {
    let composing = 0;
    for (const code of WEIGHTLESS) if (composesOnto('r', code)) composing += 1;
    expect(composing).toBeLessThan(10);
  });
});

/** Whether NFC folds this mark into the letter before it, leaving one character. */
function composesOnto(letter: string, code: number): boolean {
  return (letter + String.fromCodePoint(code)).normalize('NFC').length === 1;
}

describe('a mark that composes with the letter before it', () => {
  it('stays, because it renders as an accent the shopper can see', () => {
    // The line this package draws: compose first, then drop what composed with
    // nothing. An acute over an r is a visible letter; an overline is decoration.
    expect(normalisePhrasing('fŕee shipping')).toBe('fŕee shipping');
    expect(normalisePhrasing('fr̅ee shipping')).toBe('free shipping');
  });

  it('keeps honest accented copy readable as itself', () => {
    expect(normalisePhrasing('Últimas unidades')).toBe('últimas unidades');
    expect(normalisePhrasing('café')).toBe('café');
  });
});

describe('a character that does take room', () => {
  it('still separates two numbers when it is a control that breaks the line', () => {
    // Deleting these wholesale would read `Only 2\n3 left` as 23 and reject it.
    for (const char of ['\t', '\n', '\v', '\f', '\r', '\u0085']) {
      const found = numeralsIn(`1${char}3`);
      expect(
        found.map((numeral) => numeral.token),
        JSON.stringify(char),
      ).toEqual(['1', '3']);
    }
  });

  it('still separates two numbers when it is a spacing combining mark', () => {
    // Mc marks advance the cursor, so the shopper sees them between the digits.
    for (const char of ['ः', 'ा', 'ா']) {
      const found = numeralsIn(`1${char}3`);
      expect(
        found.map((numeral) => numeral.token),
        JSON.stringify(char),
      ).toEqual(['1', '3']);
    }
  });
});
