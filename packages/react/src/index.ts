/**
 * @rudra/react — renders a component specification as React Server Components.
 *
 * Carries no client JavaScript. The recommendation area arrives in the initial
 * HTML response and needs no hydration.
 */

export { RudraComponent, type RudraComponentProps } from './rudra-component.js';

export {
  defaultRegistry,
  extendRegistry,
  type BlockRegistry,
  type BlockRenderer,
} from './registry.js';

export {
  defaultFormatPrice,
  defaultHrefForSku,
  type BlockRenderContext,
} from './render-context.js';

export {
  BannerRenderer,
  CarouselRenderer,
  CopyRenderer,
  GridRenderer,
  HeroRenderer,
} from './blocks/block-renderers.js';

export { ProductCard } from './blocks/product-card.js';
