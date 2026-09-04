import { describe, expect, it } from 'vitest';
import { checkCrawlable } from './check-crawlable.js';

// A page the way the shop serves it today: the slot is written in place.
const GOOD = `<!DOCTYPE html><html><body><main>
<h1>Trail Shoe</h1>
<section class="rudra" data-rudra-slot="recommendations"><h2>Picked for you</h2></section>
</main></body></html>`;

// What React sends once a Suspense boundary sits above the slot: a shell, the
// content parked at the end inside a hidden div, and a script to move it.
const DEFERRED = `<!DOCTYPE html><html><body><main>
<h1>Trail Shoe</h1>
<!--$?--><template id="B:0"></template><!--/$-->
</main>
<div hidden id="S:0"><section class="rudra" data-rudra-slot="recommendations"><h2>Picked for you</h2></section></div>
<script>$RC("B:0","S:0")</script>
</body></html>`;

// The same deferral one level up, which is what a route-level loading.tsx
// does: the whole <main> goes into the hidden div, so the slot arrives before
// its own </main> and the position check passes. Trimmed from what react-dom
// 19.2.8 actually streams; only the markers give this page away.
const DEFERRED_ABOVE_MAIN = `<!DOCTYPE html><html><head></head><body><!--$?--><template id="B:0"></template><div>Loading…</div><!--/$-->
<div hidden id="S:0"><main><h1>Trail Shoe</h1><section class="rudra" data-rudra-slot="recommendations"><h2>Picked for you</h2></section></main></div>
<script>$RC("B:0","S:0")</script>
</body></html>`;

describe('checking a page a crawler will read', () => {
  it('passes a page that writes the slot in place', () => {
    expect(checkCrawlable(GOOD)).toEqual([]);
  });

  it('catches every way a deferred page is wrong', () => {
    const problems = checkCrawlable(DEFERRED);

    expect(problems).toEqual([
      'the slot is after </main>, so it is not in position',
      'the page holds content in a hidden div for a script to move',
      'the page uses a script to move content into place',
    ]);
  });

  it('catches a page that defers the whole <main>, where the slot is still before </main>', () => {
    const problems = checkCrawlable(DEFERRED_ABOVE_MAIN);

    expect(problems).toEqual([
      'the page holds content in a hidden div for a script to move',
      'the page uses a script to move content into place',
    ]);
  });

  it('catches a slot that arrives after the main content on its own', () => {
    const late = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main>
<section class="rudra" data-rudra-slot="recommendations"></section></body></html>`;

    expect(checkCrawlable(late)).toEqual(['the slot is after </main>, so it is not in position']);
  });

  it('says so when the slot is missing altogether', () => {
    const empty = '<!DOCTYPE html><html><body><main></main></body></html>';

    expect(checkCrawlable(empty)).toEqual(['the page has no recommendation slot at all']);
  });

  it('says so when the page has no </main> at all, so position cannot be judged', () => {
    const noMain = `<!DOCTYPE html><html><body>
<h1>Trail Shoe</h1>
<section class="rudra" data-rudra-slot="recommendations"><h2>Picked for you</h2></section>
</body></html>`;

    expect(checkCrawlable(noMain)).toEqual([
      'the page has no </main>, so the slot position cannot be checked',
    ]);
  });
});
