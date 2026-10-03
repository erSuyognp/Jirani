"""SMS gateway behind one interface. SMS_PROVIDER=mock (default) or live.

- mock: nothing leaves the server; outbox rows get status 'would_send'. Always works.
- live: real SMS through a provider's trial/sandbox tier, BUT only to numbers on DEMO_SMS_ALLOWLIST.
  Synthetic plots have no real numbers; DEMO_PLOT_PHONES maps one or two of them to the team's own phones.
  Every other recipient goes through the mock. Any live failure falls back to the mock with the error recorded.
Credentials come from environment variables only (see .env.example).

Hackathon build decision (2026-10-03): ships with the MOCK only. Real delivery needs carrier registration with an
SMS provider, which takes weeks and is out of scope. The live path, allowlist and tests stay for later.
"""
import os
import re
from dataclasses import dataclass
from typing import Callable, Optional, Protocol

import config


@dataclass
class SendResult:
    status: str                 # would_send | sent | failed_fallback_mock
    provider: str               # mock | <live provider name>
    provider_id: Optional[str] = None
    error: Optional[str] = None
    to_number_masked: Optional[str] = None


class LiveClient(Protocol):
    name: str

    def send(self, to: str, body: str) -> str:  # returns provider message id; raises on failure
        ...


def mask(number: str) -> str:
    return number[:4] + "*" * max(0, len(number) - 7) + number[-3:] if len(number) > 7 else "***"


def normalise(number: str) -> str:
    return "".join(c for c in number if c.isdigit() or c == "+")


class Gateway:
    def __init__(self, mode: str, allowlist: list[str], plot_phones: dict[str, str],
                 client_factory: Optional[Callable[[], LiveClient]] = None):
        self.mode = mode
        self.allowlist = {normalise(n) for n in allowlist}
        self.plot_phones = {k.strip(): normalise(v) for k, v in plot_phones.items()}
        self.client_factory = client_factory
        self._client: Optional[LiveClient] = None

    def map_demo_recipients(self, recipients: list[str], max_phones: int = 2) -> None:
        """Live demo without explicit DEMO_PLOT_PHONES: the nearest one or two SYNTHETIC recipient plots stand in
        for the team's allowlisted phones. Anything not on the allowlist still never receives a real SMS."""
        if self.mode != "live" or self.plot_phones:
            return
        phones = sorted(self.allowlist)[:max_phones]
        self._auto = dict(zip(recipients, phones))

    def allowed_number_for(self, plot_id: str) -> Optional[str]:
        """The real number for a plot ONLY if it is on the allowlist. Never anything else."""
        n = self.plot_phones.get(plot_id) or getattr(self, "_auto", {}).get(plot_id)
        return n if n and n in self.allowlist else None

    def send(self, plot_id: str, body: str) -> SendResult:
        if self.mode != "live":
            return SendResult("would_send", "mock")
        to = self.allowed_number_for(plot_id)
        if to is None:
            return SendResult("would_send", "mock")
        try:
            if self._client is None:
                if self.client_factory is None:
                    raise RuntimeError("live mode but no SMS provider configured")
                self._client = self.client_factory()
            pid = self._client.send(to, body)
            return SendResult("sent", self._client.name, provider_id=pid, to_number_masked=mask(to))
        except Exception as e:  # a provider outage must never break the demo
            err = re.sub(r"\+?\d[\d ]{6,}\d", lambda m: mask(normalise(m.group())), f"{type(e).__name__}: {e}")
            return SendResult("failed_fallback_mock", "mock", error=err[:300], to_number_masked=mask(to))


class TwilioClient:
    """Twilio Programmable Messaging REST API (trial account). Credentials from env only; never logged."""
    name = "twilio"
    API = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages"

    def __init__(self, sid: str, token: str, from_number: str, timeout: float = 15.0):
        if not (sid and token and from_number):
            raise RuntimeError("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER must be set")
        self.sid, self._token, self.from_number, self.timeout = sid, token, from_number, timeout

    def _url(self, suffix=""):
        return self.API.format(sid=self.sid) + suffix + ".json"

    @staticmethod
    def _err(r):
        try:
            j = r.json()
            return f"HTTP {r.status_code} Twilio error {j.get('code')}: {j.get('message')}"
        except Exception:
            return f"HTTP {r.status_code}"

    def send(self, to: str, body: str) -> str:
        import requests
        r = requests.post(self._url(), data={"To": to, "From": self.from_number, "Body": body},
                          auth=(self.sid, self._token), timeout=self.timeout)
        if r.status_code >= 300:
            raise RuntimeError(self._err(r))
        return r.json()["sid"]

    def status(self, message_sid: str) -> dict:
        """Delivery status: queued | sending | sent | delivered | undelivered | failed, plus error code."""
        import requests
        r = requests.get(self._url("/" + message_sid), auth=(self.sid, self._token), timeout=self.timeout)
        if r.status_code >= 300:
            raise RuntimeError(self._err(r))
        j = r.json()
        return {k: j.get(k) for k in ("sid", "status", "error_code", "error_message", "num_segments", "price",
                                      "date_sent")}


def twilio_from_env() -> TwilioClient:
    return TwilioClient(os.environ.get("TWILIO_ACCOUNT_SID", ""), os.environ.get("TWILIO_AUTH_TOKEN", ""),
                        os.environ.get("TWILIO_FROM_NUMBER", ""))


def live_client_factory() -> Optional[Callable[[], LiveClient]]:
    if config.SMS_LIVE_PROVIDER == "twilio":
        return twilio_from_env
    return None  # unknown/unset provider: live mode falls back to mock with the error recorded


def from_env() -> Gateway:
    return Gateway(config.SMS_PROVIDER, config.DEMO_SMS_ALLOWLIST, config.DEMO_PLOT_PHONES, live_client_factory())
