import { describe, expect, it } from 'vitest';
import { verify, verifyFields } from './verify.js';

const NOTHING = { values: [] };

function tokensOf(findings: { token: string }[]): string[] {
  const out: string[] = [];
  for (const finding of findings) out.push(finding.token);
  return out;
}

describe('verify — the quantity layer', () => {
  it('supports a number the host stands behind', () => {
    const result = verify('Yours for $39', { values: [39] });
    expect(result.supported).toBe(true);
    expect(result.quantity.findings).toEqual([]);
  });

  it('rejects a number the host never supplied', () => {
    const result = verify('Only 2 left', { values: [39] });
    expect(result.supported).toBe(false);
    expect(result.quantity.supported).toBe(false);
    expect(result.quantity.findings).toEqual([
      {
        layer: 'quantity',
        token: '2',
        reason: 'quantity: "2" is not a value the supplied facts carry',
      },
    ]);
  });

  it('rejects every number it cannot stand behind, not just the first', () => {
    const result = verify('Was 60, now 39', { values: [39] });
    expect(tokensOf(result.quantity.findings)).toEqual(['60']);

    const both = verify('Was 60, now 45', { values: [39] });
    expect(tokensOf(both.quantity.findings)).toEqual(['60', '45']);
  });

  it('names an unsupported token once, however often it is written', () => {
    const result = verify('Only 2 left, just 2 remaining', NOTHING);
    expect(tokensOf(result.quantity.findings)).toEqual(['2']);
  });

  it('counts what it checked, so a check that checked nothing is visible', () => {
    expect(verify('Was 60, now 39', { values: [39, 60] }).quantity.checked).toBe(2);
    expect(verify('Built for long days', NOTHING).quantity.checked).toBe(0);
  });

  it('passes text with no number in it', () => {
    const result = verify('Built for long days on the trail', NOTHING);
    expect(result.supported).toBe(true);
  });

  it('reads the host facts in any shape they were written', () => {
    expect(verify('$1,299', { values: ['USD 1299.00'] }).supported).toBe(true);
    expect(verify('1.299 Euro', { values: [1299] }).supported).toBe(true);
  });

  it('does not care what language the sentence is in', () => {
    expect(verify('Nur noch 2 übrig', { values: [2] }).quantity.supported).toBe(true);
    expect(verify('Nur noch 2 übrig', { values: [39] }).quantity.supported).toBe(false);
    expect(verify('4,8 von 5', { values: [4.8, 5] }).quantity.supported).toBe(true);
    expect(verify('4,8 von 5', { values: [5] }).quantity.supported).toBe(false);
  });

  it('matches a decimal the host wrote with the other separator', () => {
    expect(verify('4,8 stars', { values: ['4.8'] }).quantity.supported).toBe(true);
  });

  it('reads a numeral the host wrote in another script', () => {
    expect(verify('٣٩ euro', { values: [39] }).quantity.supported).toBe(true);
  });

  it('calls the quantity layer a proof', () => {
    expect(verify('anything', NOTHING).quantity.strength).toBe('proof');
  });
});

describe('verify — the wording layer', () => {
  it('rejects a claim with no value to check', () => {
    const result = verify('Selling fast', NOTHING);
    expect(result.supported).toBe(false);
    expect(result.wording.supported).toBe(false);
    expect(result.wording.findings).toEqual([
      {
        layer: 'wording',
        token: 'selling fast',
        reason:
          'wording: "selling fast" is a claim with no value to check, caught by a best-effort denylist',
      },
    ]);
  });

  it('catches a claim across a hyphen and a line break', () => {
    expect(verify('a best-selling shoe', NOTHING).wording.supported).toBe(false);
    expect(verify('selling\nfast', NOTHING).wording.supported).toBe(false);
  });

  it('takes a phrase the host added for their own language', () => {
    const facts = { values: [], bannedPhrases: ['nur noch'] };
    expect(verify('Nur noch wenige', facts).wording.supported).toBe(false);
    expect(verify('Nur noch wenige', NOTHING).wording.supported).toBe(true);
  });

  it('keeps the built-in list when the host adds one', () => {
    expect(verify('selling fast', { values: [], bannedPhrases: ['nur noch'] }).supported).toBe(
      false,
    );
  });

  it('normalises a phrase the host added', () => {
    // Not a built-in, or the built-in list would catch it and this would prove nothing.
    const facts = { values: [], bannedPhrases: ['NUR-NOCH'] };
    expect(verify('Nur noch wenige', facts).wording.supported).toBe(false);
  });

  it('counts the phrases it screened against', () => {
    const plain = verify('anything', NOTHING).wording.checked;
    const added = verify('anything', { values: [], bannedPhrases: ['nur noch'] }).wording.checked;
    expect(plain).toBeGreaterThan(20);
    expect(added).toBe(plain + 1);
  });

  it('calls the wording layer best-effort, because that is what it is', () => {
    expect(verify('anything', NOTHING).wording.strength).toBe('best-effort');
  });

  it('reports the two layers apart', () => {
    const result = verify('Selling fast, only 2 left', NOTHING);
    expect(tokensOf(result.quantity.findings)).toEqual(['2']);
    expect(tokensOf(result.wording.findings)).toEqual(['selling fast']);
  });

  it('passes wording that claims nothing', () => {
    expect(verify('Built for long days on the trail', NOTHING).wording.supported).toBe(true);
  });
});

describe('verifyFields', () => {
  it('verifies every field against one set of facts', () => {
    const result = verifyFields(
      { headline: 'Yours for $39', badge: 'Only 2 left' },
      { values: [39] },
    );

    expect(result.supported).toBe(false);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]?.field).toBe('headline');
    expect(result.fields[0]?.result.supported).toBe(true);
    expect(result.fields[1]?.field).toBe('badge');
    expect(tokensOf(result.fields[1]?.result.quantity.findings ?? [])).toEqual(['2']);
  });

  it('is supported only when every field is', () => {
    const facts = { values: [39] };
    expect(verifyFields({ a: '$39', b: 'thirty nine' }, facts).supported).toBe(true);
    expect(verifyFields({ a: '$39', b: '$40' }, facts).supported).toBe(false);
  });

  it('is supported when there is nothing to verify', () => {
    expect(verifyFields({}, NOTHING)).toEqual({ supported: true, fields: [] });
  });
});
