"""SQLite schema and small data helpers (plain sqlite3, no ORM)."""
import json
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS plots (
  plot_id TEXT PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL,
  blocks_json TEXT NOT NULL, phone_hash_or_null TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, plot_id TEXT NOT NULL, block TEXT NOT NULL, stress TEXT NOT NULL,
  severity INTEGER, trend TEXT, confidence REAL, taken_at TEXT NOT NULL, model_version TEXT,
  received_at TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, stress TEXT NOT NULL, created_at TEXT NOT NULL,
  centre_lat REAL NOT NULL, centre_lon REAL NOT NULL, radius_km REAL NOT NULL,
  report_ids_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT, approved_at TEXT
);
CREATE TABLE IF NOT EXISTS sms_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id INTEGER NOT NULL, plot_id TEXT NOT NULL,
  body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  provider TEXT, provider_id TEXT, error TEXT, to_number_masked TEXT
);
"""


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(path):
    con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def seed_if_empty(con, seed_path):
    """Free hosts may wipe disk: reseed the SYNTHETIC registry whenever the plots table is empty."""
    if con.execute("SELECT COUNT(*) FROM plots").fetchone()[0]:
        return 0
    plots = json.load(open(seed_path))["plots"]
    con.executemany("INSERT INTO plots VALUES (?,?,?,?,NULL)",
                    [(p["plot_id"], p["lat"], p["lon"], json.dumps(p["blocks"])) for p in plots])
    con.commit()
    return len(plots)


REPORT_FIELDS = ("id", "plotId", "block", "stress", "severity", "trend", "confidence", "takenAt", "modelVersion")
STRESSES = {"healthy", "miner", "rust", "phoma", "cercospora", "not_sure"}


def validate_packet(p):
    if not isinstance(p, dict) or not all(k in p for k in ("id", "plotId", "block", "stress", "takenAt")):
        raise ValueError("packet missing required fields")
    if p["stress"] not in STRESSES:
        raise ValueError(f"unknown stress {p['stress']!r}")
    extra = set(p) - set(REPORT_FIELDS) - {"synthetic"}
    if extra:  # privacy: refuse anything beyond the agreed packet (no names, phones, photos, GPS)
        raise ValueError(f"unexpected fields {sorted(extra)}")
    return p


def upsert_report(con, p, synthetic=False):
    con.execute(
        """INSERT INTO reports (id, plot_id, block, stress, severity, trend, confidence, taken_at, model_version,
                                received_at, synthetic)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET plot_id=excluded.plot_id, block=excluded.block, stress=excluded.stress,
             severity=excluded.severity, trend=excluded.trend, confidence=excluded.confidence,
             taken_at=excluded.taken_at, model_version=excluded.model_version""",
        (p["id"], p["plotId"], p["block"], p["stress"], p.get("severity"), p.get("trend"), p.get("confidence"),
         p["takenAt"], p.get("modelVersion"), now_iso(), 1 if synthetic else 0))
