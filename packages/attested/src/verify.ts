import { numeralsIn, supportedValues, type Numeral } from './numerals.js';
import {
  BANNED_PHRASES,
  indexPhrasing,
  normalisePhrasing,
  spansIn,
  type Indexed,
  type Span,
} from './phrases.js';

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

const cache = new WeakMap<object, { copy: readonly unknown[]; supported: Set<string> }>();

function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function supportedOf(facts: Facts): Set<string> {
  const values = facts.values;
  if (!Array.isArray(values)) return supportedValues(values);

  // The host may edit this array between calls, so reuse only a matching copy
  const cached = cache.get(values);
  if (cached !== undefined && sameValues(cached.copy, values)) return cached.supported;

  const supported = supportedValues(values);
  cache.set(values, { copy: [...values], supported });
  return supported;
}

function normaliseAll(phrases: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const phrase of phrases ?? []) {
    const normalised = normalisePhrasing(phrase);
    if (normalised.length > 0) out.push(normalised);
  }
  return out;
}

function bannedOf(facts: Facts): string[] {
  const banned = new Set(BANNED_PHRASES);
  for (const phrase of normaliseAll(facts.bannedPhrases)) banned.add(phrase);
  return [...banned];
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
    if (numeral.forms.some((form) => supported.has(form))) continue;
    if (reported.has(numeral.token)) continue;

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

function isInside(spans: Span[], hit: Span): boolean {
  for (const span of spans) {
    if (span.start <= hit.start && hit.end <= span.end) return true;
  }
  return false;
}

function checkWording(text: string, banned: string[], allowed: string[]): LayerReport {
  const plain = normalisePhrasing(text);
  const byLook = normalisePhrasing(text, true);
  const versions = byLook === plain ? [plain] : [plain, byLook];

  const scans: Indexed[] = [];
  const forgiven: Span[] = [];
  for (const version of versions) {
    const scan = indexPhrasing(version);
    scans.push(scan);
    for (const phrase of allowed) {
      for (const span of spansIn(scan, phrase)) {
        if (!version.slice(span.start, span.end + 1).includes('\n')) forgiven.push(span);
      }
    }
  }

  const findings: Finding[] = [];
  for (const phrase of banned) {
    let caught = false;
    for (const scan of scans) {
      for (const hit of spansIn(scan, phrase)) {
        if (!isInside(forgiven, hit)) caught = true;
      }
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
    checked: banned.length,
    findings,
  };
}

function check(
  text: string,
  supported: Set<string>,
  banned: string[],
  allowed: string[],
): VerifyResult {
  const quantity = checkQuantities(text, supported);
  const wording = checkWording(text, banned, allowed);
  return { supported: quantity.supported && wording.supported, quantity, wording };
}

export function verify(text: string, facts: Facts): VerifyResult {
  return check(text, supportedOf(facts), bannedOf(facts), normaliseAll(facts.allowedPhrases));
}

export function verifyFields(fields: Record<string, string>, facts: Facts): BatchResult {
  const supported = supportedOf(facts);
  const banned = bannedOf(facts);
  const allowed = normaliseAll(facts.allowedPhrases);

  const results: FieldResult[] = [];
  const texts: string[] = [];
  let allSupported = true;
  for (const field of Object.keys(fields)) {
    const text = fields[field] ?? '';
    const result = check(text, supported, banned, allowed);
    if (!result.supported) allSupported = false;
    results.push({ field, result });
    texts.push(text);
  }

  const acrossFields = checkWording(texts.join(' '), banned, allowed);
  return { supported: allSupported && acrossFields.supported, fields: results, acrossFields };
}
