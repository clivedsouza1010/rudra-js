import { describe, expect, it } from 'vitest';
import { parseArmOutput } from './run.js';

const good = JSON.stringify({ arm: 'c cohort', cpuUserMs: 134, cpuSystemMs: 2, views: 500 });

describe('reading what an arm process sent back', () => {
  it('returns the result when it is the arm that was asked for', () => {
    expect(parseArmOutput('c cohort', good).arm).toBe('c cohort');
  });

  it('refuses output that is not json, and shows what arrived', () => {
    expect(() => parseArmOutput('c cohort', `(node) warning\n${good}`)).toThrow(
      /did not return JSON.*\(node\) warning/s,
    );
  });

  it('refuses a result labelled as a different arm', () => {
    expect(() =>
      parseArmOutput('c cohort', JSON.stringify({ ...JSON.parse(good), arm: 'd per-shopper' })),
    ).toThrow(/asked for arm 'c cohort' and got 'd per-shopper'/);
  });

  it('refuses a result with no cpu, which is the column the run is for', () => {
    const { cpuUserMs, ...noCpu } = JSON.parse(good) as Record<string, unknown>;
    void cpuUserMs;

    expect(() => parseArmOutput('c cohort', JSON.stringify(noCpu))).toThrow(/reported no cpu/);
  });
});
