import { createHash } from "node:crypto";

/** Soft identity: same type + sender + content = same message (ignore timestamp churn). */
export function messageFingerprint({ messageType, sender, content } = {}) {
  const raw = [
    String(messageType || "").trim().toUpperCase(),
    String(sender || "").trim(),
    String(content || "").trim(),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

/** Keep newest occurrence of each fingerprint. */
export function dedupeByFingerprint(items = []) {
  const best = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const fp = messageFingerprint(item);
    const prev = best.get(fp);
    if (!prev) {
      best.set(fp, item);
      continue;
    }
    const prevTime = Number(prev.timestamp ?? prev.receivedAt ?? 0);
    const nextTime = Number(item.timestamp ?? item.receivedAt ?? 0);
    if (nextTime >= prevTime) best.set(fp, item);
  }
  return [...best.values()];
}
