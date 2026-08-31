import { RudraComponent } from '@rudra-js/react';
import { getShopContext } from './shop-context';
import { buildTrackingInput } from './fixtures/tracking-input';

/**
 * Separated from the route so the route can answer `notFound()` — which signals
 * by throwing — while this half stays testable by rendering it.
 */
export async function ProductPageContent({
  sku,
  shopperId,
}: {
  sku: string;
  shopperId: string | undefined;
}) {
  const { catalog, bundles, findShopper, generator } = getShopContext();
  const product = catalog.find((candidate) => candidate.sku === sku);
  if (!product) return null;

  const shopper = findShopper(shopperId);
  const spec = await generator.generate(buildTrackingInput(shopper, product.sku, catalog, bundles));

  return (
    <main>
      <article>
        <h1>{product.title}</h1>
        <p>{product.category}</p>
        <p>
          {new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency }).format(
            product.price,
          )}
        </p>
      </article>

      <RudraComponent spec={spec} products={catalog} bundles={bundles} locale="en-US" />
    </main>
  );
}
