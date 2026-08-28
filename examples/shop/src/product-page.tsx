import { RudraComponent } from '@rudra-js/react';
import { getShopContext } from './shop';
import { buildTrackingInput } from './fixtures/tracking-input';

/**
 * The page itself, separated from the route.
 *
 * The route has to be able to answer a bad URL with a 404, and `notFound()`
 * signals that by throwing — which a test calling the route as a plain function
 * would report as a failure. Returning null for an unknown SKU keeps the
 * decision in the route and leaves everything else testable by rendering it.
 */
export async function ProductPageContent({
  sku,
  shopperId,
}: {
  sku: string;
  shopperId: string | undefined;
}) {
  const { catalog, findShopper, generator } = getShopContext();
  const product = catalog.find((candidate) => candidate.sku === sku);
  if (!product) return null;

  const shopper = findShopper(shopperId);
  const spec = await generator.generate(buildTrackingInput(shopper, product.sku, catalog));

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

      <RudraComponent spec={spec} products={catalog} locale="en-US" />
    </main>
  );
}
