"""Jirani cooperative server: report intake, outbreak detection, officer dashboard, SMS outbox.

Run:  uvicorn main:app --app-dir server --port 8000
All demo data (registry, simulated reports) is SYNTHETIC. No LLM calls anywhere.
"""
import base64
import json
import os
from collections import Counter
from datetime import datetime

from fastapi import Body, FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markupsafe import Markup

import config
import outbreak
import sms_gateway
from models import connect, now_iso, seed_if_empty, sync_registry, upsert_report, validate_consult, validate_packet

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = json.load(open(os.path.join(HERE, "alert_templates.json"), encoding="utf8"))

app = FastAPI(title="Jirani cooperative server")
app.add_middleware(CORSMiddleware, allow_origins=config.APP_ORIGIN, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(HERE, "templates"))
ICONS = json.load(open(os.path.join(HERE, "icons.json"), encoding="utf8"))  # Lucide icon paths (ISC licence)
SEED = json.load(open(config.SEED_PATH, encoding="utf8"))
DASHBOARD = "/dashboard"


def icon(name, size=18):
    return Markup(f'<svg class="i" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                  f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def fmt_ts(s):
    """'2026-10-03T23:31:18Z' -> '3 Oct 2026, 23:31' (UTC)."""
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return f"{d.day} {d:%b %Y, %H:%M}"
    except (AttributeError, ValueError):
        return s or "-"


def logo(size=28):
    """The leaf mark from app/public/icon.svg."""
    return Markup(f'<svg width="{size}" height="{size}" viewBox="4 9 48 46" aria-hidden="true"><path d="M14 40c0-14 12-24 '
                  '34-26-2 22-12 34-26 34-3 0-6-1-8-3l-4 5-3-2 5-5c1-1 2-2 2-3z" fill="#009fda"/><path d="M20 44c8-8 14-14 '
                  '22-22" stroke="#002244" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>')


templates.env.globals["icon"] = icon
templates.env.globals["logo"] = logo
templates.env.filters["ts"] = fmt_ts
con = connect(config.DB_PATH)
seed_if_empty(con, config.SEED_PATH)
sync_registry(con, config.SEED_PATH)
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


@app.post("/api/consults")
def consult_create(payload=Body(...)):
    """'Ask the officer': leaf photos for one report, sent only when the farmer chose to. Idempotent by id."""
    try:
        images = validate_consult(payload)
    except ValueError as e:
        raise HTTPException(422, str(e))
    rep = con.execute("SELECT plot_id FROM reports WHERE id = ?", (payload["id"],)).fetchone()
    if not rep or rep["plot_id"] != payload["plotId"]:
        raise HTTPException(422, "no report with this id for this plot; send the report first")
    con.execute("INSERT INTO consults (id, plot_id, block, images_json, created_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(id) DO NOTHING",
                (payload["id"], payload["plotId"], str(payload["block"])[:20], json.dumps(images), now_iso()))
    con.commit()
    return {"accepted": True, "id": payload["id"]}


@app.get("/api/consults/replies")
def consult_replies(ids: str = ""):
    """The phone asks for replies to its own requests (ids are the random report ids it created)."""
    wanted = [i for i in ids.split(",") if i][:50]
    if not wanted:
        return {"replies": []}
    rows = con.execute(f"SELECT * FROM consults WHERE status = 'answered' AND id IN ({','.join('?' * len(wanted))})",
                       wanted).fetchall()
    return {"replies": [{k: v for k, v in (("id", r["id"]), ("verdict", r["verdict"]), ("stress", r["stress"]),
                                             ("band", r["band"]), ("answeredAt", r["answered_at"])) if v is not None}
                        for r in rows]}


@app.get("/consults/{consult_id}/{n}.jpg")
def consult_image(consult_id: str, n: int):
    row = con.execute("SELECT images_json FROM consults WHERE id = ?", (consult_id,)).fetchone()
    images = json.loads(row["images_json"]) if row else []
    if not 0 <= n < len(images):
        raise HTTPException(404)
    return Response(base64.b64decode(images[n]), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


REPLY_STRESSES = ("rust", "miner", "phoma", "cercospora", "healthy")


@app.post("/consults/{consult_id}/reply")
def consult_reply(consult_id: str, reply: str = Form(...), band: str = Form("low"), officer: str = Form("officer")):
    """The officer answers from a fixed list: a diagnosis (with low/high), 'I will visit', or 'send new photos'."""
    if reply in ("visit", "retake"):
        verdict, stress, band = reply, None, None
    elif reply in REPLY_STRESSES and band in ("low", "high"):
        verdict, stress, band = "diagnosis", reply, "low" if reply == "healthy" else band
    else:
        raise HTTPException(422, "unknown reply")
    cur = con.execute("UPDATE consults SET status='answered', verdict=?, stress=?, band=?, officer=?, answered_at=? "
                      "WHERE id=? AND status='open'",
                      (verdict, stress, band, officer.strip()[:60] or "officer", now_iso(), consult_id))
    con.commit()
    if not cur.rowcount and not con.execute("SELECT 1 FROM consults WHERE id = ?", (consult_id,)).fetchone():
        raise HTTPException(404)
    return RedirectResponse(DASHBOARD + "#consults", status_code=303)


@app.post("/alerts/{alert_id}/approve")
def approve(alert_id: int, officer: str = Form("officer")):
    a = con.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if not a:
        raise HTTPException(404)
    if a["status"] != "draft":
        return RedirectResponse(DASHBOARD, status_code=303)
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
    return RedirectResponse(DASHBOARD, status_code=303)


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
    return RedirectResponse(DASHBOARD, status_code=303)


@app.post("/alerts/{alert_id}/dismiss")
def dismiss(alert_id: int, officer: str = Form("officer")):
    con.execute("UPDATE alerts SET status='dismissed', approved_by=?, approved_at=? WHERE id=? AND status='draft'",
                (officer.strip()[:60] or "officer", now_iso(), alert_id))
    con.commit()
    return RedirectResponse(DASHBOARD, status_code=303)


SEV = ["none", "very low", "low", "high", "very high"]
TREND_RANK = {"worse": 0, "first": 1, "same": 2, "better": 3, None: 4}
STRESS_LABEL = {"healthy": "No disease sign", "miner": "Leaf miner", "rust": "Leaf rust", "phoma": "Brown leaf spot (Phoma)",
                "cercospora": "Cercospora leaf spot", "not_sure": "Not sure"}


@app.get("/", response_class=HTMLResponse)
def landing(request: Request):
    return templates.TemplateResponse(request, "landing.html", {
        "app_url": config.APP_URL, "repo_url": config.REPO_URL, "area": SEED.get("area", ""),
        "n_plots": con.execute("SELECT COUNT(*) FROM plots").fetchone()[0],
    })


@app.get("/dashboard", response_class=HTMLResponse)
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
    by_id = {r["id"]: r for r in reps}
    consults = []
    for c in con.execute("SELECT * FROM consults ORDER BY status DESC, created_at DESC LIMIT 60"):  # open first
        c = dict(c)
        c["n_images"] = len(json.loads(c.pop("images_json")))
        c["report"] = by_id.get(c["id"])
        consults.append(c)
    map_plots = [{"id": pid, "lat": p["lat"], "lon": p["lon"], **{k: latest_plot.get(pid, {}).get(k) for k in
                  ("stress", "severity", "trend", "block", "taken_at", "synthetic")}}
                 for pid, p in plots_.items()]
    for m in map_plots:
        m["when"] = fmt_ts(m.pop("taken_at")) if m["stress"] else None
    return templates.TemplateResponse(request, "dashboard.html", {
        "flagged": flagged, "alerts": alerts, "outbox": outbox, "map_plots": map_plots, "sev": SEV,
        "counts": Counter(r["status"] for r in outbox), "n_reports": len(reps),
        "n_synthetic": sum(r["synthetic"] for r in reps), "sms_mode": gateway.mode,
        "stress_label": STRESS_LABEL, "area": SEED.get("area", ""), "n_plots": len(plots_),
        "n_reporting": len(latest_plot), "n_draft": sum(a["status"] == "draft" for a in alerts),
        "rule": config.OUTBREAK, "consults": consults, "n_open": sum(c["status"] == "open" for c in consults),
        "reply_stresses": REPLY_STRESSES,
    })
