import { z } from 'zod';
import type {
  ComponentProvider,
  ProviderRequest,
  ProviderResult,
  TokenUsage,
} from '@rudra-js/core';

export interface AnthropicProviderOptions {
  apiKey: string;

  model?: string;
  maxTokens?: number;
  baseUrl?: string;

  workspaceId?: string;

  thinking?: { type: 'adaptive' | 'disabled' } | null;

  fetch?: typeof globalThis.fetch;
}

const TOOL_NAME = 'emit_component_spec';

const DEFAULT_MAX_TOKENS = 8192;

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: unknown;
}

function describeShape(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return `an array of ${input.length}`;
  if (typeof input !== 'object') return String(typeof input);

  const keys = Object.keys(input);
  return keys.length === 0 ? 'an empty object' : `an object with keys ${keys.join(', ')}`;
}

function onlyValue(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const values = Object.values(input);
  return values.length === 1 ? values[0] : undefined;
}

function isToolUseBlock(candidate: unknown): candidate is ToolUseBlock {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as Record<string, unknown>)['type'] === 'tool_use' &&
    (candidate as Record<string, unknown>)['name'] === TOOL_NAME
  );
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ComponentProvider {
  const model = options.model ?? 'claude-sonnet-5';
  const thinking =
    options.thinking === undefined ? { type: 'disabled' as const } : options.thinking;
  const call = options.fetch ?? globalThis.fetch;

  let baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    name: 'anthropic',
    model,

    async generate(request: ProviderRequest): Promise<ProviderResult> {
      request.signal.throwIfAborted();

      const response = await send(call, `${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          ...(options.workspaceId ? { 'anthropic-workspace-id': options.workspaceId } : {}),
        },

        signal: request.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(thinking ? { thinking } : {}),

          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: request.user }],
          tools: [
            {
              name: TOOL_NAME,
              description: 'Return the component specification.',

              input_schema: z.toJSONSchema(request.schema, { io: 'input' }),
            },
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        }),
      });

      if (!response.ok) {
        const category = await errorCategory(response);

        throw new Error(`anthropic responded ${response.status}${category}`);
      }

      const parsed: unknown = await response.json();

      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(
          `anthropic returned ${parsed === null ? 'null' : typeof parsed}, not an object`,
        );
      }

      const body = parsed as {
        content?: unknown;
        usage?: Record<string, unknown>;
        stop_reason?: string;
      };

      if (body.stop_reason === 'max_tokens') {
        throw new Error(
          `anthropic stopped at the max_tokens budget (${maxTokens}) before returning a tool use`,
        );
      }
      if (body.stop_reason === 'refusal') {
        throw new Error('anthropic refused to answer (stop_reason: refusal)');
      }

      const blocks = Array.isArray(body.content) ? body.content : [];
      const block = blocks.find(isToolUseBlock);

      if (!block) {
        throw new Error(`anthropic returned no ${TOOL_NAME} tool use`);
      }

      const asSent = request.schema.safeParse(block.input);
      const usable = asSent.success ? asSent : request.schema.safeParse(onlyValue(block.input));

      if (!usable.success) {
        throw new Error(
          `anthropic returned a ${TOOL_NAME} tool use that does not fit the schema. ` +
            `It sent ${describeShape(block.input)}.`,
          { cause: asSent.error },
        );
      }

      const spec = usable.data;
      const usage = toUsage(body.usage);

      return { spec, ...(usage ? { usage } : {}) };
    },
  };
}

async function send(call: typeof globalThis.fetch, url: string, init: RequestInit) {
  try {
    return await call(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;

    const cause = error instanceof Error ? (error.cause ?? error) : error;
    const detail =
      cause && typeof cause === 'object' && 'code' in cause
        ? String((cause as { code: unknown }).code)
        : String(cause instanceof Error ? cause.message : cause);

    throw new Error(`anthropic did not answer: ${detail}`, { cause: error });
  }
}

async function errorCategory(response: Response): Promise<string> {
  try {
    const body: unknown = JSON.parse(await response.text());
    const type = (body as { error?: { type?: unknown } })?.error?.type;
    return typeof type === 'string' ? ` (${type})` : '';
  } catch {
    return '';
  }
}

function toUsage(usage: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!usage) return undefined;

  const numberAt = (key: string): number | undefined => {
    const value = usage[key];
    return typeof value === 'number' ? value : undefined;
  };

  const inputTokens = numberAt('input_tokens');
  const outputTokens = numberAt('output_tokens');
  const cacheReadTokens = numberAt('cache_read_input_tokens');
  const cacheWriteTokens = numberAt('cache_creation_input_tokens');

  const mapped = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}
