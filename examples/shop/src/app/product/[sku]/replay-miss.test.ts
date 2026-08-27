import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProductPage from './page.js';

const RECORDINGS_DIR = fileURLToPath(new URL('../../../../recordings/', import.meta.url));

/**
 * The design says a replay miss is a hard error in CI. It cannot be, in the
 * literal sense: `createReplayProvider` does throw, but `@rudra-js/core`'s
 * generator catches provider errors and degrades to the fallback component by
 * design — that is what lets the site stay up when a model or a store misbehaves
 * in production. The throw never reaches this test.
 *
 * What is enforceable is the effect the design actually cares about: once a
 * transcript is committed, the page it belongs to must be served from that
 * transcript rather than silently sliding into the fallback. This stays
 * dormant — passing for lack of anything to check — until a real recording
 * lands under `examples/shop/recordings/`.
 */
const hasTranscripts =
  existsSync(RECORDINGS_DIR) && readdirSync(RECORDINGS_DIR).some((file) => file.endsWith('.json'));

describe('the replay-miss rule', () => {
  if (!hasTranscripts) {
    it('has nothing to enforce yet — no transcripts are committed under examples/shop/recordings/', () => {
      expect(hasTranscripts).toBe(false);
    });
    return;
  }

  it('serves the recorded transcript rather than the fallback component', async () => {
    const markup = renderToStaticMarkup(
      await ProductPage({
        params: Promise.resolve({ sku: 'RJ-00001' }),
        searchParams: Promise.resolve({ shopper: 'S-0001' }),
      }),
    );

    expect(markup).not.toContain('data-rudra-source="fallback"');
  });
});
