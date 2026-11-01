import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

const KEY = "datasync:messages";

/**
 * Durable store via Upstash Redis. Survives Vercel rebuilds/redeploys.
 */
export class RedisStore {
  constructor({ maxMessages = 1000, url, token } = {}) {
    this.kind = "redis";
    this.maxMessages = maxMessages;
    this.redis = new Redis({ url, token });
  }

  async #readAll() {
    const raw = await this.redis.get(KEY);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async #writeAll(messages) {
    await this.redis.set(KEY, messages);
  }

  async add(payload) {
    const record = {
      id: randomUUID(),
      messageType: payload.messageType,
      sender: payload.sender,
      content: payload.content,
      timestamp: payload.timestamp ?? Date.now(),
      receivedAt: Date.now(),
    };

    const messages = await this.#readAll();
    messages.unshift(record);
    if (messages.length > this.maxMessages) {
      messages.length = this.maxMessages;
    }
    await this.#writeAll(messages);
    return record;
  }

  async list({ limit = 50, messageType } = {}) {
    let items = await this.#readAll();

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    return items.slice(0, Math.min(Math.max(limit, 1), 500));
  }

  async getById(id) {
    const messages = await this.#readAll();
    return messages.find((m) => m.id === id) ?? null;
  }

  async clear() {
    const messages = await this.#readAll();
    const removed = messages.length;
    await this.redis.del(KEY);
    return removed;
  }

  async stats() {
    const messages = await this.#readAll();
    const byType = {};
    for (const message of messages) {
      byType[message.messageType] = (byType[message.messageType] ?? 0) + 1;
    }

    return {
      total: messages.length,
      maxMessages: this.maxMessages,
      byType,
      latestReceivedAt: messages[0]?.receivedAt ?? null,
      storage: this.kind,
    };
  }
}

export function createStoreFromEnv({ maxMessages = 1000 } = {}) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

  if (url && token) {
    return new RedisStore({ maxMessages, url, token });
  }

  return null;
}
