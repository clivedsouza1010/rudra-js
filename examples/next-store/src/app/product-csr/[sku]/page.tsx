import { notFound } from 'next/navigation';
import { CATALOG, getProduct } from '@/data/catalog';
import { getShopper } from '@/data/shoppers';
import { ProductDetail, ShopperSwitcher } from '@/components/ProductDetail';
import { CsrRecommendations } from '@/components/CsrRecommendations';

/**
 * The client-side rendering control arm.
 *
 * The product detail is server-rendered exactly as on the SSR route; only the
 * recommendation region differs. It ships as an empty placeholder and is filled
 * in after hydration by a client fetch — so the server response contains no
 * recommendation content at all.
 */
export const dynamic = 'force-dynamic';

export default async function ProductCsrPage({
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

  return (
    <>
      <ProductDetail product={product} />
      <ShopperSwitcher active={shopper} sku={sku} mode="csr" />
      <CsrRecommendations sku={sku} shopperId={shopper.id} products={CATALOG} />
    </>
  );
}
