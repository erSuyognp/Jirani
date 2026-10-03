// F2 "where it looked": class activation map. Exact because the stress head is linear on pooled features:
// CAM_c = sum_k W[c,k] * features[k,:,:], ReLU, normalise to 0-1, upsample, overlay.
import type { StressHead } from "./model";

export function computeCam(features: Float32Array, head: StressHead, cls: number, C: number, H: number, W: number): Float32Array {
  const w = head.weight[cls];
  const cam = new Float32Array(H * W);
  for (let k = 0; k < C; k++) {
    const wk = w[k];
    if (wk === 0) continue;
    const off = k * H * W;
    for (let p = 0; p < H * W; p++) cam[p] += wk * features[off + p];
  }
  let mx = 0;
  for (let p = 0; p < cam.length; p++) {
    cam[p] = Math.max(0, cam[p]);
    if (cam[p] > mx) mx = cam[p];
  }
  if (mx > 0) for (let p = 0; p < cam.length; p++) cam[p] /= mx;
  return cam;
}

/** Mean CAM across leaves is not meaningful (different photos), so we draw it per leaf. */
export function drawOverlay(leaf: HTMLCanvasElement, cam: Float32Array, H: number, W: number, maxW = 480): HTMLCanvasElement {
  const scale = Math.min(1, maxW / leaf.width);
  const w = Math.round(leaf.width * scale), h = Math.round(leaf.height * scale);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(leaf, 0, 0, w, h);
  // 7x7 heat image, upsampled bilinearly by the browser (the model saw the leaf squashed to a square,
  // so stretching the square map back over the leaf maps each cell to the region it came from)
  const small = document.createElement("canvas");
  small.width = W;
  small.height = H;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(W, H);
  for (let p = 0; p < H * W; p++) {
    const v = cam[p];
    // transparent -> yellow -> red
    img.data[p * 4] = 255;
    img.data[p * 4 + 1] = Math.round(220 * (1 - v));
    img.data[p * 4 + 2] = 0;
    img.data[p * 4 + 3] = Math.round(200 * Math.max(0, v - 0.15) / 0.85);
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = 0.75;
  ctx.drawImage(small, 0, 0, w, h);
  ctx.globalAlpha = 1;
  return out;
}
