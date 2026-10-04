"""Build the spoken explanation for the /simulation page (AI-generated voice, fixed hand-written text).

Reads server/narration.json and writes one MP3 per line to server/static/narration/, plus manifest.json.
Uses ElevenLabs text-to-speech. The API key is read from the environment or the repo's .env file
(ELEVENLABS_API_KEY) and is needed only here, at build time: the server and the page just play the MP3 files.
A clip is regenerated only when its text, voice or model changed, so re-running costs nothing.

Usage: python scripts/build_narration.py [--force]
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "server", "narration.json")
OUT = os.path.join(ROOT, "server", "static", "narration")
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"


def api_key():
    key = os.environ.get("ELEVENLABS_API_KEY")
    env = os.path.join(ROOT, ".env")
    if not key and os.path.exists(env):
        for line in open(env, encoding="utf8"):
            if line.startswith("ELEVENLABS_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set (environment or .env)")
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="regenerate every clip")
    force = ap.parse_args().force
    cfg = json.load(open(SRC, encoding="utf8"))
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    previous = json.load(open(manifest_path, encoding="utf8")) if os.path.exists(manifest_path) else {}
    old = previous.get("clips", {})
    key, clips, made, chars = None, {}, 0, 0
    for line in cfg["lines"]:
        digest = hashlib.sha256(f"{cfg['voice_id']}|{cfg['model_id']}|{line['text']}".encode("utf8")).hexdigest()[:16]
        name = f"{line['id']}.mp3"
        path = os.path.join(OUT, name)
        if force or old.get(line["id"], {}).get("hash") != digest or not os.path.exists(path):
            key = key or api_key()
            r = requests.post(API.format(voice=cfg["voice_id"]), timeout=120,
                              headers={"xi-api-key": key, "Content-Type": "application/json"},
                              json={"text": line["text"], "model_id": cfg["model_id"],
                                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.8}})
            if r.status_code != 200:
                sys.exit(f"ElevenLabs error {r.status_code} for line {line['id']}: {r.text[:200]}")
            open(path, "wb").write(r.content)
            made += 1
            chars += len(line["text"])
            print(f"generated {name} ({len(r.content) // 1024} KB)")
        # 128 kbit/s MP3: 16,000 bytes per second
        clips[line["id"]] = {"file": name, "hash": digest, "seconds": round(os.path.getsize(path) / 16000, 1), "text": line["text"]}
    json.dump({"voice": "AI-generated (ElevenLabs text-to-speech)", "voice_id": cfg["voice_id"], "model_id": cfg["model_id"],
               "built": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z") if made else previous.get("built"),
               "clips": clips}, open(manifest_path, "w", encoding="utf8"), indent=1, ensure_ascii=False)
    print(f"{made} clip(s) generated ({chars} characters), {len(clips) - made} unchanged -> {OUT}")


if __name__ == "__main__":
    main()
