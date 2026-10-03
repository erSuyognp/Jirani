"""Tune the app's photo quality gate on BRACOL images.

Python mirror of app/src/capture/quality.ts. Computes the four metrics on:
- clean: uncropped Mendeley originals (what a phone photo on white paper looks like), all intact ones
- bad (synthetic): the same photos blurred, darkened, over-exposed, and leafless frames
Then proposes thresholds so that >= 98% of clean photos pass, and reports how many bad ones are caught.
Copy the chosen numbers into CONFIG.quality in app/src/config.ts.

Usage: python ml/tune_quality.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

from common import ANALYSIS_W, HERE, REPORT, leaf_mask

MENDELEY = os.path.join(HERE, "data", "bracol", "coffee-datasets", "coffee-datasets", "leaf", "images")
OOD_SYN = os.path.join(HERE, "data", "ood", "synthetic")
CENTRE = 0.6


def luma(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def metrics(img):
    w, h = img.size
    sw, sh = ANALYSIS_W, max(1, round(h * ANALYSIS_W / w))
    small = np.asarray(img.resize((sw, sh), Image.BILINEAR)).astype(np.float32)
    y = luma(small)
    clipped = float(((y <= 5) | (y >= 250)).mean())
    m = leaf_mask(small.astype(np.uint8))
    x0, x1 = int(sw * (1 - CENTRE) / 2), int(np.ceil(sw * (1 + CENTRE) / 2))
    y0, y1 = int(sh * (1 - CENTRE) / 2), int(np.ceil(sh * (1 + CENTRE) / 2))
    centre = float(m[y0:y1, x0:x1].mean())
    ys, xs = np.nonzero(m)
    lap = 0.0
    has_leaf = len(xs) >= 0.01 * sw * sh
    if has_leaf:
        bx0, bx1 = np.percentile(xs, [1, 99])
        by0, by1 = np.percentile(ys, [1, 99])
        fx, fy = w / sw, h / sh
        crop = img.crop((int(bx0 * fx), int(by0 * fy), int((bx1 + 1) * fx), int((by1 + 1) * fy)))
        lw = ANALYSIS_W
        lh = max(3, round(crop.size[1] * lw / crop.size[0]))
        g = luma(np.asarray(crop.resize((lw, lh), Image.BILINEAR)).astype(np.float32))
        L = g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4 * g[1:-1, 1:-1]
        lap = float(L.var())
    return {"luma": float(y.mean()), "clipped": clipped, "centre": centre, "lap": lap, "has_leaf": has_leaf}


def main():
    rng = np.random.default_rng(150)
    files = sorted(os.listdir(MENDELEY))
    clean = []
    for f in files:
        im = Image.open(os.path.join(MENDELEY, f)).convert("RGB")
        im.draft("RGB", (1024, 512))
        clean.append(im.resize((1024, 512), Image.BILINEAR))
    sample = [clean[i] for i in rng.choice(len(clean), 200, replace=False)]
    C = [metrics(im) for im in clean]
    bad = {
        "blur_s3": [metrics(im.filter(ImageFilter.GaussianBlur(3))) for im in sample],
        "blur_s6": [metrics(im.filter(ImageFilter.GaussianBlur(6))) for im in sample],
        "dark": [metrics(ImageEnhance.Brightness(im).enhance(0.25)) for im in sample],
        "bright": [metrics(ImageEnhance.Brightness(im).enhance(2.2)) for im in sample],
        "no_leaf": [metrics(Image.open(os.path.join(OOD_SYN, f)).convert("RGB")) for f in sorted(os.listdir(OOD_SYN))],
    }

    arr = {k: np.array([c[k] for c in C]) for k in ("luma", "clipped", "centre", "lap")}
    th = {
        "lumaMin": float(np.floor(min(60, np.percentile(arr["luma"], 0.5) - 10))),
        "lumaMax": float(np.ceil(max(235, np.percentile(arr["luma"], 99.5) + 5))),
        "clippedMaxFraction": float(np.round(max(0.5, np.percentile(arr["clipped"], 99.5) + 0.05), 2)),
        "leafMinFraction": float(np.round(min(0.08, np.percentile(arr["centre"], 1) * 0.5), 3)),
        "blurMinLaplacianVar": float(min(60.0, np.round(np.percentile(arr["lap"], 1.5), 1))),
    }

    def gate(m):
        if m["luma"] < th["lumaMin"]:
            return "dark"
        if m["luma"] > th["lumaMax"] or m["clipped"] > th["clippedMaxFraction"]:
            return "bright"
        if not m["has_leaf"] or m["centre"] < th["leafMinFraction"]:
            return "no_leaf"
        if m["lap"] < th["blurMinLaplacianVar"]:
            return "blurry"
        return None

    res = {"thresholds": th, "clean_n": len(C), "clean_pass_rate": float(np.mean([gate(m) is None for m in C])),
           "clean_metric_percentiles": {k: {p: float(np.percentile(v, p)) for p in (1, 5, 50, 95, 99)} for k, v in arr.items()},
           "bad": {}}
    for k, ms in bad.items():
        g = [gate(m) for m in ms]
        res["bad"][k] = {"n": len(ms), "rejected": float(np.mean([x is not None for x in g])),
                         "reasons": {r: g.count(r) for r in set(g)}}
    os.makedirs(REPORT, exist_ok=True)
    json.dump(res, open(os.path.join(REPORT, "quality_gate.json"), "w"), indent=2)
    print(json.dumps({k: res[k] for k in ("thresholds", "clean_n", "clean_pass_rate", "bad")}, indent=1, default=str))
    print("lap percentiles clean:", res["clean_metric_percentiles"]["lap"])
    print("lap blur_s3 median:", np.median([m["lap"] for m in bad["blur_s3"]]))


if __name__ == "__main__":
    main()
