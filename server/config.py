"""Server configuration. Tunables in one place; secrets and deployment settings from environment only."""
import os

OUTBREAK = {
    "window_days": 14,          # look-back window for reports
    "min_severity": 2,          # consider confident reports with severity >= this
    "min_plots": 3,             # distinct plots needed for a draft alert
    "cluster_radius_km": 2.0,   # plots within this distance of an anchor plot form a cluster
    "recipient_radius_km": 1.5, # neighbours within this distance of the cluster centre get the alert
                                # (1.5 km reaches 9 plots for the demo cluster around OND-0017; target 8-12)
    "dedupe_radius_km": 2.0,    # an open alert for the same stress within this distance is updated, not duplicated
    "stresses": ["miner", "rust", "phoma", "cercospora"],
}

# Visit tickets (which block the officer sees first). DRAFT heuristics, not validated.
TICKETS = {
    "min_severity": 3,          # a confident disease report at this severity opens a ticket
    "worse_min_severity": 2,    # ... or at this severity when the trend is "worse"
    "visits_per_day": 4,        # officer capacity used for the suggested dates (half morning, half afternoon)
    "rest_weekday": 6,          # no visits suggested on this weekday (Monday = 0, Sunday = 6)
    "weights": {"per_severity": 10, "worse": 5, "in_alert": 3, "photo_request": 4, "per_wait_day": 1, "max_wait_days": 5},
}

DB_PATH = os.environ.get("JIRANI_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "jirani.db"))
SEED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_plots.json")
# CORS: comma-separated list of app origins, e.g. "https://jirani.pages.dev,http://localhost:5173"
# Trailing slashes are stripped: browsers send "https://x.vercel.app", never "https://x.vercel.app/".
APP_ORIGIN = [o.strip().rstrip("/") for o in os.environ.get(
    "APP_ORIGIN", "http://localhost:5173,http://localhost:4173").split(",") if o.strip().rstrip("/")]

# Links on the landing page. APP_URL defaults to the first deployed (https) origin in APP_ORIGIN.
APP_URL = os.environ.get("APP_URL") or next(
    (o for o in APP_ORIGIN if o.startswith("https://") and "localhost" not in o), "http://localhost:5173")
REPO_URL = os.environ.get("REPO_URL", "https://github.com/erSuyognp/Jirani")

# SMS gateway. See sms_gateway.py and .env.example.
SMS_PROVIDER = os.environ.get("SMS_PROVIDER", "mock").lower()          # mock | live
SMS_LIVE_PROVIDER = os.environ.get("SMS_LIVE_PROVIDER", "twilio").lower()  # twilio (trial)
# Only these numbers may ever receive a real SMS (the team's own phones). Comma-separated, E.164.
DEMO_SMS_ALLOWLIST = [n.strip() for n in os.environ.get("DEMO_SMS_ALLOWLIST", "").split(",") if n.strip()]
# Map synthetic plots to demo numbers for live mode: "OND-0012=+2547...,OND-0018=+2547..."
DEMO_PLOT_PHONES = dict(
    kv.split("=", 1) for kv in os.environ.get("DEMO_PLOT_PHONES", "").split(",") if "=" in kv)
