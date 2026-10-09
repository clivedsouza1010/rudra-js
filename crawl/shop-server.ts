import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not work out a free port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

export type RunningShop = {
  shop: ChildProcess;
  ready: Promise<void>;
  seen: () => string;
};

export type ShopCommand = { file: string; args: string[] };

function shopCommand(port: number): ShopCommand {
  return {
    file: 'npm',
    args: ['run', 'start', '--workspace', '@rudra-js/example-shop', '--', '-p', String(port)],
  };
}

export function exitedBeforeServing(code: number | null, signal: NodeJS.Signals | null): string {
  if (code === null) return `the shop was killed by ${signal} before serving anything`;
  return `the shop exited with ${code} before serving anything`;
}

export function startShop(port: number, command: ShopCommand = shopCommand(port)): RunningShop {
  const shop = spawn(command.file, command.args, {
    env: {
      ...process.env,
      RUDRA_REPLAY_ONLY: '1',
      RUDRA_SHOP_MODE: 'replay',
      ANTHROPIC_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const boundAddress = `http://localhost:${port}`;
  let seen = '';

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the shop did not start within 60 seconds')),
      60_000,
    );

    const remember = (chunk: Buffer): void => {
      seen += chunk.toString();
      if (seen.includes(boundAddress)) {
        clearTimeout(timer);
        resolve();
      }
    };
    shop.stdout?.on('data', remember);
    shop.stderr?.on('data', remember);

    shop.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(exitedBeforeServing(code, signal)));
    });
  });

  return { shop, ready, seen: () => seen };
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {}
}

export async function stopShop(shop: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (shop.exitCode !== null || shop.signalCode !== null) {
      resolve();
      return;
    }
    if (shop.pid === undefined) {
      resolve();
      return;
    }
    const pid = shop.pid;
    const escalate = setTimeout(() => {
      signalGroup(pid, 'SIGKILL');
    }, 5_000);
    shop.once('exit', () => {
      clearTimeout(escalate);
      resolve();
    });
    signalGroup(pid, 'SIGTERM');
  });

  shop.stdout?.destroy();
  shop.stderr?.destroy();
  shop.unref();
}
