import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const script = readFileSync(join(REPO_ROOT, 'scripts/verify-consumer.mjs'), 'utf8');

describe('the consumer isolation check', () => {
  it('forbids a package that really does resolve from the repo root', () => {
    // The check passes when the import throws, so a name nothing can resolve proves nothing.
    const declared = /const MUST_NOT_RESOLVE = '([^']+)';/.exec(script);
    expect(declared, 'verify-consumer.mjs no longer declares MUST_NOT_RESOLVE').not.toBeNull();

    const fromRoot = createRequire(join(REPO_ROOT, 'package.json'));
    expect(() => fromRoot.resolve(declared![1]!)).not.toThrow();
  });
});
