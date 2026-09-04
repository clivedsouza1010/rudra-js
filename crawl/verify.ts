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

type RunningShop = {
  shop: ChildProcess;
  ready: Promise<void>;
  // Everything the shop has said so far, kept for the whole run rather than
  // until it is ready, so a failure after that can still show what it said.
  seen: () => string;
};

function startShop(port: number): RunningShop {
  const environment: NodeJS.ProcessEnv = { ...process.env, RUDRA_REPLAY_ONLY: '1' };
  // Present but empty. Next only fills a key in from .env.local when it is
  // missing, and the shop reads an empty one as no key at all.
  environment['ANTHROPIC_API_KEY'] = '';

  const shop = spawn(
    'npm',
    ['run', 'start', '--workspace', '@rudra-js/example-shop', '--', '-p', String(port)],
    {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own group, so stopping it reaches next and not only npm.
      detached: true,
    },
  );

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(
    () => rejectReady(new Error('the shop did not start within 60 seconds')),
    60_000,
  );
  const boundAddress = `http://localhost:${port}`;

  // Sleeping a fixed time is how flaky checks get written, so wait for the one
  // line that names the address next actually bound.
  let seen = '';
  const remember = (chunk: Buffer): void => {
    seen += chunk.toString();
    if (seen.includes(boundAddress)) {
      clearTimeout(timer);
      resolveReady();
    }
  };
  shop.stdout?.on('data', remember);
  shop.stderr?.on('data', remember);

  shop.on('exit', (code, signal) => {
    clearTimeout(timer);
    rejectReady(new Error(exitedBeforeServing(code, signal)));
  });

  return { shop, ready, seen: () => seen };
}

// Signals the whole group, not just npm, so an npm that does not forward the
// signal cannot orphan next.
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

// SIGTERM asks nicely; a shop that ignores it (or is stuck) would otherwise
// hang the parent forever, since the piped stdio keeps the event loop alive.
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
