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
  color: Swatch;
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
  weight: [low: number, high: number, unit: 'g' | 'kg'];
  highlights: string[];
  spec: [label: string, values: string[]];
}

const CATEGORY_INFO: Record<string, CategoryInfo> = {
  'Trail Running': {
    department: 'Footwear',
    noun: 'trail shoe',
    use: 'running on dirt, rock and roots',
    weight: [240, 340, 'g'],
    highlights: [
      'Lugged outsole that grips loose dirt and wet rock',
      'Rock plate under the forefoot',
      'Gusseted tongue keeps grit out',
    ],
    spec: ['Drop', ['4 mm', '6 mm', '8 mm']],
  },
  'Road Running': {
    department: 'Footwear',
    noun: 'road shoe',
    use: 'daily miles on pavement',
    weight: [210, 290, 'g'],
    highlights: [
      'Soft foam midsole for long runs',
      'Engineered mesh upper that breathes',
      'Reflective heel tab for early starts',
    ],
    spec: ['Drop', ['6 mm', '8 mm', '10 mm']],
  },
  'Hiking Boots': {
    department: 'Footwear',
    noun: 'hiking boot',
    use: 'day hikes and long weekends on rough trail',
    weight: [480, 680, 'g'],
    highlights: [
      'Mid-height collar that supports the ankle',
      'Stiff shank for rocky ground',
      'Locking lace hooks hold the heel in place',
    ],
    spec: ['Height', ['Mid', 'High']],
  },
  'Approach Shoes': {
    department: 'Footwear',
    noun: 'approach shoe',
    use: 'scrambles and the walk in to the crag',
    weight: [330, 420, 'g'],
    highlights: [
      'Sticky rubber toe for scrambling',
      'Lace-to-toe fit for precise footing',
      'Clip loop at the heel',
    ],
    spec: ['Fit', ['Snug', 'Regular']],
  },
  'Insulated Jackets': {
    department: 'Clothing',
    noun: 'insulated jacket',
    use: 'cold mornings and belay stops',
    weight: [320, 560, 'g'],
    highlights: [
      'Stays warm when damp and packs into its own pocket',
      'Two zip hand pockets and an inner chest pocket',
      'Hem drawcord seals out drafts',
    ],
    spec: ['Fill', ['60 g/m² synthetic', '100 g/m² synthetic', '800-fill down']],
  },
  'Rain Shells': {
    department: 'Clothing',
    noun: 'rain shell',
    use: 'wet days on the trail',
    weight: [280, 420, 'g'],
    highlights: [
      'Fully taped seams',
      'Helmet-compatible hood with a stiff brim',
      'Pit zips let heat out on the climb',
    ],
    spec: ['Waterproof rating', ['20,000 mm', '28,000 mm']],
  },
  'Base Layers': {
    department: 'Clothing',
    noun: 'base layer',
    use: 'wearing next to the skin all day',
    weight: [140, 260, 'g'],
    highlights: [
      'Flatlock seams that won’t rub under a pack',
      'Thumb loops keep the sleeves in place',
      'Dries fast between stops',
    ],
    spec: ['Weight class', ['Lightweight', 'Midweight', 'Heavyweight']],
  },
  Backpacks: {
    department: 'Packs',
    noun: 'backpack',
    use: 'day trips and overnights',
    weight: [0.9, 2.1, 'kg'],
    highlights: [
      'Adjustable torso length',
      'Hip belt pockets you can reach on the move',
      'Lid pocket and stretch side pockets',
    ],
    spec: ['Capacity', ['28 L', '38 L', '48 L', '58 L']],
  },
  Tents: {
    department: 'Camp',
    noun: 'tent',
    use: 'backpacking and car camping',
    weight: [1.4, 3.2, 'kg'],
    highlights: [
      'Freestanding, with two doors and two vestibules',
      'Color-coded clips for quick pitching',
      'Mesh inner for warm nights',
    ],
    spec: ['Sleeps', ['1', '2', '3']],
  },
  'Sleeping Bags': {
    department: 'Camp',
    noun: 'sleeping bag',
    use: 'three-season nights out',
    weight: [0.8, 1.6, 'kg'],
    highlights: [
      'Draft collar and zip baffle',
      'Contoured hood with a one-hand drawcord',
      'Comes with a stuff sack and a storage sack',
    ],
    spec: ['Rated to', ['-7 °C', '-2 °C', '4 °C']],
  },
  Headlamps: {
    department: 'Gear',
    noun: 'headlamp',
    use: 'camp chores and pre-dawn starts',
    weight: [45, 110, 'g'],
    highlights: [
      'Red mode that saves your night vision',
      'Charges over USB-C',
      'Lamp head tilts down for reading a map',
    ],
    spec: ['Max output', ['350 lumens', '500 lumens', '750 lumens']],
  },
  'Trekking Poles': {
    department: 'Gear',
    noun: 'pair of trekking poles',
    use: 'steep climbs and long descents',
    weight: [380, 560, 'g'],
    highlights: [
      'Flick locks set the length in seconds',
      'Cork grips with an extended foam section',
      'Carbide tips and snow baskets',
    ],
    spec: ['Collapsed length', ['36 cm', '61 cm', '66 cm']],
  },
};

const MATERIAL_SPEC: Record<string, string> = {
  'Gore-Tex': 'Gore-Tex membrane',
  Merino: 'Merino wool',
  Ripstop: 'Ripstop nylon',
  Vibram: 'Vibram outsole',
  Primaloft: 'PrimaLoft insulation',
  Cordura: 'Cordura fabric',
};

const MATERIAL_TEXT: Record<string, string> = {
  'Gore-Tex': 'a Gore-Tex membrane',
  Merino: 'merino wool',
  Ripstop: 'ripstop nylon',
  Vibram: 'a Vibram outsole',
  Primaloft: 'PrimaLoft insulation',
  Cordura: 'Cordura fabric',
};

const TAG_TEXT: Record<string, string> = {
  waterproof: 'Waterproof, with a water-repellent finish on the outside',
  lightweight: 'Built light for long days',
  insulated: 'Insulated for cold starts',
  breathable: 'Breathable enough for steady climbs',
  recycled: 'Made with recycled fabric',
  'wide-fit': 'Also comes in a wide fit',
};

const REVIEWERS = ['Maya R.', 'Tom K.', 'Priya S.', 'Owen D.', 'Lena H.', 'Sam W.', 'Jo B.'];
const WHEN = ['2 weeks ago', '1 month ago', '3 months ago', '5 months ago'];

function reviewsFor(info: CategoryInfo, title: string, rating: number, random: () => number) {
  const stars = Math.min(5, Math.max(1, Math.round(rating)));
  const first: Review =
    stars >= 4
      ? {
          author: pick(random, REVIEWERS),
          rating: stars,
          title: 'Does what I bought it for',
          body: `I used the ${title} for ${info.use} and it held up well. ${pick(random, info.highlights)} is the part I noticed most.`,
          when: pick(random, WHEN),
        }
      : {
          author: pick(random, REVIEWERS),
          rating: stars,
          title: stars === 3 ? 'Fine, not great' : 'Not what I hoped for',
          body: `I wanted the ${title} for ${info.use}. It ${stars === 3 ? 'does the job, but it feels heavier than the listing suggests' : 'started to wear after a few weeks, and I sent it back'}.`,
          when: pick(random, WHEN),
        };
  const second: Review = {
    author: pick(
      random,
      REVIEWERS.filter((name) => name !== first.author),
    ),
    rating: Math.min(5, Math.max(1, stars + (stars >= 4 ? -1 : 1))),
    title: 'Good, with one catch',
    body: `Solid ${info.noun} overall. It runs a little ${random() > 0.5 ? 'small' : 'warm'}, so check the size chart before you order.`,
    when: pick(random, WHEN),
  };
  return [first, second];
}

function ratingCountsFor(rating: number, total: number): ProductDetails['ratingCounts'] {
  const weights = [5, 4, 3, 2, 1].map((stars) => Math.exp(-Math.abs(stars - rating) * 1.4));
  const sum = weights.reduce((left, right) => left + right, 0);
  const counts = weights.map((weight) => Math.round((weight / sum) * total));
  counts[0]! += total - counts.reduce((left, right) => left + right, 0);
  return counts as ProductDetails['ratingCounts'];
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
  const color = SWATCHES[colorIndex]!;
  const swatches = [0, 2, 4].map((step) => SWATCHES[(colorIndex + step) % SWATCHES.length]!);

  const [low, high, unit] = info.weight;
  const weight = low + random() * (high - low);
  const weightText = unit === 'kg' ? `${weight.toFixed(2)} kg` : `${Math.round(weight)} g`;

  const rating = product.rating ?? 0;
  const reviewCount = rating < 1 ? 0 : 12 + Math.floor(random() * 480);
  const tagLines = product.tags.flatMap((tag) => (TAG_TEXT[tag] ? [TAG_TEXT[tag]] : []));
  const materialText = MATERIAL_TEXT[material] ?? material.toLowerCase();

  return {
    brand: pick(random, BRANDS),
    department: info.department,
    color,
    swatches,
    highlights: [...tagLines, ...info.highlights].slice(0, 5),
    specs: [
      ['Material', MATERIAL_SPEC[material] ?? material],
      ['Weight', weightText],
      [info.spec[0], pick(random, info.spec[1])],
      ['Item number', product.sku],
    ],
    description: `The ${product.title} is a ${info.noun} made with ${materialText}, for ${info.use}. ${info.highlights[0]}, and ${info.highlights[1]!.charAt(0).toLowerCase()}${info.highlights[1]!.slice(1)}.`,
    reviewCount,
    ratingCounts: ratingCountsFor(rating, reviewCount),
    reviews: reviewCount === 0 ? [] : reviewsFor(info, product.title, rating, random),
  };
}
