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

### Narration for the simulation (2026-10-03)
- 16 fixed lines (`server/narration.json`: one per step and a closing line), written in plain language, turned into MP3 clips by `scripts/build_narration.py` with ElevenLabs text-to-speech (model `eleven_multilingual_v2`, the stock voice the user's ElevenLabs agent is configured with). 2,277 characters, 2 min 14 s, 2.1 MB in `server/static/narration/`.
- The API key is read from `.env` (gitignored) at build time only. It is not in the repo, the server or the page. The ElevenLabs agent itself is not used: a live voice agent would be a language model answering at runtime, which the project says it does not have.
- Page: narration plays with each step and the step waits for it; a "Narration" switch turns it off; the page banner and the switch say "AI-generated voice". Without the clips the page works silently.
- Recorder: logs when each clip starts and, with ffmpeg, muxes the clips onto the picture as `recordings/jirani-simulation.mp4` (H.264 + AAC).
- Checked: full narrated run in headless Edge against the production build of the app, all 16 clips played; MP4 is 1920x1080, 2 min 58 s, with sound (mean -25 dB); frames checked. On wide screens the page now fits the window exactly, so the dashboard jumping to a section no longer scrolls the page. Server tests 24/24 include a check that the clips match the script.
- Not checked: listening to the clips (I cannot hear them), so pronunciation and pacing are unreviewed; narration on the live site.

### Agriculture-track gaps: harvest slot, Gikuyu prompts, capture card (2026-10-03)
Source: `JIRANI_ADD_FEATURES_PROMPT.md` (8 items). No step needed an LLM, a product name, a live SMS gateway or
retraining, so nothing was stopped. The model, tau (0.76) and the refusal rule are untouched.

**Added**
1. **Harvest slot (cherry band + ticket range).**
   - Optional fourth photo after the three leaves. `app/src/capture/cherry.ts` grades it A, B or C with a deterministic
     colour-and-defect heuristic (share of ripe red, unripe green and blackened pixels on the white card). It refuses
     (no band) when the photo is dark, shows no white card, or shows too little fruit. Thresholds in `CONFIG.cherry`.
   - The card shows "Band B. Last coop tickets 310–340 USD/50kg. Not a price offer." plus "Prototype grade, not a
     trained model. Confirm at the factory." and "Demo tickets are synthetic, not market prices." Without the photo:
     "No cherry photo. No grade." With a photo that cannot be graded: "Cherry photo not clear. No grade."
   - Buyer tickets: 9 synthetic tickets in `scripts/seed_cooperative.py` → `server/seed_plots.json` and
     `app/public/content/plots.json` (plot coordinates unchanged). Server: `buyer_tickets` table, filled from the seed
     at start-up, `GET /api/buyer-tickets`, kept by a simulation reset.
   - SMS: " Band B." is appended when a band exists; " Band B, tickets 310-340 USD/50kg, no offer." is used instead
     when it still fits 160 characters. Audio: `harvest.band.A/B/C` and `harvest.tickets.A/B/C` clips.
   - The band is a separate slot. It never changes the diagnosis; a refusal stays a refusal (unit test).
2. **Gikuyu, phrase-locked.** "Play prompt (Gikuyu)" on each of the three questions plays a recorded clip if there is
   one, then shows the question in Kiswahili. Clip pack and manifest in `app/public/audio/ki/` (3 prompts, 5
   confirmations). After a prompt was pressed, the answer's confirmation clip plays too (yes / no / not sure; upper /
   lower block only if a block has that name). Settings carries the fixed fallback sentence, and the result card has
   a picture row (three leaves, tick / cross / question mark, cherry band) so that sentence is true.
3. **Printable capture card.** `scripts/build_capture_card.py` → `app/public/capture-card.pdf` and
   `server/static/capture-card.pdf` (A4, 3 KB, no PDF library). The capture screen shows the card as a diagram with the
   current box highlighted and links to the PDF. "White paper" is gone from the app, the officer's "retake" texts and
   the project page.
4. **Rule line in the causes slot**, both languages: "Rain and soil are cached estimates, not a second model. They
   never override a low-confidence leaf." Missing or stale pack: "No fresh rain or soil note."
5. **Onboarding line** under the welcome text, both languages. No account, no permission, no login.
6. **Project page.** Primary button "Open the farmer app" (top bar, hero, final section); simulation and dashboard
   are secondary. Hero stat is the three-leaf rule (75.6% of 82 simulated triples answered, 100% right when it
   answered). 90.1% moved under "Also measured" with miner recall 75.9% and cercospora recall 72.7%. PlantDoc 48% /
   78% stays, with "about one in five such triples still gets a confident answer". Limits: Brazilian leaves,
   machine-drafted Kiswahili until human clips land, Gikuyu placeholders, cherry prototype, synthetic plots and
   tickets, mock SMS. The dashboard header now links the farmer app first; the dashboard is otherwise unchanged.
7. **Audio licence note** in DATA.md ("Audio licence") and in the project-page limits. `build_audio.py --missing`
   builds only clips whose file does not exist, so human recordings dropped in with the same names are kept.
8. **Holdout hook.** `ml/holdout/README.md` and an empty `ml/holdout/ke/`. Nothing reads the folder.
- README: demo order is farmer app, simulation, dashboard; features F7, F8 and the card; limits; rebuild commands.
- **Android app.** Rebuilt (version 1.1.0, code 3) and installed on the Galaxy A14. In the app the capture-card link
  opens the native share sheet with the PDF, because the WebView cannot show one.

**Still placeholder**
- **Gikuyu clips: none recorded.** The control is silent and only shows the Kiswahili question. The app, the project
  page and Settings say "Gikuyu clips are placeholders. Replace with human recordings before judging." Record the
  eight clips listed in `app/public/audio/ki/manifest.json`, set `recorded: true` on each and `placeholder: false`.
- **Cherry band: a heuristic**, checked on generated images and on four real web photos (see below). Never run on a
  handful of cherry photographed on the printed card.
- **Buyer tickets: synthetic** demo numbers.
- **Kiswahili: machine-drafted**, including the six new clips (MMS-TTS, non-commercial) and every new string.
- **`ml/holdout/ke/`: empty.**

**Decisions and deviations**
- **The unit "USD/50kg" lives in the registry, not in `answers.json`.** The no-dosage scan flags a number followed by
  "kg", and that check was left as it is. The sentence template is fixed; the two amounts and the unit come from the
  cooperative's tickets.
- **The ticket range is rarely in the SMS.** The existing message already uses 94 to 160 characters. Over every card,
  three block names, three bands and both languages (1,278 cases, counted by the unit test): 54 carry the range, 1,155
  the band only, 69 neither (no room). In practice only short messages such as "Not sure" get the range. The card and the audio always carry it.
- **No fiducial detector, so no "card not seen" warning.** Each photo is one box filling the frame, so the corner
  marks are never in the picture; a detector would warn on every photo. The quality gate is unchanged and is still
  the only gate. The marks and the 20 mm bar are printed for a later whole-card photo.
- **Ticket clips say fixed amounts.** They are built from the seed. `manifest.json` records the amounts, the app
  plays a ticket clip only when they equal the range on the card, and a unit test fails when they drift.
- **The simulation page still says "Three leaves on white paper"**, which is true of its sample photos; its
  narration clips are tied to that script. The simulation skips the cherry photo, so its card shows "No cherry
  photo. No grade."
- The cherry band is not stored in history and not sent to the cooperative; the report packet is unchanged.

**Checked**
- Tests: app 39/39 (was 29), server 25/25 (was 24), typecheck clean.
- Browser, dev build, phone width: three sample rust leaves + a generated cherry image (20 red, 4 green discs) →
  "Band B. Last coop tickets 310–340 USD/50kg. Not a price offer." in English and Kiswahili, SMS 138 characters with
  " Daraja B."; dark-table image → "too dark, no grade"; empty card → "no cherry found"; three mixed leaves + an
  all-red image → "Not sure", "Do not spray", with Band A in its own slot; Gikuyu control → placeholder note and the
  Kiswahili question; Settings notes.
- **Offline:** production build, service worker active, preview server stopped, page reloaded: a full check rendered
  the card with the cherry photo (Band A) and without it ("No cherry photo. No grade."). The new clips, the Gikuyu
  manifest, `plots.json` and the PDF were served from the cache.
- Project page at 1280 px and 375 px: button order, hero stat, tables, limits, no horizontal overflow (read from the
  page; screenshots were not available in this session).
- Capture card: PDF structure validated (objects, offsets, stream length) and its drawing commands redrawn as an image
  to check the layout. **Not opened in a PDF viewer and not printed**, so the 20 mm bar is not measured on paper.
- Galaxy A14, new APK: existing history kept; capture screen with the card diagram; the PDF link opens the share
  sheet with `jirani-capture-card.pdf`; three gallery leaves → cherry step → questions (Gikuyu prompt shows the
  Kiswahili line) → "Leaf rust, very low, 99%" with the picture row, the rule line and "No cherry photo. No grade."
  (236 / 92 / 66 ms). The result was not saved.
- **Not checked:** a cherry photo on the phone (camera or gallery); audio playback of the new clips by ear; the live
  sites (needs a push; Vercel and Render then rebuild); the simulation page end to end after these changes.

**Real cherry photos (later the same day)**
- Four photos from Wikimedia Commons were downloaded (originals in the gitignored `app/dev-samples/cherry/`) and run
  through the heuristic: two ripe cherries on white → band A; cut fruit and pale beans on white → band C; a coffee
  tree → refused ("no card"); **cherries on a branch → band C, which is wrong: there is no card in that photo.**
- Cause: pale leaf highlights counted as "white card" (15.4% of the frame against a 15% minimum). Fix in
  `CONFIG.cherry`: a card pixel must now be near-neutral (saturation below 0.2) and bright (value from 0.55), and the
  card must fill at least 25% of the photo. The two on-tree photos now reach 7 to 8% and are refused; the two
  on-white photos reach 51 to 60%. The limits come from the white paper in the BRACOL-style sample leaves
  (saturation up to 0.15, value from 0.56).
- The four photos are regression fixtures now (64 px thumbnails in `app/src/capture/fixtures/`, sources and licences
  in its README and in DATA.md).
- Galaxy A14, rebuilt APK: the on-branch photo → "The card is not visible around the cherry. No grade."; the two
  ripe cherries on white → "Cherry photo added", then on the card "Band A. Last coop tickets 355–390 USD/50kg. Not a
  price offer." The three leaves in that check gave "Not sure" (66%), and the card still said "Do not spray" and
  "Not sure. Ask a person." next to Band A. Not saved.
- Three test images are left on the phone in `Pictures/Jirani/`: `cherry_test_generated.jpg`,
  `cherry_real_two_ripe_on_white.jpg`, `cherry_real_on_branch.jpg`.
- Still not done: a real handful of cherry on the printed card, photographed with the phone camera.

### Waiting on the user
- [ ] **Record the Gikuyu clips** (8 short clips, list in `app/public/audio/ki/manifest.json`), or accept the placeholder note in the demo.
- [ ] **Print the capture card once** at 100% and measure the 20 mm bar.
- [ ] Try the cherry photo with real cherry (or anything red on the card) before showing the band in the video.
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
- Gikuyu clips need a human speaker; the cherry band needs real cherry photos (ideally a trained head) before it is more than a prototype.
- A block name of 8 characters can make the longest result SMS 161 characters (the app then fails to build it). The registry only has blocks A to D, so it cannot happen in the demo; cap the name at 7 characters or shorten a template before using longer names.
