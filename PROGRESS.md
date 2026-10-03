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
| M6b | Deploy app + server as two live HTTPS links (mock SMS only) | ✅ done (phone re-check by user) | App https://jirani-eosin.vercel.app · Dashboard https://jirani-coop.onrender.com |
| M7 | Context pack + cause ranking | ⏳ next | Cause logic + 5 scenario tests already exist in the app; needs `build_context_pack.py` (NASA POWER, SoilGrids). |
| M8 | README, DATA.md, EVIDENCE.md, final deploy, phone test | ⏳ | |

## M6b: deploy (mock SMS only)

### Decision (user, 2026-10-03)
We ship with the **mock SMS gateway only**. No Twilio account, no live sending. Neighbour alerts are written to the
outbox as **"would be sent"**. Delivery to real phones needs carrier registration with an SMS provider, which takes
weeks and is out of scope for the hackathon. M6b is now only: deploy the server and the app as two live HTTPS links
and confirm that a sync from the deployed app on a phone appears on the deployed dashboard.
JIRANI_SPEC.md (§10, M6b row, cut order, demo step 6) and README were updated to match.

### Done
- **Gateway kept for later**: `server/sms_gateway.py` keeps the interface, the Twilio client, the allowlist (real sends
  only to `DEMO_SMS_ALLOWLIST`), masking of numbers in errors and the fallback to mock, with their tests.
  `SMS_PROVIDER` defaults to `mock`; `render.yaml` sets `mock` and no provider secrets. `scripts/send_test_sms.py`
  stays as a future delivery check (not used).
- **Recipient set tightened**: `recipient_radius_km` 3.0 → **1.5 km**. The demo cluster (OND-0017 plus synthetic
  OND-0022, OND-0039) reaches **9 plots** (was 27). Tests assert 8–12.
- **Dashboard outbox for the video**: one row per message with time (UTC), recipient plot, full message text and a
  "would be sent" badge, plus a note that real delivery is out of scope. Header shows "SMS: mock (no real SMS is sent)".
  Approve button reads "Approve alert".
- **Deploy config**: `render.yaml` (Render Blueprint, free plan, `/api/health`), `app/vercel.json`,
  `app/public/_headers` (Cloudflare Pages alternative), `.env.example`. App reads `VITE_API_URL` (verified in the
  build); server reads `APP_ORIGIN` for CORS and reseeds the synthetic registry when its DB is empty.
- Exact deploy steps: README → "Deploy".
- Tests: server 15/15, app 26/26.

### Deploy status (2026-10-03)
- [x] **Server on Render**: <https://jirani-coop.onrender.com> (deployed by the user). `/api/health` → 40 synthetic plots, `sms_provider: mock`.
- [x] **App on Vercel**: <https://jirani-eosin.vercel.app> (deployed by the user). Bundle points at the Render URL; model,
      ORT wasm/mjs, audio and content all served (wasm as `application/wasm`).
- [x] **CORS**: `APP_ORIGIN` on Render had been entered with a trailing slash (`https://jirani-eosin.vercel.app/`), so every
      browser preflight from the app was rejected (400). Fixed in code: the server now strips trailing slashes from
      `APP_ORIGIN` (commit 6b17e48, with a test). After Render auto-redeployed, the preflight returns 200.
- [x] **Acceptance (in Claude's in-app browser)**: opened the deployed app → setup OND-0017 → three BRACOL rust photos
      (fetched from the authors' repo through the app's file input) → card "Kutu ya majani, Juu (99%), Juu sana"
      (inference 66 / 33 / 114 ms) → Save → Sync showed the exact packet → Send → "1 zimetumwa ✓" → the deployed
      dashboard shows `1 reports (0 synthetic)` and OND-0017 · B · rust · very high on the visit list.
- [ ] **User**: repeat once from a real phone (open the app URL online, wait for "Offline ready ✓", do a check, Sync → Send),
      then check the dashboard.

### Filming notes
- Render free tier sleeps when idle and wipes its disk on restart: open the dashboard about a minute before filming.
  Reports from earlier sessions may be gone (the synthetic registry reseeds itself). Run
  `python scripts/simulate_outbreak.py --server https://jirani-coop.onrender.com` right before the dashboard scene
  so the phone's rust report tips the draft alert.
- The test report from Claude's browser (OND-0017 B rust) is on the server now. Either leave it or let a restart clear it.

## Open TODOs (cross-milestone)
- `TODO: verify` BRACOL paper volume/article number (DATA.md); meaning of stress code 5.
- Kiswahili text and audio need native speaker review; agronomy text needs agronomist review.
- Real-phone latency numbers for README (Settings → show inference time).
- Real SMS delivery to neighbours (needs a provider with carrier registration; out of scope).
- Out-of-distribution refusal is weak on other crops' leaves (48% single image, 78% with the 3-leaf rule). State it in the video.
