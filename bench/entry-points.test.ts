import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { measureArm } from './measure-arm.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}));

vi.mock('./measure-arm.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./measure-arm.js')>()),
  measureArm: vi.fn(),
}));

const REPO = fileURLToPath(new URL('..', import.meta.url));

function runScript(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node_modules/.bin/tsx', args, {
      cwd: REPO,
      env: { ...process.env, ANTHROPIC_API_KEY: '', RUDRA_REPLAY_ONLY: '1' },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('importing a bench entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('run.ts runs no arm', async () => {
    let failure: unknown;
    await import('./run.js').catch((error: unknown) => {
      failure = error;
    });

    expect(execFileSync).not.toHaveBeenCalled();
    expect(failure).toBeUndefined();
  });

  it('run-arm.ts measures nothing', async () => {
    let failure: unknown;
    await import('./run-arm.js').catch((error: unknown) => {
      failure = error;
    });

    expect(measureArm).not.toHaveBeenCalled();
    expect(failure).toBeUndefined();
  });
});

describe('running a bench entry point as a script', () => {
  it('run-arm.ts asks for an arm name and exits 2', { timeout: 30_000 }, async () => {
    const ran = await runScript(['bench/run-arm.ts']);

    expect(ran.stderr).toContain('run-arm needs an arm name');
    expect(ran.code).toBe(2);
  });
});
