import type { ReactNode } from 'react';
import type { Block, BlockKind } from '@rudra-js/core';
import type { BlockRenderContext } from './render-context.js';
import {
  BannerRenderer,
  CarouselRenderer,
  CopyRenderer,
  GridRenderer,
  HeroRenderer,
} from './blocks/block-renderers.js';
import { BundleRenderer } from './blocks/bundle-block.js';

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
  bundle: BundleRenderer,
};

export function extendRegistry(overrides: Partial<BlockRegistry>): BlockRegistry {
  return {
    hero: overrides.hero ?? defaultRegistry.hero,
    grid: overrides.grid ?? defaultRegistry.grid,
    carousel: overrides.carousel ?? defaultRegistry.carousel,
    banner: overrides.banner ?? defaultRegistry.banner,
    copy: overrides.copy ?? defaultRegistry.copy,
    bundle: overrides.bundle ?? defaultRegistry.bundle,
  };
}
