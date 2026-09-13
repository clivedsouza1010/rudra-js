// Everything here is string work. No float ever holds a value, so a twenty-digit
// order number compares exactly.

/** The decimal point and the digit-grouping mark, ASCII and Arabic. */
const SEPARATORS = '.,\u066b\u066c';

/** Runs of decimal digits joined by single separators. */
const TOKEN = String.raw`\p{Nd}+(?:[.,\u066b\u066c]\p{Nd}+)*`;

const IS_DIGIT = /^\p{Nd}$/u;

export interface Numeral {
  /** The run exactly as it appears in the text. */
  token: string;
  /** Every reading of that run, canonical. Empty when the run reads as nothing. */
  forms: string[];
}

/** Unicode lays every decimal block out as ten code points in a row, so the zero is findable. */
function digitValue(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  let zero = code;
  while (code - zero < 9 && zero > 0 && IS_DIGIT.test(String.fromCodePoint(zero - 1))) {
    zero -= 1;
  }
  return code - zero;
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

/** Whether these runs and marks read as one grouped whole number: 12,345,678. */
function isGrouping(groups: string[], separators: string[]): boolean {
  if (separators.length === 0) return true;

  for (const separator of separators) {
    if (separator !== separators[0]) return false;
  }

  const lead = groups[0] ?? '';
  if (lead.length < 1 || lead.length > 3) return false;

  for (let index = 1; index < groups.length; index += 1) {
    if ((groups[index] ?? '').length !== 3) return false;
  }
  return true;
}

/** `1,299` is 1299 in London and 1.299 in Berlin, so both readings are kept. */
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
  if (isGrouping(groups, separators)) forms.push(canonical(groups.join(''), ''));

  const whole = groups.slice(0, -1);
  const leading = separators.slice(0, -1);
  const point = separators[separators.length - 1];
  if (isGrouping(whole, leading) && leading[0] !== point) {
    forms.push(canonical(whole.join(''), groups[groups.length - 1] ?? ''));
  }
  return forms;
}

export function numeralsIn(text: string): Numeral[] {
  const found: Numeral[] = [];
  for (const match of text.matchAll(new RegExp(TOKEN, 'gu'))) {
    found.push({ token: match[0], forms: formsOf(match[0]) });
  }
  return found;
}

/** Every reading of every numeral the host stands behind. */
export function supportedValues(values: readonly (string | number)[]): Set<string> {
  const supported = new Set<string>();
  for (const value of values) {
    for (const numeral of numeralsIn(String(value))) {
      for (const form of numeral.forms) supported.add(form);
    }
  }
  return supported;
}
