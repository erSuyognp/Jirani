// Kiswahili audio: the card is spoken by concatenating pre-recorded clips. No speech is generated at runtime.
// Clips are machine-generated at build time (scripts/build_audio.py) and need native speaker review.
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { Card } from "../logic/card";

const BASE = import.meta.env.BASE_URL;
let manifest: Record<string, string> | null = null;

async function loadManifest(): Promise<Record<string, string>> {
  if (manifest) return manifest;
  try {
    manifest = (await (await fetch(`${BASE}audio/sw/manifest.json`)).json()).clips ?? {};
  } catch {
    manifest = {};
  }
  return manifest!;
}

/** Clip keys for a card, in order: stress, severity, trend, action, do-not. */
export function cardClipKeys(card: Card): string[] {
  const keys = [`stress.${card.stressKey}`];
  if (card.confident) {
    keys.push(`severity.${card.severityKey}`, `trend.${card.trendKey ?? "first"}`);
  } else {
    keys.push("next_step.ask_person");
  }
  keys.push(`action.${card.actionKey}`, `do_not.${card.stressKey}`);
  return keys;
}

let current: HTMLAudioElement | null = null;

export async function playKeys(keys: string[]): Promise<void> {
  const m = await loadManifest();
  current?.pause();
  for (const k of keys) {
    const f = m[k];
    if (!f) continue;
    await new Promise<void>((resolve) => {
      const a = new Audio(`${BASE}audio/sw/${f}`);
      current = a;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }
}

export function stopAudio() {
  current?.pause();
}

/** One file for Bluetooth transfer to the basic phone: clips concatenated into a single WAV. */
export async function cardAudioFile(keys: string[]): Promise<File | null> {
  const m = await loadManifest();
  const files = keys.map((k) => m[k]).filter(Boolean);
  if (!files.length) return null;
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const bufs: AudioBuffer[] = [];
  for (const f of files) {
    const data = await (await fetch(`${BASE}audio/sw/${f}`)).arrayBuffer();
    bufs.push(await ctx.decodeAudioData(data));
  }
  const rate = bufs[0].sampleRate;
  const gap = Math.round(rate * 0.25);
  const total = bufs.reduce((n, b) => n + b.length + gap, 0);
  const pcm = new Float32Array(total);
  let off = 0;
  for (const b of bufs) {
    pcm.set(b.getChannelData(0), off);
    off += b.length + gap;
  }
  return new File([wav(pcm, rate)], "jirani-matokeo.wav", { type: "audio/wav" });
}

function wav(pcm: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const s = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return buf;
}

/** Share via Web Share (Bluetooth etc.) where supported; otherwise download. */
export async function shareOrDownload(file: File): Promise<"shared" | "downloaded"> {
  // Android app: the WebView has no Web Share or downloads, so write the file to the cache and use the native share sheet.
  if (Capacitor.isNativePlatform()) {
    await shareNative(file);
    return "shared";
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: "Jirani" });
    return "shared";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

async function shareNative(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { uri } = await Filesystem.writeFile({ path: file.name, data: btoa(bin), directory: Directory.Cache });
  await Share.share({ title: "Jirani", files: [uri] });
}
