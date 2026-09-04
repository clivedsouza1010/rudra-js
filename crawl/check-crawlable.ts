// What the renderer puts on the wrapper. Finding this is finding the slot.
const SLOT = 'data-rudra-slot';

// React parks content it could not send in place inside one of these, then
// moves it with a script. A crawler runs neither. Checked against react-dom
// 19.2.8: a host that sets React's identifierPrefix moves the S: prefix, and
// then both of these stop matching without saying so.
const HIDDEN_HOLDER = '<div hidden id="S:';
const SWAP_SCRIPT = '$RC(';

export function checkCrawlable(html: string): string[] {
  const problems: string[] = [];

  const slotAt = html.indexOf(SLOT);
  if (slotAt === -1) {
    // Nothing else can be judged without it.
    return ['the page has no recommendation slot at all'];
  }

  const mainEndsAt = html.indexOf('</main>');
  if (mainEndsAt === -1) {
    problems.push('the page has no </main>, so the slot position cannot be checked');
  } else if (slotAt > mainEndsAt) {
    problems.push('the slot is after </main>, so it is not in position');
  }

  if (html.includes(HIDDEN_HOLDER)) {
    problems.push('the page holds content in a hidden div for a script to move');
  }

  if (html.includes(SWAP_SCRIPT)) {
    problems.push('the page uses a script to move content into place');
  }

  return problems;
}
