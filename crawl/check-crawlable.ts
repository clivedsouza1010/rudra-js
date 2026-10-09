const SLOT = 'data-rudra-slot';

const HIDDEN_HOLDER = '<div hidden id="S:';
const SWAP_SCRIPT = '$RC(';

const NO_SLOT = 'the page has no recommendation slot at all';
const NO_MAIN = 'the page has no </main>, so the slot position cannot be checked';
const AFTER_MAIN = 'the slot is after </main>, so it is not in position';
export const HIDDEN_DIV = 'the page holds content in a hidden div for a script to move';
export const SWAP = 'the page uses a script to move content into place';

export function checkCrawlable(html: string): string[] {
  const problems: string[] = [];

  const slotAt = html.indexOf(SLOT);
  if (slotAt === -1) {
    return [NO_SLOT];
  }

  const mainEndsAt = html.indexOf('</main>');
  if (mainEndsAt === -1) {
    problems.push(NO_MAIN);
  } else if (slotAt > mainEndsAt) {
    problems.push(AFTER_MAIN);
  }

  if (html.includes(HIDDEN_HOLDER)) {
    problems.push(HIDDEN_DIV);
  }

  if (html.includes(SWAP_SCRIPT)) {
    problems.push(SWAP);
  }

  return problems;
}
