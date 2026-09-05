import { createRequire } from 'node:module';
import { classify, collect, refusals, renderTable, unstable } from './matrix.js';
import { freePort, startShop, stopShop } from './shop-server.js';
import { reportFailure } from './verify-messages.js';

async function main(): Promise<void> {
  const port = await freePort();
  const { shop, ready, seen } = startShop(port);

  try {
    await ready;
    const origin = `http://localhost:${port}`;

    // Without this the agent that goes first is measured on a cold cache.
    await collect(origin);

    const responses = await collect(origin);
    const classes = classify(responses);
    const reasons = [
      ...unstable(responses, await collect(origin)),
      ...refusals(responses, classes),
    ];

    if (reasons.length > 0) {
      console.error('refusing to print a table from this run:');
      for (const reason of reasons) console.error(`  - ${reason}`);
      process.exitCode = 1;
      return;
    }

    console.log(renderTable(classes));
    console.log();
    // The split is Next's bot list, which moves between releases.
    const next = createRequire(import.meta.url)('next/package.json') as { version: string };
    console.log(`next@${next.version}, one page, Accept-Encoding: identity`);
  } catch (error) {
    reportFailure(error, seen());
    process.exitCode = 1;
  } finally {
    await stopShop(shop);
    shop.stdout?.destroy();
    shop.stderr?.destroy();
    shop.unref();
  }
}

await main();
