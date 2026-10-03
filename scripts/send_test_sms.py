"""Send ONE test SMS through the Twilio trial account to an allowlisted phone and report delivery.

Use this before filming to check that a real SMS actually arrives.
- Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and DEMO_SMS_ALLOWLIST from the environment
  (or from a local .env file if present). Never prints credentials; phone numbers are masked.
- Refuses any number that is not on DEMO_SMS_ALLOWLIST.
- Polls the message until it reaches a final status (delivered / undelivered / failed) or the wait runs out,
  and logs the provider's status and error code.

Usage:
  python scripts/send_test_sms.py                 # first allowlisted number
  python scripts/send_test_sms.py --to +2547XXXXXXXX --wait 120
"""
import argparse
import os
import sys
import time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))

FINAL = {"delivered", "undelivered", "failed", "canceled", "read"}
# Common Twilio error codes. Details: https://www.twilio.com/docs/api/errors/<code>  (TODO: verify current wording)
HINTS = {
    21211: "Invalid 'To' number. Use E.164 format, e.g. +2547XXXXXXXX.",
    21408: "Sending to this country is not enabled. Twilio Console > Messaging > Settings > Geo permissions.",
    21606: "The 'From' number cannot send SMS (check TWILIO_FROM_NUMBER is your SMS-capable Twilio number).",
    21608: "Trial accounts can only text Verified Caller IDs. Verify this number in the Twilio Console first.",
    21610: "The recipient has replied STOP to this sender.",
    21612: "Twilio cannot route from this 'From' number to this 'To' number.",
    30003: "Handset unreachable (off or no signal).",
    30005: "Unknown destination handset (number may not exist).",
    30006: "Landline or unreachable carrier.",
    30007: "Carrier filtering (message blocked as spam or unregistered traffic).",
    30008: "Unknown error from the carrier.",
    30032: "US toll-free number not verified.",
    30034: "US A2P 10DLC: message from an unregistered US long code was blocked by the carrier.",
}


def load_dotenv(path):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    load_dotenv(os.path.join(ROOT, ".env"))
    import sms_gateway  # after env is loaded
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", help="allowlisted number (default: first on DEMO_SMS_ALLOWLIST)")
    ap.add_argument("--wait", type=int, default=90, help="seconds to poll for delivery status")
    a = ap.parse_args()

    allow = [sms_gateway.normalise(n) for n in os.environ.get("DEMO_SMS_ALLOWLIST", "").split(",") if n.strip()]
    if not allow:
        sys.exit("DEMO_SMS_ALLOWLIST is empty. Set it to your own phone number(s) first.")
    to = sms_gateway.normalise(a.to) if a.to else allow[0]
    if to not in allow:
        sys.exit(f"Refusing: {sms_gateway.mask(to)} is not on DEMO_SMS_ALLOWLIST.")
    try:
        client = sms_gateway.twilio_from_env()
    except RuntimeError as e:
        sys.exit(str(e))

    body = f"JIRANI test SMS {datetime.now().strftime('%d-%b %H:%M')}. If you can read this, delivery works."
    log(f"sending to {sms_gateway.mask(to)} from {sms_gateway.mask(client.from_number)} ({len(body)} chars)")
    try:
        sid = client.send(to, body)
    except Exception as e:
        code = next((int(w) for w in str(e).replace(":", " ").split() if w.isdigit() and len(w) == 5), None)
        log(f"SEND FAILED: {e}")
        if code in HINTS:
            log(f"hint: {HINTS[code]}")
        sys.exit(1)
    log(f"accepted by Twilio, message sid {sid}")

    last, t0 = None, time.time()
    while time.time() - t0 < a.wait:
        st = client.status(sid)
        cur = (st["status"], st["error_code"])
        if cur != last:
            log(f"status={st['status']} error_code={st['error_code']} error_message={st['error_message']} "
                f"segments={st['num_segments']} price={st['price']}")
            last = cur
        if st["status"] in FINAL:
            break
        time.sleep(5)
    status, code = last if last else (None, None)
    if code and int(code) in HINTS:
        log(f"hint: {HINTS[int(code)]}")
    if status == "delivered":
        log("RESULT: delivered. Check the phone.")
    elif status in FINAL:
        log(f"RESULT: {status}. The demo still works through the mock outbox.")
        sys.exit(2)
    else:
        log(f"RESULT: still '{status}' after {a.wait}s (some carriers never report 'delivered'). Check the phone.")


if __name__ == "__main__":
    main()
