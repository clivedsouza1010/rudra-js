'use client';

import { useState } from 'react';

export function SearchBox() {
  const [note, setNote] = useState('');

  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        setNote('Search isn’t part of this demo. Use the categories below to look around.');
      }}
    >
      <label className="visually-hidden" htmlFor="store-search">
        Search products
      </label>
      <input
        id="store-search"
        className="search__input"
        type="search"
        placeholder="Search the store"
        onChange={() => setNote('')}
      />
      <button className="search__button" type="submit">
        Search
      </button>
      <p className="search__note" aria-live="polite">
        {note}
      </p>
    </form>
  );
}
