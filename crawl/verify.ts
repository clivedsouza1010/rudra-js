import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { checkCrawlable } from './check-crawlable.js';

// The page the committed transcript covers. Any other page is a replay miss,
// which fails for a reason that has nothing to do with crawling.
const PATH = '/product/RJ-00001?shopper=S-0001';

// Ask the operating system for a free port, then hand that number to next.
// PORT=0 is not something `next start` is documented to accept, so pick the
// port here rather than hoping.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not work out a free port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

function startShop(port: number): ChildProcess {
  const environment: NodeJS.ProcessEnv = { ...process.env, RUDRA_REPLAY_ONLY: '1' };
  // Present but empty. Next only fills a key in from .env.local when it is
  // missing, and the shop reads an empty one as no key at all.
  environment['ANTHROPIC_API_KEY'] = '';

  return spawn(
    'npm',
    ['run', 'start', '--workspace', '@rudra-js/example-shop', '--', '-p', String(port)],
    {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

// Wait for next to say it is listening. Sleeping a fixed time is how flaky
// checks get written.
function waitUntilReady(shop: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the shop did not start within 60 seconds')),
      60_000,
    );
    let seen = '';

    const read = (chunk: Buffer): void => {
      seen += chunk.toString();
      if (seen.includes('Ready') || seen.includes('started server')) {
        clearTimeout(timer);
        resolve();
      }
    };

    shop.stdout?.on('data', read);
    shop.stderr?.on('data', read);
    shop.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the shop exited with ${code} before serving anything:\n${seen}`));
    });
  });
}

async function main(): Promise<void> {
  const port = await freePort();
  const shop = startShop(port);

  try {
    await waitUntilReady(shop);
    const response = await fetch(`http://localhost:${port}${PATH}`);
    if (!response.ok) throw new Error(`the shop answered ${response.status}`);
    if (!response.body) throw new Error('the shop sent no body');

    // The first read is what a crawler taking one read would see.
    const reader = response.body.getReader();
    const first = await reader.read();
    const decoder = new TextDecoder();
    const firstChunk = first.value ? decoder.decode(first.value, { stream: true }) : '';

    let html = firstChunk;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      html += decoder.decode(next.value, { stream: true });
    }

    // A fallback page is still server-rendered, so every crawlability check
    // would pass while the page is not the one we meant to measure.
    if (html.includes('data-rudra-source="fallback"')) {
      throw new Error('the shop served the deterministic fallback, so this checked the wrong page');
    }

    const problems = checkCrawlable(html, firstChunk);
    if (problems.length > 0) {
      console.error('the page is not what a crawler needs:');
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }

    console.log('crawlable: the slot is in the first chunk, in position, and nothing hides it');
  } finally {
    // Always, including when the check failed or the fetch threw.
    shop.kill('SIGTERM');
  }
}

await main();
