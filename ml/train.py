"""Multi-task training: stress (5 classes) + 0.5 x severity (5 levels).

Phase 1: frozen backbone, heads only. Phase 2: fine-tune everything at a lower LR.
Early stopping on validation stress accuracy (ties broken by validation loss).

Usage: python ml/train.py [--epochs1 5] [--epochs2 40]
"""
import argparse
import json
import os
import time
from collections import Counter

import torch
import torch.nn as nn

from common import (CKPT_DIR, REPORT, STRESS, JiraniNet, LeafDataset, eval_transform, predict_logits,
                    read_split, seed_all, train_transform)


def class_weights(labels, n):
    c = Counter(labels)
    w = torch.tensor([len(labels) / (n * c[k]) if c[k] else 0.0 for k in range(n)])
    return w


def evaluate(model, loader, device, crit_s, crit_v):
    model.eval()
    ls, lv, ys, yv = predict_logits(model, loader, device)
    f = nn.functional.cross_entropy
    loss = (f(ls, ys, weight=crit_s.weight.cpu()) + 0.5 * f(lv, yv, weight=crit_v.weight.cpu())).item()
    return (ls.argmax(1) == ys).float().mean().item(), (lv.argmax(1) == yv).float().mean().item(), loss


def run_phase(name, model, params, lr, epochs, patience, loaders, crits, device, state, log):
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    crit_s, crit_v = crits
    bad = 0
    for ep in range(epochs):
        model.train()
        t0, tot, n = time.time(), 0.0, 0
        for x, s, v in loaders["train"]:
            x, s, v = x.to(device), s.to(device), v.to(device)
            ls, lv, _ = model(x)
            loss = crit_s(ls, s) + 0.5 * crit_v(lv, v)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item() * len(x)
            n += len(x)
        sched.step()
        acc_s, acc_v, vloss = evaluate(model, loaders["val"], device, crit_s, crit_v)
        row = {"phase": name, "epoch": ep + 1, "train_loss": tot / n, "val_loss": vloss,
               "val_stress_acc": acc_s, "val_sev_acc": acc_v, "sec": time.time() - t0}
        log.append(row)
        better = (acc_s, -vloss) > (state["best_acc"], -state["best_loss"])
        if better:
            state.update(best_acc=acc_s, best_loss=vloss, epoch=f"{name}:{ep + 1}")
            torch.save({"model": model.state_dict(), "epoch": state["epoch"], "val_stress_acc": acc_s},
                       os.path.join(CKPT_DIR, "best.pt"))
            bad = 0
        else:
            bad += 1
        print(f"{name} ep{ep + 1:02d} loss {tot / n:.3f} | val loss {vloss:.3f} stress {acc_s:.3f} "
              f"sev {acc_v:.3f} | {row['sec']:.0f}s {'*' if better else ''}", flush=True)
        if bad >= patience:
            print(f"early stop in {name}")
            break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs1", type=int, default=5)
    ap.add_argument("--epochs2", type=int, default=40)
    ap.add_argument("--patience", type=int, default=10)
    ap.add_argument("--batch", type=int, default=32)
    args = ap.parse_args()

    seed_all()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", device, torch.cuda.get_device_name(0) if device == "cuda" else "")
    os.makedirs(CKPT_DIR, exist_ok=True)
    os.makedirs(REPORT, exist_ok=True)

    train_items, val_items = read_split("train"), read_split("val")
    g = torch.Generator().manual_seed(150)
    loaders = {
        "train": torch.utils.data.DataLoader(LeafDataset(train_items, train_transform()), batch_size=args.batch,
                                             shuffle=True, generator=g, num_workers=0, drop_last=True),
        "val": torch.utils.data.DataLoader(LeafDataset(val_items, eval_transform()), batch_size=64),
    }
    ws = class_weights([s for _, s, _ in train_items], len(STRESS))
    wv = class_weights([v for _, _, v in train_items], 5)
    print("stress class weights", [round(x, 2) for x in ws.tolist()], "| severity", [round(x, 2) for x in wv.tolist()])
    crits = (nn.CrossEntropyLoss(weight=ws).to(device), nn.CrossEntropyLoss(weight=wv).to(device))

    model = JiraniNet().to(device)
    state = {"best_acc": -1.0, "best_loss": 1e9, "epoch": None}
    log = []
    t0 = time.time()
    for p in model.features.parameters():
        p.requires_grad = False
    heads = list(model.stress_head.parameters()) + list(model.severity_head.parameters())
    run_phase("frozen", model, heads, 1e-3, args.epochs1, args.epochs1, loaders, crits, device, state, log)
    for p in model.features.parameters():
        p.requires_grad = True
    run_phase("finetune", model, model.parameters(), 3e-4, args.epochs2, args.patience, loaders, crits, device,
              state, log)
    total = time.time() - t0
    print(f"best val stress acc {state['best_acc']:.4f} at {state['epoch']} | total {total / 60:.1f} min")
    json.dump({"device": device, "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None,
               "args": vars(args), "best": state, "train_minutes": total / 60,
               "class_weights_stress": ws.tolist(), "class_weights_severity": wv.tolist(), "log": log},
              open(os.path.join(REPORT, "train_log.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
