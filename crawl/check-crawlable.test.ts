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

describe('checking a page a crawler will read', () => {
  it('passes a page that writes the slot in place', () => {
    expect(checkCrawlable(GOOD, GOOD)).toEqual([]);
  });

  it('catches every way a deferred page is wrong', () => {
    const problems = checkCrawlable(DEFERRED, DEFERRED);

    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toContain('after </main>');
    expect(problems.join(' ')).toContain('hidden');
    expect(problems.join(' ')).toContain('script');
  });

  it('catches a slot that arrives after the main content on its own', () => {
    const late = `<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1></main>
<section class="rudra" data-rudra-slot="recommendations"></section></body></html>`;

    expect(checkCrawlable(late, late)).toEqual([
      'the slot is after </main>, so it is not in position',
    ]);
  });

  it('catches a slot missing from the first chunk', () => {
    const firstChunk = '<!DOCTYPE html><html><body><main><h1>Trail Shoe</h1>';

    expect(checkCrawlable(GOOD, firstChunk)).toEqual([
      'the slot is not in the first chunk, so a crawler reading one read misses it',
    ]);
  });

  it('says so when the slot is missing altogether', () => {
    const empty = '<!DOCTYPE html><html><body><main></main></body></html>';

    expect(checkCrawlable(empty, empty)).toEqual(['the page has no recommendation slot at all']);
  });

  it('says so when the page has no </main> at all, so position cannot be judged', () => {
    const noMain = `<!DOCTYPE html><html><body>
<h1>Trail Shoe</h1>
<section class="rudra" data-rudra-slot="recommendations"><h2>Picked for you</h2></section>
</body></html>`;

    expect(checkCrawlable(noMain, noMain)).toEqual([
      'the page has no </main>, so the slot position cannot be checked',
    ]);
  });
});
