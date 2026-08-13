/**
 * @rudra/react — the SSR rendering layer.
 *
 * Turns a validated component spec into React Server Components. Contains no
 * client-side JavaScript, so a generated component ships entirely in the
 * initial HTML response.
 */

export { RudraComponent, type RudraComponentProps } from './render.js';
export {
  defaultRegistry,
  extendRegistry,
  type BlockRegistry,
  type BlockRenderer,
} from './registry.js';
export {
  defaultHrefForSku,
  defaultFormatPrice,
  type RenderCtx,
} from './context.js';
export { defaultTheme, styles, gridColumns, type RudraTheme } from './theme.js';
export { ProductCard } from './components/ProductCard.js';
export {
  HeroRenderer,
  GridRenderer,
  CarouselRenderer,
  BannerRenderer,
  CopyRenderer,
} from './components/blocks.js';
