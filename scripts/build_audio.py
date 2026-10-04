"""Build the Kiswahili audio pack: one short clip per phrase key, generated at BUILD time.

TTS model: facebook/mms-tts-swh (Meta MMS, VITS) via Hugging Face transformers.
License: CC-BY-NC-4.0 (non-commercial). Fine for a hackathon prototype; must be replaced (or the clips
re-recorded by a native speaker) before any real deployment. All clips are MACHINE-GENERATED and need
native speaker review.

Text comes only from app/public/content/answers.json and i18n/sw.json (the closed answer list). The cherry-band
ticket clips also read the buyer tickets in app/public/content/plots.json and say the amounts as words; the
manifest records which amounts each clip says ("spoken"), and the app plays a ticket clip only when they match.
Output: app/public/audio/sw/<key>.mp3 (16 kHz mono, 24 kbps) + manifest.json. No speech at runtime.

To replace a clip with a human recording, drop a file with the same name into app/public/audio/sw/.

Usage: python scripts/build_audio.py            # rebuild every clip
       python scripts/build_audio.py --missing  # only clips whose file does not exist yet (keeps recordings)
"""
import json
import os
import re
import sys

import lameenc
import numpy as np
import torch
from transformers import AutoTokenizer, VitsModel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "app", "public", "content")
OUT = os.path.join(ROOT, "app", "public", "audio", "sw")
MODEL = "facebook/mms-tts-swh"
KBPS = 24
TICKET_COUNT = 3  # same as CONFIG.harvest.ticketCount in app/src/config.ts

SW_UNITS = ["", "moja", "mbili", "tatu", "nne", "tano", "sita", "saba", "nane", "tisa"]
SW_TENS = ["", "kumi", "ishirini", "thelathini", "arobaini", "hamsini", "sitini", "sabini", "themanini", "tisini"]


def sw_number(n):
    """1..999 in Kiswahili words, e.g. 355 -> 'mia tatu hamsini na tano', 310 -> 'mia tatu na kumi'."""
    if not 0 < n < 1000 or n != int(n):
        raise ValueError(f"cannot say {n}")
    n = int(n)
    parts = [f"mia {SW_UNITS[n // 100]}"] if n >= 100 else []
    if (n // 10) % 10:
        parts.append(SW_TENS[(n // 10) % 10])
    if n % 10:
        parts.append(SW_UNITS[n % 10])
    return " ".join(parts[:-1] + (["na"] if len(parts) > 1 else []) + parts[-1:])


def ticket_ranges():
    """Range of the last TICKET_COUNT buyer tickets per band (the same rule as app/src/logic/harvest.ts)."""
    reg = json.load(open(os.path.join(CONTENT, "plots.json"), encoding="utf8")).get("buyer_tickets") or {}
    out = {}
    for band in "ABC":
        last = sorted((t for t in reg.get("tickets", []) if t["band"] == band), key=lambda t: t["date"])[-TICKET_COUNT:]
        if last:
            out[band] = {"low": min(t["price"] for t in last), "high": max(t["price"] for t in last), "unit": reg["unit"]}
    return out


def phrases():
    A = json.load(open(os.path.join(CONTENT, "answers.json"), encoding="utf8"))
    S = json.load(open(os.path.join(CONTENT, "i18n", "sw.json"), encoding="utf8"))
    p = {}
    for k, v in A["stress"].items():
        p[f"stress.{k}"] = v["sw"]
    for k, v in A["severity"].items():
        p[f"severity.{k}"] = "Ukubwa: " + v["sw"] + "."  # "how bad: ..." (a bare "juu" is too short to hear)
    for k, v in A["audio"]["trend"].items():
        p[f"trend.{k}"] = v["sw"]
    for k, v in A["action"].items():
        p[f"action.{k}"] = v["sw"]
    for k, v in A["do_not"].items():
        p[f"do_not.{k}"] = v["sw"]
    p["next_step.ask_person"] = A["next_step"]["ask_person"]["sw"]
    p["next_step.sync"] = A["next_step"]["sync"]["sw"]
    p["card.footer"] = A["card"]["footer"]["sw"]
    p["prompt.block"] = S["q_block"]
    p["prompt.changed"] = S["q_changed"] + " " + ", ".join(
        S[k] for k in ["changed_leaves_falling", "changed_spots_spreading", "changed_fewer_cherries", "changed_nothing_new"])
    p["prompt.sprayed"] = S["q_sprayed"] + " " + ", ".join(S[k] for k in ["yes", "no", "dont_know"])
    for band, v in A["audio"]["harvest"]["band"].items():  # the band, then "prototype grade, confirm at the factory"
        p[f"harvest.band.{band}"] = v["sw"] + " " + A["harvest"]["prototype"]["sw"]
    for band, r in ticket_ranges().items():
        p[f"harvest.tickets.{band}"] = A["audio"]["harvest"]["tickets"]["sw"].format(
            low=sw_number(r["low"]), high=sw_number(r["high"]))
    return p


def normalise(text):
    t = text.lower()
    t = re.sub(r"\([^)]*\)", " ", t)          # drop "(Phoma)" style asides
    t = t.replace("…", " ").replace("✓", " ")
    t = re.sub(r"[^a-z' ,.?]", " ", t)        # MMS vocab: plain Latin letters + light punctuation
    return re.sub(r"\s+", " ", t).strip()


def mp3(wave, rate):
    enc = lameenc.Encoder()
    enc.set_bit_rate(KBPS)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(wave, -1, 1) * 32767).astype(np.int16).tobytes()
    return enc.encode(pcm) + enc.flush()


def main():
    only_missing = "--missing" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(MODEL)
    model = VitsModel.from_pretrained(MODEL).eval()
    rate = model.config.sampling_rate
    torch.manual_seed(150)
    clips, total, secs = {}, 0, 0.0
    for key, text in phrases().items():
        fname = key.replace(".", "_") + ".mp3"
        if only_missing and os.path.exists(os.path.join(OUT, fname)):
            clips[key] = fname
            total += os.path.getsize(os.path.join(OUT, fname))
            continue
        norm = normalise(text)
        with torch.no_grad():
            wav = model(**tok(norm, return_tensors="pt")).waveform[0].numpy()
        wav = wav / max(1e-6, np.abs(wav).max()) * 0.9
        pad = np.zeros(int(0.15 * rate), dtype=wav.dtype)
        wav = np.concatenate([pad, wav, pad])
        data = mp3(wav, rate)
        open(os.path.join(OUT, fname), "wb").write(data)
        clips[key] = fname
        total += len(data)
        secs += len(wav) / rate
        print(f"{key:28s} {len(wav) / rate:5.1f}s {len(data) / 1024:6.1f} KB  | {norm}")
    json.dump({"review_status": "MACHINE-GENERATED (Meta MMS TTS), needs native speaker review",
               "model": MODEL, "model_license": "CC-BY-NC-4.0 (non-commercial; replace before deployment)",
               "format": f"mp3 mono {rate} Hz {KBPS} kbps", "clips": clips,
               "spoken": {f"harvest.tickets.{band}": r for band, r in ticket_ranges().items()}},
              open(os.path.join(OUT, "manifest.json"), "w", encoding="utf8"), indent=1, ensure_ascii=False)
    print(f"\n{len(clips)} clips, {secs:.0f} s new audio, {total / 1024:.0f} KB total")


if __name__ == "__main__":
    main()
