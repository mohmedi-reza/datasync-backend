import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { sortNewestFirst } from "./sort.js";

const LEGACY_KEY = "datasync:messages";
const LIST_KEY = "datasync:messages:list";
const VERSION_KEY = "datasync:version";

/**
 * Durable store via Upstash Redis.
 * Uses a Redis LIST (LPUSH) so insert order stays newest-first.
 * No app-level message cap.
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
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      await this.redis.lpush(LIST_KEY, ordered[i]);
    }
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

  async add(payload) {
    await this.#migrateLegacyIfNeeded();

    const record = {
      id: randomUUID(),
      messageType: payload.messageType,
      sender: payload.sender,
      content: payload.content,
      timestamp: payload.timestamp ?? Date.now(),
      receivedAt: Date.now(),
    };

    await this.redis.lpush(LIST_KEY, record);
    await this.#bump();
    return record;
  }

  async list({ limit, messageType } = {}) {
    let items = await this.#readAll();

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    if (limit == null || limit <= 0) return items;
    return items.slice(0, limit);
  }

  async getById(id) {
    const messages = await this.#readAll();
    return messages.find((m) => m.id === id) ?? null;
  }

  async removeByIds(ids = []) {
    const idSet = new Set((ids || []).map(String));
    if (!idSet.size) return 0;

    const messages = await this.#readAll();
    const kept = messages.filter((m) => !idSet.has(String(m.id)));
    const removed = messages.length - kept.length;
    if (!removed) return 0;

    await this.redis.del(LIST_KEY);
    if (kept.length) {
      // LPUSH oldest first so newest ends at head
      for (let i = kept.length - 1; i >= 0; i -= 1) {
        await this.redis.lpush(LIST_KEY, kept[i]);
      }
    }
    await this.#bump();
    return removed;
  }

  async clear() {
    await this.#migrateLegacyIfNeeded();
    const removed = await this.redis.llen(LIST_KEY);
    await this.redis.del(LIST_KEY);
    await this.redis.del(LEGACY_KEY);
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
