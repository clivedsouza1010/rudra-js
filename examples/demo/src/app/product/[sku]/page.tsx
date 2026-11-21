import { notFound } from 'next/navigation';
import { StoreFooter } from '../../../components/store-footer';
import { StoreHeader } from '../../../components/store-header';
import { shoppers } from '../../../demo-context';
import { ProductPageContent } from '../../../product-page';

const RECORDED_SHOPPER = 'S-0001';
const others = shoppers.filter((shopper) => shopper.id !== RECORDED_SHOPPER);

const EXAMPLE_SHOPPERS = [
  { id: RECORDED_SHOPPER, label: `${RECORDED_SHOPPER}, recorded` },
  ...others
    .filter((shopper) => shopper.viewedSkus.length === 0)
    .slice(0, 1)
    .map((shopper) => ({ id: shopper.id, label: `${shopper.id}, first visit` })),
  ...others
    .filter((shopper) => shopper.viewedSkus.length >= 6 && shopper.cartSkus.length > 0)
    .slice(0, 2)
    .map((shopper) => ({ id: shopper.id, label: `${shopper.id}, browses a lot` })),
];

function DemoBar({
  shopper,
  styled,
  toggleHref,
}: {
  shopper: string | undefined;
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
        <select id="demo-shopper" name="shopper" defaultValue={shopper ?? RECORDED_SHOPPER}>
          {EXAMPLE_SHOPPERS.map((option) => (
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
  if (content === null) notFound();

  const styled = styles !== 'off';
  const query = new URLSearchParams();
  if (shopper !== undefined) query.set('shopper', shopper);
  if (styled) query.set('styles', 'off');
  const toggleHref = query.size === 0 ? '?' : `?${query.toString()}`;

  return (
    <>
      <link rel="stylesheet" href="/store.css" />
      {styled ? <link rel="stylesheet" href="/demo-styles.css" /> : null}
      <DemoBar shopper={shopper} styled={styled} toggleHref={toggleHref} />
      <StoreHeader />
      {content}
      <StoreFooter />
    </>
  );
}
