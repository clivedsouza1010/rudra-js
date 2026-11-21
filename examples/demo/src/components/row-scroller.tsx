'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const TRACK = '.rudra-carousel__track, .rudra-grid__items';

export function RowScroller({ label, children }: { label: string; children: ReactNode }) {
  const holder = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ back: false, forward: false });

  useEffect(() => {
    const track = holder.current?.querySelector<HTMLElement>(TRACK);
    if (!track) return;

    const measure = () =>
      setEdges({
        back: track.scrollLeft > 4,
        forward: track.scrollLeft + track.clientWidth < track.scrollWidth - 4,
      });
    measure();
    track.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      track.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  const scroll = (direction: 1 | -1) => {
    const track = holder.current?.querySelector<HTMLElement>(TRACK);
    if (!track) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({
      left: direction * track.clientWidth * 0.9,
      behavior: still ? 'auto' : 'smooth',
    });
  };

  const scrolls = edges.back || edges.forward;

  return (
    <div className="row-scroller" ref={holder}>
      {children}
      <button
        type="button"
        className="row-scroller__button row-scroller__button--back"
        aria-label={`Scroll ${label} back`}
        hidden={!scrolls}
        aria-disabled={!edges.back}
        onClick={() => scroll(-1)}
      >
        ‹
      </button>
      <button
        type="button"
        className="row-scroller__button row-scroller__button--forward"
        aria-label={`Scroll ${label} forward`}
        hidden={!scrolls}
        aria-disabled={!edges.forward}
        onClick={() => scroll(1)}
      >
        ›
      </button>
    </div>
  );
}
