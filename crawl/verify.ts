import { checkCrawlable } from './check-crawlable.js';
import { startShop, stopShop, freePort } from './shop-server.js';
import { reportFailure } from './verify-messages.js';

// The page the committed transcript covers. Any other page is a replay miss,
// which fails for a reason that has nothing to do with crawling.
const PAGE_PATH = '/product/RJ-00001?shopper=S-0001';

async function main(): Promise<void> {
  const port = await freePort();
  const { shop, ready, seen } = startShop(port);

  try {
    await ready;
    // A stalled connection would otherwise hang the script forever. One
    // deadline for the whole exchange: aborting errors the body stream too, so
    // reading it below is bounded by the same signal.
    const response = await fetch(`http://localhost:${port}${PAGE_PATH}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`the shop answered ${response.status}`);

    const html = await response.text();

    // A fallback page is still server-rendered, so every crawlability check
    // would pass while the page is not the one we meant to measure.
    if (html.includes('data-rudra-source="fallback"')) {
      throw new Error('the shop served the deterministic fallback, so this checked the wrong page');
    }

    const problems = checkCrawlable(html);
    if (problems.length > 0) {
      console.error('the page is not what a crawler needs:');
      for (const problem of problems) console.error(`  - ${problem}`);
      // The usual cause, in plain terms rather than React's own vocabulary.
      console.error(
        'this usually means a loading.tsx got added, or the recommendations got wrapped in <Suspense>',
      );
      process.exitCode = 1;
      return;
    }

    console.log('crawlable: the slot is in the page, before </main>, and nothing hides it');
  } catch (error) {
    reportFailure(error, seen());
    process.exitCode = 1;
  } finally {
    // Always, including when the check failed or the fetch threw.
    await stopShop(shop);
    // A grandchild that outlived the kill still holds the other end. Dropping
    // our end is what lets the process exit rather than waiting on it.
    shop.stdout?.destroy();
    shop.stderr?.destroy();
    shop.unref();
  }
}

await main();
