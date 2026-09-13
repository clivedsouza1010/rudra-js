# @rudra-js/attested

Checks model-written product copy against the facts a shop stands behind.

Zero dependencies, no node builtins, no I/O. It is one pure function over text
and facts, so it runs in Node, in an edge runtime and in a browser, and it drops
in after anything that writes copy — json-render, the Vercel AI SDK, a raw
`fetch` to a model, your own template.

## The guarantee

**When `quantity.supported` is true, every numeral in the text is one you
supplied — and a numeral the reader cannot read counts as a failure, not a
pass.**

That is the whole promise, and it is a promise about numerals, not about
sentences. It does not say the sentence around the number is true: a price you
supplied can still be written as a sales figure. It says nothing at all about
`wording.supported`, which is a denylist over an open set and carries
`strength: 'best-effort'` on every result for that reason.

Everything the guarantee leaves open is listed under
[What it cannot catch](#what-it-cannot-catch). Nothing there is a bug queued for
later; it is the shape of what a closed check over digits can promise.

## Install

```sh
npm install @rudra-js/attested
```

```ts
import { verify } from '@rudra-js/attested';

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

**What it reads.** Bare integers and decimals, both decimal separators (`4.8`
and `4,8`), currency symbols attached or detached, percentages, and any Unicode
decimal digit — Eastern Arabic `٤٫٨`, Devanagari `४.८` and mathematical `𝟰.𝟴`
all read as 4.8. Grouping is read in the Western (`12,345,678`), Indian
(`1,29,999`), space (`1 299`, including the no-break and narrow no-break spaces)
and Swiss (`1'299`) shapes.

**How an ambiguous mark is decided.** One dot or comma with exactly three digits
behind it is grouping, never a decimal point. `1,299` and `1.299` both read as
1299 and nothing else, which is why a rating of 4.8 cannot stand behind a
written `4.800` and a stock count of 12 cannot stand behind `12.000`. Where
grouping is impossible the decimal reading survives, so `1234,567` is still
1234.567. Where the two marks differ the last one is the decimal point, so
`1.299,50` is 1299.5.

**What it refuses to read.** Three things become findings rather than passes:

- A numeric character that is not a decimal digit — `½`, `²`, `②`, `Ⅲ`. These
  render as numbers and carry a value the reader has no way to check.
- A magnitude mark glued to a run — `4.8万`, `12M`, `4.8k`. The digits may be
  yours; the multiplier is not.
- A run no locale reads as a number — `24.12.2026`, `3.14.15`. These are
  supported only by a fact written exactly the same way.

Invisible characters are dropped before any of this, so a zero-width space or a
soft hyphen cannot split `213` into a `2` and a `13` that happen to be supported
separately.

### Layer two — wording. This is the best-effort half.

Claims with no number in them: "cheap", "bargain", "on sale", "best-selling",
"selling fast", "in stock", "free delivery". There is no value to check, so
there is nothing to invert. It stays a denylist, it stays open and
English-first, and every result it produces says so:

```ts
verify('Selling fast', { values: [] }).wording;
// { supported: false, strength: 'best-effort', checked: 81, findings: [...] }
```

Add your own for your own language, and drop the ones you stand behind:

```ts
verify('Nur noch wenige', { values: [], bannedPhrases: ['nur noch'] });
verify('In stock, ships today', { values: [], allowedPhrases: ['in stock'] });
```

`bannedPhrases` is added to the built-in list; `allowedPhrases` is removed from
it, and is applied last, so a shop that genuinely offers free shipping can say
so. Without that, a denylist bans the truthful disclosure as hard as the
fabricated one — it has no notion of negation, so "we do not discount this item"
reads to it exactly like "discount".

Matching is case-insensitive. Hyphens and line breaks become spaces, accents are
composed, fullwidth forms are folded, invisible characters are dropped, and a
handful of Cyrillic and Greek letters that render as Latin ones are folded to
Latin. Spaces are dropped from both sides before matching, so `送料 無料` still
reads as `送料無料`. A phrase whose first or last character is an ASCII letter or
digit will not match glued inside a longer word, so `cheap` misses `cheapskate`,
but a trailing `s` is allowed, so `discount` catches `discounts`.

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

`checked` says how much the layer actually looked at. `quantity.checked === 0`
means the text held no numeral and layer one proved nothing about it — which is
the honest reading of `"Only two left"`, and no assertion you can write on the
result will turn that into a catch. Layer one counts the numerals it refuses to
read, so `"Only ② left"` is a finding rather than a silent zero.

## Facts

```ts
interface Facts {
  values: readonly (string | number)[];
  bannedPhrases?: readonly string[];
  allowedPhrases?: readonly string[];
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

The cost is real and it is stated under **What it cannot catch**. Two things
follow from it that are worth doing:

- **Supply only numbers you are happy to see anywhere.** A SKU of `AT-2199` in
  `values` makes `"Was $2,199"` a supported sentence. A listing date makes its
  day number a supported sales figure. If a number in your record is not a fact
  about the product a shopper would read, leave it out.
- **`values` is a trust boundary.** On a marketplace the product title is
  written by the seller, not by you. Putting it in `values` hands the model
  every number the seller chose to type. Supply fields you author.

## Many fields, one product

```ts
import { verifyFields } from '@rudra-js/attested';

const result = verifyFields(
  { headline: 'Yours for $39', badge: 'Only 2 left', body: 'Built for long days' },
  { values: [39] },
);

result.supported; // false
result.fields; // [{ field, result }, ...] in the order the fields were given
result.acrossFields; // the wording layer over every field read as one
```

The facts are read once and reused. A card renders its fields next to each
other, and the model picks the field boundaries, so
`{ badge: 'Free', delivery: 'delivery on every order' }` is one sentence to a
shopper while neither field carries it alone. `acrossFields` reads the joined
text and counts toward `supported`.

## What it cannot catch

This is the honest list.

### Claims with a number in them

- **A number that is real but means something else.** This is the largest hole
  in the provable half. A flat fact set proves the number came from you, not
  that the sentence uses it correctly. Supply a price of 39 and `"39 sold in the
last hour"`, `"Save $39 today"` and `"Under $39"` all pass. Supply a rating
  scale of 5 and `"Only 5 left"` passes. Supply a rating of 4.8 and a German
  `"nur 4,80 €"` passes as a price, because 4.80 and 4.8 are one number.
- **Numbers written as words, in any script.** `"Only two left"` has no digit in
  it, so layer one never sees it. Neither does `残り二点`, where 二 is a
  character rather than a digit, nor Arabic `قطعتين`, where "two" is the noun's
  dual ending and there is no numeral at all. `quantity.checked` is 0 for all
  three, and that is the only signal you get.
- **Magnitudes written as words.** `4.8万` and `12M` are caught. `4,8 Millionen`,
  `4.8 millions`, `4,8 mil`, `4.8 लाख` and `٤٫٨ مليون` are not — a word list is
  the denylist this package exists to get away from.
- **The unit on the number.** `￥39.99` against a price of $39.99 passes: the
  digits are yours and the currency symbol is not a digit. So does
  `"39,99 Cent"`. Layer one checks the number, never what it is a number of.
- **A number your facts happen to contain.** A fact of `'2026-09-13'` makes
  2026, 9 and 13 supported everywhere in the text, including as a stock count.
- **Where in the text a token was.** A finding names the token, not its offset.

### Claims with no number in them

- **Wording, in general.** Layer two is a denylist over an infinite set. A
  careful rewording gets past it — `"Half of what it was"` for half price,
  `"送料は無料"` with a particle dropped in. Entries are added as they are found,
  and the list will never be finished.
- **Your language, until you give it one.** Every built-in phrase is English.
  `"Gratis Versand"`, `"Livraison offerte"` and `"شحن مجاني"` all pass by
  default. `bannedPhrases` is the answer, and it is your list to keep.
- **Negation.** The list matches substrings, so `"there is no sale on this
product"` is caught as a sale claim. `allowedPhrases` is the way out.

### Preconditions the package cannot check for you

- **The text you check has to be the text you render.** `verify` sees a string.
  If anything downstream decodes it — an HTML sink turning `&half;` into ½, or
  `&#50;` into a 2 — then the string that was checked and the string on the page
  are different documents, and the guarantee covers the first one.
- **Everything that is not a number or a phrase.** A claim about materials,
  compatibility, a certification, a warranty condition or a person is entirely
  out of scope.

## What it over-rejects

The guarantee errs toward rejection, and that has a bill:

- **Every incidental number has to be in `values`.** A VAT rate, a size, a care
  temperature, a spec number, a support phone number, a founding year, the
  denominator of a rating scale. None of them are claims, all of them are
  digits, and copy mentioning one you did not supply is rejected.
- **A three-digit tail is always grouping.** `1.299 kg` reads as 1299, so a
  genuine three-decimal number — a weight, or a price in a currency with three
  decimal places — cannot be written with a dot or a comma. Supply it, and write
  it, the same way.
- **Numeric characters that are not digits are refused outright.** `2 m²` and
  `½ inch` fail, along with the `②` and `Ⅲ` the rule is there to stop.
- **A magnitude letter glued to a digit is refused.** `4K display` fails.
  `4 K display` and `1kg` do not, because a letter followed by another letter is
  a unit, not a multiplier.
- **A run no locale reads as a number needs its exact spelling.** `24.12.2026`
  is supported by a fact of `'24.12.2026'` and by nothing else.

## Licence

MIT
