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

export type RunningDemo = {
  demo: ChildProcess;
  ready: Promise<void>;
  seen: () => string;
};

export type DemoCommand = { file: string; args: string[] };

function demoCommand(port: number): DemoCommand {
  return {
    file: 'npm',
    args: ['run', 'start', '--workspace', '@rudra-js/example-demo', '--', '-p', String(port)],
  };
}

export function exitedBeforeServing(code: number | null, signal: NodeJS.Signals | null): string {
  if (code === null) return `the demo was killed by ${signal} before serving anything`;
  return `the demo exited with ${code} before serving anything`;
}

export function startDemo(port: number, command: DemoCommand = demoCommand(port)): RunningDemo {
  const demo = spawn(command.file, command.args, {
    env: {
      ...process.env,
      RUDRA_REPLAY_ONLY: '1',
      RUDRA_DEMO_MODE: 'replay',
      ANTHROPIC_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const boundAddress = `http://localhost:${port}`;
  let seen = '';

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the demo did not start within 60 seconds')),
      60_000,
    );

    const remember = (chunk: Buffer): void => {
      seen += chunk.toString();
      if (seen.includes(boundAddress)) {
        clearTimeout(timer);
        resolve();
      }
    };
    demo.stdout?.on('data', remember);
    demo.stderr?.on('data', remember);

    demo.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(exitedBeforeServing(code, signal)));
    });
  });

  return { demo, ready, seen: () => seen };
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {}
}

export async function stopDemo(demo: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (demo.exitCode !== null || demo.signalCode !== null) {
      resolve();
      return;
    }
    if (demo.pid === undefined) {
      resolve();
      return;
    }
    const pid = demo.pid;
    const escalate = setTimeout(() => {
      signalGroup(pid, 'SIGKILL');
    }, 5_000);
    demo.once('exit', () => {
      clearTimeout(escalate);
      resolve();
    });
    signalGroup(pid, 'SIGTERM');
  });

  demo.stdout?.destroy();
  demo.stderr?.destroy();
  demo.unref();
}
