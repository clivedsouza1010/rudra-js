import { NextResponse } from 'next/server';
import { buildTrackingInput } from '@/data/shoppers';
import { getGenerator } from '@/lib/rudra';

/**
 * The endpoint the client-rendered control arm calls after hydration.
 *
 * It runs the same generator against the same tracking payload as the SSR
 * route, so the only difference between the two arms is *when and where* the
 * component is produced — which is the comparison the evaluation needs.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sku = url.searchParams.get('sku') ?? undefined;
  const shopperId = url.searchParams.get('shopper') ?? undefined;

  try {
    const generator = await getGenerator();
    const spec = await generator.generate(buildTrackingInput({ shopperId, currentSku: sku }));
    return NextResponse.json(spec, {
      // The spec is per-shopper; a shared cache must not serve it to anyone else.
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    // Only a malformed tracking payload reaches here — generation itself
    // degrades rather than throwing.
    console.error('[rudra] invalid tracking input', error);
    return NextResponse.json({ error: 'invalid tracking input' }, { status: 400 });
  }
}
