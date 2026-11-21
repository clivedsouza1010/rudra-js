import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  exitedBeforeServing,
  freePort,
  startDemo,
  stopDemo,
  type DemoCommand,
} from './demo-server.js';

const IN_GROUP = "{ stdio: 'ignore' }";
const HOLDS_THE_PIPE = "{ stdio: ['ignore', 'inherit', 'inherit'], detached: true }";

function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function standIn(port: number, grandchildOptions: string): DemoCommand {
  const script = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], ${grandchildOptions});
console.log('grandchild ' + child.pid);
console.log('http://localhost:${port}');
setTimeout(() => {}, 60000);
`;
  return { file: process.execPath, args: ['-e', script] };
}

function grandchildOf(output: string): number {
  return Number(/grandchild (\d+)/.exec(output)?.[1]);
}

describe('the message for a demo that exited before serving', () => {
  it('names the exit code', () => {
    expect(exitedBeforeServing(1, null)).toEqual('the demo exited with 1 before serving anything');
  });

  it('names the signal when one killed the demo, because there is no code then', () => {
    expect(exitedBeforeServing(null, 'SIGKILL')).toEqual(
      'the demo was killed by SIGKILL before serving anything',
    );
  });
});

describe('freePort', () => {
  it('returns a port nothing is listening on', async () => {
    const port = await freePort();
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, resolve);
    });

    expect((server.address() as AddressInfo).port).toBe(port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('stopDemo', () => {
  it('takes the grandchild down with the demo', { timeout: 15_000 }, async () => {
    const port = await freePort();
    const { demo, ready, seen } = startDemo(port, standIn(port, IN_GROUP));
    await ready;
    const pid = demo.pid!;
    const grandchild = grandchildOf(seen());
    expect(grandchild).toBeGreaterThan(0);

    try {
      await stopDemo(demo);

      await expect.poll(() => gone(pid), { timeout: 5_000, interval: 25 }).toBe(true);
      await expect.poll(() => gone(grandchild), { timeout: 5_000, interval: 25 }).toBe(true);
    } finally {
      for (const orphan of [pid, grandchild]) {
        if (!gone(orphan)) process.kill(orphan, 'SIGKILL');
      }
    }
  });

  it('drops its end of the pipes when a grandchild outlives the kill', async () => {
    const port = await freePort();
    const { demo, ready, seen } = startDemo(port, standIn(port, HOLDS_THE_PIPE));
    await ready;
    const grandchild = grandchildOf(seen());
    expect(grandchild).toBeGreaterThan(0);

    try {
      await stopDemo(demo);

      expect(gone(grandchild)).toBe(false);
      expect(demo.stdout?.destroyed).toBe(true);
      expect(demo.stderr?.destroyed).toBe(true);
    } finally {
      if (!gone(grandchild)) process.kill(grandchild, 'SIGKILL');
    }
  });
});
