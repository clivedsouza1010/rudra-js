import { existsSync } from 'node:fs';
import { buildDigest, buildPrompt, parseTrackingInput } from '@rudra-js/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildTrackingInput } from '../../../fixtures/tracking-input';
import { transcriptPath } from '../../../provider/recording-provider';
import { MODEL_ID, RECORDINGS_DIRECTORY, getShopContext } from '../../../shop';
import ProductPage from './page';

const SKU = 'RJ-00001';
const SHOPPER = 'S-0001';

/**
 * The design says a replay miss is a hard error in CI. It cannot be, in the
 * literal sense: `createReplayProvider` does throw, but `@rudra-js/core`'s
 * generator catches provider errors and degrades to the fallback component by
 * design — that is what lets the site stay up when a model or a store misbehaves
 * in production. The throw never reaches this test.
 *
 * What is enforceable is the effect the design actually cares about: once a
 * transcript is committed, the page it belongs to must be served from that
 * transcript rather than silently sliding into the fallback.
 *
 * So this arms on the transcript for *this* page, found the way the replay
 * provider finds it, rather than on any JSON under `recordings/`. Recording a
 * different page — which is what the first `?shopper=` other than this one
 * does — would otherwise fail this test for a reason unrelated to the rule it
 * enforces, and a test that fails for the wrong reason gets weakened rather
 * than read.
 *
 * If core ever changes how a prompt is written, this name changes with it and
 * the guard goes dormant again. That is the honest answer: the committed
 * transcript would no longer be replayable for this page either.
 */
const { catalog, findShopper } = getShopContext();
const input = parseTrackingInput(buildTrackingInput(findShopper(SHOPPER), SKU, catalog));
const transcript = transcriptPath(
  RECORDINGS_DIRECTORY,
  MODEL_ID,
  buildPrompt(input, buildDigest(input)),
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
