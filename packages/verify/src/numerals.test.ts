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

describe('numeralsIn', () => {
  it('finds a bare integer', () => {
    expect(numeralsIn('Only 2 left')).toEqual([{ token: '2', forms: ['2'] }]);
  });

  it('finds every numeral in the text, in order', () => {
    const tokens: string[] = [];
    for (const numeral of numeralsIn('Was 60, now 39')) tokens.push(numeral.token);
    expect(tokens).toEqual(['60', '39']);
  });

  it('finds nothing in text that has no numeral', () => {
    expect(numeralsIn('Built for long days on the trail')).toEqual([]);
  });

  it('leaves the currency symbol out of the token', () => {
    expect(numeralsIn('$39')).toEqual([{ token: '39', forms: ['39'] }]);
    expect(numeralsIn('39 €')).toEqual([{ token: '39', forms: ['39'] }]);
  });

  it('leaves the percent sign out of the token', () => {
    expect(numeralsIn('20% off')).toEqual([{ token: '20', forms: ['20'] }]);
  });

  it('does not swallow a sentence-ending full stop', () => {
    expect(numeralsIn('It costs 39.')).toEqual([{ token: '39', forms: ['39'] }]);
  });

  it('reads a full stop between digits as a decimal point or as grouping', () => {
    expect(formsOf('1.299')).toEqual(['1299', '1.299']);
  });

  it('reads a comma between digits as a decimal point or as grouping', () => {
    expect(formsOf('1,299')).toEqual(['1299', '1.299']);
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

  it('rules out grouping when the run before the first separator is longer than three', () => {
    expect(formsOf('1234,567')).toEqual(['1234.567']);
  });

  it('gives a malformed run no reading at all, so nothing can support it', () => {
    expect(formsOf('3.14.15')).toEqual([]);
  });

  it('drops trailing zeros in the fraction and leading zeros in the whole part', () => {
    expect(formsOf('39.00')).toEqual(['39']);
    expect(formsOf('09')).toEqual(['9']);
    expect(formsOf('0.50')).toEqual(['0.5']);
  });

  it('reads Eastern Arabic numerals', () => {
    expect(numeralsIn('٤٫٨')).toEqual([{ token: '٤٫٨', forms: ['4.8'] }]);
    expect(formsOf('٣٩')).toEqual(['39']);
  });

  it('reads a numeral system it was never told about', () => {
    // Devanagari, then Thai.
    expect(formsOf('३९')).toEqual(['39']);
    expect(formsOf('๓๙')).toEqual(['39']);
  });

  it('keeps two numerals apart when a space sits between them', () => {
    const tokens: string[] = [];
    for (const numeral of numeralsIn('buy 2 get 3')) tokens.push(numeral.token);
    expect(tokens).toEqual(['2', '3']);
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

  it('keeps both readings of an ambiguous separator', () => {
    expect(supportedValues(['1,299'])).toEqual(new Set(['1299', '1.299']));
  });

  it('collects from every value', () => {
    expect(supportedValues([39, '4.8', 'ships 13 March'])).toEqual(new Set(['39', '4.8', '13']));
  });

  it('is empty when the host stands behind nothing', () => {
    expect(supportedValues([])).toEqual(new Set());
  });
});
