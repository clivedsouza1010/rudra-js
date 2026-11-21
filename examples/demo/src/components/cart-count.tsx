'use client';

import { useEffect, useState } from 'react';
import { CART_EVENT } from './product-top';

export function CartCount({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    const add = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      setCount((current) => current + detail);
    };
    window.addEventListener(CART_EVENT, add);
    return () => window.removeEventListener(CART_EVENT, add);
  }, []);

  return (
    <a
      className="header__cart"
      href="#cart"
      aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
    >
      Cart <span className="header__cart-count">{count}</span>
    </a>
  );
}
