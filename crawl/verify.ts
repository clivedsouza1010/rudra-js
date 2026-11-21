import { checkCrawlable } from './check-crawlable.js';
import { isEntryPoint } from './entry-point.js';
import { startDemo, stopDemo, freePort } from './demo-server.js';

const PAGE_PATH = '/product/RJ-00001?shopper=S-0001';

const SAFE_BUILD_LINE =
  'ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-demo';

export function reportFailure(error: unknown, seen: string): void {
  console.error(error instanceof Error ? error.message : String(error));

  const demoSaid = seen.trim();
  if (demoSaid) console.error(`the demo said:\n${demoSaid}`);

  console.error(
    `if there is no production build yet, the safe way to make one is:\n  ${SAFE_BUILD_LINE}`,
  );
}

async function main(): Promise<void> {
  const port = await freePort();
  const { demo, ready, seen } = startDemo(port);

  try {
    await ready;
    const response = await fetch(`http://localhost:${port}${PAGE_PATH}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`the demo answered ${response.status}`);

    const html = await response.text();

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

    if (!/data-rudra-source="(llm|cache)"/.test(html)) {
      throw new Error(
        'the demo did not serve a model-made component, so this checked the wrong page',
      );
    }

    console.log('crawlable: the slot is in the page, before </main>, and nothing hides it');
  } catch (error) {
    reportFailure(error, seen());
    process.exitCode = 1;
  } finally {
    await stopDemo(demo);
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) await main();
