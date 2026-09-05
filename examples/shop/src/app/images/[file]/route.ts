// The catalog fixture invents an image path per product. Rather than ship two
// thousand binaries, draw one: the same SKU always gets the same colour, so the
// grid looks like a shop instead of a wall of broken images.
const PALETTE = ['#2f4858', '#33658a', '#55696e', '#5b5f97', '#3c6e57', '#7a5c61'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const sku = file.replace(/\.[a-z]+$/i, '').toUpperCase();

  let hash = 0;
  for (const character of sku) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  const fill = PALETTE[hash % PALETTE.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3" role="img" aria-hidden="true"><rect width="4" height="3" fill="${fill}"/></svg>`;

  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=31536000' },
  });
}
