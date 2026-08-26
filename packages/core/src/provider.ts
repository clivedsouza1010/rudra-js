import type { z } from 'zod';
import type { GeneratedSpec } from './component-spec.js';

/**
 * The language-model port.
 *
 * `@rudra-js/core` depends on no vendor SDK. Adapters live in their own packages,
 * so a host installs exactly one and the rest never reach its dependency tree.
 * Anything satisfying this interface works — a hosted API, a self-hosted model,
 * an in-tenancy deployment, or a recorded fixture.
 */

/** Reported by an adapter for cost accounting. Never used for control flow. */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderRequest {
  /**
   * Stable across every request in a deployment. Adapters that support prompt
   * caching should mark this as the cached prefix; interpolating anything
   * per-shopper into it would silently destroy the cache hit rate.
   */
  system: string;
  /** Per-request content. Must not be merged into the cached prefix. */
  user: string;
  /**
   * The schema the response must satisfy. Adapters convert it with their own
   * SDK helper, so there is no hand-maintained JSON Schema to drift out of
   * sync with the one `component-spec` defines.
   */
  schema: z.ZodType<GeneratedSpec>;
  /** Fires when the caller's budget elapses. An adapter must stop work. */
  signal: AbortSignal;
}

export interface ProviderResult {
  spec: GeneratedSpec;
  usage?: TokenUsage;
}

/**
 * What an adapter promises.
 *
 * Three obligations, none of which the caller can verify from the outside, so
 * they are stated here rather than assumed:
 *
 *  1. Return a parsed object, not a string. Turning model output into a
 *     `GeneratedSpec` is the adapter's job, because only it knows what its
 *     structured-output mode returns.
 *  2. Throw on failure — a refusal, a transport error, an unparseable
 *     response. Never return a partial or invented spec. The caller treats a
 *     throw as "use the deterministic component", which is always safe; a
 *     fabricated spec is not.
 *  3. Respect `signal`, in both directions: do not start work when it is
 *     already aborted, and stop when it aborts mid-flight. The caller races
 *     the call against its own timeout regardless, so ignoring it does not
 *     hold a page open — but it does leave work running and billing after
 *     nobody is waiting, and it answers a caller that has already given up.
 *
 *     `AbortSignal.throwIfAborted()` is the whole of the first half.
 *
 * The caller re-validates whatever comes back. An adapter that returns
 * something malformed is a bug, not a security hole.
 */
export interface ComponentProvider {
  /** Short identifier recorded on every generated spec, e.g. 'anthropic'. */
  readonly name: string;
  /** Concrete model identifier, e.g. 'claude-opus-5'. */
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

/**
 * A provider that returns a fixed spec and never touches the network.
 *
 * This is the benchmark's control: it isolates the cost of the framework from
 * the latency of a model, which is the only way to report what server-side
 * rendering itself costs. It is also what the generator's tests run against,
 * since a test that needs an API key is a test nobody runs.
 */
export function createFixedSpecProvider(spec: GeneratedSpec): ComponentProvider {
  return {
    name: 'fixed',
    model: 'none',
    generate: async ({ signal }) => {
      // Nothing here is slow enough to need cancelling, which is exactly why it
      // is worth checking: the obligation is not "cancel your work", it is "do
      // not answer a caller that has already given up". A reference
      // implementation that skips the cheap half teaches the wrong lesson.
      signal.throwIfAborted();
      return { spec };
    },
  };
}
