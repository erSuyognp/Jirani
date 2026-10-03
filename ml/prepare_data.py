"""Prepare the BRACOL leaf dataset: fetch the authors' leaf crops, check them, make the split.

Facts established by inspecting the data (see DATA.md):
- Mendeley archive (DOI 10.17632/yy2k5y8mxg.1) is truncated as published: its sha256 matches
  Mendeley's own hash, but only 1402 of 1747 leaf images extract (the last one cut off).
  The originals are 2048x1024 photos with a lot of white background. Kept untouched under
  ml/data/bracol/coffee-datasets/ and used only as the source of the perturbed set.
- The authors' repo (github.com/esgario/lara2018, classification/dataset/leaf) holds all 1747 leaf
  images, preprocessed: cropped to the leaf and resized to 512x256. Same leaves, same ids (checked
  visually). Its dataset-full.csv is byte-identical to the Mendeley dataset.csv. We train on these
  crops for every image so the whole set shares one format.
- predominant_stress codes: 0 healthy, 1 miner, 2 rust, 3 phoma (brown leaf spot), 4 cercospora.
  Code 5 (62 rows) is undocumented and excluded, as in the authors' own dataset.csv (1685 rows).
- severity codes: 0 healthy (<0.1%), 1 very low (0.1-5%), 2 low (5-10%), 3 high (10-15%), 4 very high (>15%).
- Split: stratified by stress class, 70/15/15, seed 150 (the authors' seed).

Usage: python ml/prepare_data.py
"""
import csv
import json
import os
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from PIL import Image
from sklearn.model_selection import train_test_split

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "bracol")
CSV = os.path.join(DATA, "coffee-datasets", "coffee-datasets", "leaf", "dataset.csv")
CROPS = os.path.join(DATA, "github_leaf")
SPLITS = os.path.join(HERE, "data", "splits")
REPO = "https://raw.githubusercontent.com/esgario/lara2018/master/classification/dataset/"
SEED = 150

STRESS = ["healthy", "miner", "rust", "phoma", "cercospora"]
SEVERITY = ["healthy", "very_low", "low", "high", "very_high"]


def image_size(path):
    try:
        with Image.open(path) as im:
            im.load()
            return im.size
    except Exception:
        return None


def fetch(i):
    path = os.path.join(CROPS, f"{i}.jpg")
    if image_size(path) is None:
        urllib.request.urlretrieve(REPO + f"leaf/{i}.jpg", path)
    return i, image_size(path)


def main():
    if not os.path.exists(CSV):
        sys.exit(f"Missing {CSV}. Download BRACOL from https://data.mendeley.com/datasets/yy2k5y8mxg/1 "
                 "and extract into ml/data/bracol/ (see README).")
    os.makedirs(CROPS, exist_ok=True)
    all_rows = list(csv.DictReader(open(CSV, newline="")))

    # Label files must agree between the two sources.
    gh_csv = urllib.request.urlopen(REPO + "dataset-full.csv").read().decode().replace("\r", "").strip()
    labels_match = gh_csv == open(CSV).read().replace("\r", "").strip()
    print("GitHub dataset-full.csv identical to Mendeley dataset.csv:", labels_match)
    if not labels_match:
        sys.exit("Label files differ between Mendeley and GitHub; stop and inspect.")

    with ThreadPoolExecutor(16) as ex:
        sizes = dict(ex.map(fetch, [int(r["id"]) for r in all_rows]))
    on_disk = {int(f[:-4]) for f in os.listdir(CROPS) if f.endswith(".jpg")}
    labelled = {int(r["id"]) for r in all_rows}
    print(f"label rows {len(labelled)} | crops on disk {len(on_disk)} | decodable "
          f"{sum(s is not None for s in sizes.values())} | labelled without image {len(labelled - on_disk)} "
          f"| image without label {len(on_disk - labelled)} | sizes {dict(Counter(sizes.values()))}")
    if any(s is None for s in sizes.values()) or labelled != on_disk:
        sys.exit("Image set does not match the label file.")

    rows = [r for r in all_rows if r["predominant_stress"] != "5"]  # authors' exclusion
    ids = [int(r["id"]) for r in rows]
    y = [int(r["predominant_stress"]) for r in rows]
    train, rest = train_test_split(list(range(len(rows))), test_size=0.30, stratify=y, random_state=SEED)
    val, test = train_test_split(rest, test_size=0.50, stratify=[y[i] for i in rest], random_state=SEED)

    os.makedirs(SPLITS, exist_ok=True)
    summary = {"source": "BRACOL leaf crops from github.com/esgario/lara2018 (same ids as Mendeley)",
               "split": f"stratified by stress, 70/15/15, seed {SEED}",
               "stress_classes": STRESS, "severity_levels": SEVERITY,
               "rows_in_label_file": len(all_rows), "rows_excluded_code5": len(all_rows) - len(rows),
               "rows_used": len(rows), "splits": {}}
    for name, idx in [("train", train), ("val", val), ("test", test)]:
        items = sorted(({"id": ids[i], "stress": y[i], "severity": int(rows[i]["severity"])} for i in idx),
                       key=lambda x: x["id"])
        with open(os.path.join(SPLITS, f"{name}.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["id", "stress", "severity"])
            w.writeheader()
            w.writerows(items)
        sc = Counter(STRESS[x["stress"]] for x in items)
        sv = Counter(SEVERITY[x["severity"]] for x in items)
        summary["splits"][name] = {"n": len(items), "stress": {k: sc[k] for k in STRESS},
                                   "severity": {k: sv[k] for k in SEVERITY}}
    tot_s = Counter(STRESS[v] for v in y)
    tot_v = Counter(SEVERITY[int(r["severity"])] for r in rows)
    summary["total"] = {"stress": {k: tot_s[k] for k in STRESS}, "severity": {k: tot_v[k] for k in SEVERITY}}
    xt = Counter((int(r["predominant_stress"]), int(r["severity"])) for r in rows)
    summary["stress_x_severity"] = {STRESS[s]: {SEVERITY[v]: xt[(s, v)] for v in range(5)} for s in range(5)}
    json.dump(summary, open(os.path.join(SPLITS, "summary.json"), "w"), indent=2)

    print(f"\n{'':10s}" + "".join(f"{k:>12s}" for k in STRESS) + f"{'n':>8s}")
    for name in ["train", "val", "test"]:
        s = summary["splits"][name]
        print(f"{name:10s}" + "".join(f"{s['stress'][k]:12d}" for k in STRESS) + f"{s['n']:8d}")
    print(f"{'total':10s}" + "".join(f"{tot_s[k]:12d}" for k in STRESS) + f"{len(rows):8d}")
    print(f"\n{'':10s}" + "".join(f"{k:>12s}" for k in SEVERITY))
    for name in ["train", "val", "test"]:
        s = summary["splits"][name]
        print(f"{name:10s}" + "".join(f"{s['severity'][k]:12d}" for k in SEVERITY))
    print(f"{'total':10s}" + "".join(f"{tot_v[k]:12d}" for k in SEVERITY))


if __name__ == "__main__":
    main()
