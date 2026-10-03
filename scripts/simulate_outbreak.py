"""SYNTHETIC demo support: post a few rust reports from plots neighbouring the demo plot.

Posts reports from (min_plots - 1) neighbours within 2 km of OND-0017, so that ONE real report from the
phone (OND-0017, rust, severity >= 2) tips the cluster over the threshold and a draft alert appears.
Every packet is flagged synthetic=true and shows as SYNTHETIC on the dashboard.

Usage: python scripts/simulate_outbreak.py [--server http://localhost:8000] [--stress rust] [--all]
  --all  also post the demo plot's report itself (to test without a phone)
"""
import argparse
import json
import math
import os
import uuid
from datetime import datetime, timedelta, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO_PLOT = "OND-0017"
N_NEIGHBOURS = 2  # min_plots (3) - 1: the phone's report is the third


def km(a, b):
    r = 6371.0088
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    return 2 * r * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default=os.environ.get("JIRANI_SERVER", "http://localhost:8000"))
    ap.add_argument("--stress", default="rust")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    plots = json.load(open(os.path.join(ROOT, "server", "seed_plots.json")))["plots"]
    demo = next(p for p in plots if p["plot_id"] == DEMO_PLOT)
    near = sorted((p for p in plots if p["plot_id"] != DEMO_PLOT), key=lambda p: km(demo, p))
    near = [p for p in near if km(demo, p) <= 1.8][:N_NEIGHBOURS]
    now = datetime.now(timezone.utc)
    packets = []
    for k, p in enumerate(near):
        packets.append({"id": f"sim-{uuid.uuid4()}", "plotId": p["plot_id"], "block": p["blocks"][0],
                        "stress": a.stress, "severity": 2 + k % 2, "trend": "worse", "confidence": 0.9,
                        "takenAt": (now - timedelta(days=2 + k)).isoformat().replace("+00:00", "Z"),
                        "modelVersion": "SYNTHETIC", "synthetic": True})
        print(f"SYNTHETIC report: {p['plot_id']} ({km(demo, p):.2f} km from {DEMO_PLOT}) {a.stress} sev {2 + k % 2}")
    if a.all:
        packets.append({"id": f"sim-{uuid.uuid4()}", "plotId": DEMO_PLOT, "block": "B", "stress": a.stress,
                        "severity": 3, "trend": "worse", "confidence": 0.93,
                        "takenAt": now.isoformat().replace("+00:00", "Z"), "modelVersion": "SYNTHETIC",
                        "synthetic": True})
        print(f"SYNTHETIC report: {DEMO_PLOT} (stands in for the phone)")
    r = requests.post(f"{a.server.rstrip('/')}/api/reports", json=packets, timeout=30)
    r.raise_for_status()
    print(r.json())


if __name__ == "__main__":
    main()
