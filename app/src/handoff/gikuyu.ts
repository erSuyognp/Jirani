// Gikuyu is phrase-locked: a fixed pack of recorded clips (public/audio/ki), three question prompts and a few
// confirmations. No speech or text is generated for it, at build time or at runtime. A clip that has not been
// recorded yet is skipped, so the check can always be finished with taps.
import { stopAudio } from "./audio";

const BASE = import.meta.env.BASE_URL;

export interface GikuyuPack {
  placeholder: boolean;   // true until every clip is a human recording
  clips: Record<string, { file: string; recorded: boolean }>;
}

let pack: Promise<GikuyuPack> | null = null;

export function gikuyuPack(): Promise<GikuyuPack> {
  pack ??= fetch(`${BASE}audio/ki/manifest.json`)
    .then((r) => r.json())
    .then((m): GikuyuPack => ({ placeholder: m.placeholder !== false, clips: m.clips ?? {} }))
    .catch((): GikuyuPack => ({ placeholder: true, clips: {} }));
  return pack;
}

let current: HTMLAudioElement | null = null;

/** Plays one recorded clip. Resolves to false when there is no recording for the key or it cannot be played. */
export async function playGikuyu(key: string): Promise<boolean> {
  const clip = (await gikuyuPack()).clips[key];
  stopAudio();
  current?.pause();
  if (!clip?.recorded) return false;
  return new Promise<boolean>((resolve) => {
    const a = new Audio(`${BASE}audio/ki/${clip.file}`);
    current = a;
    a.onended = () => resolve(true);
    a.onpause = () => resolve(true);
    a.onerror = () => resolve(false);
    a.play().catch(() => resolve(false));
  });
}
