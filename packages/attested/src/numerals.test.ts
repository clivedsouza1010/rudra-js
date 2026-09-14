import { describe, expect, it } from 'vitest';
import { numeralsIn, supportedValues } from './numerals.js';

function formsOf(text: string): string[] {
  const found = numeralsIn(text);
  const out: string[] = [];
  for (const numeral of found) {
    for (const form of numeral.forms) out.push(form);
  }
  return out;
}

function kindsOf(text: string): string[] {
  const out: string[] = [];
  for (const numeral of numeralsIn(text)) out.push(numeral.kind);
  return out;
}

function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const numeral of numeralsIn(text)) out.push(numeral.token);
  return out;
}

describe('numeralsIn', () => {
  it('finds a bare integer', () => {
    expect(numeralsIn('Only 2 left')).toEqual([{ token: '2', forms: ['2'], kind: 'digits' }]);
  });

  it('finds every numeral in the text, in order', () => {
    expect(tokensOf('Was 60, now 39')).toEqual(['60', '39']);
  });

  it('finds nothing in text that has no numeral', () => {
    expect(numeralsIn('Built for long days on the trail')).toEqual([]);
  });

  it('leaves the currency symbol out of the token', () => {
    expect(tokensOf('$39')).toEqual(['39']);
    expect(tokensOf('39 €')).toEqual(['39']);
  });

  it('leaves the percent sign out of the token', () => {
    expect(numeralsIn('20% off')).toEqual([{ token: '20', forms: ['20'], kind: 'digits' }]);
  });

  it('does not swallow a sentence-ending full stop', () => {
    expect(numeralsIn('It costs 39.')).toEqual([{ token: '39', forms: ['39'], kind: 'digits' }]);
  });

  it('reads one dot or comma with three digits behind it as grouping, never as a decimal', () => {
    // The whole ×1000 family: a fact of 4.8 must not stand behind a written 4.800.
    expect(formsOf('1.299')).toEqual(['1299']);
    expect(formsOf('1,299')).toEqual(['1299']);
    expect(formsOf('4.800')).toEqual(['4800']);
    expect(formsOf('20.000')).toEqual(['20000']);
    expect(formsOf('39,990')).toEqual(['39990']);
  });

  it('rules out grouping when the run after the separator is not three digits', () => {
    expect(formsOf('4,8')).toEqual(['4.8']);
    expect(formsOf('4.8')).toEqual(['4.8']);
  });

  it('reads the last of two different separators as the decimal point', () => {
    expect(formsOf('1,299.50')).toEqual(['1299.5']);
    expect(formsOf('1.299,50')).toEqual(['1299.5']);
  });

  it('reads repeated separators as grouping only', () => {
    expect(formsOf('12,345,678')).toEqual(['12345678']);
  });

  it('will not read two different marks as grouping, because no locale does', () => {
    expect(formsOf('1,299.500')).toEqual(['1299.5']);
  });

  it('keeps the decimal reading when the run cannot be grouping at all', () => {
    expect(formsOf('1234,567')).toEqual(['1234.567']);
  });

  it('reads the Indian grouping, so a shop in Mumbai can state its own price', () => {
    expect(formsOf('1,29,999')).toEqual(['129999']);
    expect(formsOf('12,99,999')).toEqual(['1299999']);
    expect(formsOf('२,९९,९९९')).toEqual(['299999']);
  });

  it('reads a space or an apostrophe as a thousands mark', () => {
    // French, Swiss and Swedish price formatting, and the narrow space CLDR emits.
    expect(formsOf('1 299')).toEqual(['1299']);
    expect(formsOf('1\u00a0299')).toEqual(['1299']);
    expect(formsOf('1\u202f299')).toEqual(['1299']);
    expect(formsOf("1'299")).toEqual(['1299']);
    expect(formsOf('1 299,00')).toEqual(['1299']);
  });

  it('will not read a loose thousands mark as a decimal point', () => {
    // Otherwise a space would mint 12.000 out of a fact of 12, same as a dot did.
    expect(formsOf('12 000')).toEqual(['12000']);
  });

  it('splits runs a loose mark cannot group back into separate numerals', () => {
    expect(tokensOf('size 8 10 12')).toEqual(['8', '10', '12']);
  });

  it('gives a run no locale reads as a number only its own spelling', () => {
    expect(formsOf('3.14.15')).toEqual(['3.14.15']);
    expect(formsOf('24.12.2026')).toEqual(['24.12.2026']);
    // Scripts still fold, so a Devanagari date and an ASCII one are one string.
    expect(formsOf('२४.१२.२०२६')).toEqual(['24.12.2026']);
  });

  it('drops trailing zeros in the fraction and leading zeros in the whole part', () => {
    expect(formsOf('39.00')).toEqual(['39']);
    expect(formsOf('09')).toEqual(['9']);
    expect(formsOf('0.50')).toEqual(['0.5']);
  });

  it('reads Eastern Arabic numerals', () => {
    expect(numeralsIn('٤\u066b٨')).toEqual([{ token: '٤\u066b٨', forms: ['4.8'], kind: 'digits' }]);
    expect(formsOf('٣٩')).toEqual(['39']);
  });

  it('reads the Arabic thousands mark as grouping and its decimal mark as a point', () => {
    expect(formsOf('٤\u066c٨٠٠')).toEqual(['4800']);
    expect(formsOf('٤\u066b٨٠٠')).toEqual(['4.8']);
  });

  it('reads a numeral system it was never told about', () => {
    // Devanagari, then Thai.
    expect(formsOf('३९')).toEqual(['39']);
    expect(formsOf('๓๙')).toEqual(['39']);
  });

  it('reads a digit in a block that abuts the block before it', () => {
    // Mathematical sans-serif bold 1 and 9, then monospace 1 and 3.
    expect(formsOf('\u{1D7ED}\u{1D7F5}')).toEqual(['19']);
    expect(formsOf('\u{1D7F7}\u{1D7F9}')).toEqual(['13']);
    expect(formsOf('\u{1D7EE}')).toEqual(['2']);
    expect(formsOf('12\u{1D7F6}')).toEqual(['120']);
  });

  it('drops an invisible character rather than letting it split a number', () => {
    expect(numeralsIn('2\u200b13')).toEqual([{ token: '213', forms: ['213'], kind: 'digits' }]);
    expect(formsOf('2\u00ad13')).toEqual(['213']);
  });

  it('drops a variation selector, which renders as nothing but is not a format character', () => {
    // U+FE0F and U+FE00 are category Mn. A class of Cf alone left them in, and
    // "$1<VS16>3" then read as the two supported numerals 1 and 3.
    expect(numeralsIn('1\ufe0f3')).toEqual([{ token: '13', forms: ['13'], kind: 'digits' }]);
    expect(formsOf('1\ufe003')).toEqual(['13']);
    expect(formsOf('1\u{e0100}3')).toEqual(['13']);
  });

  it('drops the combining grapheme joiner and the Mongolian variation selectors', () => {
    expect(formsOf('1\u034f3')).toEqual(['13']);
    expect(formsOf('1\u180b3')).toEqual(['13']);
  });

  it('still drops a format character that is not default-ignorable', () => {
    // The Arabic number signs and the interlinear annotation marks are Cf but not
    // default-ignorable, so the class has to be the union of the two, not either one.
    expect(formsOf('1\u06003')).toEqual(['13']);
    expect(formsOf('1\ufff93')).toEqual(['13']);
    expect(formsOf('1\u{13430}3')).toEqual(['13']);
  });

  it('reads a numeric character that is not a decimal digit as one it cannot read', () => {
    expect(numeralsIn('½')).toEqual([{ token: '½', forms: [], kind: 'other-numeral' }]);
    expect(kindsOf('Only ② left')).toEqual(['other-numeral']);
    expect(kindsOf('Ⅲ pairs')).toEqual(['other-numeral']);
    expect(kindsOf('$2⁹⁹')).toEqual(['digits', 'other-numeral']);
  });

  it('reads a magnitude mark glued to a run as one it cannot read', () => {
    expect(numeralsIn('4.8万件')).toEqual([{ token: '4.8万', forms: [], kind: 'magnitude' }]);
    expect(kindsOf('12万点')).toEqual(['magnitude']);
    expect(kindsOf('4.8k reviews')).toEqual(['magnitude']);
    expect(kindsOf('12M sold')).toEqual(['magnitude']);
  });

  it('leaves a unit that is a letter alone, because a unit is not a multiplier', () => {
    expect(numeralsIn('1kg')).toEqual([{ token: '1', forms: ['1'], kind: 'digits' }]);
    expect(kindsOf('Ships in 2 Monate')).toEqual(['digits']);
  });

  it('keeps two numerals apart when a word sits between them', () => {
    expect(tokensOf('buy 2 get 3')).toEqual(['2', '3']);
  });
});

describe('supportedValues', () => {
  it('takes a number as it stands', () => {
    expect(supportedValues([39])).toEqual(new Set(['39']));
  });

  it('takes a decimal number', () => {
    expect(supportedValues([4.8])).toEqual(new Set(['4.8']));
  });

  it('pulls the numerals out of a string the host supplied', () => {
    expect(supportedValues(['$1,299.00'])).toEqual(new Set(['1299']));
  });

  it('mints one value from a grouped fact, not a decimal the host never wrote', () => {
    expect(supportedValues(['1,299'])).toEqual(new Set(['1299']));
    expect(supportedValues(['1,240'])).toEqual(new Set(['1240']));
  });

  it('collects from every value', () => {
    expect(supportedValues([39, '4.8', 'ships 13 March'])).toEqual(new Set(['39', '4.8', '13']));
  });

  it('is empty when the host stands behind nothing', () => {
    expect(supportedValues([])).toEqual(new Set());
  });

  it('lays a number out in positional notation rather than letting String pick exponents', () => {
    // `String(1e21)` is `1e+21`, which used to read as the two numerals 1 and 21.
    expect(supportedValues([1e21])).toEqual(new Set(['1000000000000000000000']));
    expect(supportedValues([1e-7])).toEqual(new Set(['0.0000001']));
  });

  it('keeps every digit of a significand, on both sides of the exponent', () => {
    expect(supportedValues([6.02e23])).toEqual(new Set(['602000000000000000000000']));
    expect(supportedValues([1.5e-7])).toEqual(new Set(['0.00000015']));
  });

  it('keeps a negative number on the small side out of the digits', () => {
    // Splicing the sign back in the middle would mint a 0 the host never supplied.
    expect(supportedValues([-1.5e-7])).toEqual(new Set(['0.00000015']));
  });

  it('lays out the digits String chose, never a wider exact expansion', () => {
    // 0.1 + 0.2 is exactly 0.3000000000000000444089209850062616169452667236328125, but
    // every renderer in the host's stack writes the shortest round-trip form, so that
    // is the run the model will write and the only one worth standing behind.
    expect(supportedValues([0.1 + 0.2])).toEqual(new Set(['0.30000000000000004']));
  });

  it('stands behind no numeral for a number that is not finite', () => {
    expect(supportedValues([NaN, Infinity, -Infinity])).toEqual(new Set());
  });

  it('lays out a string fact that is a bare number in exponent notation', () => {
    // `String(v)`, `JSON.stringify(v)`, a CSV export and a JSON API that writes 64-bit
    // values as strings all land here, so the host did not choose these digits either.
    expect(supportedValues(['1e21'])).toEqual(new Set(['1000000000000000000000']));
    expect(supportedValues(['1.23E+15'])).toEqual(new Set(['1230000000000000']));
    expect(supportedValues([' 1e-7 '])).toEqual(new Set(['0.0000001']));
  });

  it('leaves a string fact alone when the exponent is part of something longer', () => {
    // There the host really did type the digits, and a SKU is not a number.
    expect(supportedValues(['SKU AX-220e5'])).toEqual(new Set(['220', '5']));
    expect(supportedValues(['1e21 ohms'])).toEqual(new Set(['1', '21']));
  });

  it('lays out a thousand digits and stands behind nothing past that', () => {
    // A twelve-character fact must not become a digit run big enough to take the
    // process down. Every finite JS number lays out inside a thousand digits — the
    // widest is 5e-324, at 326 — and no shop sells anything wider.
    expect(supportedValues(['1e999'])).toEqual(new Set([`1${'0'.repeat(999)}`]));
    expect(supportedValues(['1e-1000'])).toEqual(new Set([`0.${'0'.repeat(999)}1`]));
    expect(supportedValues(['1e1000'])).toEqual(new Set());
    expect(supportedValues(['1e-1001'])).toEqual(new Set());
  });

  it('takes a bigint exactly, which is the only way past 2^53', () => {
    expect(supportedValues([12345678901234567890n])).toEqual(new Set(['12345678901234567890']));
  });

  it('stands behind nothing for a value that is neither, rather than throwing', () => {
    // An optional product field arrives as null, and taking the whole call down over
    // one missing price is worse than standing behind no numeral for it.
    expect(supportedValues([null, undefined, true] as unknown as (string | number)[])).toEqual(
      new Set(),
    );
  });
});
