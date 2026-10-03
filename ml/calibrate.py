"""Temperature scaling for the stress head + refusal threshold tau from the risk-coverage curve.

- Fit one temperature T on validation stress logits (minimise NLL).
- For tau in 0.30..0.95: coverage = share of val samples with max calibrated prob >= tau,
  answered accuracy = accuracy on those samples.
- tau = lowest threshold with answered accuracy >= 95%, floor 0.65.
  If no threshold reaches 95%, use the highest threshold and say so.

Note: tau is chosen on single-leaf probabilities. The app applies it to the mean of three leaves
and additionally requires two leaves to agree, which is stricter.

Usage: python ml/calibrate.py
"""
import json
import os

import numpy as np
import torch

from common import REPORT, LeafDataset, eval_transform, load_model, predict_logits, read_split

TARGET_ACC = 0.95
TAU_FLOOR = 0.65
TAUS = np.round(np.arange(0.30, 0.951, 0.01), 2)


def fit_temperature(logits, labels):
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(logits / log_t.exp(), labels)
        loss.backward()
        return loss

    opt.step(closure)
    return float(log_t.detach().exp())


def nll(logits, labels, t):
    return float(torch.nn.functional.cross_entropy(logits / t, labels))


def ece(probs, labels, bins=10):
    conf, pred = probs.max(1)
    edges = torch.linspace(0, 1, bins + 1)
    e = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.float().mean() * abs((pred[m] == labels[m]).float().mean() - conf[m].mean())
    return float(e)


def risk_coverage(probs, labels):
    conf, pred = probs.max(1)
    rows = []
    for tau in TAUS:
        m = conf >= tau
        cov = float(m.float().mean())
        acc = float((pred[m] == labels[m]).float().mean()) if m.any() else float("nan")
        rows.append({"tau": float(tau), "coverage": cov, "answered_acc": acc, "n_answered": int(m.sum())})
    return rows


def choose_tau(rows):
    ok = [r for r in rows if r["n_answered"] > 0 and r["answered_acc"] >= TARGET_ACC]
    if not ok:
        return float(TAUS[-1]), "no threshold reached the target; using the highest"
    tau = max(ok[0]["tau"], TAU_FLOOR)
    note = "lowest threshold reaching the target" if ok[0]["tau"] >= TAU_FLOOR else "target met below floor; floor applied"
    return float(tau), note


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = load_model(device=device)
    loader = torch.utils.data.DataLoader(LeafDataset(read_split("val"), eval_transform()), batch_size=64)
    ls, _, ys, _ = predict_logits(model, loader, device)

    t = fit_temperature(ls, ys)
    probs = torch.softmax(ls / t, 1)
    rows = risk_coverage(probs, ys)
    tau, note = choose_tau(rows)
    at = next(r for r in rows if abs(r["tau"] - tau) < 1e-6)
    out = {
        "temperature": t, "tau": tau, "tau_rule": f"lowest tau with val answered acc >= {TARGET_ACC}, floor {TAU_FLOOR}",
        "tau_note": note, "val_n": len(ys),
        "val_nll_before": nll(ls, ys, 1.0), "val_nll_after": nll(ls, ys, t),
        "val_ece_before": ece(torch.softmax(ls, 1), ys), "val_ece_after": ece(probs, ys),
        "val_acc": float((probs.argmax(1) == ys).float().mean()),
        "at_tau": at, "risk_coverage_val": rows,
    }
    # Test-set headline for the M1 check (full numbers come from evaluate.py).
    tl = torch.utils.data.DataLoader(LeafDataset(read_split("test"), eval_transform()), batch_size=64)
    tls, tlv, tys, tyv = predict_logits(model, tl, device)
    tp = torch.softmax(tls / t, 1)
    tm = tp.max(1).values >= tau
    out["test"] = {"n": len(tys), "stress_acc": float((tp.argmax(1) == tys).float().mean()),
                   "severity_acc": float((tlv.argmax(1) == tyv).float().mean()),
                   "coverage_at_tau": float(tm.float().mean()),
                   "answered_acc_at_tau": float((tp.argmax(1)[tm] == tys[tm]).float().mean())}
    os.makedirs(REPORT, exist_ok=True)
    json.dump(out, open(os.path.join(REPORT, "calibration.json"), "w"), indent=2)
    print(f"T = {t:.3f} | val NLL {out['val_nll_before']:.3f} -> {out['val_nll_after']:.3f} | "
          f"ECE {out['val_ece_before']:.3f} -> {out['val_ece_after']:.3f}")
    print(f"tau = {tau:.2f} ({note}) | val coverage {at['coverage']:.3f}, answered acc {at['answered_acc']:.3f}")
    te = out["test"]
    print(f"TEST (n={te['n']}): stress acc {te['stress_acc']:.3f} | severity acc {te['severity_acc']:.3f} | "
          f"at tau: coverage {te['coverage_at_tau']:.3f}, answered acc {te['answered_acc_at_tau']:.3f}")


if __name__ == "__main__":
    main()
