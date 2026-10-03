"""Outbreak detection. DRAFT rule, values in config.OUTBREAK. Creates DRAFT alerts only; a person approves.

For each stress: take confident reports with severity >= min_severity in the last window_days. If at least
min_plots distinct plots lie within cluster_radius_km of one anchor plot, that is a cluster. An open alert
(draft or approved) for the same stress within dedupe_radius_km is updated (if still draft) instead of duplicated.
"""
import json
import math
from datetime import datetime, timedelta, timezone

from config import OUTBREAK
from models import now_iso


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    r = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def window_start(now=None, cfg=OUTBREAK):
    now = now or datetime.now(timezone.utc)
    return now - timedelta(days=cfg["window_days"])


def recent_reports(con, stress, now=None, cfg=OUTBREAK):
    start = window_start(now, cfg)
    rows = con.execute(
        """SELECT r.*, p.lat, p.lon FROM reports r JOIN plots p ON p.plot_id = r.plot_id
           WHERE r.stress = ? AND r.severity >= ?""", (stress, cfg["min_severity"])).fetchall()
    return [dict(r) for r in rows if parse_ts(r["taken_at"]) >= start]


def find_cluster(reports, cfg=OUTBREAK):
    """Largest set of distinct plots within cluster_radius_km of a single anchor plot, or None."""
    plots = {}
    for r in reports:
        plots.setdefault(r["plot_id"], (r["lat"], r["lon"]))
    best = None
    for pid, (lat, lon) in sorted(plots.items()):
        members = sorted(q for q, (qa, qo) in plots.items() if haversine_km(lat, lon, qa, qo) <= cfg["cluster_radius_km"])
        if len(members) >= cfg["min_plots"] and (best is None or len(members) > len(best)):
            best = members
    if not best:
        return None
    lat = sum(plots[p][0] for p in best) / len(best)
    lon = sum(plots[p][1] for p in best) / len(best)
    ids = sorted(r["id"] for r in reports if r["plot_id"] in best)
    return {"plots": best, "centre": (lat, lon), "report_ids": ids}


def detect(con, now=None, cfg=OUTBREAK):
    """Run detection for every stress. Returns list of (alert_id, 'created'|'updated'|'unchanged')."""
    out = []
    for stress in cfg["stresses"]:
        c = find_cluster(recent_reports(con, stress, now, cfg), cfg)
        if not c:
            continue
        lat, lon = c["centre"]
        existing = None
        for a in con.execute("SELECT * FROM alerts WHERE stress = ? AND status IN ('draft','approved')", (stress,)):
            if haversine_km(lat, lon, a["centre_lat"], a["centre_lon"]) <= cfg["dedupe_radius_km"] \
                    and parse_ts(a["created_at"]) >= window_start(now, cfg):
                existing = a
                break
        if existing is None:
            cur = con.execute(
                """INSERT INTO alerts (stress, created_at, centre_lat, centre_lon, radius_km, report_ids_json, status)
                   VALUES (?,?,?,?,?,?,'draft')""",
                (stress, now_iso(), lat, lon, cfg["recipient_radius_km"], json.dumps(c["report_ids"])))
            out.append((cur.lastrowid, "created"))
        elif existing["status"] == "draft" and json.loads(existing["report_ids_json"]) != c["report_ids"]:
            con.execute("UPDATE alerts SET centre_lat=?, centre_lon=?, report_ids_json=? WHERE id=?",
                        (lat, lon, json.dumps(c["report_ids"]), existing["id"]))
            out.append((existing["id"], "updated"))
        else:
            out.append((existing["id"], "unchanged"))
    con.commit()
    return out


def recipients(con, alert, now=None, cfg=OUTBREAK):
    """Plots within recipient_radius_km of the centre that have NOT reported this stress in the window."""
    reported = {r["plot_id"] for r in con.execute(
        "SELECT plot_id, taken_at FROM reports WHERE stress = ?", (alert["stress"],))
        if parse_ts(r["taken_at"]) >= window_start(now, cfg)}
    out = []
    for p in con.execute("SELECT * FROM plots ORDER BY plot_id"):
        d = haversine_km(alert["centre_lat"], alert["centre_lon"], p["lat"], p["lon"])
        if d <= alert["radius_km"] and p["plot_id"] not in reported:
            out.append((p["plot_id"], d))
    return [pid for pid, _ in sorted(out, key=lambda x: x[1])]
