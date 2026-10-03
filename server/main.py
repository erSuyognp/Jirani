"""Jirani cooperative server: report intake, outbreak detection, officer dashboard, SMS outbox.

Run:  uvicorn main:app --app-dir server --port 8000
All demo data (registry, simulated reports) is SYNTHETIC. No LLM calls anywhere.
"""
import json
import os
from collections import Counter

from fastapi import Body, FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

import config
import outbreak
import sms_gateway
from models import connect, now_iso, seed_if_empty, upsert_report, validate_packet

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = json.load(open(os.path.join(HERE, "alert_templates.json"), encoding="utf8"))

app = FastAPI(title="Jirani cooperative server")
app.add_middleware(CORSMiddleware, allow_origins=config.APP_ORIGIN, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])
templates = Jinja2Templates(directory=os.path.join(HERE, "templates"))
con = connect(config.DB_PATH)
seed_if_empty(con, config.SEED_PATH)
gateway = sms_gateway.from_env()


def alert_body(stress, n):
    s = TEMPLATES["stress"][stress]
    return TEMPLATES["template"].format(stress_name=s["name"], n=n, sign=s["sign"])


@app.get("/api/health")
def health():
    return {"ok": True, "plots": con.execute("SELECT COUNT(*) FROM plots").fetchone()[0],
            "sms_provider": gateway.mode}


@app.get("/api/plots")
def plots():
    rows = con.execute("SELECT plot_id, lat, lon, blocks_json FROM plots ORDER BY plot_id").fetchall()
    return {"synthetic": True, "plots": [{"plot_id": r["plot_id"], "lat": r["lat"], "lon": r["lon"],
                                          "blocks": json.loads(r["blocks_json"])} for r in rows]}


@app.post("/api/reports")
def reports(payload=Body(...)):
    packets = payload if isinstance(payload, list) else [payload]
    known = {r[0] for r in con.execute("SELECT plot_id FROM plots")}
    try:
        for p in packets:
            validate_packet(p)
            if p["plotId"] not in known:
                raise ValueError(f"unknown plot {p['plotId']}")
    except ValueError as e:
        raise HTTPException(422, str(e))
    for p in packets:
        upsert_report(con, p, synthetic=bool(p.get("synthetic")))
    con.commit()
    alerts = outbreak.detect(con)
    return {"accepted": len(packets), "ids": [p["id"] for p in packets],
            "alerts": [{"id": a, "change": c} for a, c in alerts]}


@app.post("/alerts/{alert_id}/approve")
def approve(alert_id: int, officer: str = Form("officer")):
    a = con.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if not a:
        raise HTTPException(404)
    if a["status"] != "draft":
        return RedirectResponse("/", status_code=303)
    n_plots = len({r["plot_id"] for r in con.execute(
        f"SELECT plot_id FROM reports WHERE id IN ({','.join('?' * len(json.loads(a['report_ids_json'])))})",
        json.loads(a["report_ids_json"]))})
    body = alert_body(a["stress"], n_plots)
    con.execute("UPDATE alerts SET status='approved', approved_by=?, approved_at=? WHERE id=?",
                (officer.strip()[:60] or "officer", now_iso(), alert_id))
    recips = outbreak.recipients(con, a)  # nearest first
    gateway.map_demo_recipients(recips)
    for pid in recips:
        r = gateway.send(pid, body)
        con.execute("""INSERT INTO sms_outbox (alert_id, plot_id, body, status, created_at, provider, provider_id,
                       error, to_number_masked) VALUES (?,?,?,?,?,?,?,?,?)""",
                    (alert_id, pid, body, r.status, now_iso(), r.provider, r.provider_id, r.error, r.to_number_masked))
    con.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/sms/refresh")
def sms_refresh():
    """Officer-triggered: ask the provider for delivery status of real (non-mock) messages."""
    rows = con.execute("SELECT id, provider_id FROM sms_outbox WHERE status='sent' AND provider='twilio' "
                       "AND provider_id IS NOT NULL ORDER BY id DESC LIMIT 10").fetchall()
    for r in rows:
        try:
            st = sms_gateway.twilio_from_env().status(r["provider_id"])
            d = st["status"] + (f" (error {st['error_code']})" if st.get("error_code") else "")
        except Exception as e:
            d = f"status check failed: {type(e).__name__}"
        con.execute("UPDATE sms_outbox SET delivery=? WHERE id=?", (d, r["id"]))
    con.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/alerts/{alert_id}/dismiss")
def dismiss(alert_id: int, officer: str = Form("officer")):
    con.execute("UPDATE alerts SET status='dismissed', approved_by=?, approved_at=? WHERE id=? AND status='draft'",
                (officer.strip()[:60] or "officer", now_iso(), alert_id))
    con.commit()
    return RedirectResponse("/", status_code=303)


SEV = ["none", "very low", "low", "high", "very high"]
TREND_RANK = {"worse": 0, "first": 1, "same": 2, "better": 3, None: 4}


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    plots_ = {r["plot_id"]: dict(r) for r in con.execute("SELECT * FROM plots")}
    reps = [dict(r) for r in con.execute("SELECT * FROM reports ORDER BY taken_at DESC")]
    latest_block, latest_plot = {}, {}
    for r in reps:
        latest_block.setdefault((r["plot_id"], r["block"]), r)
        latest_plot.setdefault(r["plot_id"], r)
    flagged = [r for r in latest_block.values() if r["stress"] not in ("healthy",)]
    flagged.sort(key=lambda r: (r["stress"] == "not_sure", -(r["severity"] or 0), TREND_RANK.get(r["trend"], 4),
                                r["taken_at"]))
    alerts = []
    for a in con.execute("SELECT * FROM alerts ORDER BY id DESC"):
        a = dict(a)
        ids = json.loads(a["report_ids_json"])
        a["reports"] = [r for r in reps if r["id"] in ids]
        a["n_plots"] = len({r["plot_id"] for r in a["reports"]})
        a["preview"] = alert_body(a["stress"], a["n_plots"])
        a["recipients"] = outbreak.recipients(con, a) if a["status"] == "draft" else []
        alerts.append(a)
    outbox = [dict(r) for r in con.execute("SELECT * FROM sms_outbox ORDER BY id DESC LIMIT 200")]
    map_plots = [{"id": pid, "lat": p["lat"], "lon": p["lon"],
                  "stress": latest_plot.get(pid, {}).get("stress"), "severity": latest_plot.get(pid, {}).get("severity")}
                 for pid, p in plots_.items()]
    return templates.TemplateResponse(request, "dashboard.html", {
        "flagged": flagged, "alerts": alerts, "outbox": outbox, "map_plots": map_plots, "sev": SEV,
        "counts": Counter(r["status"] for r in outbox), "n_reports": len(reps),
        "n_synthetic": sum(r["synthetic"] for r in reps), "sms_mode": gateway.mode,
    })
