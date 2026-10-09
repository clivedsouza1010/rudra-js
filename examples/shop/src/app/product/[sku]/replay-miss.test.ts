import { existsSync } from 'node:fs';
import { buildDigest, buildPrompt, parseTrackingInput, toCohortDigest } from '@rudra-js/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildTrackingInput } from '../../../fixtures/tracking-input';
import { transcriptPath } from '../../../provider/recording-provider';
import {
  MODEL_ID,
  RECORDINGS_DIRECTORY,
  bundles,
  catalog,
  findShopper,
} from '../../../shop-context';
import ProductPage from './page';

const SKU = 'RJ-00001';
const SHOPPER = 'S-0001';

const input = parseTrackingInput(buildTrackingInput(findShopper(SHOPPER), SKU, catalog, bundles));
const transcript = transcriptPath(
  RECORDINGS_DIRECTORY,
  MODEL_ID,
  buildPrompt(input, toCohortDigest(buildDigest(input))),
);
const hasTranscript = existsSync(transcript);

describe('the replay-miss rule', () => {
  it(`has a transcript committed for ${SKU} and ${SHOPPER}`, () => {
    expect(
      hasTranscript,
      `no transcript at ${transcript} — the prompt changed; delete the old file and re-record, see examples/shop/README.md`,
    ).toBe(true);
  });

  it('serves the recorded transcript rather than the fallback component', async () => {
    const markup = renderToStaticMarkup(
      await ProductPage({
        params: Promise.resolve({ sku: SKU }),
        searchParams: Promise.resolve({ shopper: SHOPPER }),
      }),
    );

    expect(markup).toMatch(/data-rudra-source="(llm|cache)"/);
  });
});
