// Copy the onnxruntime-web WASM runtime into public/ort so it is self-hosted and precached.
// Never load these from a CDN: that breaks offline use.
import { copyFileSync, mkdirSync } from "node:fs";
const src = "node_modules/onnxruntime-web/dist/";
const dst = "public/ort/";
mkdirSync(dst, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) copyFileSync(src + f, dst + f);
console.log("copied onnxruntime-web wasm to public/ort");
