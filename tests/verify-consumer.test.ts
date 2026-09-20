import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const script = readFileSync(join(REPO_ROOT, 'scripts/verify-consumer.mjs'), 'utf8');
const fixture = readFileSync(join(REPO_ROOT, 'scripts/consumer-fixture.ts'), 'utf8');

describe('the consumer isolation check', () => {
  it('forbids a package that really does resolve from the repo root', () => {
    // The check passes when the import throws, so a name nothing can resolve proves nothing.
    const declared = /const MUST_NOT_RESOLVE = '([^']+)';/.exec(script);
    expect(declared, 'verify-consumer.mjs no longer declares MUST_NOT_RESOLVE').not.toBeNull();

    const fromRoot = createRequire(join(REPO_ROOT, 'package.json'));
    expect(() => fromRoot.resolve(declared![1]!)).not.toThrow();
  });

  it('substitutes the forbidden name into the consumer it generates', () => {
    const forbidden = /const MUST_NOT_RESOLVE = '([^']+)';/.exec(script);
    const placeholder = /const FORBIDDEN_PLACEHOLDER = '([^']+)';/.exec(script);
    expect(forbidden, 'verify-consumer.mjs no longer declares MUST_NOT_RESOLVE').not.toBeNull();
    expect(
      placeholder,
      'verify-consumer.mjs no longer declares FORBIDDEN_PLACEHOLDER',
    ).not.toBeNull();

    const generated = fixture.replaceAll(placeholder![1]!, forbidden![1]!);
    expect(generated).not.toContain(placeholder![1]!);
    expect(generated).toContain(`const forbidden: string = '${forbidden![1]!}';`);
  });

  it('rethrows an import failure that is not a resolution miss', () => {
    const guard = /\} catch \(error\) \{([\s\S]*?)\n\}/.exec(fixture);
    expect(guard, 'consumer-fixture.ts no longer catches the forbidden import').not.toBeNull();
    expect(guard![1]!).toContain('ERR_MODULE_NOT_FOUND');
    expect(guard![1]!).toContain('throw error');
  });
});
