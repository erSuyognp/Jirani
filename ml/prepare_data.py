"""Prepare the BRACOL leaf dataset: fill gaps, check images, apply the authors' split.

Facts established by inspecting the data (see DATA.md):
- Mendeley archive (DOI 10.17632/yy2k5y8mxg.1) is truncated as published: its sha256 matches
  Mendeley's own hash, but only ~1402 of 1747 leaf images extract. The symptom dataset is absent.
- The authors' repo (github.com/esgario/lara2018, classification/dataset/leaf) holds all 1747 leaf
  images. We fetch only the missing ones from there.
- predominant_stress codes: 0 healthy, 1 miner, 2 rust, 3 phoma (brown leaf spot), 4 cercospora.
  Code 5 (62 rows) is undocumented and excluded by the authors' own dataset.csv (1685 rows).
- severity codes: 0 healthy (<0.1%), 1 very low (0.1-5%), 2 low (5-10%), 3 high (10-15%), 4 very high (>15%).
- The authors split in code (utils/customdatasets.py): numpy seed 150 shuffle, fold 1, 70/15/15.
  We reproduce that split exactly so results are comparable.

Usage: python ml/prepare_data.py [--fetch-missing]
  --fetch-missing  download the leaf images absent from the truncated Mendeley zip from the authors' repo
"""
import csv
import json
import os
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "bracol")
LEAF = os.path.join(DATA, "coffee-datasets", "coffee-datasets", "leaf")
IMAGES = os.path.join(LEAF, "images")
CSV = os.path.join(LEAF, "dataset.csv")
SPLITS = os.path.join(HERE, "data", "splits")
RAW = "https://raw.githubusercontent.com/esgario/lara2018/master/classification/dataset/leaf/{}.jpg"

STRESS = ["healthy", "miner", "rust", "phoma", "cercospora"]
SEVERITY = ["healthy", "very_low", "low", "high", "very_high"]


def image_ok(path):
    try:
        with Image.open(path) as im:
            im.load()
        return True
    except Exception:
        return False


def check(i, fetch_missing):
    path = os.path.join(IMAGES, f"{i}.jpg")
    if os.path.exists(path) and image_ok(path):
        return i, "local"
    if not fetch_missing:
        return i, "missing"
    urllib.request.urlretrieve(RAW.format(i), path)
    return i, "fetched" if image_ok(path) else "missing"


def authors_split(n, seed=150, fold=1):
    np.random.seed(seed)
    indices = list(range(n))
    p1, p2 = int(np.ceil(0.7 * n)), int(np.ceil(0.85 * n))
    np.random.shuffle(indices)
    aux = (fold - 1) * int(n / 5)
    indices = indices[aux:] + indices[:aux]
    return sorted(indices[:p1]), sorted(indices[p1:p2]), sorted(indices[p2:])


def main():
    if not os.path.exists(CSV):
        sys.exit(f"Missing {CSV}. Download BRACOL from https://data.mendeley.com/datasets/yy2k5y8mxg/1 "
                 "and extract into ml/data/bracol/ (see README).")
    rows = list(csv.DictReader(open(CSV, newline="")))
    rows = [r for r in rows if r["predominant_stress"] != "5"]  # authors' exclusion
    fetch_missing = "--fetch-missing" in sys.argv
    with ThreadPoolExecutor(16) as ex:
        res = dict(ex.map(lambda i: check(i, fetch_missing), [int(r["id"]) for r in rows]))
    print("images:", dict(Counter(res.values())))

    # Split over the full 1685-row list first so it is identical to the authors' split,
    # then drop rows whose image is missing or unreadable locally.
    train, val, test = authors_split(len(rows))
    usable = {i for i, r in enumerate(rows) if res[int(r["id"])] != "missing"}
    train, val, test = [[i for i in s if i in usable] for s in (train, val, test)]
    rows_all = rows
    summary_missing = len(rows) - len(usable)
    os.makedirs(SPLITS, exist_ok=True)
    summary = {"source": "BRACOL leaf dataset, authors' split (seed 150, fold 1)",
               "stress_classes": STRESS, "severity_levels": SEVERITY,
               "rows_labelled": len(rows_all), "rows_missing_image": summary_missing, "splits": {}}
    for name, idx in [("train", train), ("val", val), ("test", test)]:
        items = [{"id": int(rows[i]["id"]), "stress": int(rows[i]["predominant_stress"]),
                  "severity": int(rows[i]["severity"])} for i in idx]
        with open(os.path.join(SPLITS, f"{name}.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["id", "stress", "severity"])
            w.writeheader()
            w.writerows(items)
        sc = Counter(STRESS[x["stress"]] for x in items)
        sv = Counter(SEVERITY[x["severity"]] for x in items)
        summary["splits"][name] = {"n": len(items), "stress": {k: sc[k] for k in STRESS},
                                   "severity": {k: sv[k] for k in SEVERITY}}

    # cross-tab stress x severity over the whole usable set
    rows = [rows[i] for i in sorted(usable)]
    xt = Counter((int(r["predominant_stress"]), int(r["severity"])) for r in rows)
    summary["stress_x_severity"] = {STRESS[s]: {SEVERITY[v]: xt[(s, v)] for v in range(5)} for s in range(5)}
    sizes = Counter()
    for r in rows[:50]:
        with Image.open(os.path.join(IMAGES, f"{r['id']}.jpg")) as im:
            sizes[im.size] += 1
    summary["image_sizes_sample50"] = {f"{w}x{h}": c for (w, h), c in sizes.items()}
    json.dump(summary, open(os.path.join(SPLITS, "summary.json"), "w"), indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
