import { randomUUID } from "node:crypto";
import { sortNewestFirst } from "./sort.js";

/**
 * In-memory store. Lost on process restart / Vercel redeploy.
 * Prefer RedisStore in production.
 * No message cap — grows without app-level limit.
 */
export class MessageStore {
  constructor() {
    this.kind = "memory";
    this.maxMessages = null;
    this.messages = [];
    this.version = 0;
  }

  async getVersion() {
    return this.version;
  }

  #bump() {
    this.version += 1;
    return this.version;
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

    this.messages.unshift(record);
    this.#bump();
    return record;
  }

  async list({ limit, messageType } = {}) {
    let items = sortNewestFirst(this.messages);

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    if (limit == null || limit <= 0) return items;
    return items.slice(0, limit);
  }

  async getById(id) {
    return this.messages.find((m) => m.id === id) ?? null;
  }

  async clear() {
    const removed = this.messages.length;
    this.messages = [];
    this.#bump();
    return removed;
  }

  async stats() {
    const byType = {};
    for (const message of this.messages) {
      byType[message.messageType] = (byType[message.messageType] ?? 0) + 1;
    }

    return {
      total: this.messages.length,
      maxMessages: null,
      byType,
      latestReceivedAt: this.messages[0]?.receivedAt ?? null,
      storage: this.kind,
      version: this.version,
    };
  }
}
