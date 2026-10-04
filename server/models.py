"""SQLite schema and small data helpers (plain sqlite3, no ORM)."""
import base64
import binascii
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
  provider TEXT, provider_id TEXT, error TEXT, to_number_masked TEXT,
  delivery TEXT  -- provider delivery status (queued/sent/delivered/undelivered/failed + error code)
);
-- Visit tickets: which block the officer sees first, and the visit the farmer is told about.
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plot_id TEXT NOT NULL, block TEXT NOT NULL, report_id TEXT,
  stress TEXT NOT NULL, severity INTEGER, trend TEXT, synthetic INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',   -- open -> scheduled -> done | cancelled
  visit_date TEXT, slot TEXT, officer TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
-- Buyer tickets: what buyers paid per cherry band at the factory. SYNTHETIC in the demo (from the seed file).
-- Not to be confused with visit tickets above.
CREATE TABLE IF NOT EXISTS buyer_tickets (
  id TEXT PRIMARY KEY, sold_on TEXT NOT NULL, band TEXT NOT NULL, price REAL NOT NULL, unit TEXT NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 1
);
-- "Ask the officer": leaf photos a farmer chose to send with one report, and the officer's fixed-list reply.
CREATE TABLE IF NOT EXISTS consults (
  id TEXT PRIMARY KEY, plot_id TEXT NOT NULL, block TEXT NOT NULL, images_json TEXT NOT NULL,
  created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  verdict TEXT, stress TEXT, band TEXT, officer TEXT, answered_at TEXT
);
"""


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(path):
    con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    migrate(con)
    return con


def migrate(con):
    cols = {r[1] for r in con.execute("PRAGMA table_info(sms_outbox)")}
    if "delivery" not in cols:
        con.execute("ALTER TABLE sms_outbox ADD COLUMN delivery TEXT")
    if "ticket_id" not in cols:  # visit messages: alert_id is 0 and ticket_id is set
        con.execute("ALTER TABLE sms_outbox ADD COLUMN ticket_id INTEGER")
    con.commit()


def seed_if_empty(con, seed_path):
    """Free hosts may wipe disk: reseed the SYNTHETIC registry whenever the plots table is empty."""
    if con.execute("SELECT COUNT(*) FROM plots").fetchone()[0]:
        return 0
    plots = json.load(open(seed_path, encoding="utf8"))["plots"]
    con.executemany("INSERT INTO plots VALUES (?,?,?,?,NULL)",
                    [(p["plot_id"], p["lat"], p["lon"], json.dumps(p["blocks"])) for p in plots])
    con.commit()
    return len(plots)


def sync_registry(con, seed_path):
    """The seed file is the registry: when it changes (plots moved or added), bring an existing database in line."""
    seed = json.load(open(seed_path, encoding="utf8"))
    plots = seed["plots"]
    con.executemany(
        """INSERT INTO plots VALUES (?,?,?,?,NULL)
           ON CONFLICT(plot_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, blocks_json=excluded.blocks_json""",
        [(p["plot_id"], p["lat"], p["lon"], json.dumps(p["blocks"])) for p in plots])
    bt = seed.get("buyer_tickets") or {}
    con.executemany(
        """INSERT INTO buyer_tickets VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET sold_on=excluded.sold_on, band=excluded.band, price=excluded.price,
             unit=excluded.unit, synthetic=excluded.synthetic""",
        [(t["id"], t["date"], t["band"], t["price"], bt["unit"], 1 if bt.get("synthetic", True) else 0)
         for t in bt.get("tickets", [])])
    con.commit()


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


CONSULT_FIELDS = {"id", "plotId", "block", "images"}
MAX_IMAGES = 3
MAX_IMAGE_BYTES = 300_000  # the app sends leaf crops of about 50-80 KB


def validate_consult(p):
    """Leaf photos for one report. Returns the images as base64 strings; raises ValueError on anything else."""
    if not isinstance(p, dict) or set(p) != CONSULT_FIELDS:
        raise ValueError(f"consult must have exactly the fields {sorted(CONSULT_FIELDS)}")
    images = p["images"]
    if not isinstance(images, list) or not 1 <= len(images) <= MAX_IMAGES:
        raise ValueError(f"1 to {MAX_IMAGES} images expected")
    for im in images:
        try:
            raw = base64.b64decode(im, validate=True)
        except (binascii.Error, TypeError, ValueError):
            raise ValueError("image is not base64")
        if not raw.startswith(b"\xff\xd8"):
            raise ValueError("image is not a JPEG")
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("image too large")
    return images


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
