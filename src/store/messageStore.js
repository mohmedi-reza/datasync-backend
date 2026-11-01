import { randomUUID } from "node:crypto";

/**
 * In-memory store. Lost on process restart / Vercel redeploy.
 * Prefer RedisStore in production.
 */
export class MessageStore {
  constructor({ maxMessages = 1000 } = {}) {
    this.kind = "memory";
    this.maxMessages = maxMessages;
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

    if (this.messages.length > this.maxMessages) {
      this.messages.length = this.maxMessages;
    }

    this.#bump();
    return record;
  }

  async list({ limit = 50, messageType } = {}) {
    let items = this.messages;

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    return items.slice(0, Math.min(Math.max(limit, 1), 500));
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
      maxMessages: this.maxMessages,
      byType,
      latestReceivedAt: this.messages[0]?.receivedAt ?? null,
      storage: this.kind,
      version: this.version,
    };
  }
}
