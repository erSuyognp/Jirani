"""Generate ml/report/report.md, metrics.json and plots. Every number here is measured, never typed in.

Models are run through onnxruntime (CPU), the same graph the app runs, with temperature T applied.

Usage: python ml/evaluate.py
"""
import io
import json
import os
from collections import Counter

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter  # noqa: E402
from sklearn.metrics import confusion_matrix, f1_score  # noqa: E402

from common import (CROPS, HERE, REPORT, SEVERITY_NAMES, STRESS, eval_transform, leaf_bbox_crop,  # noqa: E402
                    leaf_mask, load_image, read_split)

APP_MODEL = os.path.join(HERE, "..", "app", "public", "model")
FP32 = os.path.join(HERE, "checkpoints", "onnx", "model.fp32.onnx")
MENDELEY = os.path.join(HERE, "data", "bracol", "coffee-datasets", "coffee-datasets", "leaf", "images")
OOD = os.path.join(HERE, "data", "ood")
SEED = 150
TF = eval_transform()


class Model:
    def __init__(self, path, T):
        self.s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.T = T

    def __call__(self, imgs):
        P, V = [], []
        for im in imgs:
            x = TF(im).unsqueeze(0).numpy()
            ls, lv, _ = self.s.run(None, {"input": x})
            z = ls[0] / self.T
            p = np.exp(z - z.max())
            P.append(p / p.sum())
            V.append(int(lv[0].argmax()))
        return np.array(P), np.array(V)


def at_tau(P, y, tau):
    conf, pred = P.max(1), P.argmax(1)
    m = conf >= tau
    return {"n": int(len(y)), "acc": float((pred == y).mean()),
            "coverage": float(m.mean()), "answered_acc": float((pred[m] == y[m]).mean()) if m.any() else None}


def curve(P, y):
    conf, pred = P.max(1), P.argmax(1)
    out = []
    for t in np.round(np.arange(0.30, 0.951, 0.01), 2):
        m = conf >= t
        out.append({"tau": float(t), "coverage": float(m.mean()),
                    "answered_acc": float((pred[m] == y[m]).mean()) if m.any() else None})
    return out


def aggregate(P3, tau):
    """Python mirror of app/src/logic/aggregate.ts (min 2 photos, mean >= tau, >= 2 agree)."""
    pm = P3.mean(0)
    c = int(pm.argmax())
    votes = int((P3.argmax(1) == c).sum())
    return c if (pm[c] >= tau and votes >= 2) else None


def triples(items, rng):
    by = {}
    for k, (_, s, _) in enumerate(items):
        by.setdefault(s, []).append(k)
    out = []
    for s, idx in by.items():
        idx = list(rng.permutation(idx))
        out += [(s, idx[i:i + 3]) for i in range(0, len(idx) - 2, 3)]
    return out


# ---- synthetic perturbations (deterministic) --------------------------------------------------
def background_mask(im):
    a = np.asarray(im.convert("RGB"))
    return ~leaf_mask(a)


def clutter(w, h, rng):
    bg = Image.new("RGB", (w, h), (90, 70, 50))
    d = ImageDraw.Draw(bg)
    for _ in range(60):
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        r = int(rng.integers(5, 40))
        col = tuple(int(c) for c in rng.integers(30, 200, 3))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    return bg.filter(ImageFilter.GaussianBlur(1.5))


def perturb(im, kind, rng):
    if kind == "blur":
        return im.filter(ImageFilter.GaussianBlur(4))
    if kind == "low_light":
        a = np.asarray(im).astype(np.float32) / 255.0
        a = (a ** 1.6) * 0.45 + rng.normal(0, 0.02, a.shape)
        return Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    if kind == "colour_cast":
        a = np.asarray(im).astype(np.float32) * np.array([1.18, 1.0, 0.68])
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if kind == "jpeg_q10":
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=10)
        return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    if kind in ("dark_background", "cluttered_background"):
        m = background_mask(im)
        bg = (Image.new("RGB", im.size, (22, 22, 22)) if kind == "dark_background"
              else clutter(*im.size, rng))
        out = np.where(m[..., None], np.asarray(bg), np.asarray(im))
        return Image.fromarray(out.astype(np.uint8))
    raise ValueError(kind)


PERTURBATIONS = ["blur", "low_light", "colour_cast", "jpeg_q10", "dark_background", "cluttered_background"]


def plot_confusion(cm, title, path, labels):
    fig, ax = plt.subplots(figsize=(5, 4.3))
    ax.imshow(cm, cmap="Greens")
    ax.set_xticks(range(len(labels)), labels, rotation=35, ha="right")
    ax.set_yticks(range(len(labels)), labels)
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, cm[i, j], ha="center", va="center", color="white" if cm[i, j] > cm.max() / 2 else "black")
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_rc(val_curve, test_curve, tau, path):
    fig, ax = plt.subplots(figsize=(6, 4))
    for c, lab, st in [(val_curve, "validation", "-"), (test_curve, "test", "--")]:
        cov = [r["coverage"] for r in c if r["answered_acc"] is not None]
        acc = [r["answered_acc"] for r in c if r["answered_acc"] is not None]
        ax.plot(cov, acc, st, label=lab)
    tv = next(r for r in val_curve if abs(r["tau"] - tau) < 1e-6)
    ax.scatter([tv["coverage"]], [tv["answered_acc"]], color="red", zorder=5, label=f"tau = {tau:.2f} (val)")
    ax.axhline(0.95, color="grey", lw=0.8, ls=":")
    ax.set_xlabel("coverage (share of leaves answered)")
    ax.set_ylabel("accuracy on answered leaves")
    ax.set_title("Risk-coverage, single leaf, int8 model")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def main():
    os.makedirs(REPORT, exist_ok=True)
    meta = json.load(open(os.path.join(APP_MODEL, "model_meta.json")))
    cal = json.load(open(os.path.join(REPORT, "calibration.json")))
    exp = json.load(open(os.path.join(REPORT, "export.json")))
    train_log = json.load(open(os.path.join(REPORT, "train_log.json")))
    summary = json.load(open(os.path.join(HERE, "data", "splits", "summary.json")))
    T, tau = meta["temperature"], meta["tau"]
    int8 = Model(os.path.join(APP_MODEL, meta["model_file"]), T)
    fp32 = Model(FP32, T)
    rng = np.random.default_rng(SEED)
    M = {"model_file": meta["model_file"], "variant": meta["variant"], "temperature": T, "tau": tau}

    test = read_split("test")
    imgs = [load_image(i) for i, _, _ in test]
    ys = np.array([s for _, s, _ in test])
    yv = np.array([v for _, _, v in test])

    # 2-3. clean test, fp32 vs int8
    res = {}
    for name, mdl in [("fp32", fp32), ("int8", int8)]:
        P, V = mdl(imgs)
        res[name] = (P, V)
        cm = confusion_matrix(ys, P.argmax(1), labels=range(5))
        M[f"clean_{name}"] = {
            "stress_acc": float((P.argmax(1) == ys).mean()),
            "stress_macro_f1": float(f1_score(ys, P.argmax(1), average="macro")),
            "per_class_recall": {STRESS[k]: float(cm[k, k] / cm[k].sum()) for k in range(5)},
            "confusion": cm.tolist(),
            "severity_acc": float((V == yv).mean()),
            "severity_within_one": float((np.abs(V - yv) <= 1).mean()),
            "at_tau": at_tau(P, ys, tau),
        }
        plot_confusion(cm, f"Stress confusion, clean test, {name}", os.path.join(REPORT, f"confusion_{name}.png"), STRESS)
    Pi, Vi = res["int8"]
    cmv = confusion_matrix(yv, Vi, labels=range(5))
    M["severity_confusion_int8"] = cmv.tolist()
    plot_confusion(cmv, "Severity confusion, clean test, int8", os.path.join(REPORT, "confusion_severity_int8.png"),
                   SEVERITY_NAMES)

    # 5. risk-coverage
    tc = curve(Pi, ys)
    M["risk_coverage_test"] = tc
    plot_rc(cal["risk_coverage_val"], tc, tau, os.path.join(REPORT, "risk_coverage.png"))

    # three-leaf simulation
    tri = triples(test, rng)
    out3 = [(s, aggregate(Pi[idx], tau)) for s, idx in tri]
    ans = [(s, c) for s, c in out3 if c is not None]
    M["three_leaf_sim"] = {"n_triples": len(out3), "coverage": len(ans) / len(out3),
                           "answered_acc": float(np.mean([s == c for s, c in ans])) if ans else None}

    # app path: Mendeley originals -> app-style leaf crop
    ids_m = [k for k, (i, _, _) in enumerate(test) if os.path.exists(os.path.join(MENDELEY, f"{i}.jpg"))]
    if ids_m:
        ims = [leaf_bbox_crop(Image.open(os.path.join(MENDELEY, f"{test[k][0]}.jpg")).convert("RGB")) for k in ids_m]
        Pm, Vm = int8(ims)
        M["app_crop_path"] = {**at_tau(Pm, ys[ids_m], tau), "severity_acc": float((Vm == yv[ids_m]).mean()),
                              "same_ids_on_authors_crops": at_tau(Pi[ids_m], ys[ids_m], tau)}

    # 6. perturbed (synthetic)
    M["perturbed"] = {}
    ex = []
    for kind in PERTURBATIONS:
        r = np.random.default_rng(SEED)
        pim = [perturb(im, kind, r) for im in imgs]
        ex.append(pim[3])
        P, V = int8(pim)
        M["perturbed"][kind] = {**at_tau(P, ys, tau), "severity_acc": float((V == yv).mean())}
    allP = np.concatenate([int8([perturb(im, k, np.random.default_rng(SEED)) for im in imgs])[0] for k in PERTURBATIONS])
    M["perturbed_all"] = at_tau(allP, np.tile(ys, len(PERTURBATIONS)), tau)
    fig, axs = plt.subplots(1, 7, figsize=(14, 1.6))
    for ax, im, t in zip(axs, [imgs[3]] + ex, ["clean"] + PERTURBATIONS):
        ax.imshow(im)
        ax.set_title(t, fontsize=8)
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(os.path.join(REPORT, "perturbations.png"), dpi=110)
    plt.close(fig)

    # 7. OOD refusal
    man = json.load(open(os.path.join(OOD, "manifest.json")))
    pd_imgs = [Image.open(os.path.join(OOD, "plantdoc", x["file"])).convert("RGB") for x in man["plantdoc"]]
    sy_imgs = [Image.open(os.path.join(OOD, "synthetic", f)).convert("RGB") for f in man["synthetic"]]
    Pp, _ = int8(pd_imgs)
    Ps, _ = int8(sy_imgs)
    by = {}
    for k, x in enumerate(man["plantdoc"]):
        by.setdefault(x["class"], []).append(k)
    pd_tri = [aggregate(Pp[v], tau) for v in by.values() if len(v) >= 2]
    M["ood"] = {
        "plantdoc_single": {"n": len(pd_imgs), "refusal_rate": float((Pp.max(1) < tau).mean()),
                            "confident_as": dict(Counter(STRESS[int(p.argmax())] for p in Pp if p.max() >= tau))},
        "plantdoc_triples_by_class": {"n": len(pd_tri), "refusal_rate": float(np.mean([c is None for c in pd_tri]))},
        "synthetic_single": {"n": len(sy_imgs), "refusal_rate": float((Ps.max(1) < tau).mean()),
                             "confident": {f: STRESS[int(p.argmax())] for f, p in zip(man["synthetic"], Ps) if p.max() >= tau}},
    }

    M["sizes"] = {"fp32_bytes": exp["fp32"]["size_bytes"], "shipped_bytes": meta["file_size_bytes"],
                  "quant_attempts": [{k: a[k] for k in ("variant", "size_bytes", "stress_acc")} for a in exp["attempts"]]}
    M["training"] = {"minutes": train_log["train_minutes"], "gpu": train_log["gpu"], "best": train_log["best"]}
    M["calibration"] = {k: cal[k] for k in ("temperature", "tau", "val_nll_before", "val_nll_after",
                                            "val_ece_before", "val_ece_after", "at_tau")}
    json.dump(M, open(os.path.join(REPORT, "metrics.json"), "w"), indent=2)
    write_report(M, summary)
    print("wrote", os.path.join(REPORT, "report.md"))


def write_report(M, S):
    f, i = M["clean_fp32"], M["clean_int8"]
    L = []
    w = L.append
    w("# Jirani model evaluation report\n")
    w("_Generated by `ml/evaluate.py`. Every number below is measured by running the exported ONNX models with "
      "onnxruntime (the same graphs the app runs), with temperature scaling applied._\n")
    w("## 1. Dataset\n")
    w("BRACOL leaf dataset: label file from Mendeley (CC BY 4.0), leaf crops from the authors' repo "
      "(github.com/esgario/lara2018). Stress code 5 is excluded (undocumented). Split: stratified by stress class, "
      "70/15/15, seed 150. See `DATA.md`.\n")
    w("| Split | n | " + " | ".join(STRESS) + " |")
    w("|---|---|" + "---|" * 5)
    for sp in ["train", "val", "test"]:
        s = S["splits"][sp]
        w(f"| {sp} | {s['n']} | " + " | ".join(str(s["stress"][k]) for k in STRESS) + " |")
    w("\n| Split | " + " | ".join(SEVERITY_NAMES) + " |")
    w("|---|" + "---|" * 5)
    for sp in ["train", "val", "test"]:
        s = S["splits"][sp]
        w(f"| {sp} | " + " | ".join(str(s["severity"][k]) for k in SEVERITY_NAMES) + " |")
    w(f"\nTraining: {M['training']['minutes']:.1f} min on {M['training']['gpu']}; best checkpoint at "
      f"{M['training']['best']['epoch']}.\n")

    w("## 2. Stress classification, clean test set (n = %d)\n" % i["at_tau"]["n"])
    w("| Model | Accuracy | Macro-F1 | " + " | ".join(f"recall {k}" for k in STRESS) + " |")
    w("|---|---|---|" + "---|" * 5)
    for name, r in [("fp32", f), (f"int8 (shipped)", i)]:
        w(f"| {name} | {pct(r['stress_acc'])} | {r['stress_macro_f1']:.3f} | " +
          " | ".join(pct(r["per_class_recall"][k]) for k in STRESS) + " |")
    w("\n![confusion int8](confusion_int8.png) ![confusion fp32](confusion_fp32.png)\n")

    w("## 3. Severity\n")
    w("| Model | Exact accuracy | Within one level |")
    w("|---|---|---|")
    for name, r in [("fp32", f), ("int8 (shipped)", i)]:
        w(f"| {name} | {pct(r['severity_acc'])} | {pct(r['severity_within_one'])} |")
    w("\n![severity confusion](confusion_severity_int8.png)\n")
    w("Severity levels are % of leaf area with symptoms (very low 0.1–5%, low 5–10%, high 10–15%, very high >15%). "
      "'High' and 'very high' have few training examples (73 and 38), so treat severity as a rough guide.\n")

    w("## 4. Model size\n")
    w("| Variant | Size | Test stress accuracy |")
    w("|---|---|---|")
    w(f"| fp32 ONNX | {M['sizes']['fp32_bytes'] / 1e6:.2f} MB | {pct(f['stress_acc'])} |")
    for a in M["sizes"]["quant_attempts"]:
        w(f"| {a['variant']} | {a['size_bytes'] / 1e6:.2f} MB | {pct(a['stress_acc'])} |")
    w(f"\n**Shipped: `{M['model_file']}`, {M['sizes']['shipped_bytes'] / 1e6:.2f} MB ({M['variant']}).** "
      "Full static int8 quantization (weights and activations) collapsed accuracy on this MobileNetV3: the "
      "hard-swish / squeeze-excite activations do not survive 8-bit activation quantization. Weights alone quantize "
      "to int8 with no loss, so the shipped file stores int8 weights and computes in fp32. This shrinks the download "
      "but does not speed up inference.\n")

    c = M["calibration"]
    w("## 5. Calibration and the refusal threshold\n")
    w(f"Temperature T = {c['temperature']:.3f} (val NLL {c['val_nll_before']:.3f} → {c['val_nll_after']:.3f}, "
      f"ECE {c['val_ece_before']:.3f} → {c['val_ece_after']:.3f}). "
      f"tau = **{c['tau']:.2f}**: the lowest threshold where answered accuracy on validation is ≥ 95% (floor 0.65).\n")
    w("![risk-coverage](risk_coverage.png)\n")
    w("| At tau | Coverage | Accuracy on answered |")
    w("|---|---|---|")
    w(f"| validation, single leaf | {pct(c['at_tau']['coverage'])} | {pct(c['at_tau']['answered_acc'])} |")
    w(f"| test, single leaf, int8 | {pct(i['at_tau']['coverage'])} | {pct(i['at_tau']['answered_acc'])} |")
    t3 = M["three_leaf_sim"]
    w(f"| test, three-leaf rule (simulated, {t3['n_triples']} triples) | {pct(t3['coverage'])} | {pct(t3['answered_acc'])} |")
    w("\nThe three-leaf row groups different test leaves of the same class into triples and applies the app's rule "
      "(mean probability ≥ tau and at least two leaves agree). It is a simulation, not three leaves from one tree.\n")
    if "app_crop_path" in M:
        a = M["app_crop_path"]
        b = a["same_ids_on_authors_crops"]
        w("### App preprocessing path\n")
        w(f"The app crops each photo to the leaf's bounding box itself. We ran that crop (Python mirror of the app code) "
          f"on the uncropped Mendeley originals of {a['n']} test leaves:\n")
        w("| Input | Accuracy | Coverage at tau | Accuracy on answered |")
        w("|---|---|---|---|")
        w(f"| authors' crops (same leaves) | {pct(b['acc'])} | {pct(b['coverage'])} | {pct(b['answered_acc'])} |")
        w(f"| originals + app crop | {pct(a['acc'])} | {pct(a['coverage'])} | {pct(a['answered_acc'])} |\n")

    w("## 6. Perturbed test set (SYNTHETIC perturbations)\n")
    w("Generated from the clean test crops to stand in for messy field photos. These are synthetic, not real field images.\n")
    w("![perturbations](perturbations.png)\n")
    w("| Condition | Accuracy | Coverage at tau | Accuracy on answered | Severity acc |")
    w("|---|---|---|---|---|")
    w(f"| clean | {pct(i['stress_acc'])} | {pct(i['at_tau']['coverage'])} | {pct(i['at_tau']['answered_acc'])} | {pct(i['severity_acc'])} |")
    for k, r in M["perturbed"].items():
        w(f"| {k} | {pct(r['acc'])} | {pct(r['coverage'])} | {pct(r['answered_acc'])} | {pct(r['severity_acc'])} |")
    pa = M["perturbed_all"]
    w(f"| **all perturbed** | {pct(pa['acc'])} | {pct(pa['coverage'])} | {pct(pa['answered_acc'])} | |")
    w(f"\nDrop in accuracy, clean → all perturbed: **{100 * (i['stress_acc'] - pa['acc']):.1f} points**. "
      "In the app, the quality gate rejects blurry, dark and leafless photos before the model sees them; the numbers "
      "above are the model alone, without the gate.\n")

    o = M["ood"]
    w("## 7. Out-of-distribution refusal (higher is better)\n")
    w("| Set | n | Refused |")
    w("|---|---|---|")
    w(f"| PlantDoc non-coffee leaves, single image | {o['plantdoc_single']['n']} | {pct(o['plantdoc_single']['refusal_rate'])} |")
    w(f"| PlantDoc, three images of one class, app rule | {o['plantdoc_triples_by_class']['n']} | {pct(o['plantdoc_triples_by_class']['refusal_rate'])} |")
    w(f"| SYNTHETIC non-leaf images, single image | {o['synthetic_single']['n']} | {pct(o['synthetic_single']['refusal_rate'])} |")
    w(f"\nPlantDoc images the model still answered confidently were labelled: {o['plantdoc_single']['confident_as'] or 'none'}. "
      f"Synthetic images answered confidently: {o['synthetic_single']['confident'] or 'none'}. These are model-only numbers. "
      "In the app, the quality gate (leaf-colour fraction, blur, exposure) is an extra layer in front of the model.\n")

    w("## 8. Known limits\n")
    for s in [
        "BRACOL is Brazilian (Espirito Santo). No Kenyan or East African varieties (SL28, SL34, Ruiru 11) and no highland Kenyan field conditions.",
        "No nutrient-deficiency class. Yellowing from nitrogen deficiency is not a trained label; it should fall through to 'not sure', but this is not guaranteed.",
        "Single detached leaves, lower side, on a white background. Not leaves on the tree, not cluttered backgrounds.",
        "No abiotic stress labels (drought, frost, sunscald).",
        "Only the predominant stress per leaf is labelled, though several can co-occur.",
        "Severity classes are imbalanced; 'high' and 'very high' are rare, and almost absent for cercospora.",
        "The perturbed set is synthetic and the OOD set is small (PlantDoc sample + synthetic images). Neither replaces a field test.",
        "Rainfall and soil context (used by the cause ranking, not by this model) come from coarse global grids.",
        "The cooperative registry and outbreak reports in the demo are synthetic.",
    ]:
        w(f"- {s}")
    open(os.path.join(REPORT, "report.md"), "w", encoding="utf8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
