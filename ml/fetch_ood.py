"""Out-of-distribution set for the refusal check (not used for training).

1. PlantDoc test split (github.com/pratikkayal/PlantDoc-Dataset, CC BY 4.0): up to 3 images per class,
   27 non-coffee leaf classes (apple, tomato, corn, grape...), including rusts and leaf spots on other crops.
2. SYNTHETIC non-leaf images generated here: blank paper, dark frame, noise, skin-tone and soil-tone
   fields, a printed-text-like pattern. Labelled synthetic in the report.

Usage: python ml/fetch_ood.py
"""
import json
import os
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "ood")
API = "https://api.github.com/repos/pratikkayal/PlantDoc-Dataset/git/trees/master?recursive=1"
RAW = "https://raw.githubusercontent.com/pratikkayal/PlantDoc-Dataset/master/"
PER_CLASS = 3


def plantdoc():
    os.makedirs(os.path.join(OUT, "plantdoc"), exist_ok=True)
    tree = json.load(urllib.request.urlopen(API))["tree"]
    by_class = {}
    for x in tree:
        p = x["path"]
        if x["type"] == "blob" and p.startswith("test/") and p.lower().endswith((".jpg", ".jpeg", ".png")):
            by_class.setdefault(p.split("/")[1], []).append(p)
    got = []
    for cls, paths in sorted(by_class.items()):
        for k, p in enumerate(sorted(paths)[:PER_CLASS]):
            dst = os.path.join(OUT, "plantdoc", f"{cls.replace(' ', '_')}_{k}.jpg")
            if not os.path.exists(dst):
                try:
                    data = urllib.request.urlopen(RAW + urllib.parse.quote(p)).read()
                    open(dst, "wb").write(data)
                    Image.open(dst).convert("RGB").save(dst, "JPEG", quality=92)
                except Exception as e:
                    print("skip", p, e)
                    if os.path.exists(dst):
                        os.remove(dst)
                    continue
            got.append({"file": os.path.basename(dst), "class": cls, "source": p})
    return got


def synthetic():
    d = os.path.join(OUT, "synthetic")
    os.makedirs(d, exist_ok=True)
    rng = np.random.default_rng(150)
    W, H = 512, 256
    imgs = {
        "blank_paper": np.full((H, W, 3), 235, np.uint8) + rng.integers(-6, 6, (H, W, 3)).astype(np.uint8),
        "dark_frame": rng.integers(0, 25, (H, W, 3)).astype(np.uint8),
        "noise": rng.integers(0, 255, (H, W, 3)).astype(np.uint8),
        "skin_tone": np.clip(np.array([190, 140, 110]) + rng.normal(0, 12, (H, W, 3)), 0, 255).astype(np.uint8),
        "soil": np.clip(np.array([95, 70, 45]) + rng.normal(0, 25, (H, W, 3)), 0, 255).astype(np.uint8),
    }
    for name, a in imgs.items():
        Image.fromarray(a).save(os.path.join(d, f"{name}.jpg"), quality=90)
    im = Image.new("RGB", (W, H), (240, 240, 235))
    dr = ImageDraw.Draw(im)
    for y in range(20, H - 10, 18):
        x = 20
        while x < W - 40:
            w = int(rng.integers(15, 60))
            dr.rectangle([x, y, x + w, y + 8], fill=(40, 40, 40))
            x += w + 10
    im.save(os.path.join(d, "text_page.jpg"), quality=90)
    # a green non-leaf object: solid green rounded card
    im = Image.new("RGB", (W, H), (235, 235, 235))
    ImageDraw.Draw(im).rounded_rectangle([60, 50, 450, 210], 30, fill=(40, 140, 60))
    im.save(os.path.join(d, "green_card.jpg"), quality=90)
    return sorted(os.listdir(d))


def main():
    pd = plantdoc()
    syn = synthetic()
    json.dump({"plantdoc": pd, "synthetic": syn,
               "plantdoc_license": "CC BY 4.0 (github.com/pratikkayal/PlantDoc-Dataset)"},
              open(os.path.join(OUT, "manifest.json"), "w"), indent=2)
    print(f"PlantDoc images: {len(pd)} from {len(set(x['class'] for x in pd))} classes | synthetic: {len(syn)}")


if __name__ == "__main__":
    main()
