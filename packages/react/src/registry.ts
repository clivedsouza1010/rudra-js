import type { ReactNode } from 'react';
import type { Block, BlockKind } from '@rudra/core';
import type { BlockRenderContext } from './render-context.js';
import {
  BannerRenderer,
  CarouselRenderer,
  CopyRenderer,
  GridRenderer,
  HeroRenderer,
} from './blocks/block-renderers.js';

/**
 * What each kind of block actually renders.
 *
 * This is the seam that makes a generated component safe *and* usable. The
 * model picks from a fixed vocabulary of block kinds; the registry decides what
 * those kinds look like. A shop can swap any entry for its own design-system
 * component without the model knowing, without the specification changing, and
 * without giving the model any new ability — it still cannot say anything
 * outside the vocabulary.
 */

export type BlockRenderer<Kind extends BlockKind> = (props: {
  block: Extract<Block, { kind: Kind }>;
  context: BlockRenderContext;
}) => ReactNode;

export type BlockRegistry = {
  [Kind in BlockKind]: BlockRenderer<Kind>;
};

export const defaultRegistry: BlockRegistry = {
  hero: HeroRenderer,
  grid: GridRenderer,
  carousel: CarouselRenderer,
  banner: BannerRenderer,
  copy: CopyRenderer,
};

/** Replaces some renderers and keeps the rest. */
export function extendRegistry(overrides: Partial<BlockRegistry>): BlockRegistry {
  return { ...defaultRegistry, ...overrides };
}
