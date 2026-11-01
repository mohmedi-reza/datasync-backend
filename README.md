# DataSync Backend

HTTP API for the **DataSync** Android app. Receives POST payloads from `SyncApiService` and keeps them in memory for inspection.

Designed for a free [Render](https://render.com) **Web Service**.

## Live dashboard

Open the root URL (`/`) for a minimal live inbox of payloads received from the Android app. It auto-refreshes every 2 seconds.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | no | Live inbox UI |
| `GET` | `/health` | no | Health check |
| `POST` | `/api/sync` | optional | Accept Android payload |
| `GET` | `/api/sync/messages` | optional | List recent messages |
| `GET` | `/api/sync/messages/:id` | optional | Get one message |
| `GET` | `/api/sync/stats` | optional | Counts by type |
| `DELETE` | `/api/sync/messages` | optional | Clear store |

### Android payload

```json
{
  "messageType": "DATA_SYNC",
  "sender": "+15550198234",
  "content": "Payload: 18 records synced.",
  "timestamp": 1710000000000
}
```

### Example curl

```bash
curl -X POST "https://YOUR-SERVICE.onrender.com/api/sync" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "messageType": "SMS",
    "sender": "+15550198234",
    "content": "Hello from DataSync",
    "timestamp": 1710000000000
  }'
```

In the Android Testing screen, set URL to:

```text
https://YOUR-SERVICE.onrender.com/api/sync
```

## Local run

```bash
cp .env.example .env
npm install
npm run dev
```

Server defaults to `http://localhost:3000`.

## Deploy on Render (free)

1. Push this folder to its **own** GitHub repository.
2. In Render → **New Web Service**.
3. Connect the repo.
4. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. Environment variables:
   - `AUTH_TOKEN` = a random secret (recommended)
   - `MAX_MESSAGES` = `1000` (optional)
6. Deploy, then copy the public URL into the Android app.

Or use Blueprint: Render → New → Blueprint → select this repo (`render.yaml`).

## Persistent storage (important)

By default messages live in **RAM**. Every Vercel/Render **rebuild/redeploy** restarts the process, so the inbox looks empty again.

To keep data across builds, add a free [Upstash Redis](https://upstash.com) database and set these env vars in Vercel → Project → Settings → Environment Variables:

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Then redeploy. `/health` should show `"storage":"redis"`.

## Notes

- Free Render web services **sleep** after idle time; the first request after sleep can be slow.
- Without Upstash, storage is **in-memory** and is wiped on every deploy.
- If `AUTH_TOKEN` is empty, auth is disabled. Keep it set in production.
