import { describe, expect, it } from 'vitest';
import { mulberry32 } from './seeded-random';

describe('a seeded random', () => {
  it('produces the same sequence for the same seed', () => {
    const random = mulberry32(42);

    expect(Array.from({ length: 5 }, random)).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('produces a different sequence for a different seed', () => {
    const first = mulberry32(42);
    const second = mulberry32(43);

    expect(Array.from({ length: 5 }, first)).not.toEqual(Array.from({ length: 5 }, second));
  });

  it('stays inside the unit interval', () => {
    const random = mulberry32(7);

    for (const value of Array.from({ length: 1000 }, random)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
