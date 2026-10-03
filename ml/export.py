"""Export to ONNX (stress_logits, severity_logits, features), quantize to int8, check parity.

Writes into app/public/model/:
  model.int8.onnx (or the fallback that passed parity), model_meta.json, stress_head.json
and ml/report/export.json with sizes and fp32-vs-int8 test accuracy.

Quantization: onnxruntime static quantization (QDQ), calibrated on 200 training images.
If int8 stress accuracy drops more than 3 points vs fp32, try per-channel, then per-channel with the
heads excluded, then int8 weight-only (fp32 activations); if still bad, ship fp32 and say so.
All attempts are recorded in ml/report/export.json.

Usage: python ml/export.py
"""
import json
import os
import shutil

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import (CalibrationDataReader, QuantFormat, QuantType, quantize_static)
from onnxruntime.quantization.shape_inference import quant_pre_process

from common import (HERE, MEAN, REPORT, SEVERITY, SIZE, STD, STRESS, LeafDataset, eval_transform, load_model,
                    read_split)

APP_MODEL = os.path.join(HERE, "..", "app", "public", "model")
WORK = os.path.join(HERE, "checkpoints", "onnx")
VERSION = "0.1.0"
MAX_DROP = 0.03


class Reader(CalibrationDataReader):
    def __init__(self, items):
        ds = LeafDataset(items, eval_transform())
        self.data = iter([{"input": ds[i][0].unsqueeze(0).numpy()} for i in range(len(ds))])

    def get_next(self):
        return next(self.data, None)


def export_fp32(path):
    model = load_model()
    x = torch.randn(1, 3, SIZE, SIZE)
    torch.onnx.export(model, x, path, input_names=["input"],
                      output_names=["stress_logits", "severity_logits", "features"],
                      opset_version=17, dynamo=False)
    onnx.checker.check_model(onnx.load(path))
    return model


def test_arrays():
    ds = LeafDataset(read_split("test"), eval_transform())
    xs = np.stack([ds[i][0].numpy() for i in range(len(ds))])
    ys = np.array([s for _, s, _ in ds.items])
    yv = np.array([v for _, _, v in ds.items])
    return xs, ys, yv


def run_onnx(path, xs):
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    out = [sess.run(None, {"input": xs[i:i + 1]}) for i in range(len(xs))]
    return (np.concatenate([o[0] for o in out]), np.concatenate([o[1] for o in out]),
            np.concatenate([o[2] for o in out]))


def weight_only_int8(src, dst):
    """Store Conv/Gemm weights as per-output-channel symmetric int8 + DequantizeLinear (opset 13+).

    Activations stay fp32. Static int8 activation quantization collapses this MobileNetV3
    (hard-swish / squeeze-excite ranges), but int8 weights alone are near-lossless.
    """
    from onnx import helper, numpy_helper
    m = onnx.load(src)
    inits = {i.name: i for i in m.graph.initializer}
    new_nodes, drop = [], set()
    for n in m.graph.node:
        if n.op_type not in ("Conv", "Gemm") or n.input[1] not in inits:
            continue
        name = n.input[1]
        w = numpy_helper.to_array(inits[name]).astype(np.float32)
        axis = 0
        if n.op_type == "Gemm":
            trans_b = next((a.i for a in n.attribute if a.name == "transB"), 0)
            axis = 0 if trans_b else 1
        red = tuple(i for i in range(w.ndim) if i != axis)
        scale = np.abs(w).max(axis=red) / 127.0
        scale[scale == 0] = 1.0
        shape = [1] * w.ndim
        shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        m.graph.initializer.extend([numpy_helper.from_array(q, name + "_q"),
                                    numpy_helper.from_array(scale.astype(np.float32), name + "_scale"),
                                    numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + "_zp")])
        new_nodes.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_scale", name + "_zp"],
                                          [name], name=name + "_dq", axis=axis))
        drop.add(name)
    keep = [i for i in m.graph.initializer if i.name not in drop]
    del m.graph.initializer[:]
    m.graph.initializer.extend(keep)
    nodes = new_nodes + list(m.graph.node)
    del m.graph.node[:]
    m.graph.node.extend(nodes)
    onnx.checker.check_model(m)
    onnx.save(m, dst)


def head_nodes(path):
    m = onnx.load(path)
    return [n.name for n in m.graph.node if n.op_type in ("Gemm", "MatMul")]


def main():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(APP_MODEL, exist_ok=True)
    fp32 = os.path.join(WORK, "model.fp32.onnx")
    pre = os.path.join(WORK, "model.pre.onnx")
    model = export_fp32(fp32)
    quant_pre_process(fp32, pre, skip_symbolic_shape=True)

    xs, ys, yv = test_arrays()
    with torch.no_grad():
        ts, tv, tf = model(torch.from_numpy(xs))
    f_s, f_v, f_f = run_onnx(fp32, xs)
    print("torch vs onnx fp32 max abs diff (stress logits):", float(np.abs(f_s - ts.numpy()).max()))
    fp32_acc = float((f_s.argmax(1) == ys).mean())
    fp32_sev = float((f_v.argmax(1) == yv).mean())

    calib = read_split("train")
    rng = np.random.default_rng(150)
    calib = [calib[i] for i in rng.choice(len(calib), 200, replace=False)]

    attempts = [
        ("int8 per-tensor", dict(per_channel=False, nodes_to_exclude=[])),
        ("int8 per-channel", dict(per_channel=True, nodes_to_exclude=[])),
        ("int8 per-channel, heads fp32", dict(per_channel=True, nodes_to_exclude=head_nodes(pre))),
        ("int8 weight-only per-channel, fp32 activations", None),
    ]
    tried, chosen = [], None
    for name, kw in attempts:
        out = os.path.join(WORK, f"model.{len(tried)}.int8.onnx")
        if kw is None:
            weight_only_int8(fp32, out)
        else:
            quantize_static(pre, out, Reader(calib), quant_format=QuantFormat.QDQ, activation_type=QuantType.QUInt8,
                            weight_type=QuantType.QInt8, **kw)
        q_s, q_v, q_f = run_onnx(out, xs)
        acc = float((q_s.argmax(1) == ys).mean())
        r = {"variant": name, "path": out, "size_bytes": os.path.getsize(out), "stress_acc": acc,
             "severity_acc": float((q_v.argmax(1) == yv).mean()),
             "argmax_agreement_with_fp32": float((q_s.argmax(1) == f_s.argmax(1)).mean()),
             "feature_corr_with_fp32": float(np.corrcoef(q_f.ravel(), f_f.ravel())[0, 1])}
        tried.append(r)
        print(f"{name}: {r['size_bytes'] / 1e6:.2f} MB | stress acc {acc:.4f} (fp32 {fp32_acc:.4f}) | "
              f"agree {r['argmax_agreement_with_fp32']:.3f} | feature corr {r['feature_corr_with_fp32']:.4f}")
        if fp32_acc - acc <= MAX_DROP:
            chosen = r
            break

    if chosen is None:
        print("All int8 variants dropped more than 3 points; shipping fp32.")
        chosen = {"variant": "fp32 (int8 failed parity)", "path": fp32, "size_bytes": os.path.getsize(fp32),
                  "stress_acc": fp32_acc, "severity_acc": fp32_sev}
        ship_name = "model.fp32.onnx"
    else:
        ship_name = "model.int8.onnx"
    for f in os.listdir(APP_MODEL):
        if f.endswith(".onnx"):
            os.remove(os.path.join(APP_MODEL, f))
    shutil.copy(chosen["path"], os.path.join(APP_MODEL, ship_name))

    cal = json.load(open(os.path.join(REPORT, "calibration.json")))
    w = model.stress_head.weight.detach().numpy()
    b = model.stress_head.bias.detach().numpy()
    json.dump({"classes": STRESS, "shape": list(w.shape), "weight": np.round(w, 6).tolist(),
               "bias": np.round(b, 6).tolist()}, open(os.path.join(APP_MODEL, "stress_head.json"), "w"))
    meta = {
        "version": VERSION, "model_file": ship_name, "variant": chosen["variant"],
        "input_size": SIZE, "mean": MEAN, "std": STD,
        "preprocess": "crop to leaf bounding box, squash-resize to 224x224, RGB/255, normalise",
        "stress_classes": STRESS, "severity_levels": SEVERITY,
        "temperature": round(cal["temperature"], 4), "tau": cal["tau"],
        "stress_head_weights": "stress_head.json", "features_shape": list(f_f.shape[1:]),
        "trained_on": "BRACOL (leaf crops, github.com/esgario/lara2018)",
        "file_size_bytes": os.path.getsize(os.path.join(APP_MODEL, ship_name)),
    }
    json.dump(meta, open(os.path.join(APP_MODEL, "model_meta.json"), "w"), indent=2)
    json.dump({"fp32": {"size_bytes": os.path.getsize(fp32), "stress_acc": fp32_acc, "severity_acc": fp32_sev},
               "attempts": tried, "shipped": {**chosen, "file": ship_name}},
              open(os.path.join(REPORT, "export.json"), "w"), indent=2)
    print(f"shipped {ship_name}: {meta['file_size_bytes'] / 1e6:.2f} MB ({chosen['variant']})")


if __name__ == "__main__":
    main()
