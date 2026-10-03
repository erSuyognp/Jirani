import { readFileSync } from "node:fs";
import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// BASE lets the same build run at / (local) or /<repo>/ (GitHub Pages).
const base = process.env.BASE ?? "/";

export default defineConfig(({ command }) => ({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) }, // shown in Settings > About
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Jirani",
        short_name: "Jirani",
        description: "Offline coffee leaf check: diagnose, track, warn.",
        theme_color: "#002244",
        background_color: "#ffffff",
        display: "standalone",
        start_url: base,
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // Precache everything the app needs offline: shell, model, ort wasm, content, audio, context.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,json,onnx,wasm,mp3,ogg,opus,webm}"],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: "index.html",
        // Activate a new version as soon as it is installed. Waiting for the page to send SKIP_WAITING
        // fails if the phone goes offline between download and the next load (seen in testing).
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  // Use the onnxruntime-web build that loads its .mjs/.wasm from public/ort (self-hosted, precached once).
  // (dev keeps the default bundle: the Vite dev server will not import .mjs files from public/)
  resolve: command === "build" ? { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] } : {},
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
}));
