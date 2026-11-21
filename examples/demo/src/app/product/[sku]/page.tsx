import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StoreFooter } from '../../../components/store-footer';
import { StoreHeader } from '../../../components/store-header';
import { catalog, findShopper, shoppers } from '../../../demo-context';
import { ProductPageContent } from '../../../product-page';

const RECORDED_SHOPPER = 'S-0001';
const RECORDED_SKU = 'RJ-00001';
const SIGNED_OUT = 'anonymous';

const others = shoppers.filter((shopper) => shopper.id !== RECORDED_SHOPPER);
const firstVisit = others.find((shopper) => shopper.viewedSkus.length === 0);
const regular = others.find(
  (shopper) => shopper.viewedSkus.length >= 6 && shopper.cartSkus.length > 0,
);

function shopperOptions(sku: string, shopper: string) {
  const options = [
    {
      id: RECORDED_SHOPPER,
      label: sku === RECORDED_SKU ? `${RECORDED_SHOPPER}, recorded` : RECORDED_SHOPPER,
    },
    ...(firstVisit ? [{ id: firstVisit.id, label: `${firstVisit.id}, first visit` }] : []),
    ...(regular ? [{ id: regular.id, label: `${regular.id}, browses a lot` }] : []),
    { id: SIGNED_OUT, label: 'No history, signed out' },
  ];
  return options.some((option) => option.id === shopper)
    ? options
    : [...options, { id: shopper, label: shopper }];
}

function DemoBar({
  sku,
  shopper,
  styled,
  toggleHref,
}: {
  sku: string;
  shopper: string;
  styled: boolean;
  toggleHref: string;
}) {
  return (
    <div className="demo-bar">
      <p className="demo-bar__note">
        A <a href="https://rudrajs.com">rudra-js</a> demo. The store and its products are made up.
      </p>
      <form className="demo-bar__shopper" method="get">
        <label htmlFor="demo-shopper">Viewing as</label>
        <select id="demo-shopper" name="shopper" defaultValue={shopper}>
          {shopperOptions(sku, shopper).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {styled ? null : <input type="hidden" name="styles" value="off" />}
        <button type="submit">Switch</button>
      </form>
      <a className="demo-bar__toggle" href={toggleHref}>
        {styled ? 'Show the rudra-js markup unstyled' : 'Put the block styles back'}
      </a>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}): Promise<Metadata> {
  const { sku } = await params;
  const product = catalog.find((candidate) => candidate.sku === sku);
  return product ? { title: `${product.title} | Larchmere Outfitters` } : {};
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ shopper?: string; styles?: string }>;
}) {
  const { sku } = await params;
  const { shopper: requested, styles } = await searchParams;
  const shopper = requested ?? RECORDED_SHOPPER;
  const styled = styles !== 'off';

  const keep = new URLSearchParams({ shopper });
  if (!styled) keep.set('styles', 'off');
  const linkQuery = `?${keep.toString()}`;

  const content = await ProductPageContent({ sku, shopperId: shopper, linkQuery });
  if (content === null) notFound();

  const toggle = new URLSearchParams({ shopper });
  if (styled) toggle.set('styles', 'off');

  return (
    <>
      <link rel="stylesheet" href="/store.css" />
      {styled ? <link rel="stylesheet" href="/demo-styles.css" /> : null}
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <DemoBar sku={sku} shopper={shopper} styled={styled} toggleHref={`?${toggle.toString()}`} />
      <StoreHeader linkQuery={linkQuery} cartCount={findShopper(shopper).cartSkus.length} />
      {content}
      <StoreFooter />
    </>
  );
}
