# Jirani build progress

Hackathon deadline: Sunday 4 Oct 2026, 08:00 US Central. Spec: `JIRANI_SPEC.md`. Milestones in order; the user commits.

| # | Milestone | Status | Notes |
|---|---|---|---|
| M0 | Scaffold, BRACOL inspected, split, DATA.md | ✅ done | Mendeley zip truncated at source; all 1,747 leaf crops taken from the authors' repo (esgario/lara2018), ids verified. Stratified 70/15/15 split, seed 150, 1,685 usable (code 5 excluded). |
| M1 | Train, calibrate, tau | ✅ done | MobileNetV3-Small multi-task, 5.8 min on RTX 5060. T = 1.056, tau = 0.76. |
| M2 | ONNX + int8, eval report | ✅ done | Full static int8 collapsed accuracy; shipped **weight-only int8, 1.04 MB**, test stress acc 90.1% (fp32 88.9%). `ml/report/report.md`. |
| M3 | PWA core path, offline | ✅ done | Capture → quality gate → crop → ORT WASM → 3-leaf aggregation → refusal → card. Offline verified with servers stopped. |
| M4 | Trend + history, heatmap | ✅ done | worse/same/better incl. same-day wording; CAM overlay. |
| M5 | SMS + Kiswahili audio | ✅ done | MMS-TTS clips 516 KB (CC-BY-NC, flagged); SMS ≤ 160 GSM-7 tested for every card. SW skipWaiting fix. |
| M6 | Server, outbreak, dashboard, mock outbox | ✅ done | FastAPI + SQLite, draft alert → officer approve → outbox. |
| M6b | Deploy + live SMS (Twilio trial) | 🟡 code done, **waiting on user** | See below. |
| M7 | Context pack + cause ranking | ⏳ next | Cause logic + 5 scenario tests already exist in the app; needs `build_context_pack.py` (NASA POWER, SoilGrids). |
| M8 | README, DATA.md, EVIDENCE.md, final deploy, phone test | ⏳ | |

## M6b: deploy + live SMS (2026-10-03)

### Done (code, tested locally)
- **Recipient set tightened**: `recipient_radius_km` 3.0 → **1.5 km**. The demo cluster (OND-0017 + the two synthetic neighbours OND-0022, OND-0039) now reaches **9 plots** (was 27). Plots at the edge of the synthetic registry reach fewer. Tests assert 8–12 for the demo scenario.
- **Twilio live client** (`server/sms_gateway.py`, plain REST via `requests`, no SDK). Credentials only from env (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`); never logged.
- **Allowlist safety**: real SMS only to numbers in `DEMO_SMS_ALLOWLIST`. In live mode, if `DEMO_PLOT_PHONES` is not set, the nearest one or two alert recipients stand in for the allowlisted phones; everyone else stays mock. Phone numbers inside provider errors are masked before they are stored or shown on the (public) dashboard.
- **Fallback**: any live failure → `failed_fallback_mock` with the provider error; verified on a real uvicorn process with live mode and no credentials (9 rows: 1 fallback with error, 8 mock).
- **Delivery status**: dashboard **Check delivery** button queries Twilio for `sent` rows (status + error code).
- **`scripts/send_test_sms.py`**: sends one test SMS to an allowlisted number, refuses anything else, polls and logs status / error code / segments / price, with hints for common Twilio error codes.
- **Deploy config**: `render.yaml` (Render Blueprint, free plan, health check `/api/health`), `app/vercel.json`, `app/public/_headers` (Cloudflare Pages alternative), `.env.example`. App reads `VITE_API_URL` (verified baked into the build); server reads `APP_ORIGIN`.
- **Exact deploy steps**: `README.md` → "Deploy".
- Tests: server 15/15 (5 new for M6b), app 26/26, typecheck clean.

### Waiting on the user
1. Create the Render and Vercel projects (README → Deploy, steps 1–3) and send the two URLs.
2. Twilio Console: verify the demo phone(s) as Verified Caller IDs; enable Geo permissions for their country.
3. Put credentials in `.env` (local) and Render env vars; run `python scripts/send_test_sms.py --wait 120`; report the logged status / error code.
4. Acceptance (spec M6b): from the deployed app on a phone: sync → report on the dashboard → approve → real SMS on an allowlisted phone; and the same flow with `SMS_PROVIDER=mock`.

### Twilio delivery result
- _Not yet tested (credentials are not available to Claude; the user runs `send_test_sms.py`)._
- Known risks (TODO: verify against current Twilio docs when testing):
  - Trial accounts can only text **Verified Caller IDs** (error 21608 otherwise) and prefix every message with a trial notice, so alerts become 2 segments.
  - **US destinations:** unregistered US long-code traffic can be carrier-blocked (A2P 10DLC, error 30034). Toll-free numbers need verification (error 30032).
  - **Kenya destinations:** Geo permissions must be enabled (error 21408); delivery can be filtered (30007).
- Rule from the user: if delivery fails, spend at most 30 minutes, keep the mock, record the outcome here, move on.

## Open TODOs (cross-milestone)
- `TODO: verify` BRACOL paper volume/article number (DATA.md); meaning of stress code 5.
- Kiswahili text and audio need native speaker review; agronomy text needs agronomist review.
- Real-phone latency numbers for README (Settings → show inference time).
- Out-of-distribution refusal is weak on other crops' leaves (48% single image, 78% with the 3-leaf rule). State it in the video.
