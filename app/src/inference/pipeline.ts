// One photo: decode -> quality gate -> leaf crop -> inference -> CAM overlay.
import { decodePhoto, leafCanvas } from "../capture/image";
import { checkQuality, type QualityResult } from "../capture/quality";
import type { LeafResult } from "../logic/types";
import { computeCam, drawOverlay } from "./cam";
import { runLeaf, type StressHead } from "./model";

export interface Photo {
  file: Blob;
  thumbUrl: string;
  quality: QualityResult;
  leaf: HTMLCanvasElement | null;
  result: LeafResult | null;
}

export async function processPhoto(file: Blob): Promise<Photo> {
  const bmp = await decodePhoto(file);
  const quality = checkQuality(bmp);
  const thumbUrl = URL.createObjectURL(file);
  if (!quality.ok) {
    bmp.close();
    return { file, thumbUrl, quality, leaf: null, result: null };
  }
  const leaf = leafCanvas(bmp, quality.box);
  bmp.close();
  const result = await runLeaf(leaf);
  return { file, thumbUrl, quality, leaf, result };
}

export function heatmapFor(p: Photo, head: StressHead, cls: number, shape: number[]): string | null {
  if (!p.leaf || !p.result?.features) return null;
  const [C, H, W] = shape;
  const cam = computeCam(p.result.features, head, cls, C, H, W);
  return drawOverlay(p.leaf, cam, H, W).toDataURL("image/jpeg", 0.8);
}
