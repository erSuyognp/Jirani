// Renders the intro animation (video/intro.html) to an MP4, frame by frame, using Microsoft Edge headless.
// The browser encodes the frames itself (WebCodecs, H.264), so no ffmpeg is needed.
//
// Setup (once):  npm install --no-save --prefix scripts playwright-core mp4-muxer
// Usage:         node scripts/render_intro.cjs [--no-captions]
//   Output goes to recordings/:
//     jirani-intro.mp4               1920x1080, 30 fps, no sound
//     jirani-intro-no-captions.mp4   with --no-captions, to add the captions in a video editor instead
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright-core");

const noCaptions = process.argv.includes("--no-captions");
const out = path.join(__dirname, "..", "recordings");
const mp4 = path.join(out, noCaptions ? "jirani-intro-no-captions.mp4" : "jirani-intro.mp4");
const SLICE = 4 * 1024 * 1024; // the file comes back from the page in pieces of this size

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(String(e)));
  await page.goto(pathToFileURL(path.join(__dirname, "..", "video", "intro.html")).href + "?render=1" + (noCaptions ? "&captions=0" : ""));
  await page.addScriptTag({ path: require.resolve("mp4-muxer") });
  const started = Date.now();
  const info = await page.evaluate(async () => {
    const { W, H, FPS, DURATION, render } = window.JIRANI_INTRO;
    const canvas = document.getElementById("stage");
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
    let failed = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
    encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 12_000_000, framerate: FPS });
    const frames = Math.round(DURATION * FPS);
    for (let i = 0; i < frames; i++) {
      render(i / FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % FPS === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (failed) throw failed;
    }
    await encoder.flush();
    muxer.finalize();
    window.__mp4 = new Uint8Array(muxer.target.buffer);
    return { frames, bytes: window.__mp4.length, seconds: DURATION };
  });
  fs.mkdirSync(out, { recursive: true });
  const fd = fs.openSync(mp4, "w");
  for (let at = 0; at < info.bytes; at += SLICE) {
    const b64 = await page.evaluate(([from, to]) => {
      const part = window.__mp4.subarray(from, to);
      let s = "";
      for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
      return btoa(s);
    }, [at, Math.min(info.bytes, at + SLICE)]);
    fs.writeSync(fd, Buffer.from(b64, "base64"));
  }
  fs.closeSync(fd);
  await browser.close();
  console.log(`rendered ${info.frames} frames (${info.seconds} s) in ${Math.round((Date.now() - started) / 1000)} s -> ${mp4} (${(info.bytes / 1e6).toFixed(1)} MB)`);
})().catch((e) => { console.error(String(e)); process.exit(1); });
