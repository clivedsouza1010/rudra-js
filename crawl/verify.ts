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
// checks get written. We match the printed address rather than a bare word
// like "Ready" — that word can show up in an unrelated line before the
// server actually binds, and matching the address also proves next bound
// the port we asked for, not some other one.
function waitUntilReady(shop: ChildProcess, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the shop did not start within 60 seconds')),
      60_000,
    );
    let seen = '';
    const boundAddress = `http://localhost:${port}`;

    const read = (chunk: Buffer): void => {
      seen += chunk.toString();
      if (seen.includes(boundAddress)) {
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

// SIGTERM asks nicely; a shop that ignores it (or is stuck) would otherwise
// hang the parent forever, since the piped stdio keeps the event loop alive.
// Escalate to SIGKILL after a short grace so cleanup always finishes.
function stopShop(shop: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (shop.exitCode !== null || shop.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => {
      shop.kill('SIGKILL');
    }, 5_000);
    shop.once('exit', () => {
      clearTimeout(escalate);
      resolve();
    });
    shop.kill('SIGTERM');
  });
}

async function main(): Promise<void> {
  const port = await freePort();
  const shop = startShop(port);

  try {
    await waitUntilReady(shop, port);
    // A stalled connection would otherwise hang the script forever. One
    // deadline for the whole exchange: if it fires after fetch resolves,
    // aborting the signal also errors the body stream, so the reads below
    // are bounded by the same timeout without needing one of their own.
    const response = await fetch(`http://localhost:${port}${PATH}`, {
      // Ask for the bytes uncompressed. Node's fetch otherwise sends
      // "accept-encoding: gzip, deflate" and next start compresses, so the
      // chunk boundaries we would see are zlib's, not the server's.
      headers: { 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`the shop answered ${response.status}`);
    if (!response.body) throw new Error('the shop sent no body');

    // The first read is what a crawler taking one read would see — but one
    // read is not one server flush: small writes can arrive coalesced into
    // a single read, and a large flush (seen splitting around 64KB while
    // testing this) can arrive split across several. So this sub-check only
    // bites on a page big enough to span reads; it proves nothing about a
    // page, like this one, that fits in a single read regardless.
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

    // Only claims what checkCrawlable actually established above: the slot
    // is present, it is before </main>, and nothing hides it behind a
    // script. Not a claim about which read it arrived in — see the comment
    // by the first read for why that would overclaim on a page this size.
    console.log('crawlable: the slot is in the page, before </main>, and nothing hides it');
  } finally {
    // Always, including when the check failed or the fetch threw.
    await stopShop(shop);
  }
}

await main();
