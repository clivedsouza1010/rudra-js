/**
 * @rudra-js/anthropic — an Anthropic adapter for `@rudra-js/core`.
 *
 * Carries no vendor SDK and no dependencies: it speaks the Messages API over
 * `fetch`, which is also what makes its contract obligations testable without
 * a network.
 */

export { createAnthropicProvider, type AnthropicProviderOptions } from './anthropic-provider.js';
