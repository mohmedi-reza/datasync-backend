import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { dedupeByFingerprint, messageFingerprint } from "./fingerprint.js";
import { sortNewestFirst } from "./sort.js";

const LEGACY_KEY = "datasync:messages";
const LIST_KEY = "datasync:messages:list";
const VERSION_KEY = "datasync:version";
const FP_KEY = "datasync:fingerprints";
const READ_KEY = "datasync:read-ids";

/**
 * Durable store via Upstash Redis.
 * Uses a Redis LIST (LPUSH) so insert order stays newest-first.
 * Soft-dedupes by type+sender+content so re-synced notifications don't pile up.
 */
export class RedisStore {
  constructor({ url, token } = {}) {
    this.kind = "redis";
    this.maxMessages = null;
    this.redis = new Redis({ url, token });
    this._migrated = false;
  }

  async getVersion() {
    const value = await this.redis.get(VERSION_KEY);
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async #bump() {
    return this.redis.incr(VERSION_KEY);
  }

  async #migrateLegacyIfNeeded() {
    if (this._migrated) return;
    this._migrated = true;

    const existing = await this.redis.llen(LIST_KEY);
    if (existing > 0) return;

    const raw = await this.redis.get(LEGACY_KEY);
    if (!raw) return;

    let legacy = [];
    if (Array.isArray(raw)) legacy = raw;
    else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) legacy = parsed;
      } catch {
        legacy = [];
      }
    }

    if (!legacy.length) return;

    const ordered = sortNewestFirst(legacy);
    await this.#writeList(LIST_KEY, ordered);
    await this.redis.del(LEGACY_KEY);
  }

  async #readAll() {
    await this.#migrateLegacyIfNeeded();
    const items = await this.redis.lrange(LIST_KEY, 0, -1);
    const normalized = (items || []).map((item) => {
      if (item && typeof item === "object") return item;
      if (typeof item === "string") {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      }
      return null;
    }).filter(Boolean);

    return sortNewestFirst(normalized);
  }

  async #readIdSet() {
    const ids = await this.redis.smembers(READ_KEY);
    return new Set((ids || []).map(String));
  }

  #withRead(item, readIds) {
    return { ...item, read: readIds.has(String(item.id)) };
  }

  async #writeList(key, messages) {
    await this.redis.del(key);
    if (!messages.length) return;

    // Batch LPUSH via pipeline to avoid rate-limit mid-write loss.
    const chunkSize = 50;
    for (let start = messages.length - 1; start >= 0; start -= chunkSize) {
      const end = Math.max(-1, start - chunkSize);
      const pipe = this.redis.pipeline();
      for (let i = start; i > end; i -= 1) {
        pipe.lpush(key, messages[i]);
      }
      await pipe.exec();
    }
  }

  async #replaceList(messages) {
    const tempKey = `${LIST_KEY}:tmp`;
    await this.#writeList(tempKey, messages);
    // Atomic swap — old list stays intact until temp is fully written.
    await this.redis.rename(tempKey, LIST_KEY);

    await this.redis.del(FP_KEY);
    if (!messages.length) return;

    const fps = messages.map((m) => messageFingerprint(m));
    const chunkSize = 100;
    for (let i = 0; i < fps.length; i += chunkSize) {
      await this.redis.sadd(FP_KEY, ...fps.slice(i, i + chunkSize));
    }
  }

  async #ensureFingerprintIndex(messages) {
    const size = await this.redis.scard(FP_KEY);
    if (size > 0) return;
    if (!messages.length) return;
    const fps = messages.map((m) => messageFingerprint(m));
    const chunkSize = 100;
    for (let i = 0; i < fps.length; i += chunkSize) {
      await this.redis.sadd(FP_KEY, ...fps.slice(i, i + chunkSize));
    }
  }

  async add(payload) {
    await this.#migrateLegacyIfNeeded();
    const fp = messageFingerprint(payload);

    let known = await this.redis.sismember(FP_KEY, fp);
    if (!known) {
      const messages = await this.#readAll();
      await this.#ensureFingerprintIndex(messages);
      known = await this.redis.sismember(FP_KEY, fp);
      if (known) {
        const existing = messages.find((m) => messageFingerprint(m) === fp);
        if (existing) return { ...existing, duplicate: true };
      } else {
        const existing = messages.find((m) => messageFingerprint(m) === fp);
        if (existing) {
          await this.redis.sadd(FP_KEY, fp);
          return { ...existing, duplicate: true };
        }
      }
    } else {
      const messages = await this.#readAll();
      const existing = messages.find((m) => messageFingerprint(m) === fp);
      if (existing) return { ...existing, duplicate: true };
      // Stale fingerprint entry — allow insert.
    }

    const record = {
      id: randomUUID(),
      messageType: payload.messageType,
      sender: payload.sender,
      content: payload.content,
      timestamp: payload.timestamp ?? Date.now(),
      receivedAt: Date.now(),
    };

    await this.redis.lpush(LIST_KEY, record);
    await this.redis.sadd(FP_KEY, fp);
    await this.#bump();
    return record;
  }

  async list({ limit, messageType } = {}) {
    let items = await this.#readAll();
    const readIds = await this.#readIdSet();

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    if (limit != null && limit > 0) items = items.slice(0, limit);
    return items.map((item) => this.#withRead(item, readIds));
  }

  async getById(id) {
    const messages = await this.#readAll();
    const item = messages.find((m) => m.id === id) ?? null;
    if (!item) return null;
    const readIds = await this.#readIdSet();
    return this.#withRead(item, readIds);
  }

  async markRead(ids = []) {
    const idSet = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!idSet.length) return 0;

    const messages = await this.#readAll();
    const existing = new Set(messages.map((m) => String(m.id)));
    const toMark = idSet.filter((id) => existing.has(id));
    if (!toMark.length) return 0;

    const chunkSize = 100;
    for (let i = 0; i < toMark.length; i += chunkSize) {
      await this.redis.sadd(READ_KEY, ...toMark.slice(i, i + chunkSize));
    }
    return toMark.length;
  }

  async removeByIds(ids = []) {
    const idSet = new Set((ids || []).map(String));
    if (!idSet.size) return 0;

    const messages = await this.#readAll();
    const kept = messages.filter((m) => !idSet.has(String(m.id)));
    const removed = messages.length - kept.length;
    if (!removed) return 0;

    await this.#replaceList(kept);
    const gone = [...idSet];
    const chunkSize = 100;
    for (let i = 0; i < gone.length; i += chunkSize) {
      await this.redis.srem(READ_KEY, ...gone.slice(i, i + chunkSize));
    }
    await this.#bump();
    return removed;
  }

  async dedupe() {
    const messages = await this.#readAll();
    const before = messages.length;
    const unique = sortNewestFirst(dedupeByFingerprint(messages));
    const removed = before - unique.length;
    if (!removed) {
      await this.#ensureFingerprintIndex(unique);
      return { before, after: unique.length, removed: 0 };
    }
    await this.#replaceList(unique);
    await this.#bump();
    return { before, after: unique.length, removed };
  }

  async clear() {
    await this.#migrateLegacyIfNeeded();
    const removed = await this.redis.llen(LIST_KEY);
    await this.redis.del(LIST_KEY);
    await this.redis.del(LEGACY_KEY);
    await this.redis.del(FP_KEY);
    await this.redis.del(READ_KEY);
    await this.redis.del(`${LIST_KEY}:tmp`);
    await this.#bump();
    return removed || 0;
  }

  async stats() {
    const messages = await this.#readAll();
    const byType = {};
    for (const message of messages) {
      byType[message.messageType] = (byType[message.messageType] ?? 0) + 1;
    }

    return {
      total: messages.length,
      maxMessages: null,
      byType,
      latestReceivedAt: messages[0]?.receivedAt ?? null,
      storage: this.kind,
      version: await this.getVersion(),
    };
  }
}

export function createStoreFromEnv() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

  if (url && token) {
    return new RedisStore({ url, token });
  }

  return null;
}
