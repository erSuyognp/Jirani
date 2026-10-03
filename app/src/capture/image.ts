// Shared image helpers: decode a photo, leaf colour mask, leaf bounding-box crop.
// The crop mirrors ml/common.py (leaf_mask, leaf_bbox_crop) so the app sees what the model was trained on.
import { CONFIG } from "../config";

export async function decodePhoto(file: Blob): Promise<ImageBitmap> {
  // imageOrientation honours EXIF rotation from phone cameras.
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function draw(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number): ImageData {
  const c = canvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Leaf-coloured pixel: hue 15-170 deg (green through yellow-brown), enough saturation and value. */
export function isLeafPixel(r: number, g: number, b: number): boolean {
  const q = CONFIG.quality;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, d = mx - mn;
  if (d === 0 || mx < q.leafValMin) return false;
  const s = d / mx;
  if (s < q.leafSatMin) return false;
  const rr = r / 255, gg = g / 255, bb = b / 255;
  let h: number;
  if (mx === rr) h = (((gg - bb) / d) * 60 + 360) % 360;
  else if (mx === gg) h = ((bb - rr) / d) * 60 + 120;
  else h = ((rr - gg) / d) * 60 + 240;
  return h >= q.leafHueMin && h <= q.leafHueMax;
}

export interface Box { x: number; y: number; w: number; h: number }

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Leaf bounding box in source-pixel coordinates (1st-99th percentile of leaf pixels + margin), or null. */
export function leafBox(img: ImageBitmap): Box | null {
  const q = CONFIG.quality;
  const sw = q.analysisWidth, sh = Math.max(1, Math.round((img.height * sw) / img.width));
  const d = draw(img, 0, 0, img.width, img.height, sw, sh).data;
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      if (isLeafPixel(d[i], d[i + 1], d[i + 2])) { xs.push(x); ys.push(y); }
    }
  if (xs.length < 0.01 * sw * sh) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const mx = q.cropMarginFraction * sw, my = q.cropMarginFraction * sh;
  const x0 = Math.max(0, percentile(xs, 0.01) - mx), x1 = Math.min(sw, percentile(xs, 0.99) + 1 + mx);
  const y0 = Math.max(0, percentile(ys, 0.01) - my), y1 = Math.min(sh, percentile(ys, 0.99) + 1 + my);
  const fx = img.width / sw, fy = img.height / sh;
  return { x: Math.floor(x0 * fx), y: Math.floor(y0 * fy), w: Math.ceil((x1 - x0) * fx), h: Math.ceil((y1 - y0) * fy) };
}

/**
 * The leaf crop as a landscape canvas (training images are landscape with the leaf lying sideways).
 * If the leaf is taller than wide (phone held upright), rotate it 90 degrees.
 */
export function leafCanvas(img: ImageBitmap, box: Box | null, maxW = 1024): HTMLCanvasElement {
  const b = box ?? { x: 0, y: 0, w: img.width, h: img.height };
  const rotate = b.h > b.w;
  const longSide = Math.min(maxW, Math.max(b.w, b.h));
  const scale = longSide / Math.max(b.w, b.h);
  const w = Math.round(b.w * scale), h = Math.round(b.h * scale);
  const c = rotate ? canvas(h, w) : canvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (rotate) {
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, w, h);
  return c;
}
