import { notFound } from 'next/navigation';
import { ProductPageContent } from '../../../product-page';

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ shopper?: string }>;
}) {
  const { sku } = await params;
  const { shopper } = await searchParams;

  const content = await ProductPageContent({ sku, shopperId: shopper });
  // A URL naming a product the catalog does not have is a 404, not an excuse to
  // show a different product and track it as though the shopper asked for it.
  if (content === null) notFound();

  return content;
}
