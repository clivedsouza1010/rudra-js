import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { checkCrawlable } from './check-crawlable.js';
import { exitedBeforeServing, reportFailure } from './verify-messages.js';

// The page the committed transcript covers. Any other page is a replay miss,
// which fails for a reason that has nothing to do with crawling.
const PAGE_PATH = '/product/RJ-00001?shopper=S-0001';

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
      // Its own group, so stopping it reaches next and not only npm.
      detached: true,
    },
  );
}

type ReadinessWatcher = { ready: Promise<void>; onData: () => void };

// A Promise executor runs synchronously, so this is always overwritten right below - TS just can't see that.
function noop(): void {}

// Sleeping a fixed time is how flaky checks get written, so wait for next to
// print the address instead: a bare word like "Ready" can show up before the
// server actually binds, and the address also proves next bound the port we
// asked for, not some other one.
//
// Hands back onData instead of attaching its own listener, so main's single listener always appends first.
function waitUntilReady(shop: ChildProcess, port: number, getSeen: () => string): ReadinessWatcher {
  let resolveReady: () => void = noop;
  let rejectReady: (error: Error) => void = noop;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(
    () => rejectReady(new Error('the shop did not start within 60 seconds')),
    60_000,
  );
  const boundAddress = `http://localhost:${port}`;

  const onData = (): void => {
    if (getSeen().includes(boundAddress)) {
      clearTimeout(timer);
      resolveReady();
    }
  };

  shop.on('exit', (code) => {
    clearTimeout(timer);
    rejectReady(new Error(exitedBeforeServing(code)));
  });

  return { ready, onData };
}

// Signals the whole group, not just npm, so an npm that does not forward the
// signal cannot orphan next. The group can already be gone by the time we
// signal it, and that is fine - there is nothing left to stop.
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
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
    if (shop.pid === undefined) {
      resolve();
      return;
    }
    const pid = shop.pid;
    const escalate = setTimeout(() => {
      signalGroup(pid, 'SIGKILL');
    }, 5_000);
    shop.once('exit', () => {
      clearTimeout(escalate);
      resolve();
    });
    signalGroup(pid, 'SIGTERM');
  });
}

async function main(): Promise<void> {
  const port = await freePort();
  const shop = startShop(port);

  // Kept for the whole run, not just until the shop says it is ready, so any
  // failure after that point can still show what the shop said about it.
  let seen = '';
  const { ready, onData } = waitUntilReady(shop, port, () => seen);
  // One listener, so appending always happens before the ready check sees it.
  const remember = (chunk: Buffer): void => {
    seen += chunk.toString();
    onData();
  };
  shop.stdout?.on('data', remember);
  shop.stderr?.on('data', remember);

  try {
    await ready;
    // A stalled connection would otherwise hang the script forever. One
    // deadline for the whole exchange: aborting also errors the body stream,
    // so the reads below are bounded by it too, without needing one of their own.
    const response = await fetch(`http://localhost:${port}${PAGE_PATH}`, {
      // Uncompressed: next start compresses by default, and the chunk
      // boundaries we would see with gzip on are zlib's, not the server's.
      headers: { 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`the shop answered ${response.status}`);
    if (!response.body) throw new Error('the shop sent no body');

    // The first read is what a crawler taking one read would see — but one
    // read is not one server flush, so this sub-check only bites on a page
    // big enough to span reads. It proves nothing about a page, like this
    // one, that fits in a single read regardless.
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
      // The usual cause, in plain terms rather than React's own vocabulary.
      console.error(
        'this usually means a loading.tsx got added, or the recommendations got wrapped in <Suspense>',
      );
      process.exitCode = 1;
      return;
    }

    // Only claims what checkCrawlable actually established above: the slot
    // is present, it is before </main>, and nothing hides it behind a
    // script — not a claim about which read it arrived in.
    console.log('crawlable: the slot is in the page, before </main>, and nothing hides it');
  } catch (error) {
    reportFailure(error, seen);
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
