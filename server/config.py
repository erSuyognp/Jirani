"""Server configuration. Tunables in one place; secrets and deployment settings from environment only."""
import os

OUTBREAK = {
    "window_days": 14,          # look-back window for reports
    "min_severity": 2,          # consider confident reports with severity >= this
    "min_plots": 3,             # distinct plots needed for a draft alert
    "cluster_radius_km": 2.0,   # plots within this distance of an anchor plot form a cluster
    "recipient_radius_km": 3.0, # neighbours within this distance of the cluster centre get the alert
    "dedupe_radius_km": 2.0,    # an open alert for the same stress within this distance is updated, not duplicated
    "stresses": ["miner", "rust", "phoma", "cercospora"],
}

DB_PATH = os.environ.get("JIRANI_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "jirani.db"))
SEED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_plots.json")
# CORS: comma-separated list of app origins, e.g. "https://jirani.pages.dev,http://localhost:5173"
APP_ORIGIN = [o.strip() for o in os.environ.get(
    "APP_ORIGIN", "http://localhost:5173,http://localhost:4173").split(",") if o.strip()]

# SMS gateway. See sms_gateway.py and .env.example.
SMS_PROVIDER = os.environ.get("SMS_PROVIDER", "mock").lower()          # mock | live
SMS_LIVE_PROVIDER = os.environ.get("SMS_LIVE_PROVIDER", "").lower()      # chosen at M6b
# Only these numbers may ever receive a real SMS (the team's own phones). Comma-separated, E.164.
DEMO_SMS_ALLOWLIST = [n.strip() for n in os.environ.get("DEMO_SMS_ALLOWLIST", "").split(",") if n.strip()]
# Map synthetic plots to demo numbers for live mode: "OND-0012=+2547...,OND-0018=+2547..."
DEMO_PLOT_PHONES = dict(
    kv.split("=", 1) for kv in os.environ.get("DEMO_PLOT_PHONES", "").split(",") if "=" in kv)
