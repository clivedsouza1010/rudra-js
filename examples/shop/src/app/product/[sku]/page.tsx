import { RudraComponent } from '@rudra-js/react';
import { getShopContext } from '../../../shop';
import { buildTrackingInput } from '../../../fixtures/tracking-input';

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ shopper?: string }>;
}) {
  const { sku } = await params;
  const { shopper: shopperId } = await searchParams;
  const { catalog, findShopper, generator } = getShopContext();

  const product = catalog.find((candidate) => candidate.sku === sku) ?? catalog[0]!;
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
