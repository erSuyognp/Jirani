# Jirani — Build Spec

**Read this whole file before writing code.** It is the single source of truth for this project. Work through the milestones in order, commit after each one, and never start a stretch item while a required milestone is unfinished.

---

## 1. Context

**Event:** Hack-Nation 7th Global AI Hackathon, Challenge 04: Small AI for Development (World Bank Youth Summit), **Agriculture sector**.

**Hard deadline:** Sunday 4 October 2026, 08:00 US Central (09:00 ET). A working prototype, a public repo, and a 2 to 5 minute video must exist by then. Assume there is no time for rewrites. Prefer the boring option that works.

**Product in one sentence:** Jirani ("neighbour" in Kiswahili) is an offline tool that looks at three coffee leaves, says what is likely wrong and how bad it is, tracks whether it is getting worse, ranks likely causes of a yield drop, hands the result to a basic phone, and lets the cooperative warn neighbouring farmers.

**Pitch line:** Diagnose, track, warn.

### The user (from the challenge brief)

Noor, 38, farms 2 hectares in the fictional Ondera highlands: coffee on the upper slope, maize and beans below. Member of the Ondera Coffee Cooperative for eleven years. Her coffee yields dropped and she cannot say why. The extension officer visits twice a year.

Constraints that drive every design decision:

- Her own phone is a **basic phone**: calls, SMS, mobile money.
- The household **smartphone belongs to her daughter** and is only home on weekends.
- **No Wi-Fi.** They buy 3G bundles occasionally.
- During the day she is on the slope and the phone is at the house.

So: **the sample comes to the phone** (she carries leaves home), the smartphone does the AI **offline** on the weekend, and the **result goes to her basic phone** by SMS.

### Rules from the brief (all mandatory)

1. Runs on a device the user already has.
2. Core feature works offline.
3. Model files small enough to side-load or send over a weak connection.
4. At least one interaction in a named local language (ours: **Kiswahili**).
5. Human in the loop: the tool informs, a person decides. It never acts on the user's behalf.
6. No hallucinations: outputs come from a **fixed list of answers**.
7. **Pass/fail:** when unsure, the tool must say "not sure, ask a person" instead of guessing.

### Judging weights

| Criterion | Weight |
|---|---|
| Built solution works end to end within constraints | 25% |
| Development relevance and impact | 20% |
| Data grounding (including what the data does NOT cover) | 15% |
| Evidence it works | 15% |
| Clarity, design, inclusivity, value of AI vs simpler tool | 15% |
| Scalability and replicability | 10% |
| Responsible AI, data, safety | Pass/fail |

---

## 2. Scope

### In scope (four features)

| # | Feature | What it adds |
|---|---|---|
| F0 | Offline leaf diagnosis with refusal | The core. Stress class from a closed list, or "not sure". |
| F1 | Severity and trend | How bad it is, and whether it is worse than last time. |
| F2 | "Where it looked" heatmap | Overlay showing the leaf regions behind the prediction. |
| F3 | Cooperative sync and neighbour early warning | Store-and-forward reports, outbreak detection, officer-approved SMS alerts. |
| F4 | Yield-drop cause ranking | Combines the image result with cached rainfall and soil context into a ranked shortlist of likely causes. |

Plus the handoff: a templated SMS and a Kiswahili audio clip for the basic phone.

### Explicit non-goals (do not build)

- No cherry or parchment grading model. No price prediction.
- No free-text or generative language model anywhere in the user-facing path.
- No speech recognition. Farmer input is taps only.
- No pesticide names, product names, or dosages, ever.
- No user accounts or login.
- No native Android app. This is a PWA.
- No hardware or sensor node.

---

## 3. Architecture

```
┌──────────────────────── Smartphone (PWA, offline) ────────────────────────┐
│  Capture 3 leaf photos → quality gate → ONNX model (int8, WASM)           │
│     → per-leaf stress + severity + CAM heatmap → 3-leaf aggregation       │
│     → refusal gate → trend (IndexedDB history) → cause ranking            │
│     → Decision Card → SMS (sms: URI) + Kiswahili audio clip               │
│     → outbox queue (IndexedDB)                                            │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ only when online, only after user taps Sync
                                ▼
┌──────────────────────── Cooperative server (FastAPI + SQLite) ────────────┐
│  POST /api/reports → outbreak detector → draft alert                       │
│  Officer dashboard: flagged blocks, map, approve alert → SMS outbox (mock) │
└────────────────────────────────────────────────────────────────────────────┘
```

### Tech stack

| Part | Choice | Notes |
|---|---|---|
| Training | Python 3.11+, PyTorch, torchvision | MobileNetV3-Small backbone |
| Export | ONNX, then onnxruntime static quantization to int8 | |
| On-device inference | `onnxruntime-web`, WASM backend | **Self-host the .wasm files in the app bundle.** Never load from a CDN: that breaks offline. |
| App | Vite + React + TypeScript, `vite-plugin-pwa` | Service worker must precache app shell, model, wasm, audio, content JSON, context pack |
| Local storage | IndexedDB via `idb` | Observations, outbox queue, settings |
| Server | FastAPI + SQLite + server-rendered Jinja dashboard | Leaflet map on the dashboard is fine (the cooperative office is online) |
| Audio pack | Pre-generated at build time (see §9) | |

Check current stable versions of each library yourself before pinning. Do not trust version numbers from memory.

### Repository layout

```
jirani/
├── README.md                 # how to run everything, architecture, dataset reproduction
├── DATA.md                   # data card: every dataset, source, license, size, what it does NOT cover
├── EVIDENCE.md               # problem evidence with source, year, country (see §12)
├── ml/
│   ├── prepare_data.py       # split, label mapping, checks
│   ├── train.py              # multi-task training
│   ├── calibrate.py          # temperature scaling
│   ├── export.py             # ONNX export + int8 quantization
│   ├── evaluate.py           # all numbers and plots for the report
│   ├── report/               # generated: report.md, plots, metrics.json
│   └── requirements.txt
├── app/
│   ├── public/
│   │   ├── model/            # model.int8.onnx, model_meta.json
│   │   ├── ort/              # onnxruntime-web wasm files
│   │   ├── audio/sw/         # Kiswahili clips
│   │   ├── content/          # answers.json, i18n/*.json
│   │   └── context/          # per-plot context pack JSON
│   └── src/
│       ├── capture/          # camera, quality gate
│       ├── inference/        # preprocessing, ort session, CAM
│       ├── logic/            # aggregate.ts, refusal.ts, trend.ts, causes.ts, card.ts
│       ├── handoff/          # sms.ts, audio.ts
│       ├── sync/             # outbox.ts
│       ├── db/               # idb wrappers
│       └── ui/               # screens
├── server/
│   ├── main.py               # API + dashboard
│   ├── outbreak.py           # detection logic
│   ├── models.py             # SQLite schema
│   ├── templates/
│   └── requirements.txt
└── scripts/
    ├── build_context_pack.py # NASA POWER + SoilGrids fetch, per plot
    ├── build_audio.py        # Kiswahili TTS clips
    ├── seed_cooperative.py   # synthetic registry of plots (LABELLED SYNTHETIC)
    └── simulate_outbreak.py  # posts synthetic reports for the demo (LABELLED SYNTHETIC)
```

---

## 4. Data

### Primary: BRACOL (Brazilian Arabica Coffee Leaf dataset)

- Source: Mendeley Data. Stated license CC BY 4.0. **Verify the license and citation on the dataset page and record them in DATA.md.**
- Expected contents: Arabica leaf images taken with smartphones, each leaf labelled with a predominant biotic stress (healthy, leaf miner, leaf rust, phoma / brown leaf spot, cercospora) and a severity level.
- **Inspect the actual files before writing the loader.** Read the label CSV, print class and severity distributions, look at a few images. Record the real class names, severity definitions, image counts, and whether images show the upper or lower leaf surface. Adapt this spec's label names to whatever the dataset really contains. Do not assume.
- If automated download fails, stop and ask the user to download it manually into `ml/data/bracol/`.
- Use the dataset's own train/val/test split if it ships one. Otherwise make a stratified 70/15/15 split with a fixed seed and save the split files.

### Secondary (optional, for robustness checks only)

- **PlantDoc** or any non-coffee leaf images: used as an out-of-distribution set to test that the refusal gate fires on "not a coffee leaf". A few dozen images is enough.
- **Perturbed test set:** generate from the BRACOL test split with blur, low light, strong colour cast, JPEG artefacts, and cluttered or dark backgrounds. This stands in for "messy field conditions" and must be labelled as synthetic perturbation in the report.

### DATA.md must state what the data does not cover (this is scored)

At minimum:

- BRACOL is Brazilian. It does not include Kenyan or East African varieties (for example SL28, SL34, Ruiru 11) or highland Kenyan field conditions.
- No nutrient-deficiency class. Yellowing from nitrogen deficiency is not a trained label and must fall through to "not sure".
- Images are single leaves photographed in controlled conditions, not leaves on the tree.
- No abiotic stress labels (drought, frost, sunscald).
- The cooperative registry, plot coordinates, and outbreak reports in the demo are **synthetic**.
- Rainfall and soil context come from coarse global grids (see §8), not plot-level measurement.

---

## 5. Model (F0, F1, F2)

### Architecture

- Backbone: `torchvision.models.mobilenet_v3_small`, ImageNet-pretrained, features only.
- Replace the stock classifier with: global average pool → dropout → **two linear heads**:
  - `stress_head`: N_STRESS classes (expected 5: healthy, miner, rust, phoma, cercospora)
  - `severity_head`: N_SEV levels (expected 5: 0 = healthy through 4 = very high; use the dataset's real levels)
- Heads are **linear directly on pooled features on purpose**, so that class activation maps can be computed exactly (see F2).
- Input: 224×224 RGB, ImageNet mean/std normalisation.

### Training

- Loss: cross-entropy on stress + 0.5 × cross-entropy on severity. Use class weights if classes are imbalanced.
- Augmentation: random resized crop, horizontal and vertical flip, rotation, colour jitter (brightness, contrast, saturation, hue), Gaussian blur, random JPEG quality. The aim is tolerance to phone-camera variation.
- Two-phase: train heads with frozen backbone for a few epochs, then fine-tune everything at a lower learning rate. Early stopping on validation stress accuracy.
- Keep it fast: this must train in well under an hour on a laptop GPU or free Colab. If no GPU is available, reduce epochs and say so in the report.
- Fixed seeds. Save the best checkpoint.

### Calibration and the refusal threshold

- Fit a single temperature on the validation set (temperature scaling) for the stress head. Store `T` in `model_meta.json`.
- Compute the risk-coverage curve on validation: for thresholds τ from 0.3 to 0.95, what fraction of samples are answered (coverage) and how accurate are the answered ones.
- Pick τ as the lowest threshold where answered accuracy on validation is ≥ 95%, with a floor of 0.65. Store `tau` in `model_meta.json`.

### Export

- Export to ONNX with **two additional outputs** beside the logits: the final feature map (shape 1×C×7×7) so the app can compute CAM. Outputs: `stress_logits`, `severity_logits`, `features`.
- Also export the stress head weight matrix into `model_meta.json` (or as a small separate JSON) for CAM in the browser.
- Quantize to int8 with onnxruntime static quantization, calibrating on ~200 training images.
- **Target size: under 5 MB.** Report the actual size.
- Verify the int8 model against the fp32 model on the test set. If int8 accuracy drops more than 3 points, try per-channel quantization or excluding the heads from quantization; if still bad, ship fp16 or fp32 and report it honestly.

### `model_meta.json`

```json
{
  "version": "0.1.0",
  "input_size": 224,
  "mean": [0.485, 0.456, 0.406],
  "std": [0.229, 0.224, 0.225],
  "stress_classes": ["healthy", "miner", "rust", "phoma", "cercospora"],
  "severity_levels": [0, 1, 2, 3, 4],
  "temperature": 1.0,
  "tau": 0.65,
  "stress_head_weights": "stress_head.json",
  "trained_on": "BRACOL",
  "file_size_bytes": 0
}
```

### F2: Heatmap ("where it looked")

- In the browser: `CAM_c = Σ_k W[c,k] · features[k,:,:]` for the predicted class `c`. ReLU, normalise to 0–1, bilinear upsample to the image size, draw as a semi-transparent overlay on the leaf photo.
- Show it on the result screen with a one-line caption from i18n ("The coloured area is what the tool looked at").
- **Fallback** if exporting the feature map through quantization causes problems: occlusion sensitivity. Slide a grey patch over a 7×7 grid, re-run inference, map the drop in predicted-class probability. Slower (49 inferences) but always works.
- Do not show a heatmap when the result is "not sure".

### Evaluation report (`ml/report/report.md`, generated by `evaluate.py`)

This report is shown in the video. It must contain real measured numbers, never placeholders.

1. Dataset summary: counts per class and severity, split sizes.
2. Stress accuracy, macro-F1, and confusion matrix on the clean test set: fp32 vs int8.
3. Severity accuracy and "within one level" accuracy.
4. Model file size: fp32 vs int8.
5. Risk-coverage curve plot, with the chosen τ marked. Table: at τ, coverage and answered accuracy.
6. Same metrics on the **perturbed** test set. Report the drop plainly.
7. Refusal rate on the out-of-distribution set (non-coffee images). Higher is better.
8. A "known limits" paragraph that mirrors DATA.md.

Latency on a real phone is measured in the app (see §6) and added to the README by hand.

---

## 6. App (PWA)

### Screens

1. **Home.** Big button: "Check three leaves". Secondary: History, Sync (shows queued count), Settings (language, plot).
2. **Setup (first run only).** Pick plot from the cached cooperative list (plot id + block names). Enter the basic phone number for the SMS handoff. Stored locally only.
3. **Capture.** Guided: "Leaf 1 of 3". One leaf per photo, on a plain light surface, filling most of the frame. Show an outline guide. State which leaf side to photograph, matching what BRACOL contains. Use `<input type="file" accept="image/*" capture="environment">` as the baseline (most reliable across phones); a live `getUserMedia` preview is optional polish. Also allow picking an image from files so the demo can use BRACOL test images.
4. **Three questions (taps only).** Which block? (list from plot) · What changed since last time? (fixed options: leaves falling, spots spreading, fewer cherries, nothing new) · Has anyone sprayed this block in the last month? (yes / no / don't know). Each prompt has a play-audio button for the recorded prompt.
5. **Decision Card.** See below.
6. **History.** Past cards per block, with a simple severity-over-time strip.
7. **Sync.** Shows the exact packet that will be sent, and a Send button. Disabled when offline.

Language switch (English / Kiswahili) on every screen. Large touch targets, icons next to all text, high contrast. The UI must be usable by someone with low screen literacy.

### Quality gate (runs on each photo before inference)

Reject and ask for a retake, with a specific reason, when:

- **Blurry:** variance of Laplacian on the greyscale image below threshold.
- **Too dark / too bright:** mean luminance outside a band, or large clipped fraction.
- **No leaf:** fraction of leaf-coloured pixels (green through yellow-brown in HSV) below threshold in the centre region.

Tune thresholds on BRACOL test images so that clean images pass. Keep thresholds in one config file.

### Per-leaf inference

Resize to 224, normalise, run the ONNX session, apply temperature `T` to stress logits, softmax. Record `p_max`, predicted stress, predicted severity, and features for CAM. Measure and store inference time in ms.

### Three-leaf aggregation (`logic/aggregate.ts`)

Inputs: up to 3 per-leaf results that passed the quality gate.

- If fewer than 2 leaves passed the gate → result is `not_sure` (reason: `too_few_good_photos`).
- Mean the calibrated probability vectors across leaves → `p_mean`. Candidate = argmax.
- **Confident only if both:** `max(p_mean) ≥ tau` **and** at least 2 leaves individually predict the candidate.
- Otherwise → `not_sure` (reason: `low_confidence` or `leaves_disagree`).
- Severity for the card = the median severity among the leaves that agree with the candidate.
- If the confident candidate is `healthy` → card says no disease sign was seen on these leaves, and the cause ranking (F4) leans on weather and soil context.

### F1: Trend (`logic/trend.ts`)

- Every completed check stores an observation in IndexedDB:

```ts
interface Observation {
  id: string;            // uuid
  plotId: string;
  block: string;
  takenAt: string;       // ISO timestamp
  stress: StressClass | "not_sure";
  severity: number | null;
  confidence: number;    // max(p_mean)
  reason?: string;       // for not_sure
  answers: { changed: string; sprayed: "yes" | "no" | "unknown" };
  modelVersion: string;
  synced: boolean;
}
```

- Trend compares the new observation with the most recent **confident** observation for the same block and same stress within the last 42 days:
  - none found → `first`
  - severity higher → `worse`
  - equal → `same`
  - lower → `better`
- Trend is never computed against or from a `not_sure` observation.

### Decision Card (`logic/card.ts`)

Exactly these slots, nothing else. All text comes from `content/answers.json` by key. No string is ever composed by a model.

1. **Likely stress** (or "Not sure")
2. **Confidence** (shown as three levels: high / medium / not sure, plus the number in small text)
3. **Severity + trend** (for example: "Medium. Worse than 2 weeks ago.")
4. **One action this week**
5. **One thing not to do**
6. **Likely causes of the yield drop** (F4, up to 3 ranked lines)
7. **Next step:** either "Sync to the cooperative" or "Not sure. Ask a person."

Plus the heatmap thumbnail (F2) and buttons: Send SMS, Play audio, Save.

### Fixed answer list (`content/answers.json`)

Action selection is a lookup on `(stress, severityBand, trend)` where severityBand is `low` (levels 1–2) or `high` (levels 3–4). Draft content below. **All agronomy text is a draft and has not been reviewed by an agronomist.** Keep that statement in `answers.json` as a `review_status` field, show a small "draft guidance, confirm with your extension officer" line on the card, and state it in the README.

Rules for all content, enforced by a unit test that scans `answers.json`:

- No pesticide, fungicide, or product names. No dosages or quantities of any chemical.
- Every "action" is cultural, observational, or "show this to a person".
- Whenever severity is high or trend is `worse`, the action includes contacting the cooperative or extension officer.

| Stress | Action (low) | Action (high or worse) | Do not |
|---|---|---|---|
| rust | Check ten more trees in this block and count how many have orange powder under the leaves. | Tell the cooperative this week and ask for the extension officer. Keep the three leaves to show them. | Do not spray anything before a trained person has seen it. |
| miner | Check ten more trees in this block and count leaves with brown blotches. | Tell the cooperative this week and ask for the extension officer. | Do not spray on your own. Spraying can kill the small wasps that naturally control leaf miner. |
| phoma | Look at the windy or cold side of the block. Note whether young tips are dying back. | Tell the cooperative this week and ask for the extension officer. | Do not spray anything before a trained person has seen it. |
| cercospora | Check whether these trees get full sun with little shade or mulch. Note it for the officer. | Tell the cooperative this week and ask for the extension officer. | Do not spray anything before a trained person has seen it. |
| healthy | No disease sign on these three leaves. Check again next week with leaves from the weakest trees. | n/a | Do not treat for disease based on this check. |
| not_sure | Take three new leaves in good light and try again. If it still says not sure, show the leaves to the cooperative. | n/a | Do not spray. |

### i18n

- `content/i18n/en.json` and `content/i18n/sw.json`. Every user-visible string goes through i18n keys.
- Draft the Kiswahili strings, and mark the file with `"review_status": "machine-drafted, needs native speaker review"`. Surface this honestly in the README.
- **Gikuyu is a stretch goal only.** Do not generate Gikuyu text. If added, it must come from a human speaker.

### Latency

Show per-leaf inference time on the result screen in a small debug line (toggle in Settings). The user will read these numbers off a real phone for the README and video.

### Offline requirements (test these explicitly)

- After one online load, the app must fully work in airplane mode: capture, inference, card, history, audio, SMS link.
- The service worker precaches: app shell, model, ort wasm, `answers.json`, i18n, audio clips, context pack.
- Add an "Offline ready ✓" indicator on Home once precaching completes.

---

## 7. Handoff to the basic phone

### SMS (`handoff/sms.ts`)

- Build a single-segment message (≤ 160 GSM-7 characters, no emoji, no special characters) from a template with slots. Open it with an `sms:` URI addressed to the saved basic phone number with the body prefilled, so it goes out over the cellular network without internet. Handle the iOS/Android difference in the `sms:` body separator.
- The user must press send themselves. The app never sends anything silently.
- Template (English shown; a Kiswahili version is the default when language is `sw`):

```
JIRANI 04-Oct Block B: RUST, medium, worse. Do: tell coop this week. Dont: spray before officer sees it. Not sure? Ask a person.
```

- Add a unit test that every possible card produces an SMS of ≤ 160 characters in both languages.

### Audio (`handoff/audio.ts`)

- The card is spoken in Kiswahili by **concatenating pre-recorded clips** in order: stress clip, severity clip, trend clip, action clip, do-not clip. No speech is generated at runtime.
- "Play audio" plays the sequence. "Share audio" uses the Web Share API with a file where supported (for Bluetooth transfer to the basic phone); if unsupported, offer a download. State in the README that transferring audio to a basic phone is demonstrated, not field-tested.

---

## 8. F4: Yield-drop cause ranking

**Purpose:** Noor's actual question is "my yield dropped and I don't know why." This feature produces a short ranked list of likely causes, each with the evidence behind it and what a person should check to confirm.

**This is a transparent rule-based scorer, not a model.** Every line it shows comes from the fixed answer list. It must be explainable in one sentence per cause.

### Context pack (built online, used offline)

`scripts/build_context_pack.py` runs once per plot at cooperative setup / sync time and writes `app/public/context/<plotId>.json`:

- **Rainfall, temperature, humidity:** NASA POWER daily point API (community `AG`; parameters for precipitation, 2 m temperature, 2 m relative humidity) for the plot centroid. Fetch the last 90 days plus the same calendar window for several previous years to compute a simple normal. Check the current API documentation for exact parameter names and response format.
- **Soil pH:** ISRIC SoilGrids REST API, property pH in water, topsoil depth, mean value, for the plot centroid. Check the docs for units (values are scaled). If SoilGrids is unavailable, set soil fields to `null`.
- Cache raw responses to disk so the demo does not depend on these APIs being up.
- Demo coordinates: a synthetic plot in the central Kenya highlands. Label as synthetic.

```json
{
  "plotId": "OND-0017",
  "builtAt": "2026-10-03T20:00:00Z",
  "source": { "weather": "NASA POWER", "soil": "ISRIC SoilGrids" },
  "rain_30d_mm": 0, "rain_30d_normal_mm": 0,
  "rain_90d_mm": 0, "rain_90d_normal_mm": 0,
  "temp_mean_30d_c": 0, "rh_mean_30d_pct": 0,
  "soil_ph": null,
  "caveat": "Coarse global grid estimates, not measurements from this plot."
}
```

The app shows the pack's age and marks it stale when older than 30 days.

### Candidate causes and scoring (`logic/causes.ts`)

All thresholds live in one config object and are **draft heuristics, not validated agronomy**. Say so in the README and report.

| Cause key | Fires when | Evidence line shown | "To confirm" line shown |
|---|---|---|---|
| `disease` | Confident non-healthy image result. Score scales with severity; bonus if trend is `worse`. | "Leaves show signs of {stress}, {severity}." | "Show the leaves to the extension officer." |
| `disease_weather` | `disease` fired with rust or phoma AND recent weather is warm and humid/wet (draft: mean temp roughly 18–26 °C and RH or rainfall above normal). Adds to the disease score; not a separate line. | appended: "Recent weather has been warm and wet, which favours it." | — |
| `dry_spell` | 90-day rain below 60% of normal (draft). Stronger below 40%. | "Rain in the last 3 months was well below normal for this area." | "Check soil moisture and whether flowering was poor." |
| `soil_acidity` | Soil pH estimate below 5.0 (draft). | "Soil in this area may be too acidic for coffee." | "Ask the cooperative about a soil test." |
| `sprayed_recently` | Farmer answered "yes" to sprayed AND a disease is still detected. | "This block was sprayed recently but signs are still present." | "Tell the officer what was sprayed and when." |
| `not_covered` | Always appended last. | "This tool cannot see nutrient problems, root problems, or old trees." | "Ask a person if none of the above fits." |

Rules:

1. Return at most 3 scored causes, sorted by score, then always `not_covered` as a final muted line.
2. **Context can never override a low-confidence image.** If the image result is `not_sure`, no `disease` cause is produced. Weather and soil facts may still be shown, labelled "context only".
3. If the context pack is missing or stale, weather and soil causes are skipped and the card says context is unavailable.
4. Never output a cause without its evidence line. Never state a cause as certain: use "likely" and "may".
5. Unit tests cover at least: confident rust + wet weather; healthy leaves + dry spell; not_sure image + acidic soil; missing context pack; everything normal (only `not_covered` shown).

---

## 9. Kiswahili audio pack (`scripts/build_audio.py`)

- Generate one short clip per phrase key in the fixed answer list, from the `sw.json` strings, at build time.
- Suggested: Meta MMS TTS Kiswahili model via Hugging Face `transformers`. **Check the model's license** (MMS models have carried a non-commercial license) and record it in DATA.md. A hackathon prototype is fine; flag it as something to replace before real deployment.
- Output small mono files (for example Opus or MP3 at a low bitrate). Keep the whole audio pack under ~2 MB. Report its size.
- If TTS setup costs more than 45 minutes, fall back to the browser `speechSynthesis` API with a Kiswahili voice where available, and note clearly that this fallback is not guaranteed offline.
- Mark all audio as machine-generated, needing native speaker review.

---

## 10. F3: Cooperative server and neighbour early warning

### Store-and-forward (app side, `sync/outbox.ts`)

- Each confident observation creates a packet in the IndexedDB outbox. `not_sure` observations are queued too (they tell the officer where the tool could not help).
- Nothing is sent until the user opens Sync and presses Send. The Sync screen shows the exact JSON.
- On success mark `synced: true`. On failure keep it queued and retry next time. Idempotent by `id`.

Packet (no name, no phone number, no photo, no GPS from the device):

```json
{
  "id": "uuid",
  "plotId": "OND-0017",
  "block": "B",
  "stress": "rust",
  "severity": 3,
  "trend": "worse",
  "confidence": 0.91,
  "takenAt": "2026-10-04T17:12:00Z",
  "modelVersion": "0.1.0"
}
```

### Server (`server/`)

SQLite tables:

- `plots(plot_id, lat, lon, blocks_json, phone_hash_or_null)` — seeded by `seed_cooperative.py` with ~40 **synthetic** plots scattered within a few km. Location is the registry centroid held by the cooperative, never device GPS.
- `reports(id, plot_id, block, stress, severity, trend, confidence, taken_at, model_version, received_at)`
- `alerts(id, stress, created_at, centre_lat, centre_lon, radius_km, report_ids_json, status, approved_by, approved_at)` — status: `draft` → `approved` or `dismissed`
- `sms_outbox(id, alert_id, plot_id, body, status, created_at)`

Endpoints:

- `POST /api/reports` — accept one or many packets, upsert by id, run outbreak detection.
- `GET /api/plots` — registry for the app's setup screen (cacheable).
- `GET /` — officer dashboard.
- `POST /alerts/{id}/approve`, `POST /alerts/{id}/dismiss`.

### Outbreak detection (`server/outbreak.py`)

Draft rule, all values in config:

- Window: last 14 days. Consider confident reports with severity ≥ 2.
- For each stress, if **≥ 3 distinct plots** within **2 km** of each other have such a report → create a **draft** alert (deduplicate against an existing open alert for the same stress and area).
- Recipients: all plots within 3 km of the cluster centre that have not reported that stress in the window.
- Use haversine distance. No clustering library needed.

### Human in the loop (mandatory)

- **Alerts are never sent automatically.** A draft alert appears on the dashboard with its supporting reports. A cooperative officer presses Approve or Dismiss.
- On approve, one message per recipient plot is written to `sms_outbox` from a fixed template:

```
ONDERA COOP: leaf rust reported on 3 farms near you this week. Check your coffee leaves. Bring 3 leaves to the coop if you see orange powder.
```

- SMS sending goes through a small gateway interface (`server/sms_gateway.py`) with two implementations, chosen by the `SMS_PROVIDER` environment variable:
  - `mock` (default): writes to `sms_outbox` with status `would_send`. The dashboard shows it as "would be sent". This is the fallback and must always work.
  - `live`: sends a real SMS through a provider's **trial or sandbox** tier (for example Twilio or Africa's Talking; check current terms and ask the user which one and for credentials). Status becomes `sent` or `failed`, with the provider's message id or error stored.
- **Decision (2026-10-03): the hackathon build ships with the mock gateway only.** Neighbour alerts are written to the outbox as "would be sent". Delivery to real phones needs carrier registration with an SMS provider, which takes weeks and is out of scope for the hackathon. The `live` implementation, the allowlist and its tests stay in the code so a real provider can be plugged in later; `SMS_PROVIDER` defaults to `mock` and is not set to `live` in any deployment.
- **Safety rule for live sending:** real messages may only go to numbers in the `DEMO_SMS_ALLOWLIST` environment variable (the team's own phones). Synthetic plots have no real phone numbers. In live mode, map one or two synthetic neighbour plots to allowlisted demo numbers and send the rest through the mock. Never send to a number that is not on the allowlist. Add a unit test for this.
- If the live send fails for any reason, fall back to the mock, record the error, and keep the dashboard working. A provider outage must never break the demo.
- Credentials come from environment variables only. Never commit them. Add `.env` to `.gitignore` and provide `.env.example`.

### Dashboard

One page: map with plots coloured by latest stress and severity; table of flagged blocks sorted by severity and trend (this is the officer's visit list); draft alerts with Approve/Dismiss; SMS outbox. A visible banner: **"Demo data is synthetic."**

### Demo support

`scripts/simulate_outbreak.py` posts a handful of synthetic rust reports from neighbouring plots so that the real report from the phone in the demo tips the cluster over the threshold. Clearly labelled synthetic in code, README, and dashboard.

---

### Deployment (both parts live)

The submission has **two live links**: the farmer app and the cooperative dashboard. Anyone should be able to sync a report from the app and see it appear on the dashboard.

- **App:** the PWA is built to static files and hosted over HTTPS at a domain root (for example Vercel or Cloudflare Pages; root directory `app`, build `npm run build`, output `dist`). "Static hosting" here only means how files are delivered. All inference stays on the phone; do not move the model to the server, because the core feature must work offline.
- **Server:** deploy FastAPI to a free Python host with HTTPS (for example Render; check current free-tier limits). Provide a start command. Free tiers may sleep and may wipe local disk, so **reseed the synthetic cooperative data on startup when the database is empty**.
- The app reads the server address from `VITE_API_URL` with a local default. The server reads allowed origins for CORS from `APP_ORIGIN`.
- A laptop server behind an HTTPS tunnel (cloudflared or ngrok) is the fallback if hosted deployment fails.
- Write exact deploy steps for both parts into the README.

---

## 11. Guardrails (hard rules — do not violate)

1. **Closed outputs only.** Every user-facing sentence comes from `answers.json` / i18n by key. No LLM calls in the app or server at runtime.
2. **Refuse rather than guess.** Below `tau`, on leaf disagreement, on failed quality gate, or on unknown input, the only legal output is `not_sure` with "ask a person" and "do not spray".
3. **A person decides.** The app never sends an SMS, syncs, or alerts without an explicit user action. Outbreak alerts need officer approval.
4. **No chemicals.** No product names, no dosages. Enforced by test.
5. **Privacy.** Photos never leave the phone. Sync packets carry plot id and class only. The basic phone number is stored only on the device. A "Clear all data on this phone" button exists in Settings (for lost or shared phones).
6. **Honesty about limits.** The card shows "draft guidance". The dashboard shows "synthetic demo data". The report shows real numbers including the drops.
7. **Not an agronomist.** Footer on the card: "This tool helps you decide what to check. It does not replace the extension officer."

---

## 12. Documentation deliverables

### README.md

- What it is, who it is for, the one-sentence problem statement.
- Architecture diagram and tech stack.
- How to run: training, export, app (dev and production build), server, scripts. Exact commands.
- How to reproduce the dataset and the context pack.
- Measured results table (copied from the report) + phone latency.
- Guardrails and known limits.
- What is synthetic, what is machine-drafted, what is unreviewed.

### DATA.md

One row per dataset: name, source URL, license, size, how it is used, what it does not cover. Include BRACOL, any OOD set, NASA POWER, SoilGrids, the TTS model, and the synthetic registry.

### EVIDENCE.md

Problem evidence for the video, each with **source, year, country, and URL**. Leave clearly marked `TODO: verify` entries for the user rather than inventing statistics. Topics to cover: women's phone vs smartphone ownership (GSMA Mobile Gender Gap), extension officer reach, the role of cooperatives in coffee marketing, coffee yield context (FAOSTAT). **Do not fabricate numbers or citations.**

---

## 13. Milestones (work in this order)

Each milestone ends with a commit and a short note of what works. If a milestone runs badly over its budget, simplify it and move on.

| # | Milestone | Acceptance check | Budget |
|---|---|---|---|
| M0 | Repo scaffold, BRACOL inspected, split saved, DATA.md started | Class and severity distributions printed; real label names recorded | 45 min |
| M1 | Train multi-task model, calibrate, pick τ | Test stress accuracy reported; `tau` and `T` saved | 1.5 h |
| M2 | Export ONNX + int8, parity check, `evaluate.py` report | `report.md` generated with real numbers; int8 model < 5 MB or documented exception | 1 h |
| M3 | PWA: capture → quality gate → inference → aggregation → refusal → card | A BRACOL test image yields the right card; a blurry or non-leaf image yields "not sure"; **works in airplane mode** | 2.5 h |
| M4 | F1 trend + history; F2 heatmap | Second check on same block shows worse/same/better; overlay renders | 1.25 h |
| M5 | Handoff: SMS + Kiswahili audio pack | `sms:` opens prefilled ≤ 160 chars; audio plays offline | 1.25 h |
| M6 | F3: outbox, server, outbreak detection, dashboard, approval, mock SMS outbox | Simulated neighbours + one real sync → draft alert → approve → outbox rows | 2 h |
| M6b | Deploy server + app as two live HTTPS links (mock SMS gateway only; see §10 decision) | From the deployed app on a phone: sync → the report appears on the deployed dashboard | 1.25 h |
| M7 | F4: context pack + cause ranking on the card | Unit tests pass for the five scenarios; card shows ranked causes | 1.5 h |
| M8 | README, DATA.md, EVIDENCE.md, redeploy final builds of app and server, final offline test on a real phone | Fresh clone runs from README; phone test passes in airplane mode | 1 h |

**Cut order if time runs out** (drop from the top): Gikuyu anything → live camera preview → audio share → hosted server (fall back to a tunnel) → map on dashboard (keep the table) → F4 soil component (keep rainfall) → F2 heatmap. **Never cut:** offline inference, the refusal gate, the evaluation report, the SMS handoff.

**If time is left over** (in this order): printed sample card with fiducial markers and automatic three-leaf cropping from one photo; pictogram-only card mode for unsupported languages; Gikuyu prompts recorded by a human speaker.

---

## 14. Demo script the build must support

The video will show, in order:

1. Phone goes into **airplane mode**.
2. Three leaf photos → Decision Card with stress, severity, trend, heatmap, action, do-not, ranked causes. Inference time visible.
3. A bad photo → "Not sure. Ask a person. Do not spray."
4. SMS prefilled for the basic phone; Kiswahili audio plays.
5. Airplane mode off → Sync → packet shown → sent.
6. Cooperative dashboard (live link): flagged block appears, draft outbreak alert, officer approves, and the neighbour SMS outbox fills with "would be sent" messages (recipient plot, message, status, time). Real delivery needs carrier registration with an SMS provider and is out of scope for the hackathon.
7. The evaluation table: size, accuracy fp32 vs int8, clean vs perturbed, coverage at τ, what the data does not cover.

Make sure each of these can be shown cleanly and repeatably. Add a hidden "demo mode" toggle in Settings that preloads one earlier observation for Block B so the trend line has something to compare against (label it as demo data in the UI).

---

## 15. Working agreements for Claude Code

- Ask the user before anything that needs credentials, paid services, or a manual download. For hosting (and any future SMS provider), ask the user to create the accounts and supply keys through environment variables; use only free, trial, or sandbox tiers.
- Do not invent dataset facts, statistics, citations, or translations presented as reviewed. When unsure, write `TODO: verify` and tell the user.
- Keep all thresholds and tunables in config files, not scattered through code.
- Write small unit tests for `aggregate`, `refusal`, `trend`, `causes`, the SMS length check, and the no-chemicals content scan. Skip UI tests.
- Prefer finishing a milestone plainly over polishing an earlier one.
- At the end of each milestone, print: what works, what was simplified, what the user must do by hand.
