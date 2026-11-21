'use client';

import { useEffect, useState } from 'react';
import { CART_EVENT } from './product-top';

export function CartCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const add = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      setCount((current) => current + detail);
    };
    window.addEventListener(CART_EVENT, add);
    return () => window.removeEventListener(CART_EVENT, add);
  }, []);

  return (
    <a className="header__cart" href="#cart">
      Cart{' '}
      <span className="header__cart-count" aria-label={`${count} items`}>
        {count}
      </span>
    </a>
  );
}
