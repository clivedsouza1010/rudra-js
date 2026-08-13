import type { ReactNode } from 'react';
import type { Block, BlockKind } from '@rudra/core';
import type { RenderCtx } from './context.js';
import {
  BannerRenderer,
  CarouselRenderer,
  CopyRenderer,
  GridRenderer,
  HeroRenderer,
} from './components/blocks.js';

/**
 * The component registry.
 *
 * This is the mechanism that makes an LLM-generated component safe to
 * server-render: the model selects from a fixed vocabulary of block kinds, and
 * the registry decides what each one actually renders. A host can swap any
 * entry for its own design-system component without the model knowing or the
 * spec contract changing.
 */

export type BlockRenderer<K extends BlockKind> = (props: {
  block: Extract<Block, { kind: K }>;
  ctx: RenderCtx;
}) => ReactNode;

export type BlockRegistry = {
  [K in BlockKind]: BlockRenderer<K>;
};

export const defaultRegistry: BlockRegistry = {
  hero: HeroRenderer,
  grid: GridRenderer,
  carousel: CarouselRenderer,
  banner: BannerRenderer,
  copy: CopyRenderer,
};

/** Overlays partial overrides onto the default registry. */
export function extendRegistry(overrides: Partial<BlockRegistry>): BlockRegistry {
  return { ...defaultRegistry, ...overrides };
}
