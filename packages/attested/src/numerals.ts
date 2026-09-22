import { stripInvisible, stripMarks } from './hidden.js';

const AMBIGUOUS = '.,';

const DECIMAL_ONLY = '\u066b';

const GROUPING_ONLY = '\u066c\u0020\u00a0\u2007\u2008\u2009\u202f\u0027\u2019';

const SEPARATORS = AMBIGUOUS + DECIMAL_ONLY + GROUPING_ONLY;

const RUN = `\\p{Nd}+(?:[${SEPARATORS}]\\p{Nd}+)*`;

const MAGNITUDE = '(?:[十百千万萬億亿兆]|[kKMB](?!\\p{L}))';

const OTHER_NUMERAL = '[\\p{No}\\p{Nl}]+';

const SCAN = new RegExp(`${RUN}${MAGNITUDE}|${RUN}|${OTHER_NUMERAL}`, 'gu');
const LOOSE = new RegExp(`[${GROUPING_ONLY}]`, 'u');

const IS_DIGIT = /^\p{Nd}$/u;
const STARTS_DIGIT = /^\p{Nd}/u;
const ENDS_DIGIT = /\p{Nd}$/u;

export interface Numeral {
  token: string;

  forms: string[];

  kind: 'digits' | 'magnitude' | 'other-numeral';
}

const zeros = new Map<number, number>();

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

function canonical(whole: string, fraction: string): string {
  let start = 0;
  while (start < whole.length - 1 && whole[start] === '0') start += 1;

  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === '0') end -= 1;

  const head = whole.slice(start);
  const tail = fraction.slice(0, end);
  return tail.length === 0 ? head : `${head}.${tail}`;
}

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

  if (two) return lead >= 1 && lead <= 2;
  return false;
}

function allGrouping(separators: string[]): boolean {
  for (const separator of separators) {
    if (separator !== separators[0]) return false;
    if (DECIMAL_ONLY.includes(separator)) return false;
  }
  return true;
}

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

  if (LOOSE.test(token)) {
    for (const part of token.split(LOOSE)) {
      if (part.length > 0) collect(found, part);
    }
    return;
  }

  found.push({ token, forms: [toAscii(token)], kind: 'digits' });
}

export function numeralsIn(text: string): Numeral[] {
  const found: Numeral[] = [];
  for (const match of stripMarks(stripInvisible(text)).matchAll(SCAN)) collect(found, match[0]);
  return found;
}

const BARE_EXPONENT = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

const DIGIT_LIMIT = 1000;

function positional(written: string): string {
  const marker = written.search(/[eE]/);
  if (marker < 0) return written;

  const power = Number(written.slice(marker + 1));

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

function digitsOf(value: string | number | bigint): string {
  if (typeof value === 'number') return positional(String(value));
  if (typeof value !== 'string') return String(value);

  const trimmed = value.trim();
  return BARE_EXPONENT.test(trimmed) ? positional(trimmed) : value;
}

export function supportedValues(values: readonly (string | number | bigint)[]): Set<string> {
  const supported = new Set<string>();
  for (const value of values) {
    for (const numeral of numeralsIn(digitsOf(value))) {
      for (const form of numeral.forms) supported.add(form);
    }
  }
  return supported;
}
