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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSyncRouter(store) {
  const router = Router();

  router.post("/", async (req, res) => {
    const error = validatePayload(req.body);
    if (error) {
      return res.status(400).json({ ok: false, error: "Bad Request", message: error });
    }

    const record = await store.add({
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

  router.get("/messages", async (req, res) => {
    // No default cap — return everything unless ?limit= is explicitly set
    const rawLimit = req.query.limit;
    const limit =
      rawLimit === undefined || rawLimit === ""
        ? null
        : Number.parseInt(String(rawLimit), 10);

    const messageType =
      typeof req.query.messageType === "string" ? req.query.messageType : undefined;

    const items = await store.list({
      limit: Number.isFinite(limit) && limit > 0 ? limit : null,
      messageType,
    });
    return res.json({
      ok: true,
      count: items.length,
      items,
      version: await store.getVersion(),
    });
  });

  router.get("/messages/:id", async (req, res) => {
    const item = await store.getById(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Not Found" });
    }
    return res.json({ ok: true, item });
  });

  router.delete("/messages/:id", async (req, res) => {
    const removed = await store.removeByIds([req.params.id]);
    if (!removed) {
      return res.status(404).json({ ok: false, error: "Not Found" });
    }
    return res.json({ ok: true, removed, version: await store.getVersion() });
  });

  router.post("/messages/bulk-delete", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) {
      return res.status(400).json({ ok: false, error: "ids required" });
    }
    const removed = await store.removeByIds(ids);
    return res.json({ ok: true, removed, version: await store.getVersion() });
  });

  /** Tiny endpoint — used by dashboard change detection. */
  router.get("/version", async (_req, res) => {
    return res.json({ ok: true, version: await store.getVersion() });
  });

  /**
   * Long-poll: holds until version changes or timeout.
   * Cheap alternative to polling the full message list every few seconds.
   */
  router.get("/wait", async (req, res) => {
    const since = Number.parseInt(String(req.query.since ?? "0"), 10) || 0;
    const timeoutMs = Math.min(
      Math.max(Number.parseInt(String(req.query.timeout ?? "20000"), 10) || 20000, 1000),
      25000
    );
    const started = Date.now();

    let version = await store.getVersion();
    while (version <= since && Date.now() - started < timeoutMs) {
      if (req.aborted || res.writableEnded) return;
      await sleep(1000);
      version = await store.getVersion();
    }

    return res.json({
      ok: true,
      version,
      changed: version > since,
    });
  });

  router.get("/stats", async (_req, res) => {
    return res.json({ ok: true, ...(await store.stats()) });
  });

  router.delete("/messages", async (_req, res) => {
    const removed = await store.clear();
    return res.json({ ok: true, removed, version: await store.getVersion() });
  });

  return router;
}
