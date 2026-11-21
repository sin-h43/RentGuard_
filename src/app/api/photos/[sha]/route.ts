import { NextResponse } from 'next/server';
import { placeholderSvg, readPhoto } from '@/lib/photos';
import { route } from '@/lib/http';

// Photos are content-addressed (file name = SHA-256), so they can be cached forever.
export const GET = route(null, async ({ params }) => {
  const sha = (params.sha ?? '').toLowerCase();
  const found = await readPhoto(sha);
  const headers = { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
  if (found) return new NextResponse(new Uint8Array(found.buf), { headers: { ...headers, 'Content-Type': found.type } });
  if (!/^[0-9a-f]{64}$/.test(sha)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(placeholderSvg(sha), { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
});
