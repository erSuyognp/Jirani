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
| M7 | Context pack + cause ranking | ✅ done (live) | Real NASA POWER + SoilGrids packs for all 40 plots; ranked causes on the card. See below. |
| M8 | README, DATA.md, EVIDENCE.md, final deploy, phone test | 🟡 done except the **real-phone airplane test** (user) | See below. |

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
- [ ] **User**: repeat once from a real phone (open the app URL online, wait for "Ready to work without internet", do a check, Sync → Send),
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
  - Soil pH 6.0, so there is no acidity cause. pH across the 40 plots is 5.8–6.2. (Rebuilt after the plots moved to the Nyeri coffee area; at the first location these were 6.2 and 6.0–6.2. The weather numbers did not change: same NASA POWER cell.)
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
- Live app serves and precaches all 40 packs (checked 2026-10-03).

## M8: docs, final deploy, fresh-clone check (2026-10-03)

### Done
- **README.md** covers:
  - who it is for and the problem in one sentence
  - features F0–F4 and the handoff
  - architecture diagram and stack
  - **measured results table** (from `ml/report/metrics.json`)
  - exact run commands (app, server, dataset + model reproduction, context and audio packs)
  - guardrails and known limits
  - a table of what is synthetic, machine-drafted or unreviewed
  - the deploy steps
- **EVIDENCE.md**: facts with source, year, country and URL, each checked where possible in the primary document:
  - GSMA *Mobile Gender Gap Report 2025* press release: LMIC and Sub-Saharan Africa figures
  - Kenya *Agricultural Sector Extension Policy* 2023: target of 1:600 by 2029; "ratio … has not improved"
  - ICO *Country Coffee Profile: Kenya* 2019: about 800,000 smallholders in about 500 cooperatives; cooperatives produced 30,381 of 41,375 t in 2017/18; yields 302 vs. 556 kg/ha
  - FAOSTAT via OWID: Kenya 0.436 t/ha in 2024 vs. Brazil 1.74
  - Kenya-specific GSMA figures and the current extension ratio (1:1,000 / 1:1,380) are marked `TODO: verify`.
- **DATA.md**: complete (BRACOL Mendeley + GitHub, OOD sets, perturbed set, NASA POWER, SoilGrids, TTS model, synthetic registry), each with what it does not cover.
- **Final deploy**: `main` pushed; the Vercel app serves the M7 context packs (40 precached); the Render server is live in mock SMS mode.
- **Fresh clone** (`git clone` into a scratch folder, following the README):
  - App: `npm install` → `npm test` 26/26 → `npm run build` OK.
  - Server, new venv: `pip install -r server/requirements-dev.txt` → `pytest` 16/16 → uvicorn starts and seeds 40 plots → `simulate_outbreak.py --all` creates a draft alert → dashboard 200.
  - Training reproduction was not re-run from the clone (it needs the BRACOL download); the commands are the ones used for M0–M2.

### Android app (2026-10-03)
- Capacitor 8 wrapper in `app/android` (`npm run build:android`, then `gradlew assembleDebug`). Web assets, model, wasm, audio and context packs ship inside the APK, so it is offline-ready on first launch (no service worker).
- Native share sheet for the audio file (`@capacitor/share` + `@capacitor/filesystem`). Sync uses `CapacitorHttp`, so the server's CORS list is unchanged.
- World Bank-style theme: navy `#002244` with cyan `#009FDA` (web app too). Adaptive launcher icon and splash screen in the same colours. No World Bank logo or name.
- Tested over adb on a Samsung Galaxy A14 (SM-A146B):
  - setup → 3 sample rust leaves from the gallery → **Leaf rust, High (99%)**, with heatmaps
  - share audio opens the share sheet (`jirani-matokeo.wav`)
  - Save → Sync → Send → "1 sent ✓"; the report shows on the live dashboard
  - 204 / 82 / 90 ms per leaf
- Not tested on the APK: airplane mode, the camera button, the SMS link (no basic-phone number set), a "Not sure" photo.

### Product UI pass (2026-10-03)
- UI layer rebuilt (web app and APK share it); diagnosis, refusal, trend, causes, SMS and sync logic are unchanged (26/26 tests).
  - `app/src/ui/`: `App.tsx` (state, navigation), one file per screen, `widgets.tsx`, `native.ts` (Capacitor glue).
  - Icon set (`lucide-react`) instead of emoji; bottom navigation; first-launch welcome → setup; Home shows the latest result per block.
  - Check flow with step bar, in-app dialogs (stop a check, save a result, clear data) and toasts; no browser `confirm()`.
  - Result card keeps the seven slots, the draft line, heatmaps and the latency line; it now follows the language switch.
  - Sync lists the queued reports and still shows the exact JSON. Server address, latency toggle and demo data moved to Settings → Advanced.
- Android shell: edge-to-edge with safe-area insets, hardware back button, haptics, portrait lock, `allowBackup="false"`, version 1.0.0 (code 2), Capacitor template tests removed.
- Checked on the Galaxy A14 over adb: gallery → 3 leaves → result (270 / 88 / 89 ms) → save; back button and both dialogs; Kiswahili and English; the SMS button opens the Android app chooser (no message sent).
- Not checked on the phone: first-launch welcome/setup (browser only; the phone kept its data), the camera button, audio playback, share sheet, Sync → Send with the new screen, airplane mode.
- New Kiswahili UI strings are machine-drafted like the rest.

### Landing page, dashboard redesign, real coffee area (2026-10-03)
- Server: `/` is now a landing page (problem with sourced facts, how it works, measured results, guardrails and limits, two phone screenshots); the dashboard moved to **`/dashboard`**. Approve / Dismiss redirect there.
- Dashboard: same navy/cyan design as the app, KPI tiles, satellite / street-map toggle (Esri World Imagery, OpenStreetMap), popups, visit list with severity bars, outbox. The "Demo data is synthetic" banner, "fictional" label and "would be sent" wording are kept. The map view and layer survive the 15 s refresh.
- Registry: the 40 synthetic plot points moved from Nyeri town centre to a real smallholder coffee area near Wamagana, Nyeri County (centre -0.4920, 36.9480; source notes in DATA.md). Offsets between plots are unchanged, so the demo cluster is the same (OND-0022 0.79 km, OND-0039 1.00 km, 9 recipients). The points are still random and not real farms.
- `sync_registry` updates plot coordinates in an existing database from `seed_plots.json` on startup. Alerts already stored in an old local database keep their old centre.
- Context packs rebuilt for the new coordinates (40/40, soil pH 5.8–6.2). The app and APK bundle the new `plots.json` and packs.
- Tests: server 18/18 (new: landing + dashboard render, registry sync), app 26/26.
- Checked locally on port 8010 with a fresh database: landing page (desktop width) and dashboard (desktop and 500 px wide) render, simulate_outbreak → draft alert → Approve → 9 "would be sent" rows.
- Not checked: the live Render deploy (needs a push), the landing page at phone width, the "Map" street layer. The rebuilt APK (new plot coordinates and packs) is installed on the Galaxy A14 and opens to Home; no check was run on it after this rebuild.

### Ask the officer: opt-in photos and fixed replies (2026-10-03)
- **Decision (user, 2026-10-03):** leaf photos may leave the phone when the farmer asks for advice. This replaces the spec's "photos never leave the phone" (guardrail 5) with "photos leave only when the farmer chooses, per check".
- App:
  - A switch on the result card, "Ask the extension officer", off by default. Saving with it on stores that check's three leaf images (canvas re-encoded, 640 px, no EXIF) in a new IndexedDB store (`asks`, database version 2).
  - Sync lists the photos that will go, sends them after the report (`POST /api/consults`), then asks for replies (`GET /api/consults/replies`). With nothing left to send, the button reads "Check for the officer's reply".
  - A reply shows on Home as a notice and in History under the check, using the same action and do-not text as the card (`answers.json`), with an SMS button when a basic-phone number is set.
- Server and dashboard:
  - `consults` table; photos are accepted only for an existing report of the same plot, 1 to 3 JPEGs, no other fields. Report packets still refuse photos.
  - "Photo requests from farmers" panel: the photos, what the app said, and a reply from a fixed list (diagnosis + low/high, "I will visit", "photos not clear"). No free text, so the no-chemicals rule and Kiswahili coverage hold.
- Tests: app 28/28 (every reply in both languages fits one GSM-7 SMS), server 20/20.
- Checked end to end in the browser against a local server: "Not sure" check with the switch on → Sync showed 3 photos (38 KB) → Send → request on the dashboard → reply "Leaf rust, high" → app showed "Officer replies: 1", the Home notice and the reply in History. The database upgraded from version 1 with data in place.
- Checked on the Galaxy A14 (new APK): existing history survived the database upgrade; a gallery check with the switch on saved, and Sync listed "Block C, 3 leaf photos, about 67 KB". **Send was not pressed on the phone**: the APK talks to the live Render server, which does not have the new endpoints until this is pushed. Until then a Send delivers the reports and leaves the photos queued with an error.
- Fix after the first live try (2026-10-03): the officer's reply did not reach the phone.
  - Cause: an older photo request on the phone was rejected (HTTP 422) because its report had been sent before the deploy and Render wiped the database on redeploy; the app stopped at that error and never asked for replies.
  - Fix in the app: a failed photo request stays queued without blocking the others or the replies; on a 422 the app re-sends that check's report and retries. Fix on the server: the replies endpoint also lists requests it no longer has (`unknown`), and the app queues those again.
  - Also fixed: the Home notice for a new reply was laid out as a column (CSS class clash); History now scrolls to a new reply.
  - Verified on the Galaxy A14 against the live server: Send delivered the stuck Block C photos, the reply ("Cercospora leaf spot", high) arrived, the Home notice showed, and History shows the reply under the check. The server-side `unknown` part is not live until pushed.
- Limits:
  - The dashboard has no login, so sent photos are visible to anyone with the link. Render's free plan wipes them on restart.
  - "Clear all data on this phone" does not delete photos already sent to the server.
  - The phone gets the reply only when the farmer presses Sync again; there is no push message.
  - New strings and reply texts are machine-drafted Kiswahili.

### Visit queue: tickets, schedule, farmer notice (2026-10-03)
- Server (`server/tickets.py`, values in `config.TICKETS`, all DRAFT):
  - A ticket opens for a block when its latest report is a confident disease at severity high or above, or at low or above with trend "worse"; when the officer answers a photo request with "I will visit"; or by hand ("Add to queue" on the visit list). One active ticket per block.
  - Score: 10 per severity level, +5 worsening, +3 in an open outbreak alert, +4 promised visit, +1 per day waiting (max 5). Highest goes first.
  - Suggested dates: from tomorrow (UTC), 4 visits a day (2 morning, 2 afternoon), no Sundays, after already confirmed visits.
- Dashboard: "Visit queue: where to go first" with rank, reasons, a date and morning/afternoon the officer can change, Confirm visit / Change, Visited, remove. Rank numbers also show on the map; a KPI tile counts visits to schedule.
- A person decides: the farmer is told nothing until the officer confirms. Confirming writes a visit SMS to the mock outbox ("would be sent") and exposes the visit to the phone (`GET /api/visits?plotId=`).
- App: Sync now always has a button ("Send", or "Check for news from the cooperative" when nothing is queued). After a sync, Home shows an "Officer visit" card: the sentence with block, weekday and date, morning or afternoon, and four fixed "until then" steps from `answers.json`, plus an SMS button for the basic phone. Past visits drop off Home.
- Tests: server 23/23 (ranking, one ticket per block, nothing told before confirmation, past dates refused, capacity, promised visit, manual ticket, SMS length), app 29/29 (visit text and SMS in both languages).
- Checked end to end in the browser against a local server: synthetic reports → 4 tickets ranked (very high first) → confirm OND-0017 → app "Check for news" → Home card "The officer will visit Block B on Monday 5 October, in the morning." with the four steps.
- Not checked: on the phone against the live server (needs a push first); the "Visited" and remove buttons in a browser (covered by tests only).
- Limits: the visit steps are draft and not reviewed by an agronomist; the phone learns about a visit only when the farmer presses Sync; anyone who knows a plot id can read its confirmed visit dates; one officer and one capacity for the whole cooperative.

### Simulation page and recording (2026-10-03)
- `/simulation` on the server: the real app in a phone frame (iframe, `?sim=1`) beside the live dashboard, with 15 steps (Play all / Next step). Linked from the landing page and the dashboard.
- App simulation mode (`app/src/sim.ts`, `app/src/ui/simDriver.ts`): only when the URL has `?sim`; separate IndexedDB (`jirani-sim`); preloads one labelled demo check; receives step names by `postMessage` and taps through the real UI with a visible marker; sample photos replace the camera; reports are flagged `synthetic`. The model really runs on the sample photos.
- Server helpers: `POST /simulation/reset` (clears reports, alerts, outbox, photo requests, tickets), `POST /simulation/neighbours` (two synthetic neighbour reports), `GET /simulation/state` (ids for the simulated officer clicks). The officer steps use the normal dashboard endpoints.
- Sample photos: six held-out BRACOL test leaves and one non-leaf image (`app/public/sim/`, 96 KB, not precached by the service worker). The three rust leaves give "Leaf rust, High, worse than 14 days ago"; the three mixed leaves give "Not sure".
- `scripts/record_simulation.cjs` records the page with Edge headless (playwright-core, installed with `--no-save`).
- Checked: full run in headless Edge against the local server and dev app, all 15 steps, about 2 min 15 s; frames checked at each step. Recording: `recordings/jirani-simulation.webm` (1920x1080, 2:19, VP8; folder is gitignored).
- Not checked: the simulation on the live sites (needs a push; Vercel must serve the new app build), other browsers than Edge/Chromium, the page on a phone-width screen.
- Limits: playing the simulation wipes the server's demo data and needs no login; in Safari and Firefox the embedded app's storage rules may differ; a `.webm` may need converting to `.mp4` for some video editors.

### Waiting on the user
- [ ] **Real-phone test in airplane mode** (spec M8 acceptance):
  1. Open https://jirani-eosin.vercel.app online and wait for "Ready to work without internet".
  2. Turn on airplane mode.
  3. Do a 3-leaf check, plus one bad photo → "Not sure".
  4. Open the SMS link, then play the audio.
  5. Airplane mode off → Sync → Send → see it on https://jirani-coop.onrender.com.
- [x] Real-phone per-leaf inference times in README (Galaxy A14, Android app).
- [ ] Android app: airplane-mode check with the camera, a bad photo, and the SMS link with a basic-phone number set.
- [ ] Resolve or drop the `TODO: verify` items in EVIDENCE.md and DATA.md before quoting them in the video.

## Open TODOs (cross-milestone)
- `TODO: verify` BRACOL paper volume/article number (DATA.md); meaning of stress code 5.
- Kiswahili text and audio need native speaker review; agronomy text needs agronomist review.
- Real SMS delivery to neighbours (needs a provider with carrier registration; out of scope).
- Out-of-distribution refusal is weak on other crops' leaves (48% single image, 78% with the 3-leaf rule). State it in the video.
