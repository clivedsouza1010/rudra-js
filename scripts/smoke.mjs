#!/usr/bin/env node
/**
 * Contract smoke test.
 *
 * Runs the documented sample payload through the real generator and asserts the
 * guarantees the README makes about reconciliation. It uses the fallback path
 * (no provider), so it needs no API key and no network — which also means it
 * checks the path that has to hold when the model is unavailable.
 *
 *   npm run build && npm run smoke
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createGenerator, parseTrackingInput, buildDigest } = await import(
  join(root, 'packages/core/dist/index.js')
);

const input = JSON.parse(readFileSync(join(root, 'docs/sample-tracking-input.json'), 'utf8'));

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// 1. The documented payload satisfies the contract.
const parsed = parseTrackingInput(input);
console.log('parse                : OK');

// 2. The digest derives the signals the prompt and the fallback both rely on.
const digest = buildDigest(parsed);
console.log('cold start           :', digest.isColdStart);
console.log('category affinity    :', digest.categoryAffinity.map((a) => `${a.category}=${a.score}`).join(' '));
console.log('interaction types    :', digest.interactionCounts.map((i) => `${i.type}×${i.count}`).join(' '));
check(digest.isColdStart === false, 'digest reported cold start on a payload with signals');
check(digest.categoryAffinity[0]?.category === 'Trail Running', 'strongest affinity should be Trail Running');

// 3. A generator with no provider still produces a renderable component.
const spec = await createGenerator().generate(input);
const placed = spec.blocks.flatMap((block) =>
  block.kind === 'grid' || block.kind === 'carousel' ? block.items.map((item) => item.sku) : [],
);

console.log('\nheadline             :', spec.headline, spec.subheadline ? `| ${spec.subheadline}` : '');
console.log('source               :', `${spec.source} (${spec.latencyMs}ms)`);
console.log('placed SKUs          :', placed.join(', ') || '(none)');

check(spec.source === 'fallback', 'a provider-less generator must report source=fallback');
check(spec.blocks.length > 0, 'fallback produced no blocks');
check(placed.length > 0, 'fallback placed no products');

// 4. The reconciliation guarantees the README claims.
check(!placed.includes('OW-303'), 'disliked SKU OW-303 was placed');
check(!placed.includes('OW-304'), 'out-of-stock SKU OW-304 was placed');
check(!placed.includes('TR-104'), 'the currently-viewed SKU TR-104 was placed');
check(!placed.includes('TR-101'), 'already-purchased SKU TR-101 was placed');
check(!placed.includes('NU-501'), 'SKU already in the cart was placed');
check(placed.length <= parsed.context.maxItems, `maxItems exceeded: ${placed.length} > ${parsed.context.maxItems}`);
check(new Set(placed).size === placed.length, 'the same SKU was placed twice');
check(
  placed.every((sku) => parsed.candidates.some((candidate) => candidate.sku === sku)),
  'a placed SKU was not in the candidate set',
);

if (failures.length > 0) {
  console.error('\nFAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nOK — all contract guarantees hold');
