// Cherry band from the optional fourth photo. PROTOTYPE: a deterministic colour-and-defect heuristic, not a
// trained model. It emits a band (A, B or C) or no grade, and nothing else: no price is ever derived from the image.
// Thresholds live in CONFIG.cherry and are DRAFT values.
import { CONFIG } from "../config";
import { draw } from "./image";
import { lumaStats } from "./quality";

export type Band = "A" | "B" | "C";
export type CherryIssue = "dark" | "no_card" | "no_cherry";

export interface CherryGrade {
  band: Band | null;            // null = not graded
  issue: CherryIssue | null;    // why it was not graded
  metrics: { fruit: number; card: number; ripe: number; defect: number };
}

/**
 * Grade RGBA pixels. Fruit = saturated or blackened pixels; ripe = red; defect = green (unripe) or blackened.
 * Refuses (no band) when the photo is dark, when no white card is visible, or when there is too little fruit.
 */
export function gradeCherryPixels(d: Uint8ClampedArray): CherryGrade {
  const c = CONFIG.cherry;
  let fruit = 0, ripe = 0, defect = 0, card = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), delta = mx - mn;
    if (mx < c.darkValMax) { fruit++; defect++; continue; }   // blackened fruit (the card itself is white)
    if (delta / mx < c.satMin) {                               // not fruit: the white card, or shadow
      if (mx >= c.cardValMin) card++;
      continue;
    }
    let h: number;
    if (mx === r) h = (((g - b) / delta) * 60 + 360) % 360;
    else if (mx === g) h = ((b - r) / delta) * 60 + 120;
    else h = ((r - g) / delta) * 60 + 240;
    if (h >= c.ripeHueMin || h <= c.ripeHueMax) { fruit++; ripe++; }
    else if (h >= c.unripeHueMin && h <= c.unripeHueMax) { fruit++; defect++; }
    else if (h > c.ripeHueMax && h < c.unripeHueMin) fruit++;  // orange to yellow: half ripe, neither ripe nor defect
  }
  const metrics = {
    fruit: n ? fruit / n : 0, card: n ? card / n : 0,
    ripe: fruit ? ripe / fruit : 0, defect: fruit ? defect / fruit : 0,
  };
  let issue: CherryIssue | null = null;
  if (lumaStats(d).mean < CONFIG.quality.lumaMin) issue = "dark";
  else if (metrics.card < c.cardMinFraction) issue = "no_card";   // a dark table would be read as blackened fruit
  else if (metrics.fruit < c.fruitMinFraction) issue = "no_cherry";
  if (issue) return { band: null, issue, metrics };
  const band: Band =
    metrics.ripe >= c.bandA.ripeMin && metrics.defect <= c.bandA.defectMax ? "A"
    : metrics.ripe >= c.bandB.ripeMin && metrics.defect <= c.bandB.defectMax ? "B"
    : "C";
  return { band, issue: null, metrics };
}

export function gradeCherry(img: ImageBitmap): CherryGrade {
  const w = CONFIG.quality.analysisWidth, h = Math.max(1, Math.round((img.height * w) / img.width));
  return gradeCherryPixels(draw(img, 0, 0, img.width, img.height, w, h).data);
}
