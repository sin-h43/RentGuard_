import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { env } from './env';
import { HttpError } from './http';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

function looksLike(ext: string, b: Buffer): boolean {
  if (ext === 'jpg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === 'webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return false;
}

/** Stores an uploaded image under its SHA-256 and returns the hash (content address). */
export async function savePhoto(file: File): Promise<string> {
  const ext = EXT[file.type];
  if (!ext) throw new HttpError(400, 'Only JPEG, PNG or WebP images are allowed.');
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(400, 'Each photo must be 3 MB or smaller.');
  const buf = Buffer.from(await file.arrayBuffer());
  if (!looksLike(ext, buf)) throw new HttpError(400, 'File content does not match its image type.');
  const sha = createHash('sha256').update(buf).digest('hex');
  const dir = path.resolve(env.uploadDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${sha}.${ext}`), buf);
  return sha;
}

export async function readPhoto(sha: string): Promise<{ buf: Buffer; type: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const dir = path.resolve(env.uploadDir);
  for (const ext of Object.keys(MIME)) {
    try {
      return { buf: await fs.readFile(path.join(dir, `${sha}.${ext}`)), type: MIME[ext] };
    } catch {
      /* try next extension */
    }
  }
  return null;
}

/** Stand-in picture for photos that have no file (demo seed data). Colour derives from the hash. */
export function placeholderSvg(sha: string): string {
  const hue = parseInt(sha.slice(0, 4), 16) % 360;
  const hue2 = (hue + 40) % 360;
  const tag = sha.slice(0, 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" role="img" aria-label="Listing photo ${tag}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 78%)"/><stop offset="1" stop-color="hsl(${hue2} 50% 62%)"/></linearGradient></defs>
<rect width="400" height="260" fill="url(#g)"/>
<path d="M70 170 L200 80 L330 170 V215 H70 Z" fill="rgba(255,255,255,.55)"/>
<rect x="172" y="150" width="56" height="65" fill="rgba(0,0,0,.18)"/>
<text x="200" y="245" font-family="monospace" font-size="13" text-anchor="middle" fill="rgba(0,0,0,.55)">photo ${tag}</text>
</svg>`;
}
