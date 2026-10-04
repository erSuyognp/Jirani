"""SYNTHETIC cooperative registry for the demo. Not real farms. The AREA is real, the plot points are not.

Writes:
  server/seed_plots.json           -> loaded into SQLite by server/main.py on first start
  app/public/content/plots.json    -> cached plot list for the app's setup screen

Both files also carry the SYNTHETIC buyer tickets of the fictional factory (what buyers paid per cherry band).
The app shows the last three tickets of a band as a range next to the cherry band on the card. They are made-up
demo numbers, not market prices, and never a price offer.

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

# SYNTHETIC buyer tickets (date, cherry band, price). Hand-written demo values, not market data.
TICKET_UNIT = "USD/50kg"
BUYER_TICKETS = [
    ("2026-08-22", "A", 355), ("2026-08-22", "B", 310), ("2026-08-22", "C", 255),
    ("2026-09-05", "A", 390), ("2026-09-05", "B", 340), ("2026-09-05", "C", 285),
    ("2026-09-19", "A", 370), ("2026-09-19", "B", 325), ("2026-09-19", "C", 270),
]


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
           "cooperative": "Ondera Coffee Cooperative (fictional)",
           "buyer_tickets": {
               "synthetic": True,
               "note": "SYNTHETIC buyer tickets of the fictional Ondera factory. Demo numbers, not market prices.",
               "factory": "Ondera factory (fictional)", "unit": TICKET_UNIT,
               "tickets": [{"id": f"BT-{i:04d}", "date": d, "band": b, "price": p}
                           for i, (d, b, p) in enumerate(BUYER_TICKETS, 1)]},
           "plots": plots}
    for path in [os.path.join(ROOT, "server", "seed_plots.json"),
                 os.path.join(ROOT, "app", "public", "content", "plots.json")]:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(doc, open(path, "w"), indent=1)
    print(f"wrote {len(plots)} SYNTHETIC plots and {len(BUYER_TICKETS)} SYNTHETIC buyer tickets; "
          f"demo plot {DEMO_PLOT} at {CENTRE}")


if __name__ == "__main__":
    main()
