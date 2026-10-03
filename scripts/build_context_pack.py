"""Build the per-plot context pack (weather + soil) used OFFLINE by the cause ranking (F4).

Runs online, once per plot at cooperative setup / sync time. Writes app/public/context/<plotId>.json.

Sources:
- NASA POWER daily point API (community AG): PRECTOTCORR (mm/day), T2M (C), RH2M (%). Fill value -999.
  Recent days are published with a lag, so windows end on the last day with complete data.
  "Normal" = mean of the same 30 / 90-day calendar windows over the previous NORMAL_YEARS years.
  POWER is a ~0.5 x 0.625 degree grid, so nearby plots share values; responses are cached per grid cell.
- ISRIC SoilGrids v2.0 REST: phh2o, depth 0-5cm, mean. Returned as pH*10 (d_factor 10). Fair-use rate limit,
  so calls are throttled and cached per plot. If SoilGrids is unavailable, soil_ph is null.

Raw responses are cached under scripts/cache/ so the build (and the demo) does not depend on the APIs being up.
Plot coordinates are the SYNTHETIC demo registry, so the pack is real data for a synthetic location.

Usage: python scripts/build_context_pack.py [--plots OND-0017,...] [--refresh]
"""
import argparse
import json
import math
import os
import time
from datetime import date, datetime, timedelta, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = os.path.join(ROOT, "server", "seed_plots.json")
OUT = os.path.join(ROOT, "app", "public", "context")
CACHE = os.path.join(ROOT, "scripts", "cache")
POWER = ("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M,RH2M&community=AG"
         "&longitude={lon}&latitude={lat}&start={start}&end={end}&format=JSON")
SOIL = "https://rest.isric.org/soilgrids/v2.0/properties/query?lon={lon}&lat={lat}&property=phh2o&depth=0-5cm&value=mean"
NORMAL_YEARS = 10
SOIL_MIN_INTERVAL_S = 12.5  # stay under ~5 requests/minute
FILL = -999.0


def cached_get(url, path, refresh, timeout=120):
    if os.path.exists(path) and not refresh:
        return json.load(open(path, encoding="utf8"))
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(data, open(path, "w", encoding="utf8"))
    return data


def power_cell(lat, lon):
    return math.floor(lat / 0.5), math.floor(lon / 0.625)


def fetch_power(lat, lon, refresh):
    today = date.today()
    start = date(today.year - NORMAL_YEARS - 1, 1, 1)
    cell = power_cell(lat, lon)
    path = os.path.join(CACHE, f"power_{cell[0]}_{cell[1]}_{start:%Y%m%d}_{today:%Y%m%d}.json")
    d = cached_get(POWER.format(lat=lat, lon=lon, start=f"{start:%Y%m%d}", end=f"{today:%Y%m%d}"), path, refresh)
    p = d["properties"]["parameter"]
    days = {}
    for k in ("PRECTOTCORR", "T2M", "RH2M"):
        for ds, v in p[k].items():
            days.setdefault(ds, {})[k] = None if v is None or v <= FILL + 1 else float(v)
    return {datetime.strptime(ds, "%Y%m%d").date(): v for ds, v in days.items()}, path


def window(series, end, n, key):
    vals = [series.get(end - timedelta(days=i), {}).get(key) for i in range(n)]
    return None if any(v is None for v in vals) else vals


def weather(series):
    complete = [d for d, v in series.items() if all(v.get(k) is not None for k in ("PRECTOTCORR", "T2M", "RH2M"))]
    end = max(complete)
    out = {"data_end": end.isoformat()}
    for n in (30, 90):
        cur = window(series, end, n, "PRECTOTCORR")
        normals = []
        for y in range(1, NORMAL_YEARS + 1):
            try:
                e = end.replace(year=end.year - y)
            except ValueError:  # 29 Feb
                e = end.replace(year=end.year - y, day=28)
            w = window(series, e, n, "PRECTOTCORR")
            if w:
                normals.append(sum(w))
        out[f"rain_{n}d_mm"] = round(sum(cur), 1) if cur else None
        out[f"rain_{n}d_normal_mm"] = round(sum(normals) / len(normals), 1) if normals else None
        out[f"normal_years_{n}d"] = len(normals)
    t = window(series, end, 30, "T2M")
    rh = window(series, end, 30, "RH2M")
    out["temp_mean_30d_c"] = round(sum(t) / 30, 1) if t else None
    out["rh_mean_30d_pct"] = round(sum(rh) / 30, 1) if rh else None
    return out


_last_soil = [0.0]


def fetch_soil_ph(lat, lon, refresh):
    path = os.path.join(CACHE, f"soil_{lat:.5f}_{lon:.5f}.json")
    try:
        if refresh or not os.path.exists(path):
            wait = SOIL_MIN_INTERVAL_S - (time.time() - _last_soil[0])
            if wait > 0:
                time.sleep(wait)
            _last_soil[0] = time.time()
        d = cached_get(SOIL.format(lat=lat, lon=lon), path, refresh, timeout=60)
        layer = d["properties"]["layers"][0]
        mean = layer["depths"][0]["values"]["mean"]
        return (None if mean is None else round(mean / layer["unit_measure"]["d_factor"], 1)), path
    except Exception as e:
        print(f"  SoilGrids unavailable for {lat},{lon}: {type(e).__name__}: {e}")
        return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plots", help="comma-separated plot ids (default: all)")
    ap.add_argument("--refresh", action="store_true", help="ignore cached API responses")
    a = ap.parse_args()
    plots = json.load(open(REGISTRY, encoding="utf8"))["plots"]
    if a.plots:
        want = set(a.plots.split(","))
        plots = [p for p in plots if p["plot_id"] in want]
    os.makedirs(OUT, exist_ok=True)
    built = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    wcache = {}
    for p in plots:
        cell = power_cell(p["lat"], p["lon"])
        if cell not in wcache:
            series, _ = fetch_power(p["lat"], p["lon"], a.refresh)
            wcache[cell] = weather(series)
        w = wcache[cell]
        ph, _ = fetch_soil_ph(p["lat"], p["lon"], a.refresh)
        pack = {
            "plotId": p["plot_id"],
            "builtAt": built,
            "source": {"weather": "NASA POWER daily point API (community AG), PRECTOTCORR / T2M / RH2M",
                       "soil": "ISRIC SoilGrids v2.0, phh2o 0-5cm mean"},
            "rain_30d_mm": w["rain_30d_mm"], "rain_30d_normal_mm": w["rain_30d_normal_mm"],
            "rain_90d_mm": w["rain_90d_mm"], "rain_90d_normal_mm": w["rain_90d_normal_mm"],
            "temp_mean_30d_c": w["temp_mean_30d_c"], "rh_mean_30d_pct": w["rh_mean_30d_pct"],
            "soil_ph": ph,
            "weather_data_end": w["data_end"],
            "normal": f"mean of the same calendar window over the previous {w['normal_years_90d']} years",
            "synthetic_location": True,
            "caveat": "Coarse global grid estimates, not measurements from this plot. Plot location is synthetic.",
        }
        json.dump(pack, open(os.path.join(OUT, f"{p['plot_id']}.json"), "w", encoding="utf8"), indent=1)
        print(f"{p['plot_id']}: rain 30d {pack['rain_30d_mm']} (normal {pack['rain_30d_normal_mm']}) | "
              f"90d {pack['rain_90d_mm']} (normal {pack['rain_90d_normal_mm']}) | T {pack['temp_mean_30d_c']} C | "
              f"RH {pack['rh_mean_30d_pct']}% | pH {ph}", flush=True)


if __name__ == "__main__":
    main()
