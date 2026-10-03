// On-device inference with onnxruntime-web (WASM). The .wasm is self-hosted under /ort/ and precached.
import * as ort from "onnxruntime-web/wasm";
import { STRESS_CLASSES, type StressClass } from "../config";
import type { LeafResult } from "../logic/types";

export interface ModelMeta {
  version: string;
  model_file: string;
  variant: string;
  input_size: number;
  mean: number[];
  std: number[];
  stress_classes: string[];
  temperature: number;
  tau: number;
  stress_head_weights: string;
  features_shape: number[];
  file_size_bytes: number;
}

export interface StressHead { classes: string[]; shape: [number, number]; weight: number[][]; bias: number[] }

const BASE = import.meta.env.BASE_URL;
let session: ort.InferenceSession | null = null;
let meta: ModelMeta | null = null;
let head: StressHead | null = null;

export async function loadModel(): Promise<{ meta: ModelMeta; head: StressHead }> {
  if (session && meta && head) return { meta, head };
  // Self-hosted runtime, never a CDN. Production build loads .mjs + .wasm from /ort/; the dev bundle inlines
  // the .mjs (the Vite dev server will not import .mjs from public/) and only fetches the .wasm.
  ort.env.wasm.wasmPaths = import.meta.env.DEV ? { wasm: `${BASE}ort/ort-wasm-simd-threaded.wasm` } : `${BASE}ort/`;
  ort.env.wasm.numThreads = 1; // static hosting has no cross-origin isolation; single thread always works
  meta = await (await fetch(`${BASE}model/model_meta.json`)).json();
  head = await (await fetch(`${BASE}model/${meta!.stress_head_weights}`)).json();
  if (meta!.stress_classes.join() !== STRESS_CLASSES.join()) throw new Error("model classes do not match app");
  const buf = await (await fetch(`${BASE}model/${meta!.model_file}`)).arrayBuffer();
  session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return { meta: meta!, head: head! };
}

/** NCHW float32 tensor from a leaf canvas: squash-resize to 224x224, /255, ImageNet normalise. */
export function toTensor(leaf: HTMLCanvasElement, m: ModelMeta): Float32Array {
  const S = m.input_size;
  // two-step downscale avoids aliasing in browsers whose high-quality smoothing is still bilinear
  const mid = document.createElement("canvas");
  mid.width = S * 2;
  mid.height = S * 2;
  const mctx = mid.getContext("2d")!;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(leaf, 0, 0, S * 2, S * 2);
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mid, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const out = new Float32Array(3 * S * S);
  for (let i = 0, p = 0; p < S * S; i += 4, p++) {
    for (let ch = 0; ch < 3; ch++) out[ch * S * S + p] = (d[i + ch] / 255 - m.mean[ch]) / m.std[ch];
  }
  return out;
}

export function softmax(z: number[]): number[] {
  const mx = Math.max(...z);
  const e = z.map((v) => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export async function runLeaf(leaf: HTMLCanvasElement): Promise<LeafResult> {
  if (!session || !meta) throw new Error("model not loaded");
  const S = meta.input_size;
  const t0 = performance.now();
  const input = new ort.Tensor("float32", toTensor(leaf, meta), [1, 3, S, S]);
  const out = await session.run({ input });
  const ms = performance.now() - t0;
  const logits = Array.from(out.stress_logits.data as Float32Array);
  const sev = Array.from(out.severity_logits.data as Float32Array);
  const probs = softmax(logits.map((v) => v / meta!.temperature));
  let k = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[k]) k = i;
  let s = 0;
  for (let i = 1; i < sev.length; i++) if (sev[i] > sev[s]) s = i;
  return {
    probs,
    stress: STRESS_CLASSES[k] as StressClass,
    pMax: probs[k],
    severity: s,
    ms,
    features: new Float32Array(out.features.data as Float32Array),
  };
}
