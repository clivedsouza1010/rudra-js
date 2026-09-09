import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { measureArm } from './measure-arm.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}));

vi.mock('./measure-arm.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./measure-arm.js')>()),
  measureArm: vi.fn(),
}));

describe('importing a bench entry point', () => {
  it('run.ts runs no arm', async () => {
    await import('./run.js');

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('run-arm.ts measures nothing', async () => {
    await import('./run-arm.js');

    expect(measureArm).not.toHaveBeenCalled();
  });
});
