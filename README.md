# Jirani
**Diagnose, track, warn.** An offline leaf check for coffee farmers that runs on a phone the family already has,
says what is likely wrong (or "not sure, ask a person"), hands the result to a basic phone, and lets the cooperative
warn neighbouring farms.

**Live:** farmer app <https://jirani-eosin.vercel.app> · cooperative dashboard <https://jirani-coop.onrender.com> (demo data is synthetic)

Hack-Nation 7th Global AI Hackathon, Challenge 04 *Small AI for Development* (World Bank Youth Summit), Agriculture.
"Jirani" means "neighbour" in Kiswahili.

## Who it is for

Noor (the challenge persona) farms 2 ha in the fictional Ondera highlands and belongs to a coffee cooperative.
Her coffee yields dropped and she cannot say why.
- Her own phone is a basic phone.
- The household smartphone belongs to her daughter and is home only at weekends.
- There is no Wi-Fi, and the extension officer visits twice a year.

**Problem in one sentence:** a smallholder coffee farmer whose yields are falling has no quick, trustworthy way to find
out what is wrong with her trees, and no way to warn her neighbours, because expert advice is scarce and she has no
smartphone or internet of her own.

How Jirani fits those constraints:
1. **The sample comes to the phone.** Noor carries three leaves home.
2. **The smartphone runs the check offline** on the weekend.
3. **The result goes to her basic phone** as a prefilled SMS, which she sends herself, plus Kiswahili audio.
4. **The cooperative is the hub.** It syncs reports when there is signal, detects clusters, and sends neighbour alerts only after an officer approves.

Background evidence (with sources and `TODO: verify` flags): [EVIDENCE.md](EVIDENCE.md).

## What it does

| | Feature | How |
|---|---|---|
| F0 | **Offline diagnosis with refusal** | A MobileNetV3-Small model (1.04 MB) runs in the browser via onnxruntime-web (WASM). Three leaves; it answers only if the calibrated mean probability is ≥ τ **and** at least two leaves agree. Otherwise: "Not sure. Ask a person. Do not spray." |
| F1 | **Severity and trend** | Severity from a second model head; the trend compares with the last confident check of the same block within 42 days (worse / same / better). |
| F2 | **"Where it looked"** | Class activation map overlay on each agreeing leaf (exact, because the head is linear on pooled features). |
| F3 | **Cooperative sync and neighbour early warning** | Store-and-forward outbox; the user presses Send. The server detects ≥ 3 plots within 2 km with the same stress in 14 days and creates a **draft** alert. An officer approves it, and messages to about 9 neighbouring plots are written to the outbox as "would be sent" (mock SMS, see below). |
| F4 | **Yield-drop cause ranking** | A transparent rule-based scorer combines the image result with a cached weather and soil pack (NASA POWER rain vs. 10-year normal, SoilGrids pH). It shows up to 3 causes plus "what this tool cannot see". |
| Handoff | **Basic phone** | A single-segment SMS (≤ 160 GSM-7 characters, tested for every possible card in both languages) via an `sms:` link; Kiswahili audio built from pre-recorded clips; share audio over Bluetooth. |

Every user-facing sentence comes from a fixed answer list (`app/public/content/answers.json`, i18n). There are
**no LLM calls** anywhere at runtime.

## Architecture

```
┌──────────────────────── Smartphone (PWA, offline after first load) ───────────────────────┐
│ 3 leaf photos → quality gate (blur / exposure / leaf colour) → crop to leaf bounding box   │
│ → ONNX model (int8 weights, onnxruntime-web WASM, self-hosted) → temperature T → softmax   │
│ → 3-leaf aggregation → refusal gate (tau, agreement) → trend (IndexedDB) → cause ranking   │
│   (cached context pack) → Decision Card (7 fixed slots) → SMS link + Kiswahili audio       │
│ → outbox (IndexedDB). Service worker precaches app, model, wasm, audio, content, context.  │
└──────────────────────────────┬─────────────────────────────────────────────────────────────┘
                               │ only when online, only after the user taps Send
                               ▼ packet: plot id, block, class, severity, trend, confidence
┌──────────────────────── Cooperative server (FastAPI + SQLite, Render) ─────────────────────┐
│ POST /api/reports → outbreak detector (haversine, draft alert) → officer dashboard         │
│ (map, visit list, Approve / Dismiss) → SMS gateway (mock: "would be sent")                 │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Part | Stack |
|---|---|
| Training | Python 3.11, PyTorch 2.11 (CUDA 12.8), torchvision 0.26, MobileNetV3-Small (ImageNet) |
| Export | ONNX (opset 17), onnxruntime 1.30; int8 weights per output channel, fp32 activations |
| App | Vite 8, React 19, TypeScript 7, vite-plugin-pwa 2, onnxruntime-web 1.30 (WASM), idb 8, vitest 5 |
| Server | FastAPI 0.142, uvicorn 0.54, Jinja2, SQLite, Leaflet (dashboard only) |
| Context | NASA POWER daily API, ISRIC SoilGrids v2.0 (built once, cached, used offline) |
| Audio | Meta MMS-TTS Kiswahili (`facebook/mms-tts-swh`) at build time, MP3 via lameenc |
| Hosting | Vercel (app), Render free plan (server) |

## Measured results

All numbers come from [ml/report/report.md](ml/report/report.md), generated by `ml/evaluate.py`. They run the
exported ONNX models with onnxruntime, the same graph the app runs. Test set: 253 BRACOL leaves (Brazilian), stratified.

| Metric | fp32 | **int8 (shipped)** |
|---|---|---|
| Model file size | 3.74 MB | **1.04 MB** |
| Stress accuracy / macro-F1, clean test | 88.9% / 0.856 | **90.1% / 0.870** |
| Severity: exact / within one level | 84.2% / 99.2% | 80.2% / 98.8% |
| Single leaf at τ = 0.76: coverage / accuracy on answered | | 89.7% / 94.3% |
| Three-leaf rule (simulated, 82 triples): coverage / accuracy on answered | | 75.6% / 100% |
| App crop path (uncropped photos → app's leaf crop, 193 leaves): accuracy | | 90.2% |
| **Perturbed test (SYNTHETIC blur, low light, colour cast, JPEG, dark/cluttered background)**: accuracy | | **77.2% (−12.9 points)**; cluttered background alone 54.9% |
| Out-of-distribution refusal (PlantDoc non-coffee leaves): single image / 3 images | | **48% / 78%** |
| Out-of-distribution refusal (SYNTHETIC non-leaf images) | | 100% |

- **Quantization:** full static int8 (weights + activations) collapsed accuracy to 9–28% on this MobileNetV3. Int8 *weights* alone are lossless, so that is what ships. The file is smaller, but inference is not faster.
- **Calibration:** temperature T = 1.056. τ = 0.76 is the lowest threshold with ≥ 95% accuracy on answered validation leaves.
- **Latency, desktop browser (WASM, 1 thread):** 33–114 ms per leaf.
- **Latency, real phone (Samsung Galaxy A14, Android app):** 82–204 ms per leaf (204 / 82 / 90 ms on one 3-leaf check; the first leaf includes warm-up).

## Run it

Prerequisites: Python 3.11, Node 22.12+, git. Commands run from the repo root unless a `cd` is shown.

### App (no ML needed; the trained model is committed)
```bash
cd app
npm install
npm run dev          # http://localhost:5173  (copies the onnxruntime wasm into public/ort first)
npm test             # 26 unit tests: aggregation, refusal, trend, causes, SMS length, audio pack, no-chemicals scan
npm run build        # production PWA in app/dist (set VITE_API_URL to point at your server)
npm run preview      # serve dist on http://localhost:4173 (service worker active: test offline here)
```

### Android app (Capacitor)
The same web build, wrapped as a native Android app. The model, wasm, audio and context packs are bundled in the
APK, so it works offline from the first launch (no service worker). It talks to the live server set in
`app/.env.android`. Audio sharing uses the native share sheet; the SMS link opens the phone's SMS app.

Prerequisites: JDK 21 (`JAVA_HOME`), Android SDK with platform 36 (`app/android/local.properties` → `sdk.dir=...`).
```bash
cd app
npm run build:android                  # vite build --mode android + cap sync android
cd android && ./gradlew assembleDebug  # → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
Sync from the APK uses native HTTP (`CapacitorHttp`), so the server's `APP_ORIGIN` CORS list needs no change.

### Server
```bash
python -m venv .venv
.venv/Scripts/activate                              # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r server/requirements-dev.txt
uvicorn main:app --app-dir server --port 8000      # dashboard http://localhost:8000
python -m pytest server -q                          # 16 tests: outbreak rule, approval, privacy, SMS allowlist, CORS
python scripts/simulate_outbreak.py                 # posts 2 SYNTHETIC neighbour rust reports (--all adds OND-0017)
```

### Reproduce the dataset and the model
1. Download BRACOL from Mendeley Data (CC BY 4.0, DOI 10.17632/yy2k5y8mxg.1) into `ml/data/bracol/` and extract it:
   ```bash
   mkdir -p ml/data/bracol
   curl -L -o ml/data/bracol/bracol.zip "https://data.mendeley.com/public-files/datasets/yy2k5y8mxg/files/c16b08ee-3ca6-4bf0-8f4e-4285a53a4a24/file_downloaded"
   cd ml/data/bracol && tar -xf bracol.zip; cd ../../..
   ```
   The archive is **truncated at the source**, so `tar` reports an error near the end. The label file
   `coffee-datasets/coffee-datasets/leaf/dataset.csv` is what matters. See [DATA.md](DATA.md).
2. Install and run the pipeline (a CUDA GPU is optional; it trains in about 6 minutes on an RTX 5060):
   ```bash
   pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
   pip install -r ml/requirements.txt
   cd ml
   python prepare_data.py      # fetches the authors' 1,747 leaf crops, checks them against the labels, stratified split (seed 150)
   python train.py             # multi-task training -> ml/checkpoints/best.pt
   python calibrate.py         # temperature T and tau -> ml/report/calibration.json
   python export.py            # ONNX + int8 weights + parity check -> app/public/model/
   python fetch_ood.py         # PlantDoc sample + synthetic non-leaf images
   python evaluate.py          # -> ml/report/report.md, metrics.json, plots
   python tune_quality.py      # quality-gate thresholds -> ml/report/quality_gate.json
   ```

### Rebuild the context pack and the audio pack
```bash
pip install -r scripts/requirements.txt
python scripts/seed_cooperative.py          # SYNTHETIC registry -> server/seed_plots.json, app/public/content/plots.json
python scripts/build_context_pack.py        # NASA POWER + SoilGrids -> app/public/context/<plot>.json (~8 min, rate-limited)
python scripts/build_audio.py               # Kiswahili clips -> app/public/audio/sw/
```

## Guardrails

1. **Closed outputs only.** Every sentence comes from `answers.json` and i18n by key. No LLM at runtime.
2. **Refuse rather than guess.** On a failed quality gate, fewer than 2 good photos, mean probability below τ, or disagreeing leaves, the only output is "Not sure. Ask a person. Do not spray."
3. **A person decides.**
   - The farmer presses Send for the SMS and for Sync.
   - Outbreak alerts are drafts until an officer approves them.
   - Nothing is ever sent automatically.
4. **No chemicals.** No product names and no dosages. A unit test scans all content for both.
5. **Privacy.**
   - Photos never leave the phone.
   - Sync packets carry plot id, block and class only; the server rejects any extra field.
   - The basic phone number is stored only on the device.
   - Settings has a "Clear all data on this phone" button.
6. **Honesty about limits.**
   - The card says "Draft guidance, confirm with your extension officer".
   - The dashboard says "Demo data is synthetic".
   - The report shows the drops.
7. **Card footer:** "This tool helps you decide what to check. It does not replace the extension officer."

## Known limits

- **Brazilian training data.** BRACOL comes from Espírito Santo, Brazil. It has no Kenyan varieties (SL28, SL34, Ruiru 11) and no Kenyan field conditions. Accuracy on Kenyan leaves is **unknown**.
- **Detached leaves only.** The model saw the lower side of single detached leaves on white paper. Cluttered backgrounds drop accuracy to 55%, which is why the app insists on white paper.
- **No nutrient-deficiency or abiotic classes.** These should fall through to "not sure", but that is not guaranteed.
- **Weak refusal on other crops' leaves.** On PlantDoc images (tomato and corn rusts, etc.) the model refuses only 48% of single images and 78% with the three-leaf rule. The quality gate adds some protection.
- **Severity is a rough guide.** The "high" and "very high" classes are rare in the training data.
- **Coarse context data.** The context pack comes from coarse global grids: one weather cell for the whole cooperative and a modelled soil pH. It is not a measurement.
- **Draft cause rules.** The cause ranking and outbreak thresholds are **draft heuristics, not validated agronomy**.
- **Mock neighbour SMS.** Alerts reach the outbox as "would be sent". Real delivery needs carrier registration with an SMS provider, which takes weeks and is out of scope.
- **Audio transfer untested in the field.** Moving audio to a basic phone over Bluetooth is demonstrated, not field-tested.

## What is synthetic, machine-drafted or unreviewed

| Item | Status |
|---|---|
| Cooperative registry (40 plots, locations), "Ondera" | **Synthetic.** Fictional cooperative, made-up coordinates in central Kenya. |
| Neighbour reports from `simulate_outbreak.py` | **Synthetic**, labelled on the dashboard |
| Perturbed test set; non-leaf OOD images | **Synthetic** |
| Context packs | Real NASA POWER / SoilGrids data **for synthetic locations** |
| Agronomy text (actions, do-nots, causes, alert templates) | **Draft, not reviewed by an agronomist** (`review_status` in `answers.json`) |
| Kiswahili text | **Machine-drafted, needs native speaker review** |
| Kiswahili audio | **Machine-generated** (Meta MMS-TTS, **CC-BY-NC-4.0**, non-commercial: replace before deployment); not reviewed by a native speaker |
| Gikuyu | Not included (stretch goal; would need a human speaker) |

Datasets, licences and what they do not cover: [DATA.md](DATA.md). Build log and decisions: [PROGRESS.md](PROGRESS.md).
Full build spec: [JIRANI_SPEC.md](JIRANI_SPEC.md).

## Deploy (two live links)

The farmer app is a static PWA (all inference stays on the phone). The cooperative server is FastAPI + SQLite.
Deploy the **server first** (you need its URL for the app), then the **app**, then tell the server the app's URL.

### 1. Server on Render (free plan)

Render's free web services sleep when idle (the first request after a sleep takes about a minute) and lose their
disk on restart. The server reseeds the **synthetic** cooperative registry whenever its database is empty.
Reports from earlier sessions are lost on restart, which is fine for the demo. Check Render's current free-tier
limits before relying on them.

1. Push this repo to GitHub.
2. Go to <https://dashboard.render.com> and sign in with GitHub.
3. Click **New +** → **Blueprint**.
4. Pick this repository. Render reads `render.yaml` and proposes a web service called `jirani-coop`.
5. Render asks for `APP_ORIGIN` (marked `sync: false`). For now enter `http://localhost:5173`; you will change it in step 3.
6. Click **Apply**. Wait for the deploy to show **Live**.
7. Open `https://<your-service>.onrender.com/api/health`. You should see `{"ok":true,"plots":40,"sms_provider":"mock"}`.
   The dashboard is at `https://<your-service>.onrender.com/`.

Start command (also in `render.yaml`): `uvicorn main:app --app-dir server --host 0.0.0.0 --port $PORT`.

### 2. App on Vercel

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. **Import** this repository.
3. **Root Directory**: click **Edit** and choose `app`. Framework preset: **Vite** (detected).
   Build command `npm run build`, output `dist` (both come from `app/vercel.json`).
4. Open **Environment Variables** and add `VITE_API_URL` = `https://<your-service>.onrender.com` (no trailing slash).
5. Click **Deploy**. Note the URL, e.g. `https://jirani-xyz.vercel.app`.

`VITE_API_URL` is baked in at build time. If the server URL changes, redeploy the app.
A phone that already completed setup keeps its saved server address; change it in **Settings → Cooperative server address**.

**Cloudflare Pages alternative:** Create project → connect repo → Root directory `app`, build command `npm run build`,
output `dist`, environment variable `VITE_API_URL`. `app/public/_headers` keeps the service worker uncached.

### 3. Connect them (CORS)

1. Render → `jirani-coop` → **Environment** → set `APP_ORIGIN` = your app URL, e.g. `https://jirani-xyz.vercel.app`
   (comma-separate several origins if needed). **Save Changes**; Render restarts the service.
2. On a phone, open the app URL once while online. Wait for **"Offline ready ✓"** on Home.
3. Do a check, open **Sync**, press **Send**. The report appears on the dashboard.
4. Optional: post the synthetic neighbours so the phone's report tips an alert:
   `python scripts/simulate_outbreak.py --server https://<your-service>.onrender.com`

### 4. Neighbour SMS: mock only

The hackathon build ships with the **mock SMS gateway** (`SMS_PROVIDER=mock`, the default). When an officer approves
an alert, one message per neighbouring plot is written to the dashboard's outbox with status **"would be sent"**.
Nothing is delivered to real phones: that needs carrier registration with an SMS provider, which takes weeks and is
out of scope for the hackathon.

The gateway interface stays in `server/sms_gateway.py` so a real provider can be plugged in later. It includes a
Twilio client, an allowlist that restricts real sends to the team's own numbers, fallback to the mock on any error,
and the tests for all three. `scripts/send_test_sms.py` is a delivery check for that future setup. None of it is
enabled in this build.

(The farmer's own result SMS is unaffected: the app opens the phone's SMS app with the message prefilled, and the
farmer presses send over the normal cellular network.)

**Fallback if hosting fails:** run the server on a laptop (`uvicorn main:app --app-dir server --port 8000`) behind an
HTTPS tunnel (`cloudflared tunnel --url http://localhost:8000` or `ngrok http 8000`) and use the tunnel URL as
`VITE_API_URL` and in the app's Settings.
