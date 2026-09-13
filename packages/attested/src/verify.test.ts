import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES } from './phrases.js';
import { verify, verifyFields } from './verify.js';

const NOTHING = { values: [] };

function tokensOf(findings: { token: string }[]): string[] {
  const out: string[] = [];
  for (const finding of findings) out.push(finding.token);
  return out;
}

describe('verify — the quantity layer', () => {
  it('supports a number the host stands behind', () => {
    const result = verify('Yours for $39', { values: [39] });
    expect(result.supported).toBe(true);
    expect(result.quantity.findings).toEqual([]);
  });

  it('rejects a number the host never supplied', () => {
    const result = verify('Only 2 left', { values: [39] });
    expect(result.supported).toBe(false);
    expect(result.quantity.supported).toBe(false);
    expect(result.quantity.findings).toEqual([
      {
        layer: 'quantity',
        token: '2',
        reason: 'quantity: "2" is not a value the supplied facts carry',
      },
    ]);
  });

  it('takes a bigint fact, which is the only way to hand it an id past 2^53', () => {
    // `JSON.parse` has already rounded a 19-digit id by the time a number reaches
    // here, so the exact spelling has to arrive as a bigint or as a string.
    const facts = { values: [9007199254740993n] };
    expect(verify('Order 9007199254740993 confirmed', facts).supported).toBe(true);
    expect(verify('Order 9007199254740992 confirmed', facts).supported).toBe(false);
  });

  it('stands behind nothing for a fact it cannot read, rather than throwing', () => {
    const facts = { values: [null, 39] } as unknown as { values: (string | number)[] };
    expect(verify('Yours for $39', facts).supported).toBe(true);
    expect(verify('Only 2 left', facts).supported).toBe(false);
  });

  it('rejects every number it cannot stand behind, not just the first', () => {
    const result = verify('Was 60, now 39', { values: [39] });
    expect(tokensOf(result.quantity.findings)).toEqual(['60']);

    const both = verify('Was 60, now 45', { values: [39] });
    expect(tokensOf(both.quantity.findings)).toEqual(['60', '45']);
  });

  it('names an unsupported token once, however often it is written', () => {
    const result = verify('Only 2 left, just 2 remaining', NOTHING);
    expect(tokensOf(result.quantity.findings)).toEqual(['2']);
  });

  it('counts what it checked, so a check that checked nothing is visible', () => {
    expect(verify('Was 60, now 39', { values: [39, 60] }).quantity.checked).toBe(2);
    expect(verify('Built for long days', NOTHING).quantity.checked).toBe(0);
  });

  it('passes text with no number in it', () => {
    const result = verify('Built for long days on the trail', NOTHING);
    expect(result.supported).toBe(true);
  });

  it('reads the host facts in any shape they were written', () => {
    expect(verify('$1,299', { values: ['USD 1299.00'] }).supported).toBe(true);
    expect(verify('1.299 Euro', { values: [1299] }).supported).toBe(true);
  });

  it('does not care what language the sentence is in', () => {
    expect(verify('Nur noch 2 übrig', { values: [2] }).quantity.supported).toBe(true);
    expect(verify('Nur noch 2 übrig', { values: [39] }).quantity.supported).toBe(false);
    expect(verify('4,8 von 5', { values: [4.8, 5] }).quantity.supported).toBe(true);
    expect(verify('4,8 von 5', { values: [5] }).quantity.supported).toBe(false);
  });

  it('matches a decimal the host wrote with the other separator', () => {
    expect(verify('4,8 stars', { values: ['4.8'] }).quantity.supported).toBe(true);
  });

  it('reads a numeral the host wrote in another script', () => {
    expect(verify('٣٩ euro', { values: [39] }).quantity.supported).toBe(true);
  });

  it('reads a number the host wrote large or small enough for String to use an exponent', () => {
    // `String(1e21)` is `1e+21`, which used to mint the two values 1 and 21.
    expect(verify('Only 21 sold', { values: [1e21] }).supported).toBe(false);
    expect(verify('1 left', { values: [1e21] }).supported).toBe(false);
    expect(verify('1000000000000000000000 in stock', { values: [1e21] }).quantity.supported).toBe(
      true,
    );
    expect(
      verify('1,000,000,000,000,000,000,000 made', { values: [1e21] }).quantity.supported,
    ).toBe(true);
    expect(verify('7 left', { values: [1e-7] }).supported).toBe(false);
    expect(verify('0.0000001 grams', { values: [1e-7] }).quantity.supported).toBe(true);
  });

  it('survives a host value whose exponent is past anything a shop could mean', () => {
    // These laid the digits out before anything could weigh the run: a RangeError at
    // 1e2000000000, and at -2.5e400000000 a heap abort no caller can catch.
    const wild = ['1e2000000000', '1e-2000000000', '-2.5e400000000', `1e${'9'.repeat(400)}`];
    for (const value of wild) {
      expect(verify('1000000 sold', { values: [value] }).quantity.supported).toBe(false);
    }
    expect(verify('1000000 sold', { values: ['1e6'] }).quantity.supported).toBe(true);
  });

  it('reads each fact list on its own, whatever was verified before it', () => {
    const green = ['3 season'];
    const blue = ['4 season'];
    expect(verify('a 3 season quilt', { values: green }).quantity.supported).toBe(true);
    expect(verify('a 3 season quilt', { values: blue }).quantity.supported).toBe(false);
    expect(verify('a 3 season quilt', { values: green }).quantity.supported).toBe(true);
  });

  it('reads a list the host wrote to again, at the same array', () => {
    const facts = ['3 season'];
    expect(verify('a 3 season quilt', { values: facts }).quantity.supported).toBe(true);

    facts[0] = '4 season';
    expect(verify('a 3 season quilt', { values: facts }).quantity.supported).toBe(false);
    expect(verify('a 4 season quilt', { values: facts }).quantity.supported).toBe(true);

    facts.push('2 person');
    expect(verify('a 2 person tent', { values: facts }).quantity.supported).toBe(true);

    facts.length = 0;
    expect(verify('a 4 season quilt', { values: facts }).quantity.supported).toBe(false);
  });

  it('calls the quantity layer a proof', () => {
    expect(verify('anything', NOTHING).quantity.strength).toBe('proof');
  });
});

// Every case below is one a red team landed on this package.
describe('verify — quantities a grouping mark used to manufacture', () => {
  const SHOP = { values: [39.99, 4.8, 210, 12, 20, 'TR-101'] };

  it('will not let a fact of 4.8 stand behind a written 4.800', () => {
    expect(verify('4.800 Bewertungen', SHOP).supported).toBe(false);
    expect(tokensOf(verify('4.800 Bewertungen', SHOP).quantity.findings)).toEqual(['4.800']);
  });

  it('will not let any small fact stand behind that fact times a thousand', () => {
    expect(verify('Schon 20.000 Mal verkauft', SHOP).supported).toBe(false);
    expect(verify('Über 12.000 zufriedene Kunden', SHOP).supported).toBe(false);
    expect(verify('通常39,990円のところ', SHOP).supported).toBe(false);
    expect(verify('Más de 4.800 valoraciones', SHOP).supported).toBe(false);
    expect(verify('4,800 customer reviews', SHOP).supported).toBe(false);
  });

  it('closes the same manufacture in the Arabic thousands mark', () => {
    expect(verify('٤\u066c٨٠٠ تقييم', SHOP).supported).toBe(false);
    // The Arabic decimal mark still reads as a decimal point, because it is one.
    expect(verify('٤\u066b٨ من ٥', { values: [4.8, 5] }).supported).toBe(true);
  });

  it('will not let a grouped fact mint a decimal the host never wrote', () => {
    expect(verify('Yours for $1.24', { values: ['$39.00', '1,240'] }).supported).toBe(false);
    expect(verify('Just 1.29 kg on your head', { values: ['Price 1,290'] }).supported).toBe(false);
  });

  it('stands behind a run no locale reads as a number when the host wrote it the same way', () => {
    expect(verify('Lieferung am 24.12.2026', { values: ['24.12.2026'] }).supported).toBe(true);
    expect(verify('Lieferung am 24.12.2026', { values: ['24.12.2027'] }).supported).toBe(false);
    expect(verify('Bluetooth 5.3.1', { values: ['5.3.2'] }).supported).toBe(false);
  });

  it('still supports the same number written the way another locale groups it', () => {
    expect(verify('Only 1 299 pairs made.', { values: ['1299 pairs made'] }).supported).toBe(true);
    expect(verify("1'299 in Zurich", { values: [1299] }).supported).toBe(true);
    expect(verify('Prix: 1 299,00 €', { values: ['1299.00'] }).supported).toBe(true);
    expect(verify('₹1,29,999', { values: [129999] }).supported).toBe(true);
  });
});

describe('verify — numerals the layer cannot read', () => {
  it('rejects a magnitude mark glued to a supported digit', () => {
    const facts = { values: [4.8, 12] };
    expect(verify('4.8万件のレビュー', facts).supported).toBe(false);
    expect(verify('販売数12万点', facts).supported).toBe(false);
    expect(verify('4.8k reviews', facts).supported).toBe(false);
    expect(verify('12M sold', facts).supported).toBe(false);
  });

  it('says in the finding that the magnitude, not the digit, is what it cannot read', () => {
    const [finding] = verify('4.8万件のレビュー', { values: [4.8] }).quantity.findings;
    expect(finding?.token).toBe('4.8万');
    expect(finding?.reason).toContain('magnitude mark this layer cannot read');
  });

  it('rejects a numeric character that is not a decimal digit', () => {
    expect(verify('½ price today', { values: [39] }).supported).toBe(false);
    expect(verify('Only ② left at $39', { values: [39] }).supported).toBe(false);
    expect(verify('Only Ⅲ pairs left', { values: [39] }).supported).toBe(false);
    expect(verify('Now just $2⁹⁹', { values: ['2 year warranty'] }).supported).toBe(false);
  });

  it('names the character it cannot read, so the audit trail says why', () => {
    const [finding] = verify('½ price today', { values: [39] }).quantity.findings;
    expect(finding?.token).toBe('½');
    expect(finding?.reason).toContain('numeric character this layer cannot read');
  });

  it('counts an unreadable numeral as checked, because it did look at it', () => {
    expect(verify('Only ② left at $39', { values: [39] }).quantity.checked).toBe(2);
  });

  it('leaves a unit alone, so honest spec copy is not read as a magnitude claim', () => {
    expect(verify('Weighs 250 g', { values: [250] }).supported).toBe(true);
    expect(verify('1kg on the nose', { values: [1] }).supported).toBe(true);
  });
});

describe('verify — digits that render as something else', () => {
  it('reads a mathematical digit as the digit Unicode says it is', () => {
    expect(verify('Now only $𝟭𝟵.𝟵𝟵', { values: ['$99.99'] }).supported).toBe(false);
    expect(verify('Only 𝟮 left', { values: ['$99.99', '9 in stock'] }).supported).toBe(false);
    expect(verify('Now $𝟷𝟹.', { values: ['$99.00'] }).supported).toBe(false);
    expect(verify('Now just $12𝟶.', { values: ['$129.00'] }).supported).toBe(false);
  });

  it('supports a mathematical digit whose value the host did supply', () => {
    expect(verify('Now only $𝟭𝟵.𝟵𝟵', { values: ['$19.99'] }).supported).toBe(true);
  });

  it('will not let an invisible character split one number into two supported ones', () => {
    const facts = { values: ['2 year warranty', 'ships 13 March'] };
    expect(verify('Rated by 2\u200b13 shoppers.', facts).supported).toBe(false);
    expect(verify('Just $2\u00ad13 today.', facts).supported).toBe(false);
    expect(verify('Rated by 213 shoppers.', { values: [213] }).supported).toBe(true);
  });

  it('will not let a variation selector split one number into two supported ones', () => {
    // A shopper reads $13; the facts carry only 1 and 3. The zero-width case was
    // closed and this one was not, because U+FE0F is category Mn rather than Cf.
    expect(verify('$1\ufe0f3', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$1\ufe003', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$1\u{e0100}3', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$1\u034f3', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$1\u200b3', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$13', { values: [13] }).supported).toBe(true);
  });

  it('will not let a control character split one number into two supported ones', () => {
    // The two survivors of a default-ignorable-only class: Cc is neither Cf nor
    // default-ignorable, and a backspace renders as nothing between the digits.
    expect(verify('$1\u00083', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$1\u001d3', { values: [1, 3] }).supported).toBe(false);
    expect(verify('$1\u00013', { values: [1, 3] }).supported).toBe(false);
  });

  it('will not let a combining mark split one number into two supported ones', () => {
    // U+0305 hangs over the 4 and takes no column, so the shopper reads $49.
    expect(verify('Yours for $4\u03059 today', { values: [4, 9] }).supported).toBe(false);
    expect(verify('Only 1\u03052 left', { values: [1, 2] }).supported).toBe(false);
    expect(verify('Since 1\u0305999', { values: [1, 999] }).supported).toBe(false);
  });

  it('still reads two numbers apart when what sits between them takes room', () => {
    // A line break and a spacing mark are both visible gaps, so `2` and `3` are two
    // numbers there and a fact of 23 does not stand behind them.
    expect(verify('Only 2\n3 left', { values: [2, 3] }).supported).toBe(true);
    expect(verify('Only 2\n3 left', { values: [23] }).supported).toBe(false);
    expect(verify('Only 2\u093e3 left', { values: [2, 3] }).supported).toBe(true);
  });
});

describe('verify — the wording layer', () => {
  it('rejects a claim with no value to check', () => {
    const result = verify('Selling fast', NOTHING);
    expect(result.supported).toBe(false);
    expect(result.wording.supported).toBe(false);
    expect(result.wording.findings).toEqual([
      {
        layer: 'wording',
        token: 'selling fast',
        reason:
          'wording: "selling fast" is a claim with no value to check, caught by a best-effort denylist',
      },
    ]);
  });

  it('catches a claim across a hyphen and a line break', () => {
    expect(verify('a best-selling shoe', NOTHING).wording.supported).toBe(false);
    expect(verify('selling\nfast', NOTHING).wording.supported).toBe(false);
  });

  it('catches the near-misses a reworded denylist entry used to walk past', () => {
    const rewordings = [
      'Ships free.',
      'Going fast.',
      'Stock is running low.',
      'Price just dropped.',
      'Our most popular pick.',
      'Rated highest in its class.',
      'Or your money back.',
      'Arrives tomorrow.',
      'Extra discounts on every pair',
    ];
    for (const text of rewordings) {
      expect(verify(text, NOTHING).wording.supported, text).toBe(false);
    }
  });

  it('catches a claim an invisible or look-alike character was dropped into', () => {
    expect(verify('F\u00adree delivery', NOTHING).wording.supported).toBe(false);
    expect(verify('in\u200bstock now', NOTHING).wording.supported).toBe(false);
    expect(verify('In stоck now', NOTHING).wording.supported).toBe(false);
    expect(verify('Frеe delivery', NOTHING).wording.supported).toBe(false);
  });

  it('catches a claim a variation selector was dropped into', () => {
    expect(verify('fr️ee shipping', NOTHING).wording.supported).toBe(false);
    expect(verify('sel︀ling fast', NOTHING).wording.supported).toBe(false);
    expect(verify('in st͏ock now', NOTHING).wording.supported).toBe(false);
  });

  it('catches a claim a combining mark or a control character was dropped into', () => {
    expect(verify('Order today and get fr̅ee shipping', NOTHING).wording.supported).toBe(false);
    expect(verify('Get fr̲ee shipping', NOTHING).wording.supported).toBe(false);
    expect(tokensOf(verify('Hurry, s̃old out', NOTHING).wording.findings)).toContain('sold out');
    expect(verify('fr\u0008ee shipping on all orders', NOTHING).wording.supported).toBe(false);
  });

  it('takes a phrase the host added for their own language', () => {
    const facts = { values: [], bannedPhrases: ['nur noch'] };
    expect(verify('Nur noch wenige', facts).wording.supported).toBe(false);
    expect(verify('Nur noch wenige', NOTHING).wording.supported).toBe(true);
  });

  it('holds a host phrase against the registers their own language writes it in', () => {
    // Turkish all-caps, Spanish decomposed accents, Japanese with a space dropped in.
    expect(
      verify('ÜCRETSİZ KARGO', { values: [], bannedPhrases: ['ücretsiz kargo'] }).wording.supported,
    ).toBe(false);
    expect(
      verify('U\u0301ltimas unidades', { values: [], bannedPhrases: ['últimas unidades'] }).wording
        .supported,
    ).toBe(false);
    expect(verify('送料 無料', { values: [], bannedPhrases: ['送料無料'] }).wording.supported).toBe(
      false,
    );
    expect(
      verify('شحن\u200fمجاني', { values: [], bannedPhrases: ['شحن مجاني'] }).wording.supported,
    ).toBe(false);
  });

  it('keeps the built-in list when the host adds one', () => {
    expect(verify('selling fast', { values: [], bannedPhrases: ['nur noch'] }).supported).toBe(
      false,
    );
  });

  it('normalises a phrase the host added', () => {
    // Not a built-in, or the built-in list would catch it and this would prove nothing.
    const facts = { values: [], bannedPhrases: ['NUR-NOCH'] };
    expect(verify('Nur noch wenige', facts).wording.supported).toBe(false);
  });

  it('forgives a phrase the host stands behind, so a true statement can be published', () => {
    const facts = { values: [12], allowedPhrases: ['free shipping', 'in stock'] };
    expect(verify('Free shipping on orders over $12.', facts).supported).toBe(true);
    expect(verify('12 in stock.', facts).supported).toBe(true);
    expect(verify('Free shipping on orders over $12.', { values: [12] }).supported).toBe(false);
  });

  it('lets the allowance win over a phrase the host also added', () => {
    const facts = { values: [], bannedPhrases: ['in stock'], allowedPhrases: ['in stock'] };
    expect(verify('In stock', facts).wording.supported).toBe(true);
  });

  it('counts the phrases it screened against', () => {
    const plain = verify('anything', NOTHING).wording.checked;
    const added = verify('anything', { values: [], bannedPhrases: ['nur noch'] }).wording.checked;
    const dropped = verify('anything', { values: [], allowedPhrases: ['in stock'] }).wording
      .checked;
    expect(plain).toBeGreaterThan(20);
    expect(added).toBe(plain + 1);
    // An allowance works on the text, not the list, so the whole list is still screened.
    expect(dropped).toBe(plain);
  });

  it('ignores a host phrase that normalises to nothing', () => {
    const blank = verify('anything', { values: [], bannedPhrases: ['   '] }).wording.checked;
    expect(blank).toBe(verify('anything', NOTHING).wording.checked);
  });

  it('calls the wording layer best-effort, because that is what it is', () => {
    expect(verify('anything', NOTHING).wording.strength).toBe('best-effort');
  });

  it('reports the two layers apart', () => {
    const result = verify('Selling fast, only 2 left', NOTHING);
    expect(tokensOf(result.quantity.findings)).toEqual(['2']);
    expect(tokensOf(result.wording.findings)).toEqual(['selling fast']);
  });

  it('passes wording that claims nothing', () => {
    expect(verify('Built for long days on the trail', NOTHING).wording.supported).toBe(true);
  });
});

// An allowance masks the text: a banned claim sitting wholly inside one of the
// host's phrases is not reported, and the same words elsewhere still are.
describe('verify — allowedPhrases', () => {
  const NESTED: [string, string][] = [
    ['best seller', 'One of our best sellers.'],
    ['best selling', 'A best selling shoe.'],
    ['bestseller', 'A bestseller here.'],
    ['bestselling', 'A bestselling shoe.'],
    ['back in stock', 'Back in stock today.'],
    ['almost sold out', 'Almost sold out now.'],
    ['nearly sold out', 'Nearly sold out now.'],
  ];

  it('forgives a phrase another listed phrase sits inside', () => {
    // Deleting the exact string left these seven allowable in name only: the
    // matcher drops spaces, so `best seller` was still caught as `bestseller`.
    for (const [allowed, text] of NESTED) {
      const result = verify(text, { values: [], allowedPhrases: [allowed] });
      expect(tokensOf(result.wording.findings), `${allowed} in "${text}"`).toEqual([]);
    }
  });

  it('allows every phrase on the built-in list, one at a time', () => {
    for (const phrase of BANNED_PHRASES) {
      const text = `We say: ${phrase}.`;
      const result = verify(text, { values: [], allowedPhrases: [phrase] });
      expect(tokensOf(result.wording.findings), phrase).toEqual([]);
    }
  });

  it('forgives only where the allowed wording actually appears', () => {
    const facts = { values: [2], allowedPhrases: ['back in stock'] };
    expect(tokensOf(verify('Only 2 in stock, selling fast', facts).wording.findings)).toEqual([
      'in stock',
      'selling fast',
    ]);
  });

  it('forgives one hit and still reports the same phrase elsewhere', () => {
    const facts = { values: [], allowedPhrases: ['back in stock'] };
    const result = verify('Back in stock. Also in stock elsewhere.', facts);
    expect(tokensOf(result.wording.findings)).toEqual(['in stock']);
  });

  it('forgives inwards and never outwards', () => {
    // The mirror of the bug above, and correct: `in stock` is not a promise about
    // `back in stock`, which claims a restock as well.
    expect(
      tokensOf(
        verify('Back in stock', { values: [], allowedPhrases: ['in stock'] }).wording.findings,
      ),
    ).toEqual(['back in stock']);
    expect(
      tokensOf(
        verify('Almost sold out', { values: [], allowedPhrases: ['sold out'] }).wording.findings,
      ),
    ).toEqual(['almost sold out']);
  });

  it('does not let two allowances compose into a phrase neither one carries', () => {
    const facts = { values: [], allowedPhrases: ['sold', 'out'] };
    expect(tokensOf(verify('sold out', facts).wording.findings)).toEqual(['sold out']);
  });

  it('does not join two allowances that abut in the text', () => {
    const facts = { values: [], allowedPhrases: ['back in', 'stock'] };
    expect(tokensOf(verify('Back in stock', facts).wording.findings)).toEqual([
      'in stock',
      'back in stock',
    ]);
  });

  it('does not mint a claim the text never made by blanking out the allowed run', () => {
    // Spaces are dropped before matching, so masking `in stock` with spaces would
    // glue `free` to `shipping` and report a phrase nobody wrote.
    const facts = { values: [], allowedPhrases: ['in stock'] };
    expect(tokensOf(verify('free in stock shipping', facts).wording.findings)).toEqual([]);
  });

  it('normalises an allowance the same way it normalises everything else', () => {
    const written = ['BACK IN STOCK', 'Back-In-Stock', '  back in stock  ', 'back in stоck'];
    for (const phrase of written) {
      const result = verify('Back in stock today', { values: [], allowedPhrases: [phrase] });
      expect(tokensOf(result.wording.findings), phrase).toEqual([]);
    }
  });

  it('ignores an allowance that normalises to nothing', () => {
    // The length guard is clarity, not load-bearing: an empty phrase spans nothing.
    const result = verify('on sale now', { values: [], allowedPhrases: ['   '] });
    expect(tokensOf(result.wording.findings)).toEqual(['sale']);
    expect(result.wording.checked).toBe(BANNED_PHRASES.length);
  });

  it('is the way out of the negation hole the README names', () => {
    const facts = { values: [], allowedPhrases: ['no sale'] };
    expect(tokensOf(verify('there is no sale on this product', facts).wording.findings)).toEqual(
      [],
    );
    expect(
      tokensOf(verify('there is no sale here, but a sale there', facts).wording.findings),
    ).toEqual(['sale']);
  });

  it('does not reach across a line break to forgive a claim standing on its own', () => {
    // The model picks where the paragraph breaks fall. A rule or a blank line puts
    // the negation in one block and the claim in another, and the shopper reads two.
    const cases: [string, string, string][] = [
      [
        'We do not offer\n\n---\n\nFree shipping on every order.',
        'we do not offer free shipping',
        'free shipping',
      ],
      [
        'This item is not\n\n---\n\nIn stock at our Leeds shop.',
        'this item is not in stock',
        'in stock',
      ],
      ['- Coupon needed: no\n- Sale prices on every size.', 'no sale', 'sale'],
      [
        'Free shipping\n\n---\n\nover $75 we add a gift box.',
        'free shipping over $75',
        'free shipping',
      ],
    ];

    for (const [text, allowed, caught] of cases) {
      const result = verify(text, { values: [40, 75], allowedPhrases: [allowed] });
      expect(tokensOf(result.wording.findings), text).toContain(caught);
    }
  });

  it('still forgives the same wording when it sits on one line', () => {
    const facts = { values: [40], allowedPhrases: ['we do not offer free shipping'] };
    const text = 'We do not offer free shipping on every order under $40.';
    expect(tokensOf(verify(text, facts).wording.findings)).toEqual([]);
  });

  it('still reads a banned phrase straight through the break it will not forgive', () => {
    // The two rules pull opposite ways on purpose: the denylist catches more, the
    // allowance forgives less, and both of them err toward reporting.
    expect(tokensOf(verify('Free\n\nshipping on every order', NOTHING).wording.findings)).toEqual([
      'free shipping',
    ]);
  });
});

describe('verifyFields', () => {
  it('verifies every field against one set of facts', () => {
    const result = verifyFields(
      { headline: 'Yours for $39', badge: 'Only 2 left' },
      { values: [39] },
    );

    expect(result.supported).toBe(false);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]?.field).toBe('headline');
    expect(result.fields[0]?.result.supported).toBe(true);
    expect(result.fields[1]?.field).toBe('badge');
    expect(tokensOf(result.fields[1]?.result.quantity.findings ?? [])).toEqual(['2']);
  });

  it('is supported only when every field is', () => {
    const facts = { values: [39] };
    expect(verifyFields({ a: '$39', b: 'thirty nine' }, facts).supported).toBe(true);
    expect(verifyFields({ a: '$39', b: '$40' }, facts).supported).toBe(false);
  });

  it('catches a claim split across two fields of the same card', () => {
    // The model picks the field boundaries, so a per-field check is one it can choose.
    const result = verifyFields(
      { badge: 'Free', deliveryLine: 'delivery on every order', price: '$39' },
      { values: [39] },
    );

    expect(result.supported).toBe(false);
    expect(result.fields[0]?.result.supported).toBe(true);
    expect(tokensOf(result.acrossFields.findings)).toEqual(['free delivery']);
  });

  it('honours an allowance across the joined fields', () => {
    const facts = { values: [], allowedPhrases: ['free shipping'] };
    const joined = verifyFields({ a: 'Free', b: 'shipping on every order' }, facts);
    expect(tokensOf(joined.acrossFields.findings)).toEqual([]);
    expect(joined.supported).toBe(true);

    // The allowance is global across the call, but it is still positional inside it.
    const split = verifyFields(
      { a: 'Back in stock', b: 'In stock now' },
      { values: [], allowedPhrases: ['back in stock'] },
    );
    expect(tokensOf(split.acrossFields.findings)).toEqual(['in stock']);
    expect(split.supported).toBe(false);
  });

  it('calls the across-fields read best-effort, because it is the wording layer', () => {
    const result = verifyFields({ a: 'Built for long days' }, NOTHING);
    expect(result.acrossFields.strength).toBe('best-effort');
    expect(result.acrossFields.supported).toBe(true);
  });

  it('is supported when there is nothing to verify', () => {
    const result = verifyFields({}, NOTHING);
    expect(result.supported).toBe(true);
    expect(result.fields).toEqual([]);
    expect(result.acrossFields.findings).toEqual([]);
  });
});

// The holes the README states. A test is the only thing that keeps the list honest.
describe('verify — what it does not catch, proved to still not catch it', () => {
  it('passes a number written as a word', () => {
    expect(verify('Only two left.', { values: [12] }).supported).toBe(true);
    expect(verify('残り二点', { values: [12] }).supported).toBe(true);
  });

  it('passes a real number used for something else entirely', () => {
    expect(verify('39 sold in the last hour.', { values: ['$39.00'] }).supported).toBe(true);
    expect(verify('Was $2,199. Now $129.', { values: ['$129.00', 'SKU AT-2199'] }).supported).toBe(
      true,
    );
  });

  it('passes the wrong currency on a right number', () => {
    expect(verify('￥39.99', { values: ['$39.99'] }).supported).toBe(true);
  });

  it('passes a magnitude written as a word in any language', () => {
    expect(verify('4,8 Millionen verkauft', { values: [4.8] }).supported).toBe(true);
  });

  it('passes a claim in a language the wording layer was never given', () => {
    expect(verify('Livraison offerte', NOTHING).supported).toBe(true);
    expect(verify('Gratis Versand', NOTHING).supported).toBe(true);
  });

  it('passes a character that folds into the wording the host allowed', () => {
    // An allowance is matched against normalised copy, so U+2116 and a superscript
    // both count as the word `no`. The README says so under what it cannot catch.
    const facts = { values: [], allowedPhrases: ['no sale'] };
    expect(verify('№ SALE - EVERYTHING MUST GO', facts).wording.supported).toBe(true);
    expect(verify('ⁿᵒ SALE ON EVERYTHING', facts).wording.supported).toBe(true);
  });

  it('passes a phrase a footnote marker is glued to', () => {
    // The superscript folds to an `a`, which glues to `shipping`, and the same
    // word-gap rule that stops `cheap` matching `cheapskate` drops the finding.
    expect(verify('FREE SHIPPINGᵃ see terms', NOTHING).wording.supported).toBe(true);
  });
});

describe('verify — what it over-rejects, proved to still over-reject it', () => {
  it('rejects a fact written back in the exponent notation it arrived in', () => {
    // The bill for laying a fact out positionally: the text still reads `1e-7` as
    // the two numerals 1 and 7, and the fact is now 0.0000001, so they never meet.
    expect(verify('1e-7 mol per litre', { values: [1e-7] }).quantity.supported).toBe(false);
    expect(verify('0.0000001 mol per litre', { values: [1e-7] }).quantity.supported).toBe(true);
  });
});
