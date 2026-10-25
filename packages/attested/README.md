# @rudra-js/attested

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A
language model designs one product-recommendation block for a page in your shop,
rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace
you sign up for.

This package checks model-written product copy against the facts your shop
stands behind.

The reference for both functions is on rudrajs.com:
[`verify`](https://rudrajs.com/reference/attested/verify) and
[`verifyFields`](https://rudrajs.com/reference/attested/verifyFields).

It's a pure function over text and facts. It has no dependencies and does no
I/O. It uses no Node built-ins either, so it runs in a browser or an edge
runtime as well as in Node. Drop it in after anything that writes copy:
json-render, the Vercel AI SDK, a raw `fetch` to a model, or your own template.

## The guarantee

**When `quantity.supported` is true, every numeral in the text is one you
supplied. A numeral the package can't read counts as a failure.**

That's the whole promise, and it covers numerals only. It doesn't say the
sentence around a number is true. It says nothing about `wording.supported`.

The gaps it leaves are listed under
[What it cannot catch](#what-it-cannot-catch). None of them is a bug waiting for
a fix.

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

`verify` checks two layers and reports each one separately. Layer one,
quantities, is a proof. Layer two, wording, is best-effort.

### Layer one: quantities

Layer one finds every run of digits in the text and checks it against the values
you supplied. It works the same whatever language the sentence is in.

```ts
verify('Nur noch 2 übrig', { values: [39] }).quantity.supported; // false
verify('4,8 von 5', { values: [4.8, 5] }).quantity.supported; // true
```

It leans toward rejecting. `"Only 2 left"` fails unless you supplied a fact
carrying 2, even when 2 is also the number of colourways. A wrong rejection
costs you a duller sentence. A wrong pass costs you a made-up claim.

**What it reads.**

- Whole numbers and decimals.
- Both decimal separators: `4.8` and `4,8`.
- Currency symbols, attached or detached.
- Percentages.
- Any Unicode decimal digit. Eastern Arabic `٤٫٨`, Devanagari `४.८` and
  mathematical `𝟰.𝟴` all read as 4.8.
- Digit grouping in the Western (`12,345,678`), Indian (`1,29,999`), space
  (`1 299`) and Swiss (`1'299`) shapes. The space shape also accepts the
  no-break and narrow no-break spaces.

**How it reads a dot or a comma.**

- One dot or comma with exactly three digits after it is grouping, never a
  decimal point. `1,299` and `1.299` both read as 1299 and nothing else. So a
  rating of 4.8 can't back a written `4.800`, and a stock count of 12 can't back
  `12.000`.
- Where grouping is impossible, the decimal reading stands. `1234,567` is
  1234.567.
- Where the two marks differ, the last one is the decimal point. `1.299,50` is
  1299.5.

**What it refuses to read.** Layer one reports these as findings:

- A numeric character that isn't a decimal digit, like `½`, `²`, `②` or `Ⅲ`.
  These show up on the page as numbers, and the package has no way to check the
  value they carry.
- A magnitude mark glued to a run of digits, like `4.8万`, `12M` or `4.8k`. The
  digits may be yours. The multiplier isn't.
- A run no locale reads as a number, like `24.12.2026` or `3.14.15`. Only a fact
  written exactly the same way backs it.

Before any of this, layer one drops characters that take no room on the page. So
a zero-width space, a soft hyphen, a variation selector, a backspace or a
combining overline can't split `213` into a `2` and a `13` that you happen to
have supplied separately. The rule works from Unicode's own categories, so it
covers all of Unicode with no hand-kept list. It drops:

- every format character
- every default-ignorable code point
- every control character except tabs and line breaks
- every mark that attaches to the character before it

A character that does take room still separates two numbers. A tab, a line break
and a Devanagari matra all leave a gap the shopper can see. So
`"Only 2\n3 left"` is two numbers, and a fact of 23 doesn't back it.

### Layer two: wording

Layer two looks for claims with no number in them: "cheap", "bargain", "on
sale", "best-selling", "selling fast", "in stock", "free delivery", "trending".
There's no value to check, so this layer is a denylist, a list of banned
phrases. Every result it gives carries `strength: 'best-effort'`:

```ts
verify('Selling fast', { values: [] }).wording;
// { supported: false, strength: 'best-effort', checked: 125, findings: [...] }
```

The list also covers generic environmental claims, like "eco-friendly", "carbon
neutral" and "sustainable". EU Directive 2024/825 applies through each country's
own law from 27 September 2026. Under it, a generic environmental claim is
unfair unless the trader can show recognised excellent environmental
performance. A "neutral" claim based on offsetting is unfair outright. The list
leaves out the bare word "green", because it's too often a colour.

Add phrases for your own language, and name the wording you stand behind:

```ts
verify('Nur noch wenige', { values: [], bannedPhrases: ['nur noch'] });
verify('In stock, ships today', { values: [], allowedPhrases: ['in stock'] });
```

`bannedPhrases` adds to the built-in list. `allowedPhrases` works on the text,
not on the list. **Where one of your allowed phrases appears, a banned claim
sitting wholly inside it isn't reported. The same words elsewhere in the copy
still are.** So `['back in stock']` clears `"Back in stock"` but still catches
the `in stock` in `"Only 2 in stock, selling fast"`. `checked` counts the whole
list either way, because an allowance removes nothing from it.

Without an allowance, the denylist bans a true statement as hard as a made-up
one. A shop that really offers free shipping couldn't say so. Before you write
an allowance, know this:

- **A shorter allowance doesn't clear a longer claim.** Allowing `in stock`
  doesn't clear `back in stock`, which also claims a restock.
- **Allowances don't combine, and they don't join up.** `['sold', 'out']` leaves
  `sold out` caught. `['back in', 'stock']` leaves both `in stock` and
  `back in stock` caught.
- **An allowance forgives whatever sits inside it, including phrases added to
  the list in a later version.** `['in stock and ready to ship']` forgives
  nothing extra today. The day `ready to ship` joins the list, that allowance
  silences it wherever your sentence appears. Keep allowances tight.
- **An allowance doesn't cross a line break.** The denylist reads straight
  through one, so `"Free\n\nshipping"` is still caught. An allowance won't
  bridge it. The model decides where paragraph breaks fall. A shopper reads
  `"We do not offer"` above a horizontal rule and a free shipping claim below it
  as two separate things. Both rules lean toward reporting a claim.

Before matching, layer two folds the copy and the phrases into one plain form:

- Case is ignored.
- Hyphens become spaces.
- Accents are composed, so `café` keeps its `é`. This happens before anything is
  dropped. An overline composes with nothing, so it gets dropped and can't hide
  `free` from its own entry.
- Fullwidth forms are folded to their normal-width versions.
- Characters that take no room are dropped.
- A handful of Cyrillic and Greek letters that look like Latin ones are folded
  to Latin.
- Greek letters lose their accents, so `ΕΥΚΑΙΡΙΑ` matches `ευκαιρία`. Greek
  words told apart only by their accent read as one, so `προσφορά` also catches
  `πρόσφορα`.
- Spaces are dropped, so `送料 無料` still reads as `送料無料`.

A phrase that starts or ends with an ASCII letter or digit won't match glued
inside a longer word. So `cheap` misses `cheapskate`. A trailing `s` is allowed,
so `discount` catches `discounts`. This word-gap rule reads the folded letters.
So a Greek phrase that starts or ends on a letter folded to Latin is held to it
too: `φθηνό` misses `φθηνότερο`. List each form you want caught.

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

`checked` tells you how much a layer actually looked at. When `quantity.checked`
is 0, the text held no numeral and layer one proved nothing about it. Layer one
counts the numerals it refuses to read, so `"Only ② left"` gives a finding
instead of a silent zero.

## Facts

```ts
interface Facts {
  values: readonly (string | number | bigint)[];
  bannedPhrases?: readonly string[];
  allowedPhrases?: readonly string[];
}
```

`values` is one flat list with no types. Write each value the way your own
system writes it, like `39`, `'$1,299.00'`, `'4,8'` or `'ships 13 March'`. Every
numeral in each value becomes a supported value.

A number is written out in plain digits first, whatever `String` would have made
of it. So a fact of `1e21` backs `'1,000,000,000,000,000,000,000'` and backs
neither `1` nor `21`. A string that holds nothing but a number in exponent
notation is written out the same way. `String`, `JSON.stringify`, spreadsheet
exports and APIs that write 64-bit values as strings all produce such strings.
You didn't pick those digits. Any other string is read exactly as
you typed it, so `'SKU AX-220e5'` still supplies 220 and 5.

A number in exponent notation that would run past a thousand digits when written
out backs no numeral at all.
The package checks the length before it writes anything out. `'1e1000'` isn't a
product fact under any reading, so it hits the limit and is refused. The limit
stops the extreme cases. `'1e2000000000'` is twelve characters, but writing it
out would take more memory than the process has. Every finite
JavaScript number fits well inside the limit. The longest is `5e-324`, at 326
characters.

Past 2^53, a number has lost its exact digits before it ever reaches this
package. `JSON.parse` turns `9007199254740993` into `...92`. Pass a long id as a
bigint or a string.

A null or undefined field backs no numeral and doesn't throw, so one empty field
doesn't break the whole call. Anything else is read through `String()` and
supplies whatever digits that gives. For a `Date`, that's the day, the year and
every digit of the clock. So a `listedAt` passed straight through isn't ignored.
It's one of the hazards under [What it cannot catch](#what-it-cannot-catch).

That section also lists what a flat list costs you. Two habits keep the cost
down:

- **Only supply numbers you're happy to see anywhere.** A SKU of `AT-2199` in
  `values` makes `"Was $2,199"` a supported sentence. If a number in your record
  isn't a fact about the product that a shopper would read, leave it out.
- **Treat `values` as a trust boundary.** On a marketplace, the seller writes
  the product title, not you. Putting it in `values` hands the model every
  number the seller chose to type. Supply only fields you write.

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

The facts are read once and reused for every field. A card shows its fields next
to each other, and the model picks where one field ends and the next begins. So
`{ badge: 'Free', delivery: 'delivery on every order' }` reads as one sentence
to a shopper, though neither field carries the claim alone. `acrossFields`
checks the joined text, and it counts toward `supported`.

## What it cannot catch

### Claims with a number in them

- **A number that is real but means something else.** This is the biggest gap in
  layer one. Supply a price of 39, and `"39 sold in the last hour"`,
  `"Save $39 today"` and `"Under $39"` all pass. Supply a rating scale of 5, and
  `"Only 5 left"` passes. Supply a rating of 4.8, and a German `"nur 4,80 €"`
  passes as a price, because 4.80 and 4.8 are the same number.
- **Numbers written as words, in any script.** `"Only two left"` has no digit in
  it, so layer one never sees it. Layer one also misses `残り二点`, where 二 is a
  character rather than a digit. It misses Arabic `قطعتين` too, where "two" is
  the noun's dual ending and there is no numeral at all. `quantity.checked` is 0
  for all three, and that's the only signal you get.
- **Magnitudes written as words.** The multiplier in `4,8 Millionen`,
  `4.8 millions`, `4,8 mil`, `4.8 लाख` or `٤٫٨ مليون` isn't caught.
- **The unit on the number.** `￥39.99` passes against a price of $39.99, because
  the digits are yours and the currency symbol isn't a digit. So does
  `"39,99 Cent"`. Layer one checks the number, never what it is a number of.
- **A number your facts happen to contain.** A fact of `'2026-09-13'` makes
  2026, 9 and 13 supported anywhere in the text, including as a stock count.
- **Where in the text a token was.** A finding names the token but not its
  position.

### Claims with no number in them

- **Wording, in general.** There are endless ways to word a claim, and a list
  can't hold them all. A careful rewording gets past layer two, like
  `"Half of what it was"` for half price, or `"送料は無料"` with a particle dropped
  in. Entries are added as they're found, and the list will never be finished.
- **Your language, until you give it one.** Every built-in phrase is English.
  `"Gratis Versand"`, `"Livraison offerte"` and `"شحن مجاني"` all pass by
  default. Add them with `bannedPhrases`. That list is yours to keep.
- **Negation.** The list matches substrings, so
  `"there is no sale on this product"` is caught as a sale claim. No rule reads
  the `no`. `allowedPhrases: ['no sale']` lets that sentence pass. That
  allowance is narrow, so a `sale` elsewhere in the same text still fails.
- **A character that folds into your allowance.** Allowances match the copy
  after the folding described under layer two. Anything that folds to your words
  counts as your words. Allow `no sale` and `"№ SALE"` passes, because U+2116
  folds to `no`. A superscript `ⁿᵒ` does the same. The shopper reads the numero
  sign as decoration, but the package reads it as a word. Write allowances the
  way a shop really writes them.
- **A letter glued to the end of a phrase.** `"FREE SHIPPINGᵃ see terms"` isn't
  reported. The superscript folds to an `a`, which glues onto `shipping`. The
  word-gap rule that stops `cheap` matching `cheapskate` then treats the whole
  thing as a longer word. This holds for every entry on the list. A footnote
  marker is exactly how a real shop writes one.

### Preconditions the package cannot check for you

- **The text you check has to be the text you render.** `verify` sees a string.
  Something downstream may decode it, like an HTML sink turning `&half;` into ½
  or `&#50;` into a 2. Then the string you checked and the string on the page
  are different documents. The guarantee covers only the one you checked.
- **The font has to agree with Unicode about what renders as nothing.** The
  package drops what Unicode marks as taking no room. Where a font gives one of
  those characters a visible glyph, the two disagree. U+3164 HANGUL FILLER is
  the one people really paste as a blank. Layer one reads `"1<U+3164>3"` as 13,
  while a font that widens it shows the shopper `1 3`.
- **Everything that isn't a number or a phrase.** A claim about materials,
  compatibility, a certification, a warranty condition or a person is out of
  scope.

## What it over-rejects

Leaning toward rejection has a cost:

- **Every incidental number has to be in `values`.** That means a VAT rate, a
  size, a care temperature, a number from the product specification, a support
  phone number, a founding year, the denominator of a rating scale. None of them
  are claims, but all of them are digits. Copy that mentions one you didn't
  supply is rejected.
- **Three digits after a dot or comma are always grouping.** A real
  three-decimal number, like a weight or a price in a currency with three
  decimal places, can't be written with a dot or a comma. `1.299 kg` reads
  as 1299. Supply it and write it the same way.
- **Numeric characters that aren't digits are refused outright.** `2 m²` and
  `½ inch` fail.
- **A magnitude letter glued to a digit is refused.** `4K display` fails.
  `4 K display` and `1kg` don't, because a letter followed by another letter is
  a unit, not a multiplier.
- **Scientific notation in the copy can never be supported.** A fact of `1e-7`
  is written out as `0.0000001`, and the text `"1e-7 g"` reads as the two
  numerals 1 and 7, so the two never meet. `"0.0000001 g"` passes. That's the
  cost of writing facts out in plain digits. It falls on a lab or bulk-goods
  shop that prints a value the way its own data prints it.

## Licence

MIT
