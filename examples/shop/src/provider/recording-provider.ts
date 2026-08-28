import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentProvider, PromptPair, ProviderResult } from '@rudra-js/core';

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

/**
 * Where the transcript for one prompt lives.
 *
 * A function of the same input the spec cache keys on, by way of the rendered
 * prompt: the cache keys on the digest, the candidate SKUs and the provider,
 * and the prompt is built from those — so one page maps to one file. Exported
 * because the replay-miss guard has to ask whether this page's transcript is
 * the one that got committed.
 */
export function transcriptPath(directory: string, model: string, prompt: PromptPair): string {
  const name = createHash('sha256')
    .update(JSON.stringify({ model, system: prompt.system, user: prompt.user }))
    .digest('hex')
    .slice(0, 32);

  return join(directory, `${name}.json`);
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

      // A write that fails must not discard an answer already paid for. The
      // generator treats any rejection from a provider as a model failure and
      // degrades the page, so an unwritable directory would look exactly like
      // the vendor being down — while the bill still arrives.
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          transcriptPath(directory, inner.model, request),
          `${JSON.stringify({ model: inner.model, system: request.system, user: request.user, result }, null, 2)}\n`,
        );
      } catch (error) {
        console.error(`could not write a transcript to ${directory}:`, error);
      }

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
      const path = transcriptPath(options.directory, options.model, request);

      if (!existsSync(path)) {
        const message = `no recording for this request at ${path}`;
        if (options.onMiss === 'throw') throw new Error(message);

        // Rejecting rather than returning nothing: the generator's own fallback
        // path is the right way to degrade, and it records why.
        console.warn(`${message} — falling back`);
        throw new Error(message);
      }

      let transcript: Transcript;
      try {
        transcript = JSON.parse(readFileSync(path, 'utf8')) as Transcript;
      } catch (cause) {
        // These files are committed and hand-edited; a bare SyntaxError names
        // a byte offset and nothing else, so name the file instead.
        throw new Error(`recording is not valid JSON: ${path}`, { cause });
      }

      if (
        typeof transcript !== 'object' ||
        transcript === null ||
        !('result' in transcript) ||
        typeof (transcript as { result?: unknown }).result !== 'object'
      ) {
        // Valid JSON of the wrong shape: the sibling case above already names
        // the file, and a hand-edited transcript deserves the same courtesy
        // rather than a TypeError about a property access.
        throw new Error(`the recording at ${path} has no result to replay`);
      }

      return { ...transcript.result, spec: request.schema.parse(transcript.result.spec) };
    },
  };
}
