#!/usr/bin/env node
/**
 * Time to First Byte, transfer size, and server-payload content check.
 *
 * Measures the two arms of the comparison the manuscript sets up in §VI:
 * AI-driven SSR, where the recommendation component is part of the initial HTML
 * payload, against client-side rendering, where it is fetched after hydration.
 *
 * Three numbers per arm:
 *   - TTFB      : request start to first byte of the response body
 *   - Complete  : request start to the end of the response
 *   - HTML bytes: transferred size of the document
 *
 * Plus the measurement that decides the SEO claim outright: whether the
 * recommendation markup is present in the server response at all. A crawler
 * that does not execute JavaScript sees exactly this.
 *
 * Usage:
 *   node bench/ttfb.mjs --sku TR-104 --n 40
 *   node bench/ttfb.mjs --base http://localhost:3000 --shopper u-winter-planner --n 100
 *   node bench/ttfb.mjs --json > results.json
 */

import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const args = {
    base: 'http://localhost:3000',
    sku: 'TR-104',
    shopper: 'u-trail-regular',
    n: 30,
    warmup: 3,
    json: false,
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
      case '--n': args.n = Number.parseInt(value, 10); i += 1; break;
      case '--warmup': args.warmup = Number.parseInt(value, 10); i += 1; break;
      default: break;
    }
  }
  return args;
}

/**
 * One timed request. `fetch` resolves as soon as headers arrive, so awaiting it
 * gives time-to-first-byte; draining the body gives completion.
 */
async function timedRequest(url) {
  const startedAt = performance.now();
  const response = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
  const ttfb = performance.now() - startedAt;
  const body = await response.text();
  const complete = performance.now() - startedAt;

  if (!response.ok) throw new Error(`${url} responded ${response.status}`);

  return {
    ttfb,
    complete,
    bytes: Buffer.byteLength(body, 'utf8'),
    // The renderer stamps this attribute on every generated component, so its
    // presence in the raw document is a direct test of what a crawler receives.
    hasRecommendations: body.includes('data-rudra-slot='),
    source: body.match(/data-rudra-source="([^"]+)"/)?.[1] ?? null,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean: Number(mean.toFixed(1)),
    p50: Number(percentile(sorted, 50).toFixed(1)),
    p90: Number(percentile(sorted, 90).toFixed(1)),
    p95: Number(percentile(sorted, 95).toFixed(1)),
    min: Number(sorted[0].toFixed(1)),
    max: Number(sorted[sorted.length - 1].toFixed(1)),
  };
}

async function measureArm(label, url, { n, warmup }) {
  // Warm-up requests are discarded: the first render of a route pays for JIT,
  // module loading and a cold generation cache, none of which is what we are
  // trying to measure.
  for (let i = 0; i < warmup; i += 1) await timedRequest(url);

  const ttfb = [];
  const complete = [];
  let bytes = 0;
  let hasRecommendations = false;
  const sources = new Map();

  for (let i = 0; i < n; i += 1) {
    const result = await timedRequest(url);
    ttfb.push(result.ttfb);
    complete.push(result.complete);
    bytes = result.bytes;
    hasRecommendations = result.hasRecommendations;
    if (result.source) sources.set(result.source, (sources.get(result.source) ?? 0) + 1);
  }

  return {
    label,
    url,
    samples: n,
    ttfbMs: summarise(ttfb),
    completeMs: summarise(complete),
    htmlBytes: bytes,
    recommendationsInServerHtml: hasRecommendations,
    specSources: Object.fromEntries(sources),
  };
}

function printTable(arms) {
  const pad = (value, width) => String(value).padEnd(width);
  const num = (value, width) => String(value).padStart(width);

  console.log('');
  console.log(`${pad('arm', 26)}${num('TTFB p50', 10)}${num('p95', 9)}${num('total p50', 11)}${num('bytes', 9)}   recs in HTML`);
  console.log('-'.repeat(85));
  for (const arm of arms) {
    console.log(
      pad(arm.label, 26) +
        num(`${arm.ttfbMs.p50}ms`, 10) +
        num(`${arm.ttfbMs.p95}ms`, 9) +
        num(`${arm.completeMs.p50}ms`, 11) +
        num(arm.htmlBytes, 9) +
        `   ${arm.recommendationsInServerHtml ? 'yes' : 'NO'}`,
    );
  }
  console.log('');
  for (const arm of arms) {
    const sources = Object.entries(arm.specSources)
      .map(([source, count]) => `${source}×${count}`)
      .join(' ');
    if (sources) console.log(`${arm.label}: spec sources ${sources}`);
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv);
  const query = `?shopper=${encodeURIComponent(args.shopper)}`;

  const targets = [
    { label: 'AI-driven SSR', url: `${args.base}/product/${args.sku}${query}` },
    { label: 'Client-side rendering', url: `${args.base}/product-csr/${args.sku}${query}` },
  ];

  if (!args.json) {
    console.log(`\nrudra-js TTFB benchmark`);
    console.log(`base=${args.base} sku=${args.sku} shopper=${args.shopper} n=${args.n} warmup=${args.warmup}`);
  }

  const arms = [];
  for (const target of targets) {
    arms.push(await measureArm(target.label, target.url, args));
  }

  if (args.json) {
    const meta = { base: args.base, sku: args.sku, shopper: args.shopper, samples: args.n };
    console.log(JSON.stringify({ meta, arms }, null, 2));
  } else {
    printTable(arms);
  }
}

main().catch((error) => {
  console.error('\nBenchmark failed:', error.message);
  console.error('Is the storefront running?  npm run dev  (or npm run build && npm start)\n');
  process.exit(1);
});
