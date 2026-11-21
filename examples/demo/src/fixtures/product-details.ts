import type { Product } from '@rudra-js/core';
import { mulberry32, pick } from './seeded-random';

export interface Swatch {
  name: string;
  hex: string;
}

export interface Review {
  author: string;
  rating: number;
  title: string;
  body: string;
  when: string;
}

export interface ProductDetails {
  brand: string;
  department: string;
  swatches: Swatch[];
  highlights: string[];
  specs: [label: string, value: string][];
  description: string;
  reviewCount: number;
  ratingCounts: [number, number, number, number, number];
  reviews: Review[];
}

export const SWATCHES: readonly Swatch[] = [
  { name: 'Harbor', hex: '#2f4858' },
  { name: 'Lake', hex: '#33658a' },
  { name: 'Lichen', hex: '#55696e' },
  { name: 'Dusk', hex: '#5b5f97' },
  { name: 'Spruce', hex: '#3c6e57' },
  { name: 'Sumac', hex: '#7a5c61' },
];

const BRANDS = ['Larchmere', 'Northfold', 'Halden', 'Tamarack Gear', 'Upwell'];

interface CategoryInfo {
  department: string;
  noun: string;
  use: string;
  ounces: [low: number, high: number];
  highlights: string[];
  spec: [label: string, values: string[]];
  tags: string[];
  summary: string;
  praise: string;
  fault: string;
}

const SHOE_TAGS = ['waterproof', 'lightweight', 'breathable', 'recycled', 'wide-fit'];

const CATEGORY_INFO: Record<string, CategoryInfo> = {
  'Trail Running': {
    department: 'Footwear',
    noun: 'trail shoe',
    use: 'running on dirt, rock and roots',
    ounces: [8.5, 12],
    highlights: [
      'Lugged outsole that grips loose dirt and wet rock',
      'Rock plate under the forefoot',
      'Gusseted tongue keeps grit out',
    ],
    spec: ['Drop', ['4 mm', '6 mm', '8 mm']],
    tags: SHOE_TAGS,
    summary: 'The cushioning stays firm enough to feel the ground on technical descents.',
    praise: 'The grip on wet rock is the best I’ve had.',
    fault: 'It runs a little small, so order half a size up.',
  },
  'Road Running': {
    department: 'Footwear',
    noun: 'road shoe',
    use: 'daily miles on pavement',
    ounces: [7.4, 10.2],
    highlights: [
      'Soft foam midsole for long runs',
      'Engineered mesh upper that breathes',
      'Reflective heel tab for early starts',
    ],
    spec: ['Drop', ['6 mm', '8 mm', '10 mm']],
    tags: SHOE_TAGS,
    summary: 'It’s built to feel the same at mile twenty as it did at mile one.',
    praise: 'My legs feel fresher after long runs.',
    fault: 'It runs a little small, so order half a size up.',
  },
  'Hiking Boots': {
    department: 'Footwear',
    noun: 'hiking boot',
    use: 'day hikes and long weekends on rough trail',
    ounces: [16.9, 24],
    highlights: [
      'Padded collar that supports the ankle',
      'Stiff shank for rocky ground',
      'Locking lace hooks hold the heel in place',
    ],
    spec: ['Height', ['Mid', 'High']],
    tags: [...SHOE_TAGS, 'insulated'],
    summary: 'It needs very little breaking in, so it’s ready to go right out of the box.',
    praise: 'No blisters, even on the first day out.',
    fault: 'It runs a little small, so order half a size up.',
  },
  'Approach Shoes': {
    department: 'Footwear',
    noun: 'approach shoe',
    use: 'scrambles and the walk in to the crag',
    ounces: [11.6, 14.8],
    highlights: [
      'Sticky rubber toe for scrambling',
      'Lace-to-toe fit for precise footing',
      'Clip loop at the heel',
    ],
    spec: ['Fit', ['Snug', 'Regular']],
    tags: SHOE_TAGS,
    summary: 'It edges well on slabs and still walks comfortably on the trail.',
    praise: 'It sticks to rock better than I expected.',
    fault: 'It runs a little small, so order half a size up.',
  },
  'Insulated Jackets': {
    department: 'Clothing',
    noun: 'insulated jacket',
    use: 'cold mornings and belay stops',
    ounces: [11.3, 19.8],
    highlights: [
      'Packs into its own pocket',
      'Two zip hand pockets and an inner chest pocket',
      'Hem drawcord seals out drafts',
    ],
    spec: ['Fill', ['60 g/m² synthetic', '100 g/m² synthetic', '800-fill down']],
    tags: ['lightweight', 'insulated', 'recycled'],
    summary: 'It layers under a shell without bunching at the shoulders.',
    praise: 'I didn’t need a second layer under it.',
    fault: 'It runs a little small, so size up if you’re between sizes.',
  },
  'Rain Shells': {
    department: 'Clothing',
    noun: 'rain shell',
    use: 'wet days on the trail',
    ounces: [9.9, 14.8],
    highlights: [
      'Fully taped seams',
      'Helmet-compatible hood with a stiff brim',
      'Pit zips let heat out on the climb',
    ],
    spec: ['Waterproof rating', ['20,000 mm', '28,000 mm']],
    tags: ['waterproof', 'lightweight', 'breathable', 'recycled'],
    summary: 'It packs small enough to carry on a sunny day just in case.',
    praise: 'It kept me dry through a full afternoon of rain.',
    fault: 'It runs a little small, so size up if you’re between sizes.',
  },
  'Base Layers': {
    department: 'Clothing',
    noun: 'base layer',
    use: 'wearing next to the skin all day',
    ounces: [4.9, 9.2],
    highlights: [
      'Flatlock seams that won’t rub under a pack',
      'Thumb loops keep the sleeves in place',
      'Dries fast between stops',
    ],
    spec: ['Weight class', ['Lightweight', 'Midweight', 'Heavyweight']],
    tags: ['lightweight', 'breathable', 'recycled'],
    summary: 'It moves sweat away fast, so you stay comfortable when you stop.',
    praise: 'I wore it for three days and it never felt clammy.',
    fault: 'It runs a little small, so size up if you’re between sizes.',
  },
  Backpacks: {
    department: 'Packs',
    noun: 'backpack',
    use: 'day trips and overnights',
    ounces: [32, 74],
    highlights: [
      'Adjustable torso length',
      'Hip belt pockets you can reach on the move',
      'Lid pocket and stretch side pockets',
    ],
    spec: ['Capacity', ['28 L', '38 L', '48 L', '58 L']],
    tags: ['waterproof', 'lightweight', 'recycled'],
    summary: 'The back panel keeps the load close and lets air move behind you.',
    praise: 'It carries a full load without digging into my shoulders.',
    fault: 'The hip belt pockets are too small for a phone.',
  },
  Tents: {
    department: 'Camp',
    noun: 'tent',
    use: 'backpacking and car camping',
    ounces: [49, 113],
    highlights: [
      'Freestanding, with two doors and two vestibules',
      'Color-coded clips for quick pitching',
      'Mesh inner for warm nights',
    ],
    spec: ['Sleeps', ['2', '3', '4']],
    tags: ['waterproof', 'lightweight', 'recycled'],
    summary: 'There’s room to sit up and sort your gear when the weather turns.',
    praise: 'It pitches in a few minutes, even on my own.',
    fault: 'The stakes it comes with bend in hard ground.',
  },
  'Sleeping Bags': {
    department: 'Camp',
    noun: 'sleeping bag',
    use: 'three-season nights out',
    ounces: [28, 56],
    highlights: [
      'Draft collar and zip baffle',
      'Contoured hood with a one-hand drawcord',
      'Comes with a stuff sack and a storage sack',
    ],
    spec: ['Rated to', ['20 °F', '30 °F', '40 °F']],
    tags: ['lightweight', 'insulated', 'recycled'],
    summary: 'The cut is roomy at the knees, so side sleepers can turn over.',
    praise: 'I stayed warm on a cold night close to the rating.',
    fault: 'The zipper snags on the draft tube.',
  },
  Headlamps: {
    department: 'Gear',
    noun: 'headlamp',
    use: 'camp chores and pre-dawn starts',
    ounces: [1.6, 3.9],
    highlights: [
      'Red mode that saves your night vision',
      'Charges over USB-C',
      'Lamp head tilts down for reading a map',
    ],
    spec: ['Max output', ['350 lumens', '500 lumens', '750 lumens']],
    tags: ['waterproof', 'lightweight'],
    summary: 'One button cycles the modes, and a long press keeps it from turning on in your pack.',
    praise: 'One charge lasted a whole weekend.',
    fault: 'The strap loosens on bumpy trails.',
  },
  'Trekking Poles': {
    department: 'Gear',
    noun: 'pair of trekking poles',
    use: 'steep climbs and long descents',
    ounces: [13.4, 19.8],
    highlights: [
      'Flick locks set the length in seconds',
      'Cork grips with an extended foam section',
      'Carbide tips and snow baskets',
    ],
    spec: ['Collapsed length', ['14 in', '24 in', '26 in']],
    tags: ['lightweight', 'recycled'],
    summary: 'They collapse small enough to strap to the side of a daypack.',
    praise: 'My knees thank me on the way down.',
    fault: 'The tips are loud on rock.',
  },
};

const MATERIAL_SPEC: Record<string, string> = {
  'Gore-Tex': 'Gore-Tex membrane',
  Merino: 'Merino wool',
  Ripstop: 'Ripstop nylon',
  Vibram: 'Vibram rubber',
  Primaloft: 'PrimaLoft insulation',
  Cordura: 'Cordura fabric',
};

const MATERIAL_TEXT: Record<string, string> = {
  'Gore-Tex': 'a Gore-Tex membrane',
  Merino: 'merino wool',
  Ripstop: 'ripstop nylon',
  Vibram: 'Vibram rubber',
  Primaloft: 'PrimaLoft insulation',
  Cordura: 'Cordura fabric',
};

const TAG_TEXT: Record<string, string> = {
  waterproof: 'Waterproof, with a water-repellent finish on the outside',
  lightweight: 'Built light for long days',
  insulated: 'Insulated for cold starts',
  breathable: 'Breathable enough for steady climbs',
  recycled: 'Made with recycled fabric',
  'wide-fit': 'Wide fit, for feet that need more room',
};

const REVIEWERS = ['Maya R.', 'Tom K.', 'Priya S.', 'Owen D.', 'Lena H.', 'Sam W.', 'Jo B.'];
const WHEN = ['2 weeks ago', '1 month ago', '3 months ago', '5 months ago'];

function reviewStars(rating: number): [number, number] {
  const stars = Math.min(5, Math.max(1, Math.round(rating)));
  return [stars, stars >= 4 ? stars - 1 : stars + 1];
}

function reviewsFor(info: CategoryInfo, rating: number, random: () => number) {
  const [stars, secondRating] = reviewStars(rating);
  const first: Review =
    stars >= 4
      ? {
          author: pick(random, REVIEWERS),
          rating: stars,
          title: 'Does what I bought it for',
          body: `I used this ${info.noun} for ${info.use} and it held up well. ${info.praise}`,
          when: pick(random, WHEN),
        }
      : {
          author: pick(random, REVIEWERS),
          rating: stars,
          title: stars === 3 ? 'Fine, not great' : 'Not what I hoped for',
          body: `I bought this ${info.noun} for ${info.use}. ${stars === 3 ? 'It does the job, but it feels heavier than the listing suggests.' : 'It started to wear after a few weeks, and I sent it back.'}`,
          when: pick(random, WHEN),
        };
  const second: Review = {
    author: pick(
      random,
      REVIEWERS.filter((name) => name !== first.author),
    ),
    rating: secondRating,
    title: secondRating >= 4 ? 'Good, with one catch' : 'Some good, some bad',
    body: `${secondRating >= 4 ? `Solid ${info.noun} overall.` : 'Parts of it are fine.'} ${info.fault}`,
    when: pick(random, WHEN),
  };
  return [first, second];
}

function ratingCountsFor(rating: number, total: number): ProductDetails['ratingCounts'] {
  const weights = [5, 4, 3, 2, 1].map((stars) => Math.exp(-Math.abs(stars - rating) * 1.4));
  const sum = weights.reduce((left, right) => left + right, 0);
  const shares = weights.map((weight) => weight / sum);
  const mean = shares.reduce((left, share, index) => left + share * (5 - index), 0);
  const end = mean > rating ? 1 : 5;
  const keep = (rating - end) / (mean - end);
  const counts = shares.map((share, index) =>
    Math.round((share * keep + (5 - index === end ? 1 - keep : 0)) * total),
  );
  const largest = counts.indexOf(Math.max(...counts));
  counts[largest]! += total - counts.reduce((left, right) => left + right, 0);
  for (const stars of total > 0 ? reviewStars(rating) : []) {
    if (counts[5 - stars] === 0) {
      counts[5 - stars] = 1;
      counts[largest]! -= 1;
    }
  }
  return counts as ProductDetails['ratingCounts'];
}

function weightText(ounces: number): string {
  const tenths = Math.round(ounces * 10) / 10;
  if (tenths < 16) return `${tenths.toFixed(1)} oz`;
  const whole = Math.round(ounces);
  const pounds = Math.floor(whole / 16);
  return whole % 16 === 0 ? `${pounds} lb` : `${pounds} lb ${whole % 16} oz`;
}

export function colorIndexFor(sku: string): number {
  let hash = 0;
  for (const character of sku.toUpperCase()) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return hash % SWATCHES.length;
}

export function detailsFor(product: Product): ProductDetails {
  const random = mulberry32(Number(product.sku.replace(/\D/g, '')) * 7919);
  const info = CATEGORY_INFO[product.category] ?? CATEGORY_INFO['Backpacks']!;
  const material = product.title.split(' ')[1] ?? '';
  const colorIndex = colorIndexFor(product.sku);
  const swatches = [0, 2, 4].map((step) => SWATCHES[(colorIndex + step) % SWATCHES.length]!);

  const [low, high] = info.ounces;
  const ounces = low + random() * (high - low);

  const rating = product.rating ?? 0;
  const reviewCount = rating < 1 ? 0 : 12 + Math.floor(random() * 480);
  const tagLines = product.tags.flatMap((tag) =>
    info.tags.includes(tag) && TAG_TEXT[tag] ? [TAG_TEXT[tag]] : [],
  );
  const specValues =
    product.tags.includes('wide-fit') && info.spec[0] === 'Fit'
      ? ['Wide']
      : info.spec[1].filter(
          (value) =>
            (material !== 'Primaloft' || !value.includes('down')) &&
            (!product.tags.includes('lightweight') || value !== 'Heavyweight'),
        );

  return {
    brand: pick(random, BRANDS),
    department: info.department,
    swatches,
    highlights: [...tagLines, ...info.highlights].slice(0, 5),
    specs: [
      ['Material', MATERIAL_SPEC[material] ?? material],
      ['Weight', weightText(ounces)],
      [info.spec[0], pick(random, specValues)],
      ['Item number', product.sku],
    ],
    description: `This ${info.noun} is made with ${MATERIAL_TEXT[material] ?? material.toLowerCase()}, for ${info.use}. ${info.summary}`,
    reviewCount,
    ratingCounts: ratingCountsFor(rating, reviewCount),
    reviews: reviewCount === 0 ? [] : reviewsFor(info, rating, random),
  };
}
