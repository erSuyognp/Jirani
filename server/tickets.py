"""Visit tickets: which block the extension officer should see first, and when.

DRAFT rules, values in config.TICKETS. A ticket is opened automatically for a block whose latest report is severe,
when the officer answers a photo request with "I will visit", or by hand from the visit list. Tickets are ranked by a
transparent score; the dashboard suggests a date for each, and nothing is told to the farmer until the officer
confirms the visit (a person decides).
"""
import json
from datetime import date, datetime, timedelta, timezone

from config import TICKETS
from models import now_iso
from outbreak import parse_ts

DISEASES = ("miner", "rust", "phoma", "cercospora")
ACTIVE = ("open", "scheduled")
SLOTS = ("morning", "afternoon")


def needs_visit(r, cfg=TICKETS):
    """A confident disease report that is severe, or getting worse at low severity or above."""
    if r["stress"] not in DISEASES or r["severity"] is None:
        return False
    return r["severity"] >= cfg["min_severity"] or (r["trend"] == "worse" and r["severity"] >= cfg["worse_min_severity"])


def active_ticket(con, plot_id, block):
    return con.execute("SELECT * FROM tickets WHERE plot_id=? AND block=? AND status IN ('open','scheduled')",
                       (plot_id, block)).fetchone()


def open_ticket(con, report, source):
    """Open a ticket for the report's block, or refresh the open one with the newer report. Returns the ticket id."""
    t = active_ticket(con, report["plot_id"], report["block"])
    if t:
        con.execute("UPDATE tickets SET report_id=?, stress=?, severity=?, trend=?, synthetic=? WHERE id=?",
                    (report["id"], report["stress"], report["severity"], report["trend"], report["synthetic"], t["id"]))
        if source == "photo_request" and t["source"] != "photo_request":
            con.execute("UPDATE tickets SET source='photo_request' WHERE id=?", (t["id"],))
        return t["id"]
    cur = con.execute(
        """INSERT INTO tickets (plot_id, block, report_id, stress, severity, trend, synthetic, source, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,'open',?)""",
        (report["plot_id"], report["block"], report["id"], report["stress"], report["severity"], report["trend"],
         report["synthetic"], source, now_iso()))
    return cur.lastrowid


def sync_from_reports(con, cfg=TICKETS):
    """After new reports arrive: open or refresh tickets for blocks whose latest report needs a visit."""
    latest = {}
    for r in con.execute("SELECT * FROM reports ORDER BY taken_at DESC"):
        latest.setdefault((r["plot_id"], r["block"]), dict(r))
    for r in latest.values():
        if needs_visit(r, cfg):
            open_ticket(con, r, "severity")
    con.commit()


def score(t, alert_plots, now, cfg=TICKETS):
    """Priority score and the reasons shown to the officer. Higher goes first."""
    w = cfg["weights"]
    sev = t["severity"] or 0
    s, why = sev * w["per_severity"], []
    if sev >= cfg["min_severity"]:
        why.append("high severity")
    if t["trend"] == "worse":
        s += w["worse"]
        why.append("getting worse")
    if t["plot_id"] in alert_plots:
        s += w["in_alert"]
        why.append("in an outbreak area")
    if t["source"] == "photo_request":
        s += w["photo_request"]
        why.append("visit promised")
    if t["stress"] == "not_sure":
        why.append("the tool could not tell")
    days = max(0, (now - parse_ts(t["created_at"])).days)
    s += min(days, w["max_wait_days"]) * w["per_wait_day"]
    if days >= 2:
        why.append(f"waiting {days} days")
    return s, why


def alert_plots(con):
    """Plots that reported into an open (draft or approved) outbreak alert."""
    out = set()
    for a in con.execute("SELECT report_ids_json FROM alerts WHERE status IN ('draft','approved')"):
        ids = json.loads(a["report_ids_json"])
        if ids:
            out |= {r["plot_id"] for r in con.execute(
                f"SELECT plot_id FROM reports WHERE id IN ({','.join('?' * len(ids))})", ids)}
    return out


def next_slots(taken, today, cfg=TICKETS):
    """Free (date, slot) pairs from tomorrow on, skipping the rest day, with visits_per_day split over the two slots."""
    per_slot = max(1, cfg["visits_per_day"] // 2)
    d = today
    while True:
        d += timedelta(days=1)
        if d.weekday() == cfg["rest_weekday"]:
            continue
        for slot in SLOTS:
            for _ in range(per_slot - taken.get((d.isoformat(), slot), 0)):
                yield d.isoformat(), slot


def ranked(con, now=None, cfg=TICKETS):
    """Active tickets, most urgent first, each with rank, score, reasons and (for open ones) a suggested visit."""
    now = now or datetime.now(timezone.utc)
    in_alert = alert_plots(con)
    tickets = []
    for t in con.execute("SELECT * FROM tickets WHERE status IN ('open','scheduled')"):
        t = dict(t)
        t["score"], t["why"] = score(t, in_alert, now, cfg)
        tickets.append(t)
    tickets.sort(key=lambda t: (-t["score"], t["created_at"], t["id"]))
    taken = {}
    for t in tickets:
        if t["status"] == "scheduled":
            taken[(t["visit_date"], t["slot"])] = taken.get((t["visit_date"], t["slot"]), 0) + 1
    slots = next_slots(taken, now.date(), cfg)
    for i, t in enumerate(tickets, 1):
        t["rank"] = i
        if t["status"] == "open":
            t["suggest_date"], t["suggest_slot"] = next(slots)
    return tickets


def valid_visit(day, slot, today=None):
    """YYYY-MM-DD not in the past, and a known slot."""
    try:
        d = date.fromisoformat(day)
    except (TypeError, ValueError):
        return False
    return slot in SLOTS and d >= (today or datetime.now(timezone.utc).date())


def nice_date(day):
    """'2026-10-06' -> 'Tue 6 Oct'."""
    try:
        d = date.fromisoformat(day)
        return f"{d:%a} {d.day} {d:%b}"
    except (TypeError, ValueError):
        return day or "-"
