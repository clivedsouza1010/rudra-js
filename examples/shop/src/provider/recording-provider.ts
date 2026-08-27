import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentProvider, ProviderRequest, ProviderResult } from '@rudra-js/core';

/**
 * Record and replay, so a clone with no API key still exercises generation.
 *
 * This lives in the example rather than in the published adapter because an
 * adopter never needs it, and a published surface should not grow a testing
 * concern.
 */

interface Transcript {
  model: string;
  system: string;
  user: string;
  result: ProviderResult;
}

/** The same material the spec cache keys on, so a transcript maps to one page. */
function transcriptName(model: string, request: ProviderRequest): string {
  return `${createHash('sha256')
    .update(JSON.stringify({ model, system: request.system, user: request.user }))
    .digest('hex')
    .slice(0, 32)}.json`;
}

export function createRecordingProvider(
  inner: ComponentProvider,
  directory: string,
): ComponentProvider {
  return {
    name: inner.name,
    model: inner.model,

    async generate(request) {
      const result = await inner.generate(request);
      mkdirSync(directory, { recursive: true });

      const transcript: Transcript = {
        model: inner.model,
        system: request.system,
        user: request.user,
        result,
      };
      writeFileSync(
        join(directory, transcriptName(inner.model, request)),
        `${JSON.stringify(transcript, null, 2)}\n`,
      );

      return result;
    },
  };
}

export function createReplayProvider(options: {
  directory: string;
  model: string;
  onMiss: 'throw' | 'fallback';
}): ComponentProvider {
  return {
    name: 'anthropic',
    model: options.model,

    async generate(request) {
      const path = join(options.directory, transcriptName(options.model, request));

      if (!existsSync(path)) {
        const message = `no recording for this request at ${path}`;
        if (options.onMiss === 'throw') throw new Error(message);

        // Rejecting rather than returning nothing: the generator's own fallback
        // path is the right way to degrade, and it records why.
        console.warn(`${message} — falling back`);
        throw new Error(message);
      }

      const transcript = JSON.parse(readFileSync(path, 'utf8')) as Transcript;
      return { ...transcript.result, spec: request.schema.parse(transcript.result.spec) };
    },
  };
}
