import { catalog } from '../demo-context';
import { CATEGORIES } from '../fixtures/catalog';
import { CartCount } from './cart-count';
import { SearchBox } from './search-box';

export const HOME_HREF = '/product/RJ-00001';

export function firstSkuIn(category: string): string | undefined {
  return catalog.find((product) => product.category === category && product.isInStock)?.sku;
}

export function StoreHeader({ linkQuery, cartCount }: { linkQuery: string; cartCount: number }) {
  return (
    <header className="header">
      <div className="header__bar">
        <a className="header__logo" href={`${HOME_HREF}${linkQuery}`}>
          <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
            <path d="M16 3 L28 27 H4 Z" fill="#1f5c45" />
            <path d="M16 12 L22 27 H10 Z" fill="#8fbf9f" />
          </svg>
          <span className="header__name">Larchmere Outfitters</span>
        </a>
        <SearchBox />
        <nav className="header__account" aria-label="Your account">
          <a className="header__sign-in" href="#account">
            Sign in
          </a>
          <CartCount initial={cartCount} />
        </nav>
      </div>
      <nav className="header__nav" aria-label="Categories">
        <ul>
          {CATEGORIES.map((category) => {
            const sku = firstSkuIn(category);
            return sku ? (
              <li key={category}>
                <a href={`/product/${sku}${linkQuery}`}>{category}</a>
              </li>
            ) : null;
          })}
        </ul>
      </nav>
    </header>
  );
}
