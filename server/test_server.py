"""Server tests: outbreak rule, human-in-the-loop approval, packet privacy, SMS allowlist safety.

Run: python -m pytest server -q
"""
import importlib
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sms_gateway  # noqa: E402

PLOTS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_plots.json")))["plots"]


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient
    db = os.path.join(tempfile.mkdtemp(), "t.db")
    monkeypatch.setenv("JIRANI_DB", db)
    monkeypatch.setenv("SMS_PROVIDER", "mock")
    import config
    importlib.reload(config)
    import main
    importlib.reload(main)
    return TestClient(main.app), main


def ts(days_ago=0):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def pkt(i, plot, stress="rust", sev=2, days_ago=1, **kw):
    return {"id": f"r{i}", "plotId": plot, "block": "A", "stress": stress, "severity": sev, "trend": "worse",
            "confidence": 0.9, "takenAt": ts(days_ago), "modelVersion": "test", **kw}


def near_demo(n, max_km=1.8):
    from outbreak import haversine_km
    d = next(p for p in PLOTS if p["plot_id"] == "OND-0017")
    others = sorted((p for p in PLOTS if p["plot_id"] != "OND-0017"),
                    key=lambda p: haversine_km(d["lat"], d["lon"], p["lat"], p["lon"]))
    return [p["plot_id"] for p in others if haversine_km(d["lat"], d["lon"], p["lat"], p["lon"]) <= max_km][:n]


def test_seeded_on_startup(client):
    c, _ = client
    assert c.get("/api/plots").json()["synthetic"] is True
    assert len(c.get("/api/plots").json()["plots"]) == 40


def test_landing_page_and_dashboard_render(client):
    c, _ = client
    home = c.get("/")
    assert home.status_code == 200 and 'href="/dashboard"' in home.text
    dash = c.get("/dashboard")
    assert dash.status_code == 200 and "Demo data is synthetic" in dash.text   # spec: visible banner
    assert c.get("/static/icon.svg").status_code == 200


def test_registry_sync_moves_existing_plots(client):
    """An existing database follows the seed file when plot coordinates change."""
    _, main = client
    from models import sync_registry
    main.con.execute("UPDATE plots SET lat = 0, lon = 0 WHERE plot_id = 'OND-0017'")
    sync_registry(main.con, main.config.SEED_PATH)
    row = main.con.execute("SELECT lat, lon FROM plots WHERE plot_id = 'OND-0017'").fetchone()
    assert (row["lat"], row["lon"]) != (0, 0)
    assert main.con.execute("SELECT COUNT(*) FROM plots").fetchone()[0] == 40


def test_two_plots_no_alert_third_plot_creates_draft(client):
    c, main = client
    n1, n2 = near_demo(2)
    r = c.post("/api/reports", json=[pkt(1, n1), pkt(2, n2, sev=3)]).json()
    assert r["alerts"] == []
    r = c.post("/api/reports", json=pkt(3, "OND-0017", sev=2)).json()
    assert r["alerts"][0]["change"] == "created"
    a = main.con.execute("SELECT * FROM alerts").fetchall()
    assert len(a) == 1 and a[0]["status"] == "draft" and a[0]["stress"] == "rust"
    # nothing is sent before approval
    assert main.con.execute("SELECT COUNT(*) FROM sms_outbox").fetchone()[0] == 0


def test_ignores_low_severity_old_not_sure_and_dedupes(client):
    c, main = client
    n1, n2, n3 = near_demo(3)
    c.post("/api/reports", json=[pkt(1, n1, sev=1), pkt(2, n2, days_ago=20), pkt(3, "OND-0017", stress="not_sure", sev=None)])
    assert main.con.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] == 0
    c.post("/api/reports", json=[pkt(4, n1), pkt(5, n2), pkt(6, "OND-0017")])
    c.post("/api/reports", json=[pkt(7, n3)])           # cluster grows: same alert updated, not duplicated
    c.post("/api/reports", json=[pkt(4, n1)])           # resend same id: idempotent
    assert main.con.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] == 1
    assert main.con.execute("SELECT COUNT(*) FROM reports").fetchone()[0] == 7


def test_approve_writes_outbox_to_neighbours_only(client):
    c, main = client
    n1, n2 = near_demo(2)
    c.post("/api/reports", json=[pkt(1, n1), pkt(2, n2), pkt(3, "OND-0017")])
    aid = main.con.execute("SELECT id FROM alerts").fetchone()[0]
    r = c.post(f"/alerts/{aid}/approve", data={"officer": "Officer Wanjiru"}, follow_redirects=False)
    assert r.status_code == 303
    rows = main.con.execute("SELECT * FROM sms_outbox").fetchall()
    assert 8 <= len(rows) <= 12, f"alert should reach roughly 8-12 nearby plots, got {len(rows)}"
    plots = {x["plot_id"] for x in rows}
    assert not plots & {n1, n2, "OND-0017"}       # reporters are not alerted
    assert all(x["status"] == "would_send" for x in rows)
    assert all(len(x["body"]) <= 160 for x in rows)
    assert rows[0]["body"].startswith("ONDERA COOP: leaf rust reported on 3 farms near you this week.")
    # approving twice does nothing more
    c.post(f"/alerts/{aid}/approve", follow_redirects=False)
    assert len(main.con.execute("SELECT * FROM sms_outbox").fetchall()) == len(rows)
    assert c.get("/dashboard").status_code == 200


def test_dismiss_sends_nothing(client):
    c, main = client
    n1, n2 = near_demo(2)
    c.post("/api/reports", json=[pkt(1, n1), pkt(2, n2), pkt(3, "OND-0017")])
    aid = main.con.execute("SELECT id FROM alerts").fetchone()[0]
    c.post(f"/alerts/{aid}/dismiss", follow_redirects=False)
    assert main.con.execute("SELECT status FROM alerts").fetchone()[0] == "dismissed"
    assert main.con.execute("SELECT COUNT(*) FROM sms_outbox").fetchone()[0] == 0


def test_packet_privacy_rejects_extra_fields(client):
    c, _ = client
    for extra in ({"name": "Noor"}, {"phone": "+254700000000"}, {"lat": -0.4}, {"photo": "data:..."}):
        assert c.post("/api/reports", json=pkt(1, "OND-0017", **extra)).status_code == 422
    assert c.post("/api/reports", json=pkt(1, "OND-9999")).status_code == 422


JPEG = __import__("base64").b64encode(b"\xff\xd8\xff\xe0" + b"leaf" * 50).decode()


def test_ask_the_officer_photos_and_fixed_reply(client):
    c, main = client
    consult = {"id": "r1", "plotId": "OND-0017", "block": "A", "images": [JPEG, JPEG, JPEG]}
    assert c.post("/api/consults", json=consult).status_code == 422          # no report yet: photos alone are refused
    c.post("/api/reports", json=pkt(1, "OND-0017", stress="not_sure", sev=None))
    assert c.post("/api/consults", json={**consult, "name": "Noor"}).status_code == 422     # no extra fields
    assert c.post("/api/consults", json={**consult, "images": ["bm90IGEganBlZw=="]}).status_code == 422  # not a JPEG
    assert c.post("/api/consults", json={**consult, "images": [JPEG] * 4}).status_code == 422
    assert c.post("/api/consults", json={**consult, "plotId": "OND-0001"}).status_code == 422   # wrong plot
    assert c.post("/api/consults", json=consult).status_code == 200
    assert c.post("/api/consults", json=consult).status_code == 200           # resend: idempotent
    assert main.con.execute("SELECT COUNT(*) FROM consults").fetchone()[0] == 1
    img = c.get("/consults/r1/2.jpg")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content[:2] == b"\xff\xd8"
    assert c.get("/consults/r1/3.jpg").status_code == 404
    assert "Photo requests from farmers" in c.get("/dashboard").text and "/consults/r1/0.jpg" in c.get("/dashboard").text
    # no reply until the officer answers; replies come only from the fixed list
    assert c.get("/api/consults/replies?ids=r1,lost").json() == {"replies": [], "unknown": ["lost"]}
    assert c.post("/consults/r1/reply", data={"reply": "spray something"}, follow_redirects=False).status_code == 422
    r = c.post("/consults/r1/reply", data={"reply": "rust", "band": "high", "officer": "Officer A"}, follow_redirects=False)
    assert r.status_code == 303
    reply = c.get("/api/consults/replies?ids=r1").json()["replies"]
    assert len(reply) == 1 and reply[0]["verdict"] == "diagnosis" and reply[0]["stress"] == "rust" and reply[0]["band"] == "high"
    assert set(reply[0]) == {"id", "verdict", "stress", "band", "answeredAt"}  # the officer's name stays on the server
    c.post("/consults/r1/reply", data={"reply": "visit"}, follow_redirects=False)   # answering twice changes nothing
    assert c.get("/api/consults/replies?ids=r1").json()["replies"][0]["verdict"] == "diagnosis"


def test_report_packets_still_refuse_photos(client):
    c, _ = client
    assert c.post("/api/reports", json=pkt(1, "OND-0017", images=[JPEG])).status_code == 422


def test_visit_tickets_rank_by_severity_and_tell_the_farmer_after_confirmation(client):
    import tickets
    c, main = client
    n1, n2, n3 = near_demo(3)
    c.post("/api/reports", json=[
        {**pkt(1, n1, sev=1), "trend": "first"},     # very low, not worse: no ticket
        {**pkt(2, n2, sev=3), "trend": "first"},     # high: ticket
        {**pkt(3, n3, sev=2), "trend": "worse"},     # low but getting worse: ticket
        {**pkt(4, "OND-0017", sev=4), "trend": "worse"},   # very high and worse: goes first
    ])
    q = tickets.ranked(main.con)
    assert [(t["plot_id"], t["rank"]) for t in q] == [("OND-0017", 1), (n2, 2), (n3, 3)]
    assert "high severity" in q[0]["why"] and "getting worse" in q[0]["why"]
    assert all(t["status"] == "open" and t["suggest_date"] > ts()[:10] for t in q)
    c.post("/api/reports", json=[{**pkt(4, "OND-0017", sev=4), "trend": "worse"}])      # resend: still one ticket per block
    assert len(tickets.ranked(main.con)) == 3
    # nothing is told to the farmer until the officer confirms the visit
    assert c.get("/api/visits?plotId=OND-0017").json() == {"visits": []}
    first = q[0]
    past = c.post(f"/tickets/{first['id']}/schedule", data={"visit_date": "2020-01-01", "slot": "morning"}, follow_redirects=False)
    assert past.status_code == 422
    ok = c.post(f"/tickets/{first['id']}/schedule", data={"visit_date": first["suggest_date"], "slot": "afternoon"},
                follow_redirects=False)
    assert ok.status_code == 303
    assert c.get("/api/visits?plotId=OND-0017").json() == {"visits": [
        {"id": first["id"], "block": "A", "stress": "rust", "date": first["suggest_date"], "slot": "afternoon"}]}
    sms = main.con.execute("SELECT * FROM sms_outbox WHERE ticket_id = ?", (first["id"],)).fetchall()
    assert len(sms) == 1 and sms[0]["status"] == "would_send" and sms[0]["plot_id"] == "OND-0017"
    assert "afternoon" in sms[0]["body"] and "do not spray" in sms[0]["body"] and len(sms[0]["body"]) <= 160
    page = c.get("/dashboard").text
    assert "Visit queue" in page and "Farmer told" in page and f"visit ticket #{first['id']}" in page
    # the suggested slots respect the officer's capacity (2 per half day here)
    taken = [(t["visit_date"] or t["suggest_date"], t["slot"] or t["suggest_slot"]) for t in tickets.ranked(main.con)]
    assert all(taken.count(x) <= main.config.TICKETS["visits_per_day"] // 2 for x in taken)
    c.post(f"/tickets/{first['id']}/done", follow_redirects=False)
    assert c.get("/api/visits?plotId=OND-0017").json() == {"visits": []}
    assert [t["rank"] for t in tickets.ranked(main.con)] == [1, 2]


def test_promised_visit_and_manual_ticket(client):
    import tickets
    c, main = client
    c.post("/api/reports", json=[pkt(1, "OND-0017", stress="not_sure", sev=None), {**pkt(2, "OND-0005", sev=1), "trend": "first"}])
    assert tickets.ranked(main.con) == []
    c.post("/api/consults", json={"id": "r1", "plotId": "OND-0017", "block": "A", "images": [JPEG]})
    c.post("/consults/r1/reply", data={"reply": "visit"}, follow_redirects=False)
    q = tickets.ranked(main.con)
    assert len(q) == 1 and q[0]["source"] == "photo_request" and "visit promised" in q[0]["why"]
    assert c.post("/tickets/create", data={"report_id": "r2"}, follow_redirects=False).status_code == 303
    assert c.post("/tickets/create", data={"report_id": "nope"}, follow_redirects=False).status_code == 404
    assert {t["plot_id"] for t in tickets.ranked(main.con)} == {"OND-0017", "OND-0005"}
    c.post(f"/tickets/{q[0]['id']}/cancel", follow_redirects=False)
    assert {t["plot_id"] for t in tickets.ranked(main.con)} == {"OND-0005"}


def test_visit_sms_fits_one_segment():
    import tickets
    t = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "alert_templates.json"), encoding="utf8"))["visit"]
    body = t.format(block="Lower-22", date=tickets.nice_date("2026-11-25"), slot="afternoon")
    assert len(body) <= 160, len(body)
    assert tickets.nice_date("2026-10-06") == "Tue 6 Oct"


def test_simulation_page_and_helpers(client):
    c, main = client
    page = c.get("/simulation")
    assert page.status_code == 200 and "Simulated:" in page.text and "?sim=1" in page.text
    # the spoken explanation: one pre-recorded clip per step plus the closing line, same text as server/narration.json
    lines = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "narration.json"), encoding="utf8"))["lines"]
    manifest = c.get("/static/narration/manifest.json").json()
    assert [x["id"] for x in lines] == [f"{i:02d}" for i in range(1, 16)] + ["end"] == list(manifest["clips"])
    for x in lines:
        clip = manifest["clips"][x["id"]]
        assert clip["text"] == x["text"], f"narration clip {x['id']} is stale: run scripts/build_narration.py"
        assert c.get(f"/static/narration/{clip['file']}").headers["content-type"] == "audio/mpeg"
    c.post("/api/reports", json={**pkt(1, "OND-0017", sev=3), "synthetic": True})
    r = c.post("/simulation/neighbours").json()
    assert r["accepted"] == 2 and r["alerts"] and r["alerts"][0]["change"] == "created"
    assert main.con.execute("SELECT COUNT(*) FROM reports WHERE synthetic = 1").fetchone()[0] == 3
    st = c.get("/simulation/state").json()
    assert st["reports"] == 3 and st["draft_alert"] and st["open_consult"] is None
    assert {t["plot_id"] for t in st["tickets"]} >= {"OND-0017"} and st["tickets"][0]["suggest_date"]
    assert c.post("/simulation/reset").json() == {"ok": True}
    st = c.get("/simulation/state").json()
    assert st == {"reports": 0, "draft_alert": None, "open_consult": None, "tickets": []}
    assert len(c.get("/api/plots").json()["plots"]) == 40     # the registry is kept


def test_all_alert_templates_fit_one_sms():
    import main as m
    for s in m.TEMPLATES["stress"]:
        for n in (3, 12, 40):
            assert len(m.alert_body(s, n)) <= 160


# ---- SMS gateway safety -------------------------------------------------------------------------
class FakeClient:
    name = "fake"

    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, body):
        if self.fail:
            raise ConnectionError("provider down")
        self.sent.append(to)
        return f"msg-{len(self.sent)}"


def test_mock_mode_never_calls_provider():
    fake = FakeClient()
    g = sms_gateway.Gateway("mock", ["+254700000001"], {"OND-0012": "+254700000001"}, lambda: fake)
    assert g.send("OND-0012", "hi").status == "would_send"
    assert fake.sent == []


def test_live_only_sends_to_allowlisted_numbers():
    fake = FakeClient()
    g = sms_gateway.Gateway(
        "live", allowlist=["+254700000001"],
        plot_phones={"OND-0012": "+254 700 000 001", "OND-0018": "+254700000999"},  # 0018 NOT on allowlist
        client_factory=lambda: fake)
    assert g.send("OND-0012", "hi").status == "sent"
    assert g.send("OND-0018", "hi").status == "would_send"      # mapped but not allowlisted -> mock
    assert g.send("OND-0005", "hi").status == "would_send"      # no number -> mock
    assert fake.sent == ["+254700000001"]
    for n in fake.sent:
        assert n in {"+254700000001"}


def test_live_with_empty_allowlist_sends_nothing():
    fake = FakeClient()
    g = sms_gateway.Gateway("live", [], {"OND-0012": "+254700000001"}, lambda: fake)
    assert g.send("OND-0012", "hi").status == "would_send"
    assert fake.sent == []


def test_live_failure_falls_back_to_mock():
    g = sms_gateway.Gateway("live", ["+254700000001"], {"OND-0012": "+254700000001"}, lambda: FakeClient(fail=True))
    r = g.send("OND-0012", "hi")
    assert r.status == "failed_fallback_mock" and "provider down" in r.error
    g2 = sms_gateway.Gateway("live", ["+254700000001"], {"OND-0012": "+254700000001"}, None)
    assert g2.send("OND-0012", "hi").status == "failed_fallback_mock"


def test_demo_cluster_reaches_8_to_12_neighbours(client):
    """The filmed scenario: simulate_outbreak's two nearest neighbours + the phone's OND-0017 report."""
    c, main = client
    n1, n2 = near_demo(2)
    c.post("/api/reports", json=[pkt(1, n1), pkt(2, n2), pkt(3, "OND-0017")])
    a = main.con.execute("SELECT * FROM alerts").fetchone()
    import outbreak
    assert 8 <= len(outbreak.recipients(main.con, a)) <= 12


def test_auto_demo_mapping_uses_nearest_recipients_and_allowlist_only():
    fake = FakeClient()
    g = sms_gateway.Gateway("live", ["+254700000001", "+254700000002", "+254700000003"], {}, lambda: fake)
    g.map_demo_recipients(["OND-0030", "OND-0031", "OND-0032", "OND-0033"])   # nearest first
    results = [g.send(p, "hi").status for p in ["OND-0030", "OND-0031", "OND-0032", "OND-0033"]]
    assert results == ["sent", "sent", "would_send", "would_send"]           # at most two real phones
    assert set(fake.sent) <= {"+254700000001", "+254700000002", "+254700000003"}
    g_mock = sms_gateway.Gateway("mock", ["+254700000001"], {}, lambda: fake)
    g_mock.map_demo_recipients(["OND-0030"])
    assert g_mock.send("OND-0030", "hi").status == "would_send"


def test_provider_error_masks_phone_numbers():
    class Leaky(FakeClient):
        def send(self, to, body):
            raise RuntimeError(f"HTTP 400 Twilio error 21608: The number {to} is unverified")
    g = sms_gateway.Gateway("live", ["+254700000001"], {"OND-0012": "+254700000001"}, lambda: Leaky())
    r = g.send("OND-0012", "hi")
    assert r.status == "failed_fallback_mock" and "21608" in r.error
    assert "+254700000001" not in r.error and "254700000001" not in r.error


def test_live_approval_end_to_end_with_fake_provider(client, monkeypatch):
    c, main = client
    fake = FakeClient()
    monkeypatch.setattr(main, "gateway", sms_gateway.Gateway("live", ["+254700000001"], {}, lambda: fake))
    n1, n2 = near_demo(2)
    c.post("/api/reports", json=[pkt(1, n1), pkt(2, n2), pkt(3, "OND-0017")])
    aid = main.con.execute("SELECT id FROM alerts").fetchone()[0]
    c.post(f"/alerts/{aid}/approve", follow_redirects=False)
    rows = main.con.execute("SELECT status, provider FROM sms_outbox").fetchall()
    assert [r["status"] for r in rows].count("sent") == 1
    assert all(r["status"] == "would_send" for r in rows if r["status"] != "sent")
    assert fake.sent == ["+254700000001"]
    assert "+254700000001" not in c.get("/dashboard").text          # full number never shown on the dashboard


def test_cors_origin_with_trailing_slash_is_accepted(monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setenv("JIRANI_DB", os.path.join(tempfile.mkdtemp(), "t.db"))
    monkeypatch.setenv("APP_ORIGIN", "https://jirani-eosin.vercel.app/ , http://localhost:5173")
    import config
    importlib.reload(config)
    assert config.APP_ORIGIN == ["https://jirani-eosin.vercel.app", "http://localhost:5173"]
    import main
    importlib.reload(main)
    r = TestClient(main.app).options("/api/reports", headers={
        "Origin": "https://jirani-eosin.vercel.app", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://jirani-eosin.vercel.app"
