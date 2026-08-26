/**
 * @rudra-js/react — renders a component specification as React Server Components.
 *
 * Carries no client JavaScript. The recommendation area arrives in the initial
 * HTML response and needs no hydration.
 */

export {
  RudraComponent,
  type ProductCatalog,
  type RudraComponentProps,
} from './rudra-component.js';

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

// The five default renderers reach hosts through `defaultRegistry`, which is
// also the thing they need in order to override one. `ProductCard` is exported
// on its own because a custom grid renderer still wants the standard card.
export { ProductCard } from './blocks/product-card.js';
