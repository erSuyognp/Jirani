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
    assert rows, "approval should write one message per recipient plot"
    plots = {x["plot_id"] for x in rows}
    assert not plots & {n1, n2, "OND-0017"}       # reporters are not alerted
    assert all(x["status"] == "would_send" for x in rows)
    assert all(len(x["body"]) <= 160 for x in rows)
    assert rows[0]["body"].startswith("ONDERA COOP: leaf rust reported on 3 farms near you this week.")
    # approving twice does nothing more
    c.post(f"/alerts/{aid}/approve", follow_redirects=False)
    assert len(main.con.execute("SELECT * FROM sms_outbox").fetchall()) == len(rows)
    assert c.get("/").status_code == 200


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
