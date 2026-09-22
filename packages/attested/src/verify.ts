import { numeralsIn, supportedValues, type Numeral } from './numerals.js';
import { BANNED_PHRASES, indexPhrasing, normalisePhrasing, spansIn, type Span } from './phrases.js';

export type Layer = 'quantity' | 'wording';

export interface Finding {
  layer: Layer;

  token: string;

  reason: string;
}

export interface LayerReport {
  supported: boolean;

  strength: 'proof' | 'best-effort';

  checked: number;

  findings: Finding[];
}

export interface VerifyResult {
  supported: boolean;
  quantity: LayerReport;
  wording: LayerReport;
}

export interface Facts {
  values: readonly (string | number | bigint)[];

  bannedPhrases?: readonly string[];

  allowedPhrases?: readonly string[];
}

export interface FieldResult {
  field: string;
  result: VerifyResult;
}

export interface BatchResult {
  supported: boolean;
  fields: FieldResult[];

  acrossFields: LayerReport;
}

const readings = new WeakMap<object, { held: readonly unknown[]; supported: Set<string> }>();

function unchanged(held: readonly unknown[], values: readonly unknown[]): boolean {
  if (held.length !== values.length) return false;
  for (let i = 0; i < held.length; i += 1) {
    if (held[i] !== values[i]) return false;
  }
  return true;
}

function valuesOf(facts: Facts): Set<string> {
  const values = facts.values;

  if (!Array.isArray(values)) return supportedValues(values);

  const read = readings.get(values);
  if (read !== undefined && unchanged(read.held, values)) return read.supported;

  const supported = supportedValues(values);
  readings.set(values, { held: [...values], supported });
  return supported;
}

function phrasesOf(facts: Facts): string[] {
  const phrases = new Set<string>(BANNED_PHRASES);

  for (const phrase of facts.bannedPhrases ?? []) {
    const normalised = normalisePhrasing(phrase);
    if (normalised.length > 0) phrases.add(normalised);
  }
  return [...phrases];
}

function allowedOf(facts: Facts): string[] {
  const allowed: string[] = [];
  for (const phrase of facts.allowedPhrases ?? []) {
    const normalised = normalisePhrasing(phrase);
    if (normalised.length > 0) allowed.push(normalised);
  }
  return allowed;
}

function reasonFor(numeral: Numeral): string {
  if (numeral.kind === 'other-numeral') {
    return `quantity: "${numeral.token}" is a numeric character this layer cannot read, so no fact can back it`;
  }
  if (numeral.kind === 'magnitude') {
    return `quantity: "${numeral.token}" ends in a magnitude mark this layer cannot read, so the value it shows is unchecked`;
  }
  return `quantity: "${numeral.token}" is not a value the supplied facts carry`;
}

function checkQuantities(text: string, supported: Set<string>): LayerReport {
  const numerals = numeralsIn(text);
  const findings: Finding[] = [];
  const reported = new Set<string>();

  for (const numeral of numerals) {
    let backed = false;
    for (const form of numeral.forms) {
      if (supported.has(form)) backed = true;
    }
    if (backed || reported.has(numeral.token)) continue;

    reported.add(numeral.token);
    findings.push({ layer: 'quantity', token: numeral.token, reason: reasonFor(numeral) });
  }

  return {
    supported: findings.length === 0,
    strength: 'proof',
    checked: numerals.length,
    findings,
  };
}

function standsBehind(allowed: Span[], hit: Span): boolean {
  for (const span of allowed) {
    if (span.start <= hit.start && hit.end <= span.end) return true;
  }
  return false;
}

function checkWording(text: string, phrases: string[], allowed: string[]): LayerReport {
  const normalised = normalisePhrasing(text);
  const indexed = indexPhrasing(normalised);

  const spans: Span[] = [];
  for (const phrase of allowed) {
    for (const span of spansIn(indexed, phrase)) {
      if (!normalised.slice(span.start, span.end + 1).includes('\n')) spans.push(span);
    }
  }

  const findings: Finding[] = [];
  for (const phrase of phrases) {
    let caught = false;
    for (const hit of spansIn(indexed, phrase)) {
      if (!standsBehind(spans, hit)) caught = true;
    }
    if (!caught) continue;

    findings.push({
      layer: 'wording',
      token: phrase,
      reason: `wording: "${phrase}" is a claim with no value to check, caught by a best-effort denylist`,
    });
  }

  return {
    supported: findings.length === 0,
    strength: 'best-effort',
    checked: phrases.length,
    findings,
  };
}

function check(
  text: string,
  supported: Set<string>,
  phrases: string[],
  allowed: string[],
): VerifyResult {
  const quantity = checkQuantities(text, supported);
  const wording = checkWording(text, phrases, allowed);
  return { supported: quantity.supported && wording.supported, quantity, wording };
}

export function verify(text: string, facts: Facts): VerifyResult {
  return check(text, valuesOf(facts), phrasesOf(facts), allowedOf(facts));
}

export function verifyFields(fields: Record<string, string>, facts: Facts): BatchResult {
  const supported = valuesOf(facts);
  const phrases = phrasesOf(facts);
  const allowed = allowedOf(facts);

  const results: FieldResult[] = [];
  const written: string[] = [];
  let allSupported = true;
  for (const field of Object.keys(fields)) {
    const text = fields[field] ?? '';
    const result = check(text, supported, phrases, allowed);
    if (!result.supported) allSupported = false;
    results.push({ field, result });
    written.push(text);
  }

  const acrossFields = checkWording(written.join(' '), phrases, allowed);

  return { supported: allSupported && acrossFields.supported, fields: results, acrossFields };
}
