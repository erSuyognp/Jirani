"""SMS gateway behind one interface. SMS_PROVIDER=mock (default) or live.

- mock: nothing leaves the server; outbox rows get status 'would_send'. Always works.
- live: real SMS through a provider's trial/sandbox tier, BUT only to numbers on DEMO_SMS_ALLOWLIST.
  Synthetic plots have no real numbers; DEMO_PLOT_PHONES maps one or two of them to the team's own phones.
  Every other recipient goes through the mock. Any live failure falls back to the mock with the error recorded.
Credentials come from environment variables only (see .env.example).
"""
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

    def allowed_number_for(self, plot_id: str) -> Optional[str]:
        """The real number for a plot ONLY if it is on the allowlist. Never anything else."""
        n = self.plot_phones.get(plot_id)
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
            return SendResult("failed_fallback_mock", "mock", error=f"{type(e).__name__}: {e}"[:300],
                              to_number_masked=mask(to))


def live_client_factory() -> Optional[Callable[[], LiveClient]]:
    """Provider is chosen at M6b (Twilio trial or Africa's Talking sandbox). Until then live mode falls back."""
    if config.SMS_LIVE_PROVIDER == "":
        return None
    raise NotImplementedError(f"live provider {config.SMS_LIVE_PROVIDER!r} not wired yet (M6b)")


def from_env() -> Gateway:
    try:
        factory = live_client_factory()
    except NotImplementedError:
        factory = None
    return Gateway(config.SMS_PROVIDER, config.DEMO_SMS_ALLOWLIST, config.DEMO_PLOT_PHONES, factory)
