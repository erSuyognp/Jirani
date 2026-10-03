# Jirani
Offline AI leaf check for coffee farmers: diagnose, track, warn. Runs on the phone, no internet needed.

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
5. Render asks for the values marked `sync: false`. For now:
   - `APP_ORIGIN`: leave as `http://localhost:5173` (you will change it in step 3).
   - `DEMO_SMS_ALLOWLIST`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: leave empty for now.
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

### 4. Real SMS through a Twilio trial (optional; the mock always works)

Real SMS only ever goes to numbers on `DEMO_SMS_ALLOWLIST` (your own phones). Every other recipient stays in the mock outbox.

1. In the Twilio Console (trial account):
   - Note **Account SID** and **Auth Token** (Account info) and your trial **phone number**.
   - **Phone Numbers → Verified Caller IDs**: add and verify each demo phone. Trial accounts can only text verified numbers.
   - **Messaging → Settings → Geo permissions**: enable the destination country of your demo phone.
2. Test delivery from your laptop first (never commit `.env`):
   ```
   cp .env.example .env      # then fill TWILIO_*, DEMO_SMS_ALLOWLIST in .env
   python scripts/send_test_sms.py --wait 120
   ```
   It logs the provider status (`queued` → `sent` → `delivered`) and any error code with a hint.
3. Render → `jirani-coop` → **Environment**: set `SMS_PROVIDER=live`, `DEMO_SMS_ALLOWLIST=+<your number>`,
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Save.
4. Approve an alert on the dashboard. The nearest one (or two) recipient plots stand in for your allowlisted
   phone(s); the outbox shows that row as `sent` (number masked) and the rest as `would be sent`.
   **Check delivery** asks Twilio for the delivery status.

If anything fails, the row shows `failed_fallback_mock` with the provider's error and the demo continues.
Set `SMS_PROVIDER=mock` to switch real sending off entirely.

**Fallback if hosting fails:** run the server on a laptop (`uvicorn main:app --app-dir server --port 8000`) behind an
HTTPS tunnel (`cloudflared tunnel --url http://localhost:8000` or `ngrok http 8000`) and use the tunnel URL as
`VITE_API_URL` and in the app's Settings.
