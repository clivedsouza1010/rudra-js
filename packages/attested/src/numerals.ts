// Everything here is string work. No float ever holds a value, so a twenty-digit
// order number compares exactly.

import { stripInvisible, stripMarks } from './hidden.js';

/** A dot or a comma. Either mark is a decimal point in one locale and grouping in another. */
const AMBIGUOUS = '.,';
/** The Arabic decimal separator, which is never grouping. */
const DECIMAL_ONLY = '\u066b';
/** Marks that are only ever grouping: Arabic thousands, the space family, the apostrophe. */
const GROUPING_ONLY = '\u066c\u0020\u00a0\u2007\u2008\u2009\u202f\u0027\u2019';

const SEPARATORS = AMBIGUOUS + DECIMAL_ONLY + GROUPING_ONLY;

const RUN = `\\p{Nd}+(?:[${SEPARATORS}]\\p{Nd}+)*`;
/** Marks that multiply the digits in front of them: 万 億 兆, and the k/M/B of English copy. */
const MAGNITUDE = '(?:[十百千万萬億亿兆]|[kKMB](?!\\p{L}))';
/** Numeric characters that are not decimal digits: ½ ² ② Ⅲ. */
const OTHER_NUMERAL = '[\\p{No}\\p{Nl}]+';

const SCAN = new RegExp(`${RUN}${MAGNITUDE}|${RUN}|${OTHER_NUMERAL}`, 'gu');
const LOOSE = new RegExp(`[${GROUPING_ONLY}]`, 'u');

const IS_DIGIT = /^\p{Nd}$/u;
const STARTS_DIGIT = /^\p{Nd}/u;
const ENDS_DIGIT = /\p{Nd}$/u;

export interface Numeral {
  /** The run exactly as it appears in the text. */
  token: string;
  /** Every reading of that run, canonical. Empty when the layer cannot read the run. */
  forms: string[];
  /** `digits` is a run this layer reads. The other two it cannot read at all. */
  kind: 'digits' | 'magnitude' | 'other-numeral';
}

const zeros = new Map<number, number>();

/**
 * Unicode writes decimal digits in complete sets of ten, and adjacent sets abut, so
 * the start of a maximal run of digit code points is a zero and the offset into that
 * run, modulo ten, is the value. Walking back without that modulo reads every digit
 * of the second and later sets in the maths block as a nine.
 */
function digitValue(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  let zero = zeros.get(code);
  if (zero === undefined) {
    zero = code;
    while (zero > 0 && IS_DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
    zeros.set(code, zero);
  }

  return (code - zero) % 10;
}

function toAscii(token: string): string {
  let out = '';
  for (const char of token) {
    out += SEPARATORS.includes(char) ? char : String(digitValue(char));
  }
  return out;
}

/** Strips the zeros that carry no value, so 39.00 and 39 are one string. */
function canonical(whole: string, fraction: string): string {
  let start = 0;
  while (start < whole.length - 1 && whole[start] === '0') start += 1;

  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === '0') end -= 1;

  const head = whole.slice(start);
  const tail = fraction.slice(0, end);
  return tail.length === 0 ? head : `${head}.${tail}`;
}

/** Whether these runs read as one grouped whole number: 12,345,678 or 1,29,999. */
function isGrouping(groups: string[]): boolean {
  if (groups.length === 1) return true;
  if ((groups[groups.length - 1] ?? '').length !== 3) return false;

  let three = true;
  let two = true;
  for (let index = 1; index < groups.length - 1; index += 1) {
    const size = (groups[index] ?? '').length;
    if (size !== 3) three = false;
    if (size !== 2) two = false;
  }

  const lead = (groups[0] ?? '').length;
  if (three) return lead >= 1 && lead <= 3;
  // 1,29,999 — the Indian grouping, two digits at a time above the last three.
  if (two) return lead >= 1 && lead <= 2;
  return false;
}

/** Whether every mark is the same one, and every one of them can be grouping. */
function allGrouping(separators: string[]): boolean {
  for (const separator of separators) {
    if (separator !== separators[0]) return false;
    if (DECIMAL_ONLY.includes(separator)) return false;
  }
  return true;
}

/** `1,299` is 1299 in London and in Berlin. `1234,567` is a decimal in both. */
function formsOf(token: string): string[] {
  const ascii = toAscii(token);

  const groups: string[] = [];
  const separators: string[] = [];
  let current = '';
  for (const char of ascii) {
    if (SEPARATORS.includes(char)) {
      groups.push(current);
      separators.push(char);
      current = '';
    } else {
      current += char;
    }
  }
  groups.push(current);

  if (separators.length === 0) return [canonical(groups[0] ?? '', '')];

  const forms: string[] = [];
  if (allGrouping(separators) && isGrouping(groups)) forms.push(canonical(groups.join(''), ''));

  const whole = groups.slice(0, -1);
  const leading = separators.slice(0, -1);
  const point = separators[separators.length - 1] ?? '';
  const fraction = groups[groups.length - 1] ?? '';

  // One dot or comma with exactly three digits behind it is grouping wherever it is
  // written, so `4.800` is four thousand eight hundred and never the rating 4.8.
  const groupingWins = forms.length > 0 && leading.length === 0 && fraction.length === 3;

  if (
    !groupingWins &&
    !GROUPING_ONLY.includes(point) &&
    allGrouping(leading) &&
    leading[0] !== point &&
    isGrouping(whole)
  ) {
    forms.push(canonical(whole.join(''), fraction));
  }

  return forms;
}

function collect(found: Numeral[], token: string): void {
  if (!STARTS_DIGIT.test(token)) {
    found.push({ token, forms: [], kind: 'other-numeral' });
    return;
  }
  if (!ENDS_DIGIT.test(token)) {
    found.push({ token, forms: [], kind: 'magnitude' });
    return;
  }

  const forms = formsOf(token);
  if (forms.length > 0) {
    found.push({ token, forms, kind: 'digits' });
    return;
  }

  // `8 10 12` is three numbers, not one badly grouped one.
  if (LOOSE.test(token)) {
    for (const part of token.split(LOOSE)) {
      if (part.length > 0) collect(found, part);
    }
    return;
  }

  // No locale reads `24.12.2026` as a number, so only a fact written the same way
  // stands behind it. The raw run carries a mark, and a reading never does, so it
  // can never be mistaken for one.
  found.push({ token, forms: [toAscii(token)], kind: 'digits' });
}

export function numeralsIn(text: string): Numeral[] {
  const found: Numeral[] = [];
  for (const match of stripMarks(stripInvisible(text)).matchAll(SCAN)) collect(found, match[0]);
  return found;
}

/** A whole fact in exponent notation and nothing else, so expanding it swallows no prose. */
const BARE_EXPONENT = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

/**
 * The widest digit run a fact may lay out to. Every finite JS number fits — 5e-324 is
 * the longest, at 326 characters — and nothing a shop sells is wider than that.
 */
const DIGIT_LIMIT = 1000;

/**
 * `String(1e21)` is `1e+21`, which reads as the two numerals 1 and 21. Lay the same digits
 * out in place. Empty past the limit: `1e2000000000` is twelve characters and no product
 * fact, and laying it out builds a run long enough to take the process down with it.
 */
function positional(written: string): string {
  const marker = written.search(/[eE]/);
  if (marker < 0) return written;

  const power = Number(written.slice(marker + 1));
  // The sign never reaches a numeral, so dropping it here mints no digit the host lacks.
  const body = written.slice(0, marker).replace(/^[+-]/, '');
  const point = body.indexOf('.');
  const digits = point < 0 ? body : body.slice(0, point) + body.slice(point + 1);
  const place = (point < 0 ? body.length : point) + power;

  if (place <= 0) {
    if (digits.length - place > DIGIT_LIMIT) return '';
    return `0.${'0'.repeat(-place)}${digits}`;
  }
  if (place >= digits.length) {
    if (place > DIGIT_LIMIT) return '';
    return `${digits}${'0'.repeat(place - digits.length)}`;
  }
  return `${digits.slice(0, place)}.${digits.slice(place)}`;
}

/**
 * A string fact is read as the host typed it, except when the whole of it is a number
 * in exponent notation: `String`, `JSON.stringify`, a CSV export and an API that writes
 * 64-bit values as strings all produce that, and none of them is the host choosing digits.
 */
function digitsOf(value: string | number | bigint): string {
  if (typeof value === 'number') return positional(String(value));
  if (typeof value !== 'string') return String(value);

  const trimmed = value.trim();
  return BARE_EXPONENT.test(trimmed) ? positional(trimmed) : value;
}

/** Every reading of every numeral the host stands behind. */
export function supportedValues(values: readonly (string | number | bigint)[]): Set<string> {
  const supported = new Set<string>();
  for (const value of values) {
    for (const numeral of numeralsIn(digitsOf(value))) {
      for (const form of numeral.forms) supported.add(form);
    }
  }
  return supported;
}
