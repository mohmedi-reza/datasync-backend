import "dotenv/config";
import cors from "cors";
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createSyncRouter } from "./routes/sync.js";
import { MessageStore } from "./store/messageStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(join(__dirname, "views", "dashboard.html"), "utf8");

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
  res.type("html").send(dashboardHtml);
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
