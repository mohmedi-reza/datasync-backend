import { Router } from "express";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Body must be a JSON object";
  }

  if (!isNonEmptyString(body.messageType)) {
    return "messageType is required and must be a non-empty string";
  }

  if (!isNonEmptyString(body.sender)) {
    return "sender is required and must be a non-empty string";
  }

  if (!isNonEmptyString(body.content)) {
    return "content is required and must be a non-empty string";
  }

  if (
    body.timestamp !== undefined &&
    (typeof body.timestamp !== "number" || !Number.isFinite(body.timestamp))
  ) {
    return "timestamp must be a number (unix ms) when provided";
  }

  return null;
}

export function createSyncRouter(store) {
  const router = Router();

  /**
   * Main endpoint used by the Android app (SyncApiService.sendPayload).
   * POST JSON:
   * {
   *   "messageType": "SMS" | "DATA_SYNC" | ...,
   *   "sender": "+1555...",
   *   "content": "...",
   *   "timestamp": 1710000000000
   * }
   */
  router.post("/", (req, res) => {
    const error = validatePayload(req.body);
    if (error) {
      return res.status(400).json({ ok: false, error: "Bad Request", message: error });
    }

    const record = store.add({
      messageType: req.body.messageType.trim(),
      sender: req.body.sender.trim(),
      content: req.body.content.trim(),
      timestamp: req.body.timestamp,
    });

    return res.status(201).json({
      ok: true,
      id: record.id,
      receivedAt: record.receivedAt,
      message: "Payload accepted",
    });
  });

  router.get("/messages", (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? "50"), 10) || 50;
    const messageType =
      typeof req.query.messageType === "string" ? req.query.messageType : undefined;

    const items = store.list({ limit, messageType });
    return res.json({
      ok: true,
      count: items.length,
      items,
    });
  });

  router.get("/messages/:id", (req, res) => {
    const item = store.getById(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Not Found" });
    }
    return res.json({ ok: true, item });
  });

  router.get("/stats", (_req, res) => {
    return res.json({ ok: true, ...store.stats() });
  });

  router.delete("/messages", (_req, res) => {
    const removed = store.clear();
    return res.json({ ok: true, removed });
  });

  return router;
}
