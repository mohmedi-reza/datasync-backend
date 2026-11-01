import "dotenv/config";
import cors from "cors";
import express from "express";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createSyncRouter } from "./routes/sync.js";
import { MessageStore } from "./store/messageStore.js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const MAX_MESSAGES = Number.parseInt(process.env.MAX_MESSAGES || "1000", 10) || 1000;

const app = express();
const store = new MessageStore({ maxMessages: MAX_MESSAGES });
const requireAuth = createAuthMiddleware(AUTH_TOKEN);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DataSync Backend</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 24px; line-height: 1.5; }
    main { max-width: 720px; margin: 0 auto; }
    code { background: #11111114; padding: 2px 6px; border-radius: 6px; }
    pre { background: #11111114; padding: 14px; border-radius: 12px; overflow: auto; }
    a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>DataSync Backend</h1>
    <p>API is running. Point the Android app URL to:</p>
    <pre>POST /api/sync</pre>
    <ul>
      <li><a href="/health">/health</a></li>
      <li><a href="/api/sync/stats">/api/sync/stats</a></li>
      <li><a href="/api/sync/messages">/api/sync/messages</a></li>
    </ul>
  </main>
</body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "datasync-backend",
    authRequired: Boolean(AUTH_TOKEN.trim()),
    uptimeSec: Math.round(process.uptime()),
  });
});

app.use("/api/sync", requireAuth, createSyncRouter(store));

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      ok: false,
      error: "Bad Request",
      message: "Invalid JSON body",
    });
  }

  console.error(err);
  return res.status(500).json({ ok: false, error: "Internal Server Error" });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`DataSync backend listening on port ${PORT}`);
  console.log(`Auth required: ${Boolean(AUTH_TOKEN.trim())}`);
});
