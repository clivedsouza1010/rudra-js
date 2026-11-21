'use client';

import { useState } from 'react';
import { Stars } from './stars';

export interface SwatchOption {
  name: string;
  hex: string;
  tone: number;
}

export const CART_EVENT = 'demo-cart';

const VIEWS = [
  { view: 1, label: 'Front' },
  { view: 2, label: 'Side' },
  { view: 3, label: 'Close-up' },
  { view: 4, label: 'Outdoors' },
];

export function ProductTop({
  sku,
  title,
  brand,
  price,
  rating,
  reviewCount,
  swatches,
  isInStock,
}: {
  sku: string;
  title: string;
  brand: string;
  price: string;
  rating: number;
  reviewCount: number;
  swatches: SwatchOption[];
  isInStock: boolean;
}) {
  const [view, setView] = useState(1);
  const [swatch, setSwatch] = useState(swatches[0]);
  const [fulfillment, setFulfillment] = useState<'ship' | 'pickup'>('ship');
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(0);

  const imageFor = (shown: number) =>
    `/images/${sku.toLowerCase()}${shown === 1 ? '' : `-${shown}`}.webp?tone=${swatch?.tone ?? 1}`;

  const addToCart = () => {
    setAdded((count) => count + quantity);
    window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: quantity }));
  };

  return (
    <div className="product-top">
      <div className="gallery">
        <div className="gallery__thumbs">
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              className="gallery__thumb"
              aria-pressed={view === option.view}
              aria-label={`Show the ${option.label.toLowerCase()} view`}
              onClick={() => setView(option.view)}
            >
              <img src={imageFor(option.view)} alt="" width={400} height={300} />
            </button>
          ))}
        </div>
        <img
          className="gallery__main"
          src={imageFor(view)}
          alt={`${title} in ${swatch?.name ?? 'its default color'}`}
          width={400}
          height={300}
        />
      </div>

      <div className="buy-box">
        <p className="buy-box__brand">{brand}</p>
        <h1 className="buy-box__title">{title}</h1>
        <p className="buy-box__rating">
          {reviewCount > 0 ? (
            <a href="#reviews">
              <Stars rating={rating} /> <span>{rating.toFixed(1)}</span>{' '}
              <span className="buy-box__count">({reviewCount} ratings)</span>
            </a>
          ) : (
            <span className="buy-box__count">No ratings yet</span>
          )}
        </p>
        <p className="buy-box__price">{price}</p>

        <fieldset className="choice">
          <legend className="choice__legend">
            Color: <strong>{swatch?.name}</strong>
          </legend>
          <div className="swatches">
            {swatches.map((option) => (
              <button
                key={option.name}
                type="button"
                className="swatch"
                style={{ backgroundColor: option.hex }}
                aria-pressed={swatch?.name === option.name}
                aria-label={option.name}
                onClick={() => setSwatch(option)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="choice">
          <legend className="choice__legend">How you get it</legend>
          <div className="fulfillment">
            <label className="fulfillment__option">
              <input
                type="radio"
                name="fulfillment"
                checked={fulfillment === 'ship'}
                onChange={() => setFulfillment('ship')}
              />
              <span className="fulfillment__name">Ship it</span>
              <span className="fulfillment__detail">Arrives in 3 to 5 days. Free over $50.</span>
            </label>
            <label className="fulfillment__option">
              <input
                type="radio"
                name="fulfillment"
                checked={fulfillment === 'pickup'}
                onChange={() => setFulfillment('pickup')}
              />
              <span className="fulfillment__name">Pick up</span>
              <span className="fulfillment__detail">Ready today at the Fieldhouse store.</span>
            </label>
          </div>
        </fieldset>

        {isInStock ? (
          <div className="purchase">
            <label className="purchase__quantity">
              <span>Quantity</span>
              <select
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="purchase__add" onClick={addToCart}>
              {fulfillment === 'ship' ? 'Add to cart' : 'Add for pickup'}
            </button>
          </div>
        ) : (
          <p className="purchase__out">Out of stock online and in stores right now.</p>
        )}
        <p className="purchase__added" aria-live="polite">
          {added > 0 ? `${added} in your cart. This is a demo, so nothing gets ordered.` : null}
        </p>

        <ul className="buy-box__perks">
          <li>Free returns within 90 days</li>
          <li>Members earn 5% back on this item</li>
        </ul>
      </div>
    </div>
  );
}
