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
| M7 | Context pack + cause ranking | ✅ done (redeploy needed) | Real NASA POWER + SoilGrids packs for all 40 plots; ranked causes on the card. See below. |
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

## M7: context pack + cause ranking (2026-10-03)

### Done
- `scripts/build_context_pack.py` writes `app/public/context/<plotId>.json` for all 40 synthetic plots.
  - Weather: NASA POWER daily point API (v2.10, community AG). It gives `PRECTOTCORR`, `T2M` and `RH2M` from Jan 2015 to the latest published day (data currently ends 2026-09-30, about a 3-day lag).
    - Rain for the last 30 and 90 days is compared with the mean of the same calendar window over the previous 10 years.
    - 30-day mean temperature and humidity are included.
    - One grid cell covers the whole cooperative, so all plots share the weather numbers.
  - Soil: ISRIC SoilGrids v2.0, `phh2o` 0–5 cm mean (pH × 10 → pH), queried per plot, throttled to about 5 per minute.
  - Raw responses are cached in `scripts/cache/` (gitignored). The pack carries `synthetic_location: true` and the caveat.
- **Real numbers for the demo plot OND-0017** (built 2026-10-03; synthetic location):
  - 90-day rain 131.1 mm vs. normal 262.9 mm (≈ 50%). This fires the draft `dry_spell` cause (< 60%).
  - 30-day rain 68.0 vs. 86.1 mm.
  - 30-day mean temperature 15.4 °C and humidity 80.1%. 15.4 °C is below the draft 18–26 °C band, so there is no "warm and wet" note for rust.
  - Soil pH 6.2, so there is no acidity cause. pH across the 40 plots is 6.0–6.2.
- **Card check (dev app, OND-0017 pack):**
  - Confident rust, sprayed = yes → disease (very high) › dry spell › sprayed recently › not covered.
  - Healthy leaves → dry spell › not covered.
  - Not sure → no disease line; dry spell shown as "Context only, not from the leaves".
  - Pack age is shown on every card. A pack older than 30 days shows "context unavailable" plus its age.
- Unit tests for the five spec scenarios (and two more) pass: app 26/26.
- DATA.md rows added for NASA POWER and SoilGrids, including what they do not cover.

### Not done / limits
- Thresholds (60% / 40% of normal rain, pH < 5.0, 18–26 °C with RH ≥ 75% or above-normal rain) are **draft heuristics, not validated agronomy**.
- Packs are bundled with the app, so a refresh means rebuilding the packs and redeploying the app. The spec's "built at sync time" is approximated by "built at deploy time".
- `TODO: verify` the NASA POWER acknowledgement wording and the SoilGrids licence on their sites.
- **The live app does not have the packs yet.** Commit and push so Vercel rebuilds.

## Open TODOs (cross-milestone)
- `TODO: verify` BRACOL paper volume/article number (DATA.md); meaning of stress code 5.
- Kiswahili text and audio need native speaker review; agronomy text needs agronomist review.
- Real-phone latency numbers for README (Settings → show inference time).
- Real SMS delivery to neighbours (needs a provider with carrier registration; out of scope).
- Out-of-distribution refusal is weak on other crops' leaves (48% single image, 78% with the 3-leaf rule). State it in the video.
