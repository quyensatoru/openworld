// Wedding album uploads: shrink a picture from the phone / computer to a ~1600 px JPEG (the right
// way up, whatever the camera's EXIF says) before it goes to the server.

export interface Shrunk {
  blob: Blob;
  w: number;
  h: number;
}

const MAX_SIDE = 1600;
/** Aim well under the server's 1.5 MB limit. */
const TARGET_BYTES = 650_000;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // older Safari: an <img> (which also applies EXIF orientation these days)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));

export async function shrinkPhoto(file: Blob): Promise<Shrunk> {
  const src = await decode(file);
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  if (!sw || !sh) throw new Error('empty image');
  let side = MAX_SIDE;
  for (;;) {
    const k = Math.min(1, side / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    // a transparent PNG becomes a white print, not a black one
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    for (const q of [0.86, 0.78, 0.68]) {
      const blob = await toBlob(c, q);
      if (blob && (blob.size <= TARGET_BYTES || (q === 0.68 && side <= 1000))) {
        if ('close' in src) src.close();
        return { blob, w, h };
      }
    }
    side = Math.round(side * 0.8);
  }
}
