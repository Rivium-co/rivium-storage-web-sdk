/** Small files made in the browser, so the example needs nothing on disk. */
import { RiviumStorageException, StorageErrorCode } from '@rivium/storage-web';
import { legacyMatch } from './bucket-setup';

/** A real 64x48 PNG (a colour gradient) drawn on a canvas. */
export async function makePng(width = 64, height = 48): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#2563eb');
  g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(4, 4, 10, 10); // a corner mark, so rotation is visible
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** A minimal valid one-page PDF. */
export function makePdf(text = 'Rivium Storage example'): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}

/** A tiny fake Windows program: only the "MZ" header. Harmless, but an executable by name and by content. */
export function makeFakeExe(): Uint8Array {
  const b = new Uint8Array(64);
  b[0] = 0x4d; // M
  b[1] = 0x5a; // Z
  return b;
}

/** HTML bytes, to be declared as image/png: the server checks the real content and refuses it. */
export function makeHtml(): Uint8Array {
  return new TextEncoder().encode('<!doctype html><html><body><script>alert(1)</script></body></html>');
}

/** n bytes starting like a PNG (for the size limit: refused before the content is looked at). */
export function makeBlob(n: number): Uint8Array {
  const b = new Uint8Array(n).fill(0x41);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
}

/**
 * A real PNG of random-noise pixels, for watching upload progress on a larger file. Noise does not
 * compress, so the browser's encoder makes it about width x height x 3-4 bytes (1200x1200 is ~4-6 MB).
 * It is a real image/png, so buckets that allow only images accept it (random bytes would be
 * application/octet-stream).
 */
export async function makeNoisePng(width = 1200, height = 1200): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const px = img.data;
  const max = 65536; // getRandomValues fills at most 64 KB per call
  for (let i = 0; i < px.length; i += max) crypto.getRandomValues(px.subarray(i, Math.min(px.length, i + max)));
  for (let i = 3; i < px.length; i += 4) px[i] = 255; // opaque
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Width and height from a PNG's signature + IHDR chunk, or null when the bytes are not a PNG. */
export function pngHeaderSize(b: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** The progress demo's PNG was refused because the bucket doesn't allow image/png (400 "... is not allowed in this bucket"). */
export function isPngNotAllowed(e: unknown): boolean {
  return isTypeNotAllowed(e);
}

/** The bucket refused the file's format (the SDK error's code, not its message text). */
export function isTypeNotAllowed(e: unknown): boolean {
  if (!(e instanceof RiviumStorageException)) return false;
  // An older Storage API refuses with the same message but no code.
  return e.code === StorageErrorCode.TypeNotAllowed || legacyMatch('type_not_allowed', e.statusCode, e.code, e.message);
}

export const PNG_NOT_ALLOWED =
  "This bucket doesn't allow image/png. Allow PNG in the Console (Bucket › Settings › Allowed file types) to run this check.";

export function sameBytes(a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean {
  const x = a instanceof Uint8Array ? a : new Uint8Array(a);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Width and height of an image blob (decoded by the browser). */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/** Loads a URL into an <img> and resolves with its natural size, or rejects when the browser cannot show it. */
export function loadImage(img: HTMLImageElement, src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('the browser could not load this as an image'));
    img.src = src;
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
