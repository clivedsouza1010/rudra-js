import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { exitedBeforeServing } from './verify-messages.js';

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

export function startShop(port: number, command: ShopCommand = shopCommand(port)): RunningShop {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    RUDRA_REPLAY_ONLY: '1',
    RUDRA_SHOP_MODE: 'replay',
  };
  environment['ANTHROPIC_API_KEY'] = '';

  const shop = spawn(command.file, command.args, {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(
    () => rejectReady(new Error('the shop did not start within 60 seconds')),
    60_000,
  );
  const boundAddress = `http://localhost:${port}`;

  let seen = '';
  const remember = (chunk: Buffer): void => {
    seen += chunk.toString();
    if (seen.includes(boundAddress)) {
      clearTimeout(timer);
      resolveReady();
    }
  };
  shop.stdout?.on('data', remember);
  shop.stderr?.on('data', remember);

  shop.on('exit', (code, signal) => {
    clearTimeout(timer);
    rejectReady(new Error(exitedBeforeServing(code, signal)));
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
