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
});
