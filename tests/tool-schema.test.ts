import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generatedSpecSchema } from '@rudra-js/core';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GOLDEN = join(REPO_ROOT, 'tests/golden/tool-input-schema.json');

const serialise = (io: 'input' | 'output'): string =>
  `${JSON.stringify(z.toJSONSchema(generatedSpecSchema, { io }), null, 2)}\n`;

describe('the schema the model is asked to fill in', () => {
  it('is byte for byte what is committed', () => {
    // This object is sent to the provider as the tool's input_schema, so it is
    // part of the prompt. zod decides how it is written down, and a zod upgrade
    // has already changed it once: 4.5.0 rewrote every nullable field from
    // anyOf to a type array, which no test noticed.
    expect(
      serialise('input'),
      'The tool schema changed. If that was deliberate, run:\n' +
        '  node --input-type=module -e \'import {z} from "zod"; import {writeFileSync} from "node:fs";' +
        ' const {generatedSpecSchema} = await import("./packages/core/dist/index.js");' +
        ' writeFileSync("tests/golden/tool-input-schema.json", JSON.stringify(' +
        'z.toJSONSchema(generatedSpecSchema, {io:"input"}), null, 2) + "\\n")\'\n' +
        'If it was not, a dependency changed what the model is being asked for.',
    ).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('is the shape the provider actually sends, which is not the output shape', () => {
    // zod's 'output' carries additionalProperties: false on every block and
    // 'input' does not. The provider sends 'input'. Anything checking the
    // structured-output contract has to check that one, or it is checking an
    // object nobody sends.
    expect(serialise('input')).not.toBe(serialise('output'));
    expect(serialise('output')).toContain('"additionalProperties": false');
    expect(serialise('input')).not.toContain('"additionalProperties"');
  });
});
