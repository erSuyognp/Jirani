// Records the simulation page (/simulation on the cooperative server) as a video, using Microsoft Edge headless.
//
// Setup (once):  npm install --no-save --prefix scripts playwright-core
//                npx --prefix scripts playwright-core install ffmpeg
// Usage:         node scripts/record_simulation.cjs [url] [width] [height]
//   url defaults to http://localhost:8000/simulation. Output goes to recordings/:
//     jirani-simulation.webm   the picture (browser recordings carry no sound)
//     jirani-simulation.mp4    picture + the spoken explanation, if a full ffmpeg is available
//                              (on PATH, or set FFMPEG=<path to ffmpeg>)
// The simulation clears the demo data on that server before it starts.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const url = process.argv[2] || "http://localhost:8000/simulation";
const width = Number(process.argv[3]) || 1920;
const height = Number(process.argv[4]) || 1080;
const out = path.join(__dirname, "..", "recordings");
const clipDir = path.join(__dirname, "..", "server", "static", "narration");

/** Lay each narration clip at the moment it started on the page, and mux the result with the picture. */
function addNarration(webm, clips, mp4) {
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const args = ["-y", "-loglevel", "error", "-i", webm];
  for (const c of clips) args.push("-i", path.join(clipDir, c.file));
  const delayed = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.max(0, Math.round(c.at * 1000))}:all=1[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0[a]`;
  args.push("-filter_complex", [...delayed, mix].join(";"), "-map", "0:v", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", mp4);
  const r = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    console.log(`no MP4 with sound: ${r.error ? `ffmpeg not found (${ffmpeg})` : r.stderr.trim().slice(0, 300)}`);
    return false;
  }
  return true;
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: out, size: { width, height } } });
  const page = await ctx.newPage();
  const videoStart = Date.now(); // the recording starts with the page
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
    if (Date.now() - started > 900000) throw new Error("the simulation did not finish in 15 minutes");
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(4000);
  const clips = (await page.evaluate(() => window.__narration || [])).map((c) => ({ ...c, at: (c.at - videoStart) / 1000 }));
  const video = page.video();
  await ctx.close();
  const webm = path.join(out, "jirani-simulation.webm");
  fs.rmSync(webm, { force: true });
  fs.renameSync(await video.path(), webm);
  await browser.close();
  console.log(`recorded ${Math.round((Date.now() - started) / 1000)} s -> ${webm}`);
  if (clips.length) {
    fs.writeFileSync(path.join(out, "narration-times.json"), JSON.stringify(clips, null, 1));
    const mp4 = path.join(out, "jirani-simulation.mp4");
    if (addNarration(webm, clips, mp4)) console.log(`with narration (${clips.length} clips) -> ${mp4}`);
  } else {
    console.log("no narration was played (server/static/narration missing, or switched off)");
  }
})().catch((e) => { console.error(String(e)); process.exit(1); });
