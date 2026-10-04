// "Ask the officer": the leaf photos of one check, prepared for sending. Opt-in per check.
// Images are re-drawn on a canvas at a small size, so they carry no EXIF data (no GPS, no device details).
import { canvas, decodePhoto, leafCanvas } from "../capture/image";
import type { Photo } from "../inference/pipeline";

const MAX_SIDE = 640;
const QUALITY = 0.8;

function toJpeg(src: HTMLCanvasElement): string {
  const s = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const c = canvas(Math.round(src.width * s), Math.round(src.height * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", QUALITY).split(",")[1];
}

/** Base64 JPEGs: the leaf crop the model saw, or the whole photo when the quality gate rejected it. */
export async function askImages(photos: Photo[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of photos) {
    if (p.leaf) {
      out.push(toJpeg(p.leaf));
      continue;
    }
    const bmp = await decodePhoto(p.file);
    out.push(toJpeg(leafCanvas(bmp, null, MAX_SIDE)));
    bmp.close();
  }
  return out;
}

/** Approximate size on the wire, for the Sync screen. */
export const askBytes = (images: string[]) => Math.round(images.reduce((n, i) => n + i.length, 0) * 0.75);
