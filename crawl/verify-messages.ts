const SAFE_BUILD_LINE =
  'ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop';

export function exitedBeforeServing(code: number | null, signal: NodeJS.Signals | null): string {
  if (code === null) return `the shop was killed by ${signal} before serving anything`;
  return `the shop exited with ${code} before serving anything`;
}

export function reportFailure(error: unknown, seen: string): void {
  console.error(error instanceof Error ? error.message : String(error));

  const shopSaid = seen.trim();
  if (shopSaid) console.error(`the shop said:\n${shopSaid}`);

  console.error(
    `if there is no production build yet, the safe way to make one is:\n  ${SAFE_BUILD_LINE}`,
  );
}
