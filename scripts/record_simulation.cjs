// Records the simulation page (/simulation on the cooperative server) as a video, using Microsoft Edge headless.
//
// Setup (once):  npm install --no-save --prefix scripts playwright-core
//                npx --prefix scripts playwright-core install ffmpeg
// Usage:         node scripts/record_simulation.cjs [url] [width] [height]
//   url defaults to http://localhost:8000/simulation; the video (.webm) is written to recordings/.
// The simulation clears the demo data on that server before it starts.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const url = process.argv[2] || "http://localhost:8000/simulation";
const width = Number(process.argv[3]) || 1920;
const height = Number(process.argv[4]) || 1080;
const out = path.join(__dirname, "..", "recordings");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: out, size: { width, height } } });
  const page = await ctx.newPage();
  await page.goto(url);
  // the phone pane is ready once the app and the leaf model have loaded
  await page.waitForFunction(() => document.getElementById("veil").classList.contains("hide"), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.click("#play");
  const started = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      done: document.body.dataset.done === "1",
      failed: document.querySelector("#steps li.fail") ? document.getElementById("now-d").textContent : "",
    }));
    if (s.failed) throw new Error(s.failed);
    if (s.done) break;
    if (Date.now() - started > 600000) throw new Error("the simulation did not finish in 10 minutes");
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(5000);
  const video = page.video();
  await ctx.close();
  const file = path.join(out, "jirani-simulation.webm");
  fs.rmSync(file, { force: true });
  fs.renameSync(await video.path(), file);
  await browser.close();
  console.log(`recorded ${Math.round((Date.now() - started) / 1000)} s -> ${file}`);
})().catch((e) => { console.error(String(e)); process.exit(1); });
