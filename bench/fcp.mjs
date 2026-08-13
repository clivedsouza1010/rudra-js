#!/usr/bin/env node
/**
 * First Contentful Paint, Largest Contentful Paint, and time-to-recommendation.
 *
 * TTFB alone understates the difference between the two arms, because the cost
 * of client-side rendering is paid after the document arrives: parse, hydrate,
 * fetch, render. This script measures what the shopper actually experiences.
 *
 * The third metric is the one the manuscript calls "pop-in": how long after
 * navigation the recommendation content becomes visible. On the SSR arm it is
 * present at first paint. On the CSR arm it cannot appear before hydration and
 * a network round trip.
 *
 * Requires Playwright:
 *   npm install --workspace @rudra/bench
 *   npx playwright install chromium
 *
 * Usage:
 *   node bench/fcp.mjs --sku TR-104 --runs 10
 *   node bench/fcp.mjs --throttle slow-3g --json
 */

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error(
      '\nPlaywright is not installed.\n\n' +
        '  npm install --workspace @rudra/bench\n' +
        '  npx playwright install chromium\n\n' +
        'For TTFB and the server-payload content check, bench/ttfb.mjs needs no dependencies.\n',
    );
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = {
    base: 'http://localhost:3000',
    sku: 'TR-104',
    shopper: 'u-trail-regular',
    runs: 8,
    throttle: 'none',
    json: false,
    // Escape hatch for CI images that ship a browser Playwright did not
    // download itself. Also honours PLAYWRIGHT_CHROMIUM_EXECUTABLE.
    executable: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--json') {
      args.json = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) continue;
    switch (key) {
      case '--base': args.base = value; i += 1; break;
      case '--sku': args.sku = value; i += 1; break;
      case '--shopper': args.shopper = value; i += 1; break;
      case '--runs': args.runs = Number.parseInt(value, 10); i += 1; break;
      case '--throttle': args.throttle = value; i += 1; break;
      case '--executable': args.executable = value; i += 1; break;
      default: break;
    }
  }
  return args;
}

/**
 * Network profiles, so the comparison can be run under conditions where the
 * extra round trip actually costs something. A fast local connection flatters
 * client-side rendering in a way real traffic does not.
 */
const THROTTLE = {
  none: null,
  'fast-3g': { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  'slow-3g': { downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8, latency: 400 },
};

async function measureRun(browser, url, throttleProfile) {
  const context = await browser.newContext();
  const page = await context.newPage();

  // LCP is only observable through a PerformanceObserver — querying
  // `getEntriesByType` after load returns nothing, because the entry is not
  // retained in the default buffer. Install the observer before navigation.
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__lcp = Math.max(window.__lcp, entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  if (throttleProfile) {
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      ...throttleProfile,
    });
  }

  const navigationStart = Date.now();
  await page.goto(url, { waitUntil: 'commit' });

  // The recommendation region is considered visible once the generated
  // component is in the DOM. On the CSR arm that is only true after the
  // post-hydration fetch resolves.
  const recommendationsAt = page
    .waitForSelector('[data-rudra-slot]', { state: 'attached', timeout: 30_000 })
    .then(() => Date.now() - navigationStart)
    .catch(() => null);

  await page.waitForLoadState('networkidle');
  const timeToRecommendationsMs = await recommendationsAt;

  const paint = await page.evaluate(() => {
    const entries = performance.getEntriesByType('paint');
    const fcp = entries.find((entry) => entry.name === 'first-contentful-paint');
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: window.__lcp ? Math.round(window.__lcp) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      transferSize: nav ? nav.transferSize : null,
    };
  });

  await context.close();
  return { ...paint, timeToRecommendationsMs };
}

function summarise(values) {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    p50: sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    samples: clean.length,
  };
}

async function measureArm(browser, label, url, args) {
  const profile = THROTTLE[args.throttle];
  if (profile === undefined) throw new Error(`unknown throttle profile: ${args.throttle}`);

  // One discarded run to warm the server route and the generation cache.
  await measureRun(browser, url, profile);

  const runs = [];
  for (let i = 0; i < args.runs; i += 1) {
    runs.push(await measureRun(browser, url, profile));
  }

  return {
    label,
    url,
    fcpMs: summarise(runs.map((run) => run.fcp)),
    lcpMs: summarise(runs.map((run) => run.lcp)),
    domContentLoadedMs: summarise(runs.map((run) => run.domContentLoaded)),
    timeToRecommendationsMs: summarise(runs.map((run) => run.timeToRecommendationsMs)),
  };
}

function printTable(arms) {
  const pad = (value, width) => String(value).padEnd(width);
  const num = (value, width) => String(value).padStart(width);
  const p50 = (metric) => (metric ? `${metric.p50}ms` : 'n/a');

  console.log('');
  console.log(`${pad('arm', 26)}${num('FCP p50', 10)}${num('LCP p50', 10)}${num('DCL p50', 10)}${num('recs visible', 15)}`);
  console.log('-'.repeat(71));
  for (const arm of arms) {
    console.log(
      pad(arm.label, 26) +
        num(p50(arm.fcpMs), 10) +
        num(p50(arm.lcpMs), 10) +
        num(p50(arm.domContentLoadedMs), 10) +
        num(p50(arm.timeToRecommendationsMs), 15),
    );
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = await loadPlaywright();

  const query = `?shopper=${encodeURIComponent(args.shopper)}`;
  const targets = [
    { label: 'AI-driven SSR', url: `${args.base}/product/${args.sku}${query}` },
    { label: 'Client-side rendering', url: `${args.base}/product-csr/${args.sku}${query}` },
  ];

  if (!args.json) {
    console.log(`\nrudra-js paint benchmark`);
    console.log(`base=${args.base} sku=${args.sku} shopper=${args.shopper} runs=${args.runs} throttle=${args.throttle}`);
  }

  const browser = await chromium.launch({
    ...(args.executable ? { executablePath: args.executable } : {}),
    // Containers commonly run as root, where the Chromium sandbox refuses to start.
    args: ['--no-sandbox'],
  });
  try {
    const arms = [];
    for (const target of targets) {
      arms.push(await measureArm(browser, target.label, target.url, args));
    }

    if (args.json) {
      const meta = { base: args.base, sku: args.sku, shopper: args.shopper, runs: args.runs, throttle: args.throttle };
      console.log(JSON.stringify({ meta, arms }, null, 2));
    } else {
      printTable(arms);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nBenchmark failed:', error.message);
  console.error('Is the storefront running?  npm run dev  (or npm run build && npm start)\n');
  process.exit(1);
});
