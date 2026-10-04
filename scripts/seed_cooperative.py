"""SYNTHETIC cooperative registry for the demo. Not real farms. The AREA is real, the plot points are not.

Writes:
  server/seed_plots.json           -> loaded into SQLite by server/main.py on first start
  app/public/content/plots.json    -> cached plot list for the app's setup screen

40 plots of the fictional "Ondera Coffee Cooperative", scattered at random within ~3 km of a centre in a real
smallholder coffee-growing area: the Aberdare slopes south of Nyeri town (near Wamagana, Tetu Subcounty), Nyeri
County, Kenya. OpenStreetMap maps a smallholder coffee factory (wet mill) about 0.5 km from the centre, which is
how the area was chosen (sources in DATA.md). The points are random; they are not snapped to real field boundaries
and do not stand for any real farm or cooperative.
Location = the cooperative's registry centroid, never device GPS.

Usage: python scripts/seed_cooperative.py
"""
import json
import math
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENTRE = (-0.4920, 36.9480)  # real coffee-growing area near Wamagana, Nyeri County; the plots around it are SYNTHETIC
AREA = "Coffee-growing area near Wamagana, Nyeri County, Kenya"
N = 40
DEMO_PLOT = "OND-0017"


def offset(lat, lon, km_n, km_e):
    return lat + km_n / 110.574, lon + km_e / (111.320 * math.cos(math.radians(lat)))


def main():
    rng = random.Random(150)
    plots = []
    for i in range(1, N + 1):
        pid = f"OND-{i:04d}"
        if pid == DEMO_PLOT:
            lat, lon = CENTRE
            blocks = ["A", "B", "C"]
        else:
            r = 3.0 * math.sqrt(rng.random())
            a = rng.random() * 2 * math.pi
            lat, lon = offset(*CENTRE, r * math.cos(a), r * math.sin(a))
            blocks = ["A", "B", "C", "D"][: rng.randint(2, 4)]
        plots.append({"plot_id": pid, "lat": round(lat, 5), "lon": round(lon, 5), "blocks": blocks})
    doc = {"synthetic": True,
           "note": "SYNTHETIC demo registry. Fictional Ondera Coffee Cooperative. Random points in a real coffee-growing "
                   "area; not real farms.",
           "area": AREA,
           "cooperative": "Ondera Coffee Cooperative (fictional)", "plots": plots}
    for path in [os.path.join(ROOT, "server", "seed_plots.json"),
                 os.path.join(ROOT, "app", "public", "content", "plots.json")]:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(doc, open(path, "w"), indent=1)
    print(f"wrote {len(plots)} SYNTHETIC plots; demo plot {DEMO_PLOT} at {CENTRE}")


if __name__ == "__main__":
    main()
