// What verify.ts prints when the check fails. Kept apart from verify.ts so
// these messages can be tested without starting anything.

// The one local command that is safe to run: no key reaches next, so no bill.
const SAFE_BUILD_LINE =
  'ANTHROPIC_API_KEY= RUDRA_REPLAY_ONLY=1 npm run build --workspace @rudra-js/example-shop';

export function exitedBeforeServing(code: number | null): string {
  return (
    `the shop exited with ${code} before serving anything. If there is no production build yet, run:\n` +
    `  ${SAFE_BUILD_LINE}`
  );
}

// Called once, in main's catch-all, so no failure loses what the shop said —
// not just the one that happens to exit before serving.
export function reportFailure(error: unknown, seen: string): void {
  console.error(error instanceof Error ? error.message : String(error));

  const shopSaid = seen.trim();
  if (shopSaid) console.error(`the shop said:\n${shopSaid}`);
}
