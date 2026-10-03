# Jirani
Offline AI leaf check for coffee farmers: diagnose, track, warn. Runs on the phone, no internet needed.

**Live:** farmer app <https://jirani-eosin.vercel.app> · cooperative dashboard <https://jirani-coop.onrender.com> (demo data is synthetic)

> Full README (architecture, results, limits) is written at milestone M8. This file currently holds the deploy steps.

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
