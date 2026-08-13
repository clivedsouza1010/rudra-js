import type { CSSProperties } from 'react';
import type { Block } from '@rudra/core';

/**
 * Styling is inline and token-driven rather than a stylesheet.
 *
 * The reason is architectural, not aesthetic: a generated component has to be
 * embeddable in an arbitrary host page with no build-step coordination, no CSS
 * module, and no class-name collisions. Inline styles also keep the rendered
 * markup fully self-describing, which is what makes the SSR payload
 * independently crawlable.
 */

export interface RudraTheme {
  fontFamily: string;
  radius: string;
  gap: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  accentText: string;
  banner: Record<'info' | 'promo' | 'urgency' | 'restock', { bg: string; fg: string }>;
}

export const defaultTheme: RudraTheme = {
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  radius: '10px',
  gap: '16px',
  text: '#16181d',
  muted: '#646b78',
  border: '#e3e6ec',
  surface: '#ffffff',
  accent: '#1a5cff',
  accentText: '#ffffff',
  banner: {
    info: { bg: '#eef3ff', fg: '#1a3f9e' },
    promo: { bg: '#eefaf0', fg: '#136c31' },
    urgency: { bg: '#fff4ec', fg: '#9a4212' },
    restock: { bg: '#f4f0ff', fg: '#4b2ea3' },
  },
};

export function styles(theme: RudraTheme) {
  const base: Record<string, CSSProperties> = {
    root: {
      fontFamily: theme.fontFamily,
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    },
    header: { display: 'flex', flexDirection: 'column', gap: '4px' },
    headline: { margin: 0, fontSize: '1.35rem', lineHeight: 1.25, fontWeight: 650 },
    subheadline: { margin: 0, fontSize: '0.95rem', color: theme.muted },
    blockTitle: { margin: '0 0 12px', fontSize: '1rem', fontWeight: 600 },

    grid: { display: 'grid', gap: theme.gap },
    carousel: {
      display: 'flex',
      gap: theme.gap,
      overflowX: 'auto',
      paddingBottom: '6px',
      scrollSnapType: 'x mandatory',
    },
    carouselItem: { flex: '0 0 210px', scrollSnapAlign: 'start' },

    card: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px',
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radius,
      background: theme.surface,
      textDecoration: 'none',
      color: 'inherit',
      height: '100%',
      boxSizing: 'border-box',
    },
    cardFeatured: { borderColor: theme.accent, boxShadow: `0 0 0 1px ${theme.accent}` },
    cardMedia: {
      width: '100%',
      aspectRatio: '1 / 1',
      objectFit: 'cover',
      borderRadius: '6px',
      background: '#f2f4f7',
      display: 'block',
    },
    cardTitle: { fontSize: '0.92rem', fontWeight: 600, lineHeight: 1.3 },
    cardPrice: { fontSize: '0.92rem', fontWeight: 600 },
    cardReason: { fontSize: '0.8rem', color: theme.muted, lineHeight: 1.4 },
    badge: {
      alignSelf: 'flex-start',
      fontSize: '0.68rem',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      padding: '2px 7px',
      borderRadius: '999px',
      background: theme.accent,
      color: theme.accentText,
    },

    hero: {
      display: 'flex',
      gap: '20px',
      alignItems: 'center',
      padding: '20px',
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radius,
      background: theme.surface,
      flexWrap: 'wrap',
    },
    heroMedia: {
      width: '160px',
      aspectRatio: '1 / 1',
      objectFit: 'cover',
      borderRadius: '8px',
      background: '#f2f4f7',
      flex: '0 0 auto',
    },
    heroBody: { display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 260px' },
    heroHeadline: { margin: 0, fontSize: '1.15rem', fontWeight: 650, lineHeight: 1.3 },
    heroText: { margin: 0, fontSize: '0.92rem', color: theme.muted, lineHeight: 1.5 },

    cta: {
      alignSelf: 'flex-start',
      display: 'inline-block',
      padding: '9px 16px',
      borderRadius: '8px',
      background: theme.accent,
      color: theme.accentText,
      fontSize: '0.88rem',
      fontWeight: 600,
      textDecoration: 'none',
    },

    banner: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '12px 16px',
      borderRadius: theme.radius,
      fontSize: '0.9rem',
      fontWeight: 500,
      flexWrap: 'wrap',
    },
    bannerCta: { fontWeight: 600, textDecoration: 'underline', color: 'inherit' },

    copy: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      fontSize: '0.92rem',
      lineHeight: 1.55,
      color: theme.muted,
    },

    rationale: {
      margin: 0,
      fontSize: '0.75rem',
      color: theme.muted,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    },
  };

  return base;
}

/** Grid template for a column count the spec has already constrained to 2–4. */
export function gridColumns(columns: Extract<Block, { kind: 'grid' }>['columns']): CSSProperties {
  return {
    gridTemplateColumns: `repeat(auto-fit, minmax(${columns >= 4 ? 170 : 200}px, 1fr))`,
  };
}
