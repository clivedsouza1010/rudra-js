import { generateCatalog } from '../examples/shop/src/fixtures/catalog.js';
import { generateShoppers } from '../examples/shop/src/fixtures/shoppers.js';
import { PRICES, buildArm, isArmName } from './arms.js';
import { measureArm } from './measure-arm.js';

const name = process.argv[2];

if (name === undefined || !isArmName(name)) {
  console.error(`run-arm needs an arm name, got ${String(name)}`);
  process.exit(2);
}

const catalog = generateCatalog(1);
const shoppers = generateShoppers(2, catalog);

// Taken after the fixtures are built, so the arm is charged for its own work
// and not for generating 2,000 products and 500 shoppers.
const before = process.cpuUsage();
const result = await measureArm(buildArm(name), shoppers, catalog, PRICES);
const spent = process.cpuUsage(before);

process.stdout.write(
  `${JSON.stringify({
    ...result,
    cpuUserMs: Math.round(spent.user / 1000),
    cpuSystemMs: Math.round(spent.system / 1000),
  })}\n`,
);
