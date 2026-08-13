import { notFound } from 'next/navigation';
import { RudraComponent } from '@rudra/react';
import { CATALOG, getProduct } from '@/data/catalog';
import { buildTrackingInput, getShopper } from '@/data/shoppers';
import { getGenerator } from '@/lib/rudra';
import { ProductDetail, ShopperSwitcher } from '@/components/ProductDetail';

/**
 * The AI-driven SSR arm.
 *
 * The generated component is awaited during the server render and embedded in
 * the HTML response. There is no client fetch, no loading state and no layout
 * shift for the recommendation region — it is present in the first byte of
 * markup the browser receives, and it is visible to crawlers.
 *
 * The cost is that generation sits on the critical path, which is exactly why
 * the generator enforces a wall-clock budget and falls back deterministically.
 */
export const dynamic = 'force-dynamic';

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sku } = await params;
  const query = await searchParams;
  const product = getProduct(sku);
  if (!product) notFound();

  const shopperParam = typeof query.shopper === 'string' ? query.shopper : undefined;
  const shopper = getShopper(shopperParam);

  const generator = await getGenerator();
  const spec = await generator.generate(
    buildTrackingInput({ shopperId: shopper.id, currentSku: sku }),
  );

  return (
    <>
      <ProductDetail product={product} />
      <ShopperSwitcher active={shopper} sku={sku} mode="ssr" />

      <RudraComponent
        spec={spec}
        products={CATALOG}
        showRationale
        style={{ background: '#fff', border: '1px solid #e3e6ec', borderRadius: 12, padding: 20 }}
      />

      <p style={{ marginTop: 20, fontSize: '0.78rem', color: '#646b78', fontFamily: 'ui-monospace, monospace' }}>
        server-rendered · source={spec.source} · {spec.latencyMs}ms · {spec.provider ?? 'no provider'}
        {spec.model ? `/${spec.model}` : ''}
        {spec.degradedReason ? ` · degraded=${spec.degradedReason}` : ''}
      </p>
    </>
  );
}
