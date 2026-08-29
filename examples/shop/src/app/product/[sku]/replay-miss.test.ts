import { existsSync } from 'node:fs';
import { buildDigest, buildPrompt, parseTrackingInput, toCohortDigest } from '@rudra-js/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildTrackingInput } from '../../../fixtures/tracking-input';
import { transcriptPath } from '../../../provider/recording-provider';
import { MODEL_ID, RECORDINGS_DIRECTORY, getShopContext } from '../../../shop-context';
import ProductPage from './page';

const SKU = 'RJ-00001';
const SHOPPER = 'S-0001';

/**
 * A replay miss cannot fail this test directly: the provider throws, but core's
 * generator catches provider errors and degrades by design. So this asserts the
 * effect instead — once a transcript exists for this page, the page must be
 * served from it. Armed on this page's own transcript, not on any JSON.
 */
const { catalog, findShopper } = getShopContext();
const input = parseTrackingInput(buildTrackingInput(findShopper(SHOPPER), SKU, catalog));
const transcript = transcriptPath(
  RECORDINGS_DIRECTORY,
  MODEL_ID,
  // The shop runs in cohort mode, so this is the prompt it actually sends.
  buildPrompt(input, toCohortDigest(buildDigest(input))),
);
const hasTranscript = existsSync(transcript);

describe('the replay-miss rule', () => {
  if (!hasTranscript) {
    it(`has nothing to enforce yet — no transcript is committed for ${SKU} and ${SHOPPER}`, () => {
      expect(hasTranscript).toBe(false);
    });
    return;
  }

  it('serves the recorded transcript rather than the fallback component', async () => {
    const markup = renderToStaticMarkup(
      await ProductPage({
        params: Promise.resolve({ sku: SKU }),
        searchParams: Promise.resolve({ shopper: SHOPPER }),
      }),
    );

    expect(markup).not.toContain('data-rudra-source="fallback"');
  });
});
