# @rudra-js/verify

Checks model-written product copy against the facts a shop stands behind.

Zero dependencies, no node builtins, no I/O. It is one pure function over text
and facts, so it runs in Node, in an edge runtime and in a browser, and it drops
in after anything that writes copy — json-render, the Vercel AI SDK, a raw
`fetch` to a model, your own template.

## Install

```sh
npm install @rudra-js/verify
```

```ts
import { verify } from '@rudra-js/verify';

const result = verify('Only 2 left at $39', { values: [39, 'SKU TR-101'] });

result.supported; // false
result.quantity.findings;
// [{ layer: 'quantity', token: '2', reason: 'quantity: "2" is not a value the supplied facts carry' }]
```

## The two layers

They are checked separately and reported separately, because only one of them is
a proof.

### Layer one — quantities. This is the provable half.

Every run of digits in the text has to be a value you supplied. Not "does this
read like a bad phrase" but "is this number one the shop stands behind". The set
of digits in a string is closed and checkable, and it does not care what
language the sentence is in.

```ts
verify('Nur noch 2 übrig', { values: [39] }).quantity.supported; // false
verify('4,8 von 5', { values: [4.8, 5] }).quantity.supported; // true
```

It is crude on purpose and it errs toward rejection. `"Only 2 left"` is
unsupported unless you supplied a fact carrying 2, even though 2 is also the
number of colourways. A false rejection costs a duller sentence; a false
acceptance costs a fabricated claim.

It handles bare integers and decimals, both decimal separators (`4.8` and
`4,8`), digit grouping (`1,299` and `1.299`), currency symbols attached or
detached, percentages, and any Unicode decimal digit — Eastern Arabic
`٤٫٨` reads the same as `4.8`.

A run with an ambiguous separator keeps both readings, so `1,299` is supported
by a fact of `1299` or of `1.299`. A run that reads as nothing at all — `3.14.15`
— keeps none, and is therefore never supported.

### Layer two — wording. This is the best-effort half.

Claims with no number in them: "cheap", "bargain", "on sale", "best-selling",
"selling fast", "in stock", "free delivery". There is no value to check, so
there is nothing to invert. It stays a denylist, it stays open and
English-first, and every result it produces says so:

```ts
verify('Selling fast', { values: [] }).wording;
// { supported: false, strength: 'best-effort', checked: 54, findings: [...] }
```

Add your own for your own language:

```ts
verify('Nur noch wenige', { values: [], bannedPhrases: ['nur noch', 'fast ausverkauft'] });
```

Your phrases are added to the built-in list, not swapped for it. They are
matched case-insensitively, with hyphens and line breaks treated as spaces. A
phrase whose first or last character is an ASCII letter or digit will not match
glued inside a longer word, so `cheap` misses `cheapskate`; a phrase in a script
that writes no word gaps has no such guard, so a Japanese or Chinese phrase
still matches.

## The result

```ts
interface VerifyResult {
  supported: boolean; // both layers
  quantity: LayerReport;
  wording: LayerReport;
}

interface LayerReport {
  supported: boolean;
  strength: 'proof' | 'best-effort';
  checked: number; // numerals found, or phrases screened against
  findings: Finding[]; // one per distinct token that failed
}

interface Finding {
  layer: 'quantity' | 'wording';
  token: string; // the numeral as the text wrote it, or the phrase
  reason: string; // audit evidence, naming the layer and the token
}
```

`checked` is there so a check that checked nothing is visible. A guarantee that
quietly stops guaranteeing is worse than none, so assert on it:

```ts
const result = verify(headline, facts);
if (result.quantity.checked === 0 && /\d/.test(headline)) {
  throw new Error('the headline has digits in it that the quantity layer never saw');
}
```

## Facts

```ts
interface Facts {
  values: readonly (string | number)[];
  bannedPhrases?: readonly string[];
}
```

`values` is a flat list, not a typed one. Write them however they are written in
your own system — `39`, `'$1,299.00'`, `'4,8'`, `'ships 13 March'` — and every
numeral in each one becomes a supported value.

Flat rather than typed (money, count, rating, date) because typing only helps if
the extractor can classify a token in the text, and it cannot. The `2` in
`"Only 2 left"` and the `2` in `"2 year warranty"` are the same two characters;
telling them apart means understanding the sentence, in whatever language it was
written, which is the problem this package exists to stop relying on. Typed
facts would also need an "unclassified, so skip it" branch, and that branch is a
hole. A flat set has no hole: every numeral is checked against every value.

The cost is stated plainly under **What it cannot catch**.

## Many fields, one product

```ts
import { verifyFields } from '@rudra-js/verify';

const result = verifyFields(
  { headline: 'Yours for $39', badge: 'Only 2 left', body: 'Built for long days' },
  { values: [39] },
);

result.supported; // false
result.fields; // [{ field, result }, ...] in the order the fields were given
```

The facts are read once and reused across the fields.

## What it cannot catch

This is the honest list. None of it is a bug to be fixed later; it is the shape
of what a closed check over digits can and cannot promise.

- **Numbers written as words.** "Only two left" has no digit in it, so layer one
  never sees it. Layer two catches it only if the exact phrasing is on a
  denylist, which is the thing this package exists to get away from. This is the
  largest hole.
- **A number that is real but means something else.** A flat fact set proves the
  number came from you, not that the sentence uses it correctly. Supply a price
  of 39 and `"39 people bought this today"` passes layer one.
- **Any digit supports any digit.** A fact of `'2026-09-13'` makes 2026, 9 and
  13 supported everywhere in the text, including as a stock count.
- **Wording, in general.** Layer two is a denylist over an infinite set. A
  careful rewording gets past it, and it knows nothing of your language until
  you tell it. `strength: 'best-effort'` is on every result for that reason.
- **Digits in a numeral system that is not a Unicode decimal digit.** Superscript
  `²`, Roman numerals and spelled-out CJK numerals (一二三) are not read as
  numbers, so they pass unseen.
- **Grouping marks this does not know.** A space or an apostrophe as a thousands
  mark — `1 299`, `1'299` — splits into separate runs, each of which must be
  supported on its own. That over-rejects rather than under-rejects.
- **Where in the text a token was.** A finding names the token, not its offset.
- **Everything that is not a number or a phrase.** A claim about materials,
  compatibility, a certification, a warranty condition or a person is entirely
  out of scope.

## Licence

MIT
