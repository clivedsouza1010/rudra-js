# Recordings

One transcript per page the repository makes a claim about — not one per page
anyone happens to load.

Committed here: the answer for `RJ-00001` and shopper `S-0001`, which is the
page `replay-miss.test.ts` guards. That file is what lets a clone with no API
key render a real generated component, and what arms the guard.

Anything else recorded while browsing with a key set is incidental. It is model
output, it dates, and nothing asserts against it — so delete strays rather than
committing them. A page with no transcript falls back, which is the designed
behaviour, and re-recording is one page load.

A transcript is tied to the prompt that produced it. Change the prompt — as the
move to cohort mode did — and every recording has to be made again.
