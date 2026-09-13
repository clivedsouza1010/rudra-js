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
 * A character that renders as nothing can split a number into two the host did supply,
 * or split a banned phrase off its own entry. The class that drops them was `\p{Cf}`,
 * which left every variation selector in. Both layers sweep the whole of Unicode here
 * rather than trusting a hand-written list.
 */
function invisibleCodePoints(): number[] {
  const ignorable = /\p{Default_Ignorable_Code_Point}/u;
  const format = /\p{Cf}/u;

  const found: number[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const char = String.fromCodePoint(code);
    if (ignorable.test(char) || format.test(char)) found.push(code);
  }
  return found;
}

const INVISIBLE = invisibleCodePoints();

describe('every character that renders as nothing', () => {
  it('cannot split one number into two the host did supply', () => {
    for (const code of INVISIBLE) {
      const text = `1${String.fromCodePoint(code)}3`;
      const [numeral, ...rest] = numeralsIn(text);
      expect(numeral?.token, `U+${code.toString(16).toUpperCase()}`).toBe('13');
      expect(rest, `U+${code.toString(16).toUpperCase()}`).toEqual([]);
    }
  });

  it('cannot split a phrase off its own entry on the denylist', () => {
    for (const code of INVISIBLE) {
      const text = `fr${String.fromCodePoint(code)}ee shipping`;
      expect(normalisePhrasing(text), `U+${code.toString(16).toUpperCase()}`).toBe('free shipping');
    }
  });
});
