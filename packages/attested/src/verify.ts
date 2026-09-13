import { numeralsIn, supportedValues, type Numeral } from './numerals.js';
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
  /**
   * What this layer's verdict is worth. `proof` means every numeral in the text is
   * a value the host supplied — not that the sentence around it is true.
   */
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
  /** Claims to drop from the list, for a shop that stands behind them. Applied last. */
  allowedPhrases?: readonly string[];
}

export interface FieldResult {
  field: string;
  result: VerifyResult;
}

export interface BatchResult {
  /** True when every field is, and when the fields read as one carry no banned claim. */
  supported: boolean;
  fields: FieldResult[];
  /** The wording layer over every field joined, so a phrase split across two fields still reads. */
  acrossFields: LayerReport;
}

function phrasesOf(facts: Facts): string[] {
  const phrases = new Set<string>(BANNED_PHRASES);

  for (const phrase of facts.bannedPhrases ?? []) {
    const normalised = normalisePhrasing(phrase);
    if (normalised.length > 0) phrases.add(normalised);
  }
  for (const phrase of facts.allowedPhrases ?? []) {
    phrases.delete(normalisePhrasing(phrase));
  }

  return [...phrases];
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
  const written: string[] = [];
  let allSupported = true;
  for (const field of Object.keys(fields)) {
    const text = fields[field] ?? '';
    const result = check(text, supported, phrases);
    if (!result.supported) allSupported = false;
    results.push({ field, result });
    written.push(text);
  }

  // A card renders its fields next to each other, so `Free` and `delivery on every
  // order` are one sentence to a shopper even though neither field carries one.
  const acrossFields = checkWording(written.join(' '), phrases);

  return { supported: allSupported && acrossFields.supported, fields: results, acrossFields };
}
