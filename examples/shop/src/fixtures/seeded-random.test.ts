import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './seeded-random.js';

describe('a seeded random', () => {
  it('produces the same sequence for the same seed', () => {
    const random = createSeededRandom(42);

    // Pinned to values captured from a real run, not cross-checked against a
    // second call: two live invocations that both ignored `seed` would agree
    // with each other just as well, and this would not catch that.
    expect(Array.from({ length: 5 }, random)).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('produces a different sequence for a different seed', () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(43);

    expect(Array.from({ length: 5 }, first)).not.toEqual(Array.from({ length: 5 }, second));
  });

  it('stays inside the unit interval', () => {
    const random = createSeededRandom(7);

    for (const value of Array.from({ length: 1000 }, random)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
