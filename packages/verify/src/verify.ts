import { numeralsIn, supportedValues } from './numerals.js';
import { BANNED_PHRASES, normalisePhrasing, phraseIn } from './phrases.js';

// Two layers, reported apart, because only one of them is a proof.

export type Layer = 'quantity' | 'wording';

export interface Finding {
  layer: Layer;
  /** The numeral as the text wrote it, or the phrase as the denylist holds it. */
  token: string;
  /** Audit evidence. Names the layer and the token. */
  reason: string;
}

export interface LayerReport {
  supported: boolean;
  /** What this layer's verdict is worth. Only `quantity` is a proof. */
  strength: 'proof' | 'best-effort';
  /** Numerals found, or phrases screened against. Zero means nothing was checked. */
  checked: number;
  /** One per distinct token that failed. */
  findings: Finding[];
}

export interface VerifyResult {
  /** True when both layers are. */
  supported: boolean;
  quantity: LayerReport;
  wording: LayerReport;
}

export interface Facts {
  /** In any shape they are written: `39`, `'$1,299.00'`, `'4,8'`. Every numeral in one counts. */
  values: readonly (string | number)[];
  /** Claims to ban on top of the built-in English list, for the host's own language. */
  bannedPhrases?: readonly string[];
}

export interface FieldResult {
  field: string;
  result: VerifyResult;
}

export interface BatchResult {
  /** True when every field is. */
  supported: boolean;
  fields: FieldResult[];
}

function phrasesOf(facts: Facts): string[] {
  const phrases = new Set<string>(BANNED_PHRASES);
  for (const phrase of facts.bannedPhrases ?? []) {
    const normalised = normalisePhrasing(phrase);
    if (normalised.length > 0) phrases.add(normalised);
  }
  return [...phrases];
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
    findings.push({
      layer: 'quantity',
      token: numeral.token,
      reason: `quantity: "${numeral.token}" is not a value the supplied facts carry`,
    });
  }

  return {
    supported: findings.length === 0,
    strength: 'proof',
    checked: numerals.length,
    findings,
  };
}

function checkWording(text: string, phrases: string[]): LayerReport {
  const normalised = normalisePhrasing(text);
  const findings: Finding[] = [];

  for (const phrase of phrases) {
    if (!phraseIn(normalised, phrase)) continue;

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

function check(text: string, supported: Set<string>, phrases: string[]): VerifyResult {
  const quantity = checkQuantities(text, supported);
  const wording = checkWording(text, phrases);
  return { supported: quantity.supported && wording.supported, quantity, wording };
}

/** Whether one piece of model-written text stands on the facts the host supplied. */
export function verify(text: string, facts: Facts): VerifyResult {
  return check(text, supportedValues(facts.values), phrasesOf(facts));
}

/** The same check over every field of one product, without repeating the facts. */
export function verifyFields(fields: Record<string, string>, facts: Facts): BatchResult {
  const supported = supportedValues(facts.values);
  const phrases = phrasesOf(facts);

  const results: FieldResult[] = [];
  let allSupported = true;
  for (const field of Object.keys(fields)) {
    const result = check(fields[field] ?? '', supported, phrases);
    if (!result.supported) allSupported = false;
    results.push({ field, result });
  }

  return { supported: allSupported, fields: results };
}
