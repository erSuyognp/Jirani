// Simulation driver. In simulation mode the page that embeds the app sends step names; each step taps through
// the real UI (a visible "finger" shows where), and feeds bundled sample leaves in place of the camera.
// The diagnosis is not faked: the model runs on those sample photos in this browser.
import { SIM } from "../sim";

const BASE = import.meta.env.BASE_URL;

/** Set by App: the two things a tap cannot do. */
export const simHooks: {
  addPhoto?: (b: Blob) => Promise<void>; addCherry?: (b: Blob) => Promise<void>; reset?: () => Promise<void>;
} = {};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

async function until<T>(get: () => T | null | undefined | false, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for the screen");
    await wait(100);
  }
}

function finger(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const dot = document.createElement("div");
  dot.className = "sim-finger";
  dot.style.left = `${r.left + r.width / 2}px`;
  dot.style.top = `${r.top + r.height / 2}px`;
  document.body.appendChild(dot);
  setTimeout(() => dot.remove(), 900);
}

async function tap(target: string | HTMLElement | undefined) {
  const el = typeof target === "string" ? await until(() => $(target)) : target;
  if (!el) throw new Error("nothing to tap");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  await wait(450);
  finger(el);
  await wait(350);
  el.click();
  await wait(450);
}

async function show(sel: string, ms = 1500) {
  const el = await until(() => $(sel));
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  await wait(ms);
}

async function photo(name: string) {
  await until(() => simHooks.addPhoto);
  await simHooks.addPhoto!(await (await fetch(`${BASE}sim/${name}.jpg`)).blob());
  await wait(900);
}

const nav = (i: number) => tap(all(".bottomnav button")[i]);

async function answer(block: number, changed: number, sprayed: number) {
  await until(() => $(".choice"));
  const blocks = all(".choice").length - 7; // 4 "what changed" + 3 "sprayed" options follow the blocks
  await tap(all(".choice")[block]);
  await tap(all(".choice")[blocks + changed]);
  await tap(all(".choice")[blocks + 4 + sprayed]);
}

const STEPS: Record<string, () => Promise<void>> = {
  async reset() {
    await until(() => simHooks.reset);
    await simHooks.reset!();
    await wait(600);
  },
  // quality gate: a photo with no leaf is refused before the model runs
  async bad_photo() {
    await tap(".btn.cta");
    await photo("not-a-leaf");
    await show(".banner.bad", 2200);
    await tap(all(".actionbar .split .btn")[1]); // retake last
  },
  async capture() {
    if ($(".btn.cta")) await tap(".btn.cta");
    await show(".guide", 1800); // the printed capture card: one leaf per box
    for (const n of ["rust-1", "rust-2", "rust-3"]) await photo(n);
    await wait(700);
  },
  // harvest slot: the optional cherry photo, graded by colour only (a real sample photo of ripe cherry on white)
  async cherry() {
    await show(".cherry-card", 2200);
    await until(() => simHooks.addCherry);
    await simHooks.addCherry!(await (await fetch(`${BASE}sim/cherry.jpg`)).blob());
    await show(".cherry-row", 2200);
  },
  async questions() {
    await tap(".actionbar .btn");
    // phrase-locked Gikuyu: the prompt plays a recorded clip if there is one, then shows the question in Kiswahili
    await tap(".ki-play");
    if ($(".ki-sw")) await show(".ki-sw", 2000);
    await answer(1, 1, 1); // Block B, spots spreading, not sprayed
  },
  async result() {
    await tap(".actionbar .btn");
    await until(() => $(".result-hero"));
    await wait(1800);
    await show(".pictos", 1600);
    await show(".heatmaps", 1800);
    await show(".advice.dont", 2200);
    await show(".causes", 2200);
    await show(".rule-note", 2200);
    await show(".card.harvest", 3200);
  },
  async kiswahili() {
    await tap(all(".lang button")[0]);
    await show(".result-hero", 2000);
    await show(".advice.do", 2200);
    await tap(all(".lang button")[1]);
  },
  async handoff() {
    await show(".handoff", 1200);
    await tap(".handoff summary");
    await wait(1800);
  },
  async ask() {
    await show(".card.ask", 1200);
    await tap(".card.ask input");
    await wait(1200);
    await tap(".actionbar .btn"); // save and finish
    await until(() => $(".bottomnav"));
    await wait(1200);
  },
  async sync() {
    await nav(2);
    await show(".packet", 2000);
    await show(".ask-thumbs.small", 1500);
    await tap(".actionbar .btn");
    await until(() => $(".toast") || $(".banner.bad"));
    await wait(1500);
  },
  async news() {
    await nav(2);
    await tap(".actionbar .btn");
    await until(() => $(".toast") || $(".banner.bad"));
    await wait(1200);
    await nav(0);
    if ($(".card.visit")) await show(".card.visit", 3000);
  },
  async reply() {
    if ($(".notice.from-officer")) await tap(".notice.from-officer");
    else await nav(1);
    await show(".reply", 3000);
  },
  // refusal: three leaves that disagree give "Not sure", which is then not saved
  async refusal() {
    if (!$(".btn.cta")) await nav(0);
    await tap(".btn.cta");
    for (const n of ["mixed-1", "mixed-2", "mixed-3"]) await photo(n);
    await tap(".actionbar .btn");
    await answer(0, 3, 2); // Block A, nothing new, don't know
    await tap(".actionbar .btn");
    await until(() => $(".result-hero"));
    await wait(2200);
    await show(".card.next", 2200);
    await tap(".appbar .icon-btn");
    await tap(".dialog .btn.text"); // don't save
    await wait(600);
  },
};

let started = false;

/** Listen for steps from the embedding page; answer each with done / failed. Safe to call more than once. */
export function startSim() {
  if (!SIM || started || window.parent === window) return;
  started = true;
  window.addEventListener("message", async (e) => {
    const m = e.data as { jirani?: string; step?: string; id?: number } | null;
    if (e.source !== window.parent || m?.jirani !== "sim" || !m.step) return;
    let error: string | undefined;
    try {
      const run = STEPS[m.step];
      if (!run) throw new Error(`unknown step ${m.step}`);
      await run();
    } catch (err) {
      error = String(err);
    }
    window.parent.postMessage({ jirani: "sim-done", id: m.id, step: m.step, ok: !error, error }, "*");
  });
  window.parent.postMessage({ jirani: "sim-ready" }, "*");
}
