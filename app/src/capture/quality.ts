// Quality gate: runs on each photo before inference. Thresholds live in CONFIG.quality and are tuned
// on BRACOL images by ml/tune_quality.py (a Python mirror of these exact metrics).
import { CONFIG } from "../config";
import { type Box, draw, isLeafPixel, leafBox } from "./image";

export type QualityIssue = "dark" | "bright" | "no_leaf" | "blurry";

export interface QualityResult {
  ok: boolean;
  issue: QualityIssue | null;
  metrics: { luma: number; clipped: number; leafCentre: number; lapVar: number };
  box: Box | null;
}

export function lumaStats(d: Uint8ClampedArray): { mean: number; clipped: number } {
  let sum = 0, clip = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += y;
    if (y <= 5 || y >= 250) clip++;
  }
  return { mean: sum / n, clipped: clip / n };
}

export function leafCentreFraction(d: Uint8ClampedArray, w: number, h: number, frac: number): number {
  const x0 = Math.floor((w * (1 - frac)) / 2), x1 = Math.ceil((w * (1 + frac)) / 2);
  const y0 = Math.floor((h * (1 - frac)) / 2), y1 = Math.ceil((h * (1 + frac)) / 2);
  let leaf = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      n++;
      if (isLeafPixel(d[i], d[i + 1], d[i + 2])) leaf++;
    }
  return n ? leaf / n : 0;
}

/** Variance of the 4-neighbour Laplacian on grey values (0-255). */
export function laplacianVariance(d: Uint8ClampedArray, w: number, h: number): number {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const v = g[k - 1] + g[k + 1] + g[k - w] + g[k + w] - 4 * g[k];
      sum += v;
      sum2 += v * v;
      n++;
    }
  if (!n) return 0;
  const m = sum / n;
  return sum2 / n - m * m;
}

export function checkQuality(img: ImageBitmap): QualityResult {
  const q = CONFIG.quality;
  const sw = q.analysisWidth, sh = Math.max(1, Math.round((img.height * sw) / img.width));
  const small = draw(img, 0, 0, img.width, img.height, sw, sh).data;
  const { mean, clipped } = lumaStats(small);
  const leafCentre = leafCentreFraction(small, sw, sh, q.centreFraction);
  const box = leafBox(img);
  let lapVar = 0;
  if (box) {
    // Blur is measured on the leaf region at a fixed width so the score does not depend on photo size.
    const lw = q.analysisWidth, lh = Math.max(3, Math.round((box.h * lw) / box.w));
    lapVar = laplacianVariance(draw(img, box.x, box.y, box.w, box.h, lw, lh).data, lw, lh);
  }
  const metrics = { luma: mean, clipped, leafCentre, lapVar };
  let issue: QualityIssue | null = null;
  if (mean < q.lumaMin) issue = "dark";
  else if (mean > q.lumaMax || clipped > q.clippedMaxFraction) issue = "bright";
  else if (!box || leafCentre < q.leafMinFraction) issue = "no_leaf";
  else if (lapVar < q.blurMinLaplacianVar) issue = "blurry";
  return { ok: issue === null, issue, metrics, box };
}
