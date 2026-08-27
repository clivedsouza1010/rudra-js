import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './seeded-random.js';

describe('a seeded random', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);

    expect(Array.from({ length: 5 }, first)).toEqual(Array.from({ length: 5 }, second));
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
