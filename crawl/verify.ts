import { checkCrawlable } from './check-crawlable.js';
import { isEntryPoint } from './entry-point.js';
import { FALLBACK_MARKER, PAGE_PATH } from './page.js';
import { startShop, stopShop, freePort } from './shop-server.js';
import { reportFailure } from './verify-messages.js';

async function main(): Promise<void> {
  const port = await freePort();
  const { shop, ready, seen } = startShop(port);

  try {
    await ready;
    const response = await fetch(`http://localhost:${port}${PAGE_PATH}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`the shop answered ${response.status}`);

    const html = await response.text();

    if (html.includes(FALLBACK_MARKER)) {
      throw new Error('the shop served the deterministic fallback, so this checked the wrong page');
    }

    const problems = checkCrawlable(html);
    if (problems.length > 0) {
      console.error('the page is not what a crawler needs:');
      for (const problem of problems) console.error(`  - ${problem}`);
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
    await stopShop(shop);
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) await main();
