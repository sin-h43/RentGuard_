import { query, tx } from '@/lib/db';
import { HttpError, route } from '@/lib/http';
import { savePhoto } from '@/lib/photos';
import { listingSchema } from '@/lib/validators';

const MAX_PHOTOS = 6;

/**
 * Publishes a NEW immutable version of a listing (multipart form: fields + photo files).
 * Photo files are stored by SHA-256, so re-using someone else's image yields the same hash,
 * which is exactly what the graph layer looks for.
 */
export const POST = route(['OWNER'], async ({ req, session }) => {
  const form = await req.formData().catch(() => {
    throw new HttpError(400, 'Expected a multipart form.');
  });
  const raw: Record<string, string> = {};
  for (const k of ['propertyId', 'title', 'monthlyRent', 'securityDeposit', 'addressLine', 'locality', 'city', 'pincode', 'contactPhone', 'amenities', 'effectiveFrom']) {
    const v = form.get(k);
    if (typeof v === 'string') raw[k] = v;
  }
  const b = listingSchema.parse(raw);

  const owns = await query('SELECT 1 FROM property WHERE property_id = $1 AND owner_id = $2', [b.propertyId, session!.uid]);
  if (owns.length === 0) throw new HttpError(403, 'You do not own this property.');

  // photos kept from earlier versions (must really belong to this property) + new uploads
  let keep: string[] = [];
  try {
    keep = JSON.parse(String(form.get('keepPhotos') ?? '[]'));
  } catch {
    throw new HttpError(400, 'keepPhotos must be a JSON array.');
  }
  if (!Array.isArray(keep) || keep.some((s) => typeof s !== 'string' || !/^[0-9a-f]{64}$/.test(s))) {
    throw new HttpError(400, 'keepPhotos contains an invalid hash.');
  }
  if (keep.length) {
    const ok = await query<{ sha256: string }>(
      `SELECT DISTINCT lp.sha256 FROM listing_photo lp JOIN listing_version lv USING (version_id)
        WHERE lv.property_id = $1 AND lp.sha256 = ANY($2::text[])`,
      [b.propertyId, keep],
    );
    if (ok.length !== new Set(keep).size) throw new HttpError(400, 'You can only keep photos that were on this property before.');
  }
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  const uploaded: string[] = [];
  for (const f of files) uploaded.push(await savePhoto(f));
  const hashes = [...new Set([...keep, ...uploaded])];
  if (hashes.length < 1) throw new HttpError(400, 'Add at least one photo.');
  if (hashes.length > MAX_PHOTOS) throw new HttpError(400, `At most ${MAX_PHOTOS} photos per listing.`);

  const amenities = (b.amenities ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 15);

  const started = new Date(Date.now() - 1000).toISOString();
  const versionId = await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT sp_publish_listing($1,$2,$3,$4,$5,$6,$7,$8,$9::char(6),$10,$11::jsonb,$12::date,$13::text[],$14::text[]) AS id',
      [
        b.propertyId, session!.uid, b.title, b.monthlyRent, b.securityDeposit, b.addressLine, b.locality, b.city,
        b.pincode, b.contactPhone, JSON.stringify(amenities), b.effectiveFrom,
        hashes.map((h) => `/api/photos/${h}`), hashes,
      ],
    );
    return rows[0].id as number;
  });

  // tell the owner immediately if the database triggers flagged this change
  const flagsRaised = await query<{ flag_type: string; severity: number }>(
    'SELECT flag_type, severity FROM fraud_flag WHERE property_id = $1 AND created_at >= $2::timestamptz',
    [b.propertyId, started],
  );
  return { versionId, flagsRaised };
});
