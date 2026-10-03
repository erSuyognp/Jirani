"""Shared model, dataset and transforms for train / calibrate / export / evaluate."""
import csv
import os
import random

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models
from torchvision.transforms import v2 as T

HERE = os.path.dirname(os.path.abspath(__file__))
CROPS = os.path.join(HERE, "data", "bracol", "github_leaf")
SPLITS = os.path.join(HERE, "data", "splits")
CKPT_DIR = os.path.join(HERE, "checkpoints")
REPORT = os.path.join(HERE, "report")

STRESS = ["healthy", "miner", "rust", "phoma", "cercospora"]
SEVERITY = [0, 1, 2, 3, 4]
SEVERITY_NAMES = ["healthy", "very_low", "low", "high", "very_high"]
SIZE = 224
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
SEED = 150


def seed_all(seed=SEED):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


class JiraniNet(nn.Module):
    """MobileNetV3-Small features -> GAP -> dropout -> two linear heads.

    Heads are linear directly on pooled features so CAM is exact:
    stress_logits[c] = sum_k W[c,k] * mean_hw(features[k]) + b[c].
    """

    def __init__(self, n_stress=5, n_sev=5, pretrained=True, dropout=0.2):
        super().__init__()
        weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
        self.features = models.mobilenet_v3_small(weights=weights).features  # -> N x 576 x 7 x 7
        self.dropout = nn.Dropout(dropout)
        self.stress_head = nn.Linear(576, n_stress)
        self.severity_head = nn.Linear(576, n_sev)

    def forward(self, x):
        f = self.features(x)
        p = self.dropout(f.mean(dim=(2, 3)))
        return self.stress_head(p), self.severity_head(p), f


def read_split(name):
    with open(os.path.join(SPLITS, f"{name}.csv"), newline="") as f:
        return [(int(r["id"]), int(r["stress"]), int(r["severity"])) for r in csv.DictReader(f)]


def load_image(i, folder=CROPS):
    with Image.open(os.path.join(folder, f"{i}.jpg")) as im:
        return im.convert("RGB")


def train_transform():
    return T.Compose([
        T.Resize((SIZE, SIZE)),
        T.RandomResizedCrop(SIZE, scale=(0.7, 1.0), ratio=(0.8, 1.25)),
        T.RandomHorizontalFlip(),
        T.RandomVerticalFlip(),
        T.RandomApply([T.RandomRotation(15, fill=(230, 230, 230))], p=0.5),
        T.ColorJitter(brightness=0.35, contrast=0.3, saturation=0.3, hue=0.03),
        T.RandomApply([T.GaussianBlur(5, sigma=(0.1, 2.0))], p=0.3),
        T.RandomApply([T.JPEG((30, 95))], p=0.3),
        T.ToImage(),
        T.ToDtype(torch.float32, scale=True),
        T.Normalize(MEAN, STD),
    ])


def eval_transform():
    # The app does the same: squash the leaf crop to 224x224, scale to 0-1, normalise.
    return T.Compose([
        T.Resize((SIZE, SIZE)),
        T.ToImage(),
        T.ToDtype(torch.float32, scale=True),
        T.Normalize(MEAN, STD),
    ])


class LeafDataset(torch.utils.data.Dataset):
    def __init__(self, items, transform, folder=CROPS):
        self.items = items
        self.transform = transform
        self.images = [load_image(i, folder) for i, _, _ in items]  # small: 512x256 crops

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        _, s, v = self.items[idx]
        return self.transform(self.images[idx]), s, v


def load_model(path=None, device="cpu"):
    model = JiraniNet(pretrained=False)
    path = path or os.path.join(CKPT_DIR, "best.pt")
    model.load_state_dict(torch.load(path, map_location=device)["model"])
    return model.to(device).eval()


@torch.no_grad()
def predict_logits(model, loader, device):
    S, V, ys, yv = [], [], [], []
    for x, s, v in loader:
        ls, lv, _ = model(x.to(device))
        S.append(ls.float().cpu())
        V.append(lv.float().cpu())
        ys.append(s)
        yv.append(v)
    return torch.cat(S), torch.cat(V), torch.cat(ys), torch.cat(yv)


# --- App preprocessing mirror -------------------------------------------------------------------
# Must match app/src/capture/leafCrop.ts and CONFIG.quality in app/src/config.ts.
LEAF_HUE = (15, 170)   # degrees
LEAF_SAT_MIN = 0.18
LEAF_VAL_MIN = 0.12
CROP_MARGIN = 0.02
ANALYSIS_W = 256


def leaf_mask(rgb):
    """rgb: HxWx3 uint8 -> bool mask of leaf-coloured pixels (green through yellow-brown)."""
    a = rgb.astype(np.float32) / 255.0
    mx, mn = a.max(2), a.min(2)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.zeros_like(mx)
    dd = np.maximum(d, 1e-6)
    h = np.where(mx == r, (60 * ((g - b) / dd)) % 360, h)
    h = np.where(mx == g, 60 * ((b - r) / dd) + 120, h)
    h = np.where(mx == b, 60 * ((r - g) / dd) + 240, h)
    h = np.where(d == 0, 0, h)
    return (h >= LEAF_HUE[0]) & (h <= LEAF_HUE[1]) & (s >= LEAF_SAT_MIN) & (mx >= LEAF_VAL_MIN)


def leaf_bbox_crop(img):
    """Crop a PIL image to the leaf bounding box (1st-99th percentile of leaf pixels) plus a margin."""
    w, h = img.size
    sw, sh = ANALYSIS_W, max(1, round(h * ANALYSIS_W / w))
    m = leaf_mask(np.asarray(img.convert("RGB").resize((sw, sh), Image.BILINEAR)))
    ys, xs = np.nonzero(m)
    if len(xs) < 0.01 * sw * sh:
        return img
    x0, x1 = np.percentile(xs, [1, 99])
    y0, y1 = np.percentile(ys, [1, 99])
    mx, my = CROP_MARGIN * sw, CROP_MARGIN * sh
    x0, x1 = max(0, x0 - mx), min(sw, x1 + 1 + mx)
    y0, y1 = max(0, y0 - my), min(sh, y1 + 1 + my)
    fx, fy = w / sw, h / sh
    return img.crop((int(x0 * fx), int(y0 * fy), int(np.ceil(x1 * fx)), int(np.ceil(y1 * fy))))
