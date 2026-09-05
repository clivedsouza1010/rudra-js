import { notFound } from 'next/navigation';
import { ProductPageContent } from '../../../product-page';

function StyleNote({ styled, href }: { styled: boolean; href: string }) {
  return (
    <p>
      {styled
        ? 'Styled with this example’s own CSS, written against the class table in the @rudra-js/react README. The package ships no styles. '
        : '@rudra-js/react ships no CSS on purpose — a stylesheet would fight whatever your site already has. This is the markup it emits, unstyled. '}
      <a href={href}>{styled ? 'Show it unstyled' : 'Apply the example’s styles'}</a>
    </p>
  );
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ shopper?: string; styles?: string }>;
}) {
  const { sku } = await params;
  const { shopper, styles } = await searchParams;

  const content = await ProductPageContent({ sku, shopperId: shopper });
  // A URL naming a product the catalog does not have is a 404, not an excuse to
  // show a different product and track it as though the shopper asked for it.
  if (content === null) notFound();

  const styled = styles === 'on';
  const query = new URLSearchParams();
  if (shopper !== undefined) query.set('shopper', shopper);
  if (!styled) query.set('styles', 'on');
  const toggleHref = query.size === 0 ? '?' : `?${query.toString()}`;

  return (
    <>
      {styled ? <link rel="stylesheet" href="/demo-styles.css" /> : null}
      <StyleNote styled={styled} href={toggleHref} />
      {content}
    </>
  );
}
