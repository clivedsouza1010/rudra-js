import { catalog } from '../../../demo-context';
import { SWATCHES, colorIndexFor } from '../../../fixtures/product-details';

const SHADE = 'fill="#000" fill-opacity="0.18"';
const LIGHT = 'fill="#fff" fill-opacity="0.22"';
const LINE =
  'fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round"';

function shoe(color: string, isBoot: boolean, hasLugs: boolean): string {
  const upper = isBoot
    ? 'M80 196 L86 96 Q88 76 110 74 L150 72 Q166 72 169 88 L178 134 L234 154 Q268 162 302 168 Q340 174 344 196 Z'
    : 'M78 196 L84 142 Q90 120 118 114 L160 106 Q178 103 190 114 L232 152 Q264 162 302 168 Q340 174 344 196 Z';
  const laces = isBoot
    ? [0, 1, 2, 3, 4]
        .map((step) => `<path d="M${150 + step * 6} ${96 + step * 12} l22 8" ${LINE}/>`)
        .join('')
    : [0, 1, 2, 3]
        .map((step) => `<path d="M${176 + step * 12} ${124 + step * 8} l14 -10" ${LINE}/>`)
        .join('');
  const lugs = hasLugs
    ? [0, 1, 2, 3, 4, 5, 6, 7]
        .map(
          (step) =>
            `<rect x="${92 + step * 30}" y="214" width="16" height="6" rx="2" fill="#2b2f33"/>`,
        )
        .join('')
    : '';
  return `${lugs}<path d="M70 196 Q70 216 92 216 L322 216 Q348 216 348 200 L348 192 L70 192 Z" fill="#2b2f33"/>
<path d="M72 192 L346 192 L346 202 L72 202 Z" fill="#f4f4f2"/>
<path d="${upper}" fill="${color}"/>
<path d="M84 150 Q120 136 150 150 L150 196 L80 196 Z" ${SHADE}/>
<path d="M240 158 Q290 168 340 182" ${LINE}/>${laces}`;
}

function jacket(color: string, hasHood: boolean, isQuilted: boolean): string {
  const quilting = isQuilted
    ? [0, 1, 2, 3, 4, 5, 6]
        .map(
          (step) =>
            `<path d="M132 ${110 + step * 20} L268 ${110 + step * 20}" fill="none" stroke="#000" stroke-opacity="0.14" stroke-width="2"/>`,
        )
        .join('')
    : '';
  const hood = hasHood
    ? `<path d="M160 64 Q200 14 240 64 Q220 56 200 74 Q180 56 160 64 Z" fill="${color}"/><path d="M172 62 Q200 34 228 62 Q214 58 200 72 Q186 58 172 62 Z" ${SHADE}/>`
    : '';
  return `${hood}<path d="M140 66 L172 54 Q200 72 228 54 L260 66 Q298 84 312 128 L322 232 L292 238 L282 142 L272 132 L274 246 L126 246 L128 132 L118 142 L108 238 L78 232 L88 128 Q102 84 140 66 Z" fill="${color}"/>
${quilting}<path d="M200 74 L200 246" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="3"/>
<path d="M148 190 L172 176 M252 190 L228 176" ${LINE}/>
<path d="M88 128 Q102 84 140 66 L146 90 Q118 104 110 140 Z" ${LIGHT}/>`;
}

function baseLayer(color: string): string {
  return `<path d="M146 64 Q200 84 254 64 Q292 80 306 124 L318 232 L292 236 L280 142 L268 134 L270 246 L130 246 L132 134 L120 142 L108 236 L82 232 L94 124 Q108 80 146 64 Z" fill="${color}"/>
<path d="M170 66 Q200 80 230 66 L226 74 Q200 88 174 74 Z" ${SHADE}/>
<path d="M200 76 L200 112" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="3"/>
<path d="M94 124 Q108 80 146 64 L150 86 Q122 100 114 136 Z" ${LIGHT}/>`;
}

function backpack(color: string): string {
  return `<path d="M184 70 Q200 50 216 70" fill="none" stroke="#2b2f33" stroke-width="6" stroke-linecap="round"/>
<rect x="118" y="102" width="16" height="112" rx="8" ${SHADE}/><rect x="266" y="102" width="16" height="112" rx="8" ${SHADE}/>
<rect x="130" y="70" width="140" height="172" rx="34" fill="${color}"/>
<path d="M136 96 Q200 54 264 96 L264 116 L136 116 Z" ${SHADE}/>
<rect x="150" y="148" width="100" height="74" rx="18" ${SHADE}/>
<path d="M162 162 L238 162" ${LINE}/>
<rect x="188" y="110" width="24" height="16" rx="3" fill="#2b2f33"/>
<path d="M136 120 Q140 90 164 78 L170 92 Q152 104 150 132 Z" ${LIGHT}/>`;
}

function tent(color: string): string {
  return `<path d="M66 226 Q118 88 200 78 Q282 88 334 226 Z" fill="${color}"/>
<path d="M168 226 Q200 140 232 226 Z" ${SHADE}/>
<path d="M90 222 Q150 96 200 84 M310 222 Q250 96 200 84" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="3"/>
<path d="M66 226 L40 240 M334 226 L360 240 M120 150 L70 238 M280 150 L330 238" fill="none" stroke="#8a9199" stroke-width="1.5"/>
<path d="M100 200 Q140 110 200 92 L200 110 Q152 126 120 206 Z" ${LIGHT}/>`;
}

function sleepingBag(color: string): string {
  return `<path d="M200 50 Q252 52 256 102 L248 228 Q242 254 200 254 Q158 254 152 228 L144 102 Q148 52 200 50 Z" fill="${color}"/>
<ellipse cx="200" cy="88" rx="28" ry="20" fill="#2b2f33" fill-opacity="0.55"/>
${[0, 1, 2, 3, 4].map((step) => `<path d="M152 ${128 + step * 24} Q200 ${140 + step * 24} 248 ${128 + step * 24}" fill="none" stroke="#000" stroke-opacity="0.14" stroke-width="2"/>`).join('')}
<path d="M240 104 L234 228" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="3"/>
<path d="M150 110 Q152 66 190 56 L184 76 Q162 86 162 120 Z" ${LIGHT}/>`;
}

function headlamp(color: string): string {
  return `<ellipse cx="200" cy="150" rx="116" ry="54" fill="none" stroke="${color}" stroke-width="18"/>
<ellipse cx="200" cy="150" rx="116" ry="54" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="4"/>
<rect x="156" y="160" width="88" height="60" rx="16" fill="#2b2f33"/>
<circle cx="200" cy="190" r="20" fill="#f6f1d6"/><circle cx="200" cy="190" r="11" fill="#fffbe6"/>
<rect x="228" y="168" width="10" height="8" rx="2" fill="#c0392b"/>`;
}

function trekkingPoles(color: string): string {
  return `<path d="M156 70 L230 246 M244 70 L170 246" fill="none" stroke="#8a9199" stroke-width="8" stroke-linecap="round"/>
<path d="M156 70 L230 246 M244 70 L170 246" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>
<rect x="140" y="40" width="30" height="66" rx="12" fill="${color}" transform="rotate(-23 155 73)"/>
<rect x="230" y="40" width="30" height="66" rx="12" fill="${color}" transform="rotate(23 245 73)"/>
<ellipse cx="222" cy="226" rx="16" ry="5" fill="#2b2f33"/><ellipse cx="178" cy="226" rx="16" ry="5" fill="#2b2f33"/>
<path d="M140 52 Q120 70 136 94 M260 52 Q280 70 264 94" fill="none" stroke="#2b2f33" stroke-width="3"/>`;
}

function productShape(category: string | undefined, color: string): string {
  switch (category) {
    case 'Trail Running':
      return shoe(color, false, true);
    case 'Road Running':
      return shoe(color, false, false);
    case 'Hiking Boots':
      return shoe(color, true, true);
    case 'Approach Shoes':
      return shoe(color, false, true);
    case 'Insulated Jackets':
      return jacket(color, false, true);
    case 'Rain Shells':
      return jacket(color, true, false);
    case 'Base Layers':
      return baseLayer(color);
    case 'Tents':
      return tent(color);
    case 'Sleeping Bags':
      return sleepingBag(color);
    case 'Headlamps':
      return headlamp(color);
    case 'Trekking Poles':
      return trekkingPoles(color);
    default:
      return backpack(color);
  }
}

const OUTDOORS = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9dbe1"/><stop offset="1" stop-color="#eef3f0"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#sky)"/>
<path d="M0 210 L70 130 L120 170 L190 96 L260 168 L310 128 L400 200 L400 300 L0 300 Z" fill="#a9bcb0"/>
<path d="M0 236 L90 186 L160 220 L240 176 L330 222 L400 196 L400 300 L0 300 Z" fill="#8ea596"/>
<rect y="248" width="400" height="52" fill="#dfe7dc"/>`;

function svgFor(category: string | undefined, color: string, view: number): string {
  const shape = productShape(category, color);
  const shadow = '<ellipse cx="200" cy="246" rx="132" ry="9" fill="#000" fill-opacity="0.08"/>';

  if (view === 4) {
    return `${OUTDOORS}<g transform="translate(60 54) scale(0.7)">${shadow}${shape}</g>`;
  }
  const backdrop = '<rect width="400" height="300" fill="#f2f4f1"/>';
  if (view === 2) {
    return `${backdrop}<g transform="matrix(0.62 0 0 1 76 0)">${shadow}</g><g transform="matrix(0.62 0.1 0 1 76 -20)">${shape}</g>`;
  }
  if (view === 3) return `${backdrop}<g transform="translate(-200 -140) scale(2)">${shape}</g>`;
  return `${backdrop}${shadow}${shape}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const [, base = file, view = '1'] = /^([a-z]+-\d+)(?:-(\d))?\.[a-z]+$/i.exec(file) ?? [];
  const sku = base.toUpperCase();
  const product = catalog.find((candidate) => candidate.sku === sku);

  const tone = Number(new URL(request.url).searchParams.get('tone'));
  const colorIndex =
    Number.isInteger(tone) && tone >= 1 && tone <= SWATCHES.length ? tone - 1 : colorIndexFor(sku);
  const color = SWATCHES[colorIndex]!.hex;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" role="img" aria-hidden="true">${svgFor(product?.category, color, Number(view))}</svg>`;

  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' },
  });
}
