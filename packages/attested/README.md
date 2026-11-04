# @rudra-js/attested

This package is part of [rudra-js](https://rudrajs.com).

rudra-js is an open-source TypeScript library (MIT) you install from npm. A
language model designs one product-recommendation block for a page in your shop,
rudra-js checks it against your catalog, and React renders it.

It is not a hosted platform, a visual or low-code app builder, or a workspace
you sign up for.

You can use this package to check model-written product copy against the facts
your shop stands behind.

For more, see the reference for
[`verify`](https://rudrajs.com/reference/attested/verify) and
[`verifyFields`](https://rudrajs.com/reference/attested/verifyFields) on
rudrajs.com.

It's a pure function over text and facts. There are no dependencies and no I/O.
With no Node built-ins either, it will run in browsers and edge runtimes as well
as in Node. You can run this after anything that writes copy (json-render, the
Vercel AI SDK, a raw `fetch` to a model, your template, etc.).

## The guarantee

**When `quantity.supported` is true, every numeral in the text is one you
supplied. A numeral the package can't read counts as a failure.**

That's the whole promise, but it's just for numerals. It doesn't tell you if the
sentence around a number is true. It also says nothing about
`wording.supported`.

You can find the gaps it leaves listed under
[What it cannot catch](#what-it-cannot-catch). None of these gaps is a bug
waiting to be fixed.

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

There are two layers to `verify`. It reports on each of these separately. Layer
one (quantities) is a proof, but layer two (wording) is just best-effort.

### Layer one: quantities

This layer will find all the runs of digits in the text and check these runs
against the values you supplied. This doesn't depend on the language of the
sentence.

```ts
verify('Nur noch 2 übrig', { values: [39] }).quantity.supported; // false
verify('4,8 von 5', { values: [4.8, 5] }).quantity.supported; // true
```

It leans toward rejecting. `"Only 2 left"` will fail unless you have supplied a
fact carrying 2, even when 2 is also the number of colourways. A wrong rejection
will cost you a duller sentence, but a wrong pass will cost you a made-up claim.

**What it reads.**

- Whole numbers and decimals.
- Both decimal separators: `4.8` and `4,8`.
- Currency symbols, attached or detached.
- Percentages.
- Any Unicode decimal digit. Eastern Arabic `٤٫٨`, Devanagari `४.८` and
  mathematical `𝟰.𝟴` all read as 4.8.
- Digit grouping in the Western (`12,345,678`), Indian (`1,29,999`), space
  (`1 299`) and Swiss (`1'299`) shapes. For the space shape, it will also accept
  the no-break and narrow no-break spaces.

**How it reads a dot or a comma.**

- If there's just a single dot or comma with exactly three digits after it,
  that's grouping and never a decimal point. `1,299` and `1.299` both read as
  1299 and nothing else. As a result, a rating of 4.8 can't back a written
  `4.800`. A stock count of 12 can't back `12.000` either.
- If grouping is impossible, the decimal reading will stand. `1234,567` is
  1234.567.
- With two different marks, the last mark is the decimal point. `1.299,50` is
  1299.5.

**What it refuses to read.** It will report these as findings:

- A numeric character that isn't a decimal digit, like `½`, `²`, `②` or `Ⅲ`.
  These show up on the page as numbers, but the package has no way to check the
  value they carry.
- A magnitude mark glued to a run of digits, like `4.8万`, `12M` or `4.8k`. You
  may have supplied the digits, but not the multiplier.
- A run no locale reads as a number, like `24.12.2026` or `3.14.15`. These can
  only be backed by a fact written exactly like that.

To start with, this layer will drop characters that take no room on the page.
Because of this, a zero-width space, a soft hyphen, a variation selector, a
backspace or a combining overline can't split `213` into a `2` and a `13` that
you happen to have supplied separately. This rule is based on Unicode's
categories. That way it will cover all of Unicode with no hand-kept list. It
drops:

- all format characters
- all default-ignorable code points
- all control characters except tabs and line breaks
- all marks that attach to the previous character

But if a character does take room, it will separate two numbers. A tab, a line
break and a Devanagari matra all leave a gap the shopper can see. This is why
`"Only 2\n3 left"` counts as two numbers that a fact of 23 won't back.

### Layer two: wording

This layer looks for claims that don't have a number, like "cheap", "bargain",
"on sale", "best-selling", "selling fast", "in stock", "free delivery",
"trending". With no value to check, it has to be a denylist (a list of banned
phrases). All of its results carry `strength: 'best-effort'`:

```ts
verify('Selling fast', { values: [] }).wording;
// { supported: false, strength: 'best-effort', checked: 125, findings: [...] }
```

This list also covers generic environmental claims, like "eco-friendly", "carbon
neutral" and "sustainable". From 27 September 2026, EU Directive 2024/825
applies via each country's law. Under this directive, a generic environmental
claim is unfair unless the trader can show recognised excellent environmental
performance. A "neutral" claim based on offsetting is unfair outright. But this
list leaves out the bare word "green", because that's too often a colour.

You can add phrases for your language and also name the wording you stand
behind:

```ts
verify('Nur noch wenige', { values: [], bannedPhrases: ['nur noch'] });
verify('In stock, ships today', { values: [], allowedPhrases: ['in stock'] });
```

`bannedPhrases` adds to the built-in list, but `allowedPhrases` works on the
text and not on the list. **A banned claim that sits wholly inside an allowed
phrase won't be reported. But if these words appear elsewhere in the copy, they
will be.** For example, `['back in stock']` clears `"Back in stock"` but won't
clear the `in stock` in `"Only 2 in stock, selling fast"`. `checked` counts the
whole list either way, because an allowance won't take anything off the list.

Without an allowance, the denylist will ban a true statement as hard as a
made-up claim. Even a shop that really offers free shipping couldn't say that.
Here are some things to know if you plan to write an allowance:

- **A shorter allowance doesn't clear a longer claim.** If you allow `in stock`,
  this won't clear `back in stock`, which also claims a restock.
- **Allowances don't combine and don't join up.** `['sold', 'out']` leaves
  `sold out` caught. `['back in', 'stock']` leaves `in stock` and
  `back in stock` caught.
- **An allowance forgives whatever sits inside it. This includes phrases added
  to the list in a later version.** `['in stock and ready to ship']` forgives
  nothing extra today. But on the day `ready to ship` joins the list, that
  allowance will silence it wherever your sentence appears. Keep allowances as
  tight as you can.
- **An allowance doesn't cross a line break.** But the denylist will ignore a
  line break: `"Free\n\nshipping"` is still caught. An allowance won't bridge
  it. It's up to the model to place paragraph breaks. If there's
  `"We do not offer"` above a horizontal rule and a free shipping claim below
  it, a shopper will read these as two separate things. Both rules lean toward
  reporting a claim.

To match phrases, this layer first folds the copy and the phrases into a single
plain form:

- Case is ignored.
- Hyphens become spaces.
- Accents are composed: `café` keeps its `é`. This will be done before anything
  is dropped. Because an overline composes with nothing, it will be dropped and
  can't hide `free` from its entry.
- Fullwidth forms are folded to their normal-width versions.
- Characters that take no room are dropped.
- A handful of Cyrillic and Greek letters that look like Latin ones are folded
  to Latin.
- In Greek, letters lose their accents: `ΕΥΚΑΙΡΙΑ` matches `ευκαιρία`. Greek
  words told apart only by their accent will read as a single word: `προσφορά`
  also catches `πρόσφορα`.
- Spaces are dropped: `送料 無料` reads as `送料無料`.

If a phrase starts or ends with an ASCII letter or digit, it won't match glued
inside a longer word. For example, `cheap` misses `cheapskate`. But a trailing
`s` will be allowed. That way `discount` will catch `discounts`. This word-gap
rule reads the folded letters. This means a Greek phrase that starts or ends on
a letter folded to Latin is also held to this rule: `φθηνό` misses `φθηνότερο`.
You will have to list all of the forms you want caught.

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

`checked` tells you how much a layer actually looked at. If `quantity.checked`
is 0, the text held no numeral and that layer proved nothing about it. Numerals
it refuses to read are also counted. This is why `"Only ② left"` gives a finding
instead of a silent zero.

## Facts

```ts
interface Facts {
  values: readonly (string | number | bigint)[];
  bannedPhrases?: readonly string[];
  allowedPhrases?: readonly string[];
}
```

`values` is a single flat list with no types. Write all values the way your
system does, like `39`, `'$1,299.00'`, `'4,8'` or `'ships 13 March'`. All the
numerals in a value will become supported values.

Numbers will be written out in plain digits first, whatever `String` would have
made of them. For example, a fact of `1e21` backs
`'1,000,000,000,000,000,000,000'` and backs neither `1` nor `21`. If a string
holds nothing but a number in exponent notation, it will be written out in the
same way. `String`, `JSON.stringify`, spreadsheet exports and APIs that write
64-bit values as strings all produce such strings. You didn't pick those digits.
Any other string will be read exactly as you typed it: `'SKU AX-220e5'` still
supplies 220 and 5.

If a number in exponent notation would run past a thousand digits when written
out, it backs no numeral at all. This package will check the length first and
only then write anything out. `'1e1000'` isn't a product fact under any reading.
It will hit the limit and be refused. This limit is there to stop the extreme
cases: `'1e2000000000'` is twelve characters, but writing it out would take more
memory than the process has. All finite JavaScript numbers fit well inside the
limit. Of these, the longest is `5e-324`, at 326 characters.

Past 2^53, a number will have lost its exact digits by the time it gets to this
package. `JSON.parse` turns `9007199254740993` into `...92`. Pass a long id as a
bigint or a string.

If a field is null or undefined, it backs no numeral and doesn't throw. This way
an empty field won't break the whole call. Anything else is read via `String()`
and supplies whatever digits that gives. For a `Date`, that's the day, the year
and all the digits of the clock. If you pass a raw `listedAt`, it won't be
ignored. You can find this hazard under
[What it cannot catch](#what-it-cannot-catch).

That section also lists the costs of a flat list. There are two habits to keep
the cost down:

- **Only supply numbers you're happy to see anywhere.** With a SKU of `AT-2199`
  in `values`, `"Was $2,199"` will be a supported sentence. If a number in your
  record isn't a fact about the product that a shopper would read, leave it out.
- **Treat `values` as a trust boundary.** On a marketplace, the product title is
  written by the seller and not by you. If you put it in `values`, you hand the
  model all the numbers the seller chose to type. Supply only fields you write.

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

These facts are read once and reused for all the fields. On a card the fields
are shown next to each other and it's up to the model to pick where a field ends
and the next begins. To a shopper,
`{ badge: 'Free', delivery: 'delivery on every order' }` reads as a single
sentence, though neither field carries the claim alone. `acrossFields` checks
the joined text and counts toward `supported`.

## What it cannot catch

### Claims with a number in them

- **A number that is real but means something else.** This is the biggest gap in
  layer one. If you supply a price of 39, then `"39 sold in the last hour"`,
  `"Save $39 today"` and `"Under $39"` will all pass. If you supply a rating
  scale of 5, `"Only 5 left"` will pass. With a rating of 4.8, a German
  `"nur 4,80 €"` will pass as a price, because 4.80 and 4.8 are equal.
- **Numbers written as words, in any script.** This layer will never see
  `"Only two left"`, because there's no digit in it. It will also miss
  `残り二点`, because 二 is a character and not a digit. And it will miss Arabic
  `قطعتين`, where "two" is the noun's dual ending and there is no numeral at
  all. `quantity.checked` is 0 for all three of these. That's the only signal
  you get.
- **Magnitudes written as words.** This layer won't catch the multiplier in
  `4,8 Millionen`, `4.8 millions`, `4,8 mil`, `4.8 लाख` or `٤٫٨ مليون`.
- **Units on numbers.** `￥39.99` will pass against a price of $39.99, because
  the digits are yours and a currency symbol isn't a digit. `"39,99 Cent"` will
  also pass. This layer can only check the number and not the thing it counts.
- **A number your facts happen to contain.** With a fact of `'2026-09-13'`, all
  of 2026, 9 and 13 will be supported anywhere in the text, including as a stock
  count.
- **Where in the text a token was.** A finding names the token but not its
  position.

### Claims with no number in them

- **Wording, in general.** There are endless ways to word a claim, more than a
  list can hold. A careful rewording will get past layer two, like
  `"Half of what it was"` for half price or `"送料は無料"` with a particle
  dropped in. More entries will be added as they're found, but the list will
  never be finished.
- **Your language, until you give it one.** All of the built-in phrases are
  English. `"Gratis Versand"`, `"Livraison offerte"` and `"شحن مجاني"` all pass
  by default. You'll have to add them with `bannedPhrases`. That list is yours
  to keep.
- **Negation.** Because the list matches substrings,
  `"there is no sale on this product"` is caught as a sale claim. There's no
  rule that reads the `no`. You can use `allowedPhrases: ['no sale']` to let
  that sentence pass. But this allowance is narrow: a `sale` elsewhere in the
  text will still fail.
- **A character that folds into your allowance.** Allowances match the copy
  after the folding described under layer two. Anything that folds to your words
  will count as your words. If you allow `no sale`, then `"№ SALE"` passes,
  because U+2116 folds to `no`. This is also the case for a superscript `ⁿᵒ`. To
  the shopper the numero sign is decoration, but to the package it's a word.
  Write allowances the way a shop really would.
- **A letter glued to the end of a phrase.** `"FREE SHIPPINGᵃ see terms"` isn't
  reported. This superscript folds to an `a` that glues onto `shipping`. Then
  the word-gap rule that stops `cheap` matching `cheapskate` will treat the
  whole thing as a longer word. This holds for all entries on the list. A
  footnote marker is exactly how a real shop writes a claim like this.

### Preconditions the package cannot check for you

- **You have to render the text you checked.** `verify` sees a string, but
  something downstream may decode it, like an HTML sink turning `&half;` into ½
  or `&#50;` into a 2. If this happens, the string you checked and the string on
  the page will be different documents. This guarantee only covers the string
  you checked.
- **Your font has to agree with Unicode about what renders as nothing.** This
  package will drop anything that Unicode marks as taking no room. If a font
  gives any of these characters a visible glyph, the two disagree. U+3164 HANGUL
  FILLER is the character people really paste as a blank. Layer one reads
  `"1<U+3164>3"` as 13, but with a font that widens it the shopper will see
  `1 3`.
- **Everything that isn't a number or a phrase.** Any claim about materials,
  compatibility, a certification, a warranty condition or a person is out of
  scope.

## What it over-rejects

There's a cost to leaning toward rejection:

- **All incidental numbers have to be in `values`.** That means things like a
  VAT rate, a size, a care temperature, a number from the product specification,
  a support phone number, a founding year, the denominator of a rating scale.
  None of these are claims, but they're all digits. If copy mentions a number
  you didn't supply, it will be rejected.
- **Three digits after a dot or comma are always grouping.** Neither mark can be
  used to write a real three-decimal number (like a weight or a price in a
  currency with three decimal places). `1.299 kg` reads as 1299. Supply it and
  write it the same way.
- **Numeric characters that aren't digits are refused outright.** `2 m²` and
  `½ inch` will fail.
- **Magnitude letters glued to a digit are refused.** `4K display` will fail.
  But `4 K display` and `1kg` won't, because a letter followed by another letter
  is just a unit and not a multiplier.
- **Scientific notation in the copy can never be supported.** A fact of `1e-7`
  is written out as `0.0000001`, but the text `"1e-7 g"` will be read as the two
  numerals 1 and 7. This means the fact won't ever match the text.
  `"0.0000001 g"` will pass. That's the cost of writing facts out in plain
  digits. It falls on a lab or bulk-goods shop printing a value the way its data
  does.

## Licence

MIT
