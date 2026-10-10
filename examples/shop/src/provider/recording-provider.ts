import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ComponentProvider,
  PromptPair,
  ProviderRequest,
  ProviderResult,
} from '@rudra-js/core';

interface Transcript {
  model: string;
  system: string;
  user: string;
  result: ProviderResult;
}

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
      const path = transcriptPath(directory, inner.model, request);
      const recorded = readRecording(path, request);
      if (recorded) return recorded;

      const result = await inner.generate(request);

      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          path,
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
  name: string;
  model: string;
}): ComponentProvider {
  return {
    name: options.name,
    model: options.model,

    async generate(request) {
      const path = transcriptPath(options.directory, options.model, request);
      const recorded = readRecording(path, request);
      if (recorded) return recorded;

      const message = `no recording for this request at ${path}`;
      console.warn(message);
      throw new Error(message);
    },
  };
}

function readRecording(path: string, request: ProviderRequest): ProviderResult | null {
  let transcript: Partial<Transcript> | null;
  try {
    transcript = JSON.parse(readFileSync(path, 'utf8')) as Partial<Transcript> | null;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new Error(`recording is not valid JSON: ${path}`, { cause });
  }

  const result = transcript?.result;
  if (typeof result !== 'object' || result === null) {
    throw new Error(`the recording at ${path} has no result to replay`);
  }

  return { ...result, spec: request.schema.parse(result.spec) };
}
