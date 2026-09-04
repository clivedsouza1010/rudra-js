// What verify.ts prints when the check fails. Kept apart from verify.ts so
// these messages can be tested without starting anything.

// The one local command that is safe to run: no key reaches next, so no bill.
const SAFE_BUILD_LINE =
  'ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop';

export function exitedBeforeServing(code: number | null, signal: NodeJS.Signals | null): string {
  // A null code means a signal killed it, and then the signal name is the only
  // thing that says anything: an out-of-memory kill in CI reads as SIGKILL.
  if (code === null) return `the shop was killed by ${signal} before serving anything`;
  return `the shop exited with ${code} before serving anything`;
}

// Called once, in main's catch-all, so no failure loses what the shop said —
// not just the one that happens to exit before serving. Next can bind the
// port and log "Ready" with no production build in place at all, then fail
// on the first real request and print its own "next build" advice — which
// reads .env.local and bills. So the safe line is named on every failure,
// not only one that looks like a missing build.
export function reportFailure(error: unknown, seen: string): void {
  console.error(error instanceof Error ? error.message : String(error));

  const shopSaid = seen.trim();
  if (shopSaid) console.error(`the shop said:\n${shopSaid}`);

  console.error(
    `if there is no production build yet, the safe way to make one is:\n  ${SAFE_BUILD_LINE}`,
  );
}
