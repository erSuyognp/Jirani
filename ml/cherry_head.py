"""Train the cherry ripeness head: a small linear classifier on the frozen backbone of the shipped leaf model.

RESULT (2026-10-03): NOT SHIPPED. The head is good on held-out lab fruits (about 94% of single-stage tiles) but wrong
on real camera photos: it called piles of ripe red cherries "unripe" and graded a real photo of ripe cherries on white
band C. The app therefore keeps the colour check (app/src/capture/cherry.ts). This script and its report are kept so
the experiment can be repeated, and re-run on phone photos when there are some. See ml/report/cherry_head.json.

The leaf model (app/public/model/model.int8.onnx) is NOT changed. It already outputs its feature map; this script
runs cherry images through it, averages the feature map to 576 numbers, and fits a multinomial logistic regression
on top (5 ripeness stages).

Data: "Dataset coffee 15 Channels" (Tamayo-Monsalve, Zenodo 10.5281/zenodo.4914786, CC BY 4.0): 640 lab images of
single cherries, 224x224, 15 light wavelengths per image, 5 ripening stages. Extract Dataset.rar into
ml/data/cherry/. See DATA.md for what it does not cover.

What this script has to assume (all stated in the report):
- the 15 channels run from short to long wavelength, at about the centres in WAVELENGTHS below. The files do not
  list them; the order agrees with the data (red fruit reflects from channel 8 up, green fruit dips at channel 11,
  everything is bright in channels 12-14, the near infrared). The colour image is computed from the 11 usable
  visible bands with the CIE colour-matching functions (channel 7 is noise in many images and is not used);
- the lab's pad is dark grey. Fruits are up to 6 times brighter than it, so the pad is taken as 14% reflectance;
- the label numbers are not named in the files; names are inferred from the class counts in the dataset
  description and from the reconstructed colours.
- training images are cut-out fruits pasted on a white card (one fruit, or several of the same stage), because the
  app sees cherries on the printed card, not on the lab's grey pad. These composites are SYNTHETIC arrangements of
  real fruit pixels.

Usage: python ml/cherry_head.py      (about 4 minutes on a laptop CPU)
Writes: ml/report/cherry_head.json (numbers) and ml/report/cherry_head_weights.json (the head; not used by the app)
"""
import json
import os

import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy import ndimage
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "ml", "data", "cherry")
MODEL = os.path.join(ROOT, "app", "public", "model", "model.int8.onnx")
META = json.load(open(os.path.join(ROOT, "app", "public", "model", "model_meta.json")))
OUT_HEAD = os.path.join(ROOT, "ml", "report", "cherry_head_weights.json")   # deliberately not under app/: not shipped
REAL = os.path.join(ROOT, "app", "dev-samples", "cherry")                    # real camera photos (gitignored, see DATA.md)
OUT_REPORT = os.path.join(ROOT, "ml", "report", "cherry_head.json")
SEED = 150

# label number -> stage (INFERRED: counts 78/160/160/112/130 match dry/semi/ripe/overripe/unripe in the description;
# 1 and 2 are told apart by colour: 2 is yellow, 1 is orange-red)
LABEL_NAME = {0: "dry", 1: "ripe", 2: "semi_ripe", 3: "overripe", 4: "unripe"}
CLASSES = ["unripe", "semi_ripe", "ripe", "overripe", "dry"]          # order of the head's outputs
RIPE, DEFECT = ("ripe", "overripe"), ("unripe", "dry")                # how stages count towards a band
CARD = 0.93                                                           # white card brightness in the composites
WAVELENGTHS = [410, 450, 470, 490, 505, 530, 560, 590, 600, 620, 630, 650]   # nm, ASSUMED centres of channels 0-11
VISIBLE = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11]                          # channel 7 dropped (noise)
PAD_REFLECTANCE = 0.14                                                # ASSUMED: the brightest ripe fruit then reaches about 0.9

# Mirror of CONFIG.cherry in app/src/config.ts (colour check and band thresholds)
CH = dict(fruitMin=0.05, cardMin=0.25, cardSatMax=0.2, cardValMin=0.55, satMin=0.3, darkValMax=0.22,
          ripeHueMin=335, ripeHueMax=12, unripeHueMin=45, unripeHueMax=170,
          A=(0.8, 0.08), B=(0.6, 0.2), tileCols=5, tileFruitMin=0.2, tilePerFruit=2.2)


def _lobe(lam, mu, s1, s2):
    return np.exp(-0.5 * ((lam - mu) / np.where(lam < mu, s1, s2)) ** 2)


def _cmf(lam):
    """CIE 1931 colour-matching functions, analytic fit of Wyman, Sloan and Shirley (2013)."""
    lam = np.asarray(lam, np.float64)
    xb = 1.056 * _lobe(lam, 599.8, 37.9, 31.0) + 0.362 * _lobe(lam, 442.0, 16.0, 26.7) - 0.065 * _lobe(lam, 501.1, 20.4, 26.2)
    yb = 0.821 * _lobe(lam, 568.8, 46.9, 40.5) + 0.286 * _lobe(lam, 530.9, 16.3, 31.1)
    zb = 1.217 * _lobe(lam, 437.0, 11.8, 36.0) + 0.681 * _lobe(lam, 459.0, 26.0, 13.8)
    return np.stack([xb, yb, zb], 1)


def _spectral_to_rgb_matrix():
    lam = np.array([WAVELENGTHS[c] for c in VISIBLE], np.float64)
    width = np.gradient(lam)                                   # each band stands for the stretch of spectrum around it
    m = _cmf(lam) * width[:, None]                             # (bands, XYZ)
    m = m / m.sum(0) * np.array([0.9505, 1.0, 1.089])          # a flat (white) spectrum maps to the D65 white point
    xyz_to_srgb = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    return (m @ xyz_to_srgb.T).astype(np.float32)              # (bands, RGB), linear sRGB


SPECTRAL_TO_RGB = _spectral_to_rgb_matrix()


def reflectance(a):
    """Per-channel brightness relative to the lab's grey pad (median of the middle of the image, mostly pad)."""
    a = a.astype(np.float32)
    gain = np.median(a[62:162, 62:162, :].reshape(-1, 15), axis=0)
    gain[gain < 1] = 1
    return a / gain


def to_rgb(a):
    """15-channel lab image -> approximate sRGB in 0..1 (gamma-encoded, as a camera would store it)."""
    lin = np.clip(reflectance(a)[:, :, VISIBLE] * PAD_REFLECTANCE @ SPECTRAL_TO_RGB, 0, 1)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055).astype(np.float32)


def cut_out(a):
    """The fruit as (crop, mask): the warm-coloured blob in the middle (the lab's pad is bluish grey)."""
    rgb = to_rgb(a)
    warm = ndimage.gaussian_filter(rgb[:, :, 0] - rgb[:, :, 2], sigma=1.5)
    cand = ndimage.binary_opening(warm > 0.05, iterations=2)
    lab, n = ndimage.label(cand)
    if not n:
        return None
    centre = lab[72:152, 72:152]
    ids = [i for i in np.unique(centre) if i]
    if not ids:
        return None
    best = max(ids, key=lambda i: (centre == i).sum())
    m = ndimage.binary_fill_holes(ndimage.binary_closing(lab == best, iterations=5))
    ys, xs = np.where(m)
    if len(ys) < 400 or len(ys) > 16000:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return rgb[y0:y1, x0:x1].copy(), m[y0:y1, x0:x1].copy()


def jitter(rgb, rng):
    """Colour changes a phone camera adds over a lab reflectance image: more saturation, contrast, brightness."""
    sat, gamma, gain = rng.uniform(1.0, 2.6), rng.uniform(0.8, 1.9), rng.uniform(0.85, 1.08)
    grey = rgb.mean(2, keepdims=True)
    out = np.clip(grey + (rgb - grey) * sat, 0, 1) ** gamma * gain
    return np.clip(out * rng.uniform(0.96, 1.04, size=3), 0, 1)


def paste(canvas, fruit, mask, cx, cy, size, rng):
    h, w = mask.shape
    s = size / max(h, w)
    nh, nw = max(4, round(h * s)), max(4, round(w * s))
    f = np.asarray(Image.fromarray((fruit * 255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)).astype(np.float32) / 255
    m = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)).astype(np.float32) / 255
    if rng.random() < 0.5:
        f, m = f[:, ::-1], m[:, ::-1]
    y0, x0 = int(cy - nh / 2), int(cx - nw / 2)
    H, W = canvas.shape[:2]
    ya, yb, xa, xb = max(0, y0), min(H, y0 + nh), max(0, x0), min(W, x0 + nw)
    if ya >= yb or xa >= xb:
        return 0
    fm = m[ya - y0:yb - y0, xa - x0:xb - x0, None]
    canvas[ya:yb, xa:xb] = canvas[ya:yb, xa:xb] * (1 - fm) + f[ya - y0:yb - y0, xa - x0:xb - x0] * fm
    return float(fm.sum())


def card(h, w, rng):
    base = CARD * rng.uniform(0.9, 1.04)
    return np.clip(base + rng.normal(0, 0.008, size=(h, w, 3)), 0, 1).astype(np.float32)


def tile(fruits_by_class, stage, rng, augment, mixed=False):
    """One 224x224 training image on a white card: one fruit, a few fruits, or a small pile.

    Pure tiles hold one stage. Mixed tiles hold fruits of two or three stages, as a real handful does; their
    target is the share of fruit area per stage. Returns (image, shares).
    """
    c = card(224, 224, rng)
    u = rng.random()
    n = 1 if (u < 0.35 and not mixed) else int(rng.integers(2, 6)) if u < 0.7 else int(rng.integers(8, 20))
    stages = [stage] if not mixed else [stage] + list(rng.choice(5, size=int(rng.integers(1, 3))))
    area = np.zeros(5)
    for k in range(n):
        cls = int(stages[int(rng.integers(len(stages)))])
        fruit, mask = fruits_by_class[cls][int(rng.integers(len(fruits_by_class[cls])))]
        size = rng.uniform(100, 170) if n == 1 else rng.uniform(70, 115) if n < 6 else rng.uniform(45, 78)
        lo, hi = (60, 164) if n < 6 else (15, 209)
        area[cls] += paste(c, fruit, mask, rng.uniform(lo, hi), rng.uniform(lo, hi), size, rng)
    return (jitter(c, rng) if augment else c), area / max(1.0, area.sum())


class Backbone:
    """The shipped leaf model, used only for its feature map (same preprocessing as the app: squash to 224, normalise)."""

    def __init__(self):
        self.s = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
        self.mean, self.std = np.array(META["mean"], np.float32), np.array(META["std"], np.float32)

    def features(self, rgb):
        S = META["input_size"]
        if rgb.shape[:2] != (S, S):
            rgb = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).resize((S, S), Image.BILINEAR)).astype(np.float32) / 255
        x = ((rgb - self.mean) / self.std).transpose(2, 0, 1)[None].astype(np.float32)
        return self.s.run(["features"], {"input": x})[0][0].mean(axis=(1, 2))


def colour_shares(rgb):
    """Python mirror of gradeCherryPixels (app/src/capture/cherry.ts): fruit, card, ripe and defect shares."""
    mx, mn = rgb.max(2), rgb.min(2)
    d = mx - mn
    sat = d / np.maximum(mx, 1e-6)
    dark = mx < CH["darkValMax"]
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        h = np.where(mx == r, ((g - b) / d * 60 + 360) % 360, np.where(mx == g, (b - r) / d * 60 + 120, (r - g) / d * 60 + 240))
    col = ~dark & (sat >= CH["satMin"])
    ripe = col & ((h >= CH["ripeHueMin"]) | (h <= CH["ripeHueMax"]))
    unripe = col & (h >= CH["unripeHueMin"]) & (h <= CH["unripeHueMax"])
    half = col & (h > CH["ripeHueMax"]) & (h < CH["unripeHueMin"])
    fruit = dark | ripe | unripe | half
    cardpix = ~dark & (sat < CH["cardSatMax"]) & (mx >= CH["cardValMin"])
    nf = max(1, fruit.sum())
    return dict(fruit=fruit.mean(), card=cardpix.mean(), ripe=ripe.sum() / nf, defect=(dark | unripe).sum() / nf, mask=fruit)


def band(ripe, defect):
    if ripe >= CH["A"][0] and defect <= CH["A"][1]:
        return "A"
    if ripe >= CH["B"][0] and defect <= CH["B"][1]:
        return "B"
    return "C"


def head_shares(rgb, backbone, W, b):
    """Mirror of the app's tile pipeline: tiles with enough fruit -> backbone -> head -> stage shares.

    The head was trained on fruits about half a tile wide, so the tile follows the fruit: about 2.2 fruit widths,
    never smaller than a fifth of the photo (the framing the cherry box gives) and never larger than the photo.
    The fruit width is twice the largest distance from inside the fruit mask to its edge.
    """
    H, Wd = rgb.shape[:2]
    mask = colour_shares(rgb)["mask"]
    small = np.asarray(Image.fromarray(mask).resize((256, max(1, round(H * 256 / Wd))), Image.NEAREST))
    fruit_w = 2 * ndimage.distance_transform_edt(small).max() * Wd / 256
    side = float(np.clip(CH["tilePerFruit"] * fruit_w, Wd / CH["tileCols"], min(H, Wd)))
    cols, rows = int(np.ceil(Wd / side)), int(np.ceil(H / side))
    tot, acc = 0.0, np.zeros(len(CLASSES))
    for ty in range(rows):
        for tx in range(cols):
            y0 = int(round(ty * (H - side) / max(1, rows - 1))) if rows > 1 else 0
            x0 = int(round(tx * (Wd - side) / max(1, cols - 1))) if cols > 1 else 0
            y1, x1 = min(H, int(y0 + side)), min(Wd, int(x0 + side))
            share = mask[y0:y1, x0:x1].mean() if y1 > y0 and x1 > x0 else 0
            if share < CH["tileFruitMin"]:
                continue
            z = W @ backbone.features(rgb[y0:y1, x0:x1]) + b
            p = np.exp(z - z.max())
            acc += share * p / p.sum()
            tot += share
    if not tot:
        return None
    p = acc / tot
    return dict(zip(CLASSES, p))


def handful(fruits_by_class, rng, augment=True):
    """SYNTHETIC whole photo: 10-22 cut-out fruits of mixed stages on a white card. Returns image and true shares."""
    H, Wd = 600, 800
    c = card(H, Wd, rng)
    mix = rng.dirichlet(np.array([0.5, 0.5, 3.0, 0.8, 0.3]))          # mostly ripe, like a picked handful
    if rng.random() < 0.25:
        mix = rng.dirichlet(np.ones(5) * 0.6)
    n = int(rng.integers(10, 26))
    area = np.zeros(5)
    size = rng.uniform(70, 110)                                      # fruits of one handful are about the same size
    for k in range(n):                                               # anywhere on the card; fruits may touch or overlap
        cls = int(rng.choice(5, p=mix))
        fruit, mask = fruits_by_class[cls][int(rng.integers(len(fruits_by_class[cls])))]
        area[cls] += paste(c, fruit, mask, rng.uniform(60, Wd - 60), rng.uniform(60, H - 60), size * rng.uniform(0.85, 1.15), rng)
    area /= max(1.0, area.sum())
    true = dict(zip(CLASSES, area))
    return (jitter(c, rng) if augment else c), true


# Real camera photos from Wikimedia Commons: (what a person sees, file, crop box or None, shrink onto a card or None)
REAL_CASES = [
    ("ripe", "two ripe cherries on white, close-up", "real_white_bg.jpg", None, None),
    ("ripe", "two ripe cherries on white, shrunk onto a card", "real_white_bg.jpg", None, 0.25),
    ("ripe", "fresh pile, mostly red", "more/fresh.jpg", (300, 300, 660, 570), None),
    ("ripe", "red cherries on a drying patio", "more/green_tarrazu.jpg", (520, 300, 800, 480), None),
    ("dry", "dried pile", "more/dried.jpg", (200, 200, 560, 470), None),
    ("dry", "dried cherries in a tray", "more/dried_ifex.jpg", (300, 400, 700, 700), None),
    ("unripe", "four half-ripe cherries in a hand", "more/hand.jpg", (320, 230, 630, 370), None),
    ("unripe", "green to orange cherries on a branch", "real_varying_tree.jpg", (380, 60, 720, 420), None),
]


def real_photo_check(bb, W, b):
    """The head and the colour check on real camera photos. Returns None when the photos are not on this machine."""
    out = []
    for expect, name, file, box, shrink in REAL_CASES:
        path = os.path.join(REAL, file)
        if not os.path.exists(path):
            return None
        im = Image.open(path).convert("RGB")
        if box:
            im = im.crop(box)
        if shrink:
            c = Image.new("RGB", (800, 600), (240, 240, 236))
            w, h = int(im.width * shrink), int(im.height * shrink)
            c.paste(im.resize((w, h), Image.LANCZOS), ((800 - w) // 2, (600 - h) // 2))
            im = c
        rgb = np.asarray(im).astype(np.float32) / 255
        p, col = head_shares(rgb, bb, W, b), colour_shares(rgb)
        top = max(p, key=p.get) if p else None
        group = "ripe" if top in RIPE else "unripe" if top in ("unripe", "semi_ripe") else top
        out.append({"photo": name, "a_person_sees": expect, "head_top_stage": top, "head_right": group == expect,
                    "head_shares": {k: round(float(v), 2) for k, v in (p or {}).items()},
                    "head_band": band(sum(p[k] for k in RIPE), sum(p[k] for k in DEFECT)) if p else None,
                    "colour_check_ripe": round(float(col["ripe"]), 2), "colour_check_defect": round(float(col["defect"]), 2),
                    "colour_check_band": band(col["ripe"], col["defect"])})
        print(f"real photo: {name} [{expect}] head says {top} ({'right' if group == expect else 'WRONG'}), band {out[-1]['head_band']}; "
              f"colour check ripe {col['ripe']:.2f} defect {col['defect']:.2f}, band {out[-1]['colour_check_band']}")
    return out


def main():
    rng = np.random.default_rng(SEED)
    x = np.load(os.path.join(DATA, "dataset_15Canales_224x224.npy"), mmap_mode="r")
    y = np.load(os.path.join(DATA, "label_dataset_15Canales_224x224.npy"))
    stage = np.array([CLASSES.index(LABEL_NAME[int(v)]) for v in y])

    # cut every fruit out once; split fruits (not composites) 70/15/15, stratified, so no fruit is in two splits
    fruits, split = {}, {}
    skipped = 0
    for c in range(5):
        idx = np.where(stage == c)[0]
        rng.shuffle(idx)
        n_tr, n_va = round(0.7 * len(idx)), round(0.15 * len(idx))
        for part, ids in (("train", idx[:n_tr]), ("val", idx[n_tr:n_tr + n_va]), ("test", idx[n_tr + n_va:])):
            got = [f for f in (cut_out(np.asarray(x[i])) for i in ids) if f is not None]
            skipped += len(ids) - len(got)
            fruits[(part, c)] = got
            split[(part, c)] = len(got)
    print("fruits per split and stage:", {p: [split[(p, c)] for c in range(5)] for p in ("train", "val", "test")}, "| not segmented:", skipped)

    bb = Backbone()

    def tiles(part, per_class, augment, mixed=False):
        """Features and targets. A pure tile's target is its stage; a mixed tile's target is its stage shares."""
        by_class = {c: fruits[(part, c)] for c in range(5)}
        X, S = [], []
        for c in range(5):
            for _ in range(per_class):
                img, shares = tile(by_class, c, rng, augment, mixed)
                X.append(bb.features(img))
                S.append(shares)
        return np.array(X), np.array(S)

    Xp, Sp = tiles("train", 240, True)
    Xm, Sm = tiles("train", 240, True, mixed=True)
    Xva, Sva = tiles("val", 80, True)
    Xte, Ste = tiles("test", 120, True)
    Xte_plain, Ste_plain = tiles("test", 60, False)
    Xte_mixed, Ste_mixed = tiles("test", 80, True, mixed=True)
    Yva, Yte, Yte_plain = Sva.argmax(1), Ste.argmax(1), Ste_plain.argmax(1)
    Xtr, Str = np.concatenate([Xp, Xm]), np.concatenate([Sp, Sm])
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-6
    # soft targets: every tile is given once per stage, weighted by that stage's share of the fruit area
    rows, labels = np.nonzero(Str > 0.02)
    Xsoft, wsoft = (Xtr[rows] - mu) / sd, Str[rows, labels]
    best = None
    for C in (0.003, 0.01, 0.03, 0.1, 0.3):
        clf = LogisticRegression(C=C, max_iter=4000).fit(Xsoft, labels, sample_weight=wsoft)
        acc = clf.score((Xva - mu) / sd, Yva)
        print(f"C={C}: val accuracy on pure tiles {acc:.3f}")
        if best is None or acc > best[0]:
            best = (acc, C, clf)
    val_acc, C, clf = best
    W = (clf.coef_ / sd).astype(np.float32)                     # fold the standardisation into the weights
    b = (clf.intercept_ - (clf.coef_ * (mu / sd)).sum(1)).astype(np.float32)

    def acc5(X, Y):
        return float(((X @ W.T + b).argmax(1) == Y).mean())

    def group(c):  # ripe / defect / other, the three groups that decide the band
        return 0 if CLASSES[c] in RIPE else 1 if CLASSES[c] in DEFECT else 2

    pred = (Xte @ W.T + b).argmax(1)
    test_acc, test_plain = acc5(Xte, Yte), acc5(Xte_plain, Yte_plain)
    group_acc = float(np.mean([group(p) == group(t) for p, t in zip(pred, Yte)]))
    cm = confusion_matrix(Yte, pred).tolist()
    zm = Xte_mixed @ W.T + b
    pm = np.exp(zm - zm.max(1, keepdims=True))
    pm /= pm.sum(1, keepdims=True)
    mixed_err = float(np.abs(pm - Ste_mixed).sum(1).mean() / 2)      # share of fruit area put in the wrong stage
    print(f"test tiles: 5-stage accuracy {test_acc:.3f} (colour-jittered), {test_plain:.3f} (plain); 3-group accuracy {group_acc:.3f}; "
          f"mixed tiles: {mixed_err:.3f} of the fruit area in the wrong stage")

    # whole-photo check on SYNTHETIC handfuls made from test fruits: band from the head vs band from the colour check
    by_class = {c: fruits[("test", c)] for c in range(5)}
    n, ok_head, ok_col, truth_counts, err_h, err_c = 240, 0, 0, {"A": 0, "B": 0, "C": 0}, [], []
    for _ in range(n):
        img, true = handful(by_class, rng)
        t_ripe, t_def = sum(true[k] for k in RIPE), sum(true[k] for k in DEFECT)
        truth = band(t_ripe, t_def)
        truth_counts[truth] += 1
        col = colour_shares(img)
        p = head_shares(img, bb, W, b)
        h_ripe, h_def = (sum(p[k] for k in RIPE), sum(p[k] for k in DEFECT)) if p else (0, 1)
        ok_head += band(h_ripe, h_def) == truth
        ok_col += band(col["ripe"], col["defect"]) == truth
        err_h.append(abs(h_ripe - t_ripe))
        err_c.append(abs(col["ripe"] - t_ripe))
    print(f"synthetic handfuls (n={n}, truth {truth_counts}): band right, head {ok_head / n:.3f}, colour check {ok_col / n:.3f}; "
          f"mean error of the ripe share, head {np.mean(err_h):.3f}, colour check {np.mean(err_c):.3f}")

    real = real_photo_check(bb, W, b)
    report = {
        "shipped": False,
        "decision": "Not used by the app. Good on held-out lab fruits, wrong on real camera photos (see real_camera_photos). "
                    "The app keeps the colour check in app/src/capture/cherry.ts.",
        "real_camera_photos": real if real is not None else "not run: photos not on this machine (app/dev-samples/cherry, see DATA.md)",
        "real_camera_photos_head_right": None if real is None else f"{sum(r['head_right'] for r in real)} of {len(real)}",
        "dataset": "Dataset coffee 15 Channels, Zenodo 10.5281/zenodo.4914786, CC BY 4.0 (Tamayo-Monsalve)",
        "backbone": "app/public/model/model.int8.onnx (frozen, unchanged)", "features": int(W.shape[1]),
        "classes": CLASSES, "label_names": "INFERRED from class counts and reconstructed colour", "seed": SEED,
        "fruits": {p: [split[(p, c)] for c in range(5)] for p in ("train", "val", "test")}, "fruits_not_segmented": skipped,
        "training_images": "SYNTHETIC composites: cut-out real fruits on a white card (single stage and mixed), colour-jittered", "C": C,
        "val_accuracy": round(float(val_acc), 4), "test_accuracy_5_stage": round(test_acc, 4),
        "test_accuracy_5_stage_no_jitter": round(test_plain, 4), "test_accuracy_ripe_defect_other": round(group_acc, 4),
        "test_confusion_rows_true_cols_pred": cm, "test_mixed_tiles_area_in_wrong_stage": round(mixed_err, 4),
        "synthetic_handfuls": {"n": n, "truth_bands": truth_counts, "band_accuracy_head": round(ok_head / n, 4),
                               "band_accuracy_colour_check": round(ok_col / n, 4),
                               "ripe_share_mean_abs_error_head": round(float(np.mean(err_h)), 4),
                               "ripe_share_mean_abs_error_colour_check": round(float(np.mean(err_c)), 4)},
    }
    json.dump(report, open(OUT_REPORT, "w", encoding="utf8"), indent=1)
    json.dump({"note": "NOT SHIPPED. Cherry ripeness head: linear layer on the mean of the leaf model's feature map. Trained by "
                       "ml/cherry_head.py on lab images of single cherries (Zenodo 10.5281/zenodo.4914786, CC BY 4.0). It fails on "
                       "real camera photos, so the app does not load it.",
               "classes": CLASSES, "ripe": list(RIPE), "defect": list(DEFECT), "shape": [len(CLASSES), int(W.shape[1])],
               "weight": [[round(float(v), 5) for v in row] for row in W], "bias": [round(float(v), 5) for v in b],
               "test_accuracy_5_stage": round(test_acc, 4)},
              open(OUT_HEAD, "w", encoding="utf8"))
    print("wrote", OUT_HEAD, os.path.getsize(OUT_HEAD), "bytes;", OUT_REPORT)


if __name__ == "__main__":
    main()
