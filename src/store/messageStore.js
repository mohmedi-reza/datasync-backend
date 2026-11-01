import { randomUUID } from "node:crypto";

/**
 * Simple in-memory store.
 * On Render free tier the filesystem is ephemeral, so memory is the
 * reliable default. Messages are lost when the service sleeps/restarts.
 */
export class MessageStore {
  constructor({ maxMessages = 1000 } = {}) {
    this.maxMessages = maxMessages;
    this.messages = [];
  }

  add(payload) {
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

    return record;
  }

  list({ limit = 50, messageType } = {}) {
    let items = this.messages;

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    return items.slice(0, Math.min(Math.max(limit, 1), 500));
  }

  getById(id) {
    return this.messages.find((m) => m.id === id) ?? null;
  }

  clear() {
    const removed = this.messages.length;
    this.messages = [];
    return removed;
  }

  stats() {
    const byType = {};
    for (const message of this.messages) {
      byType[message.messageType] = (byType[message.messageType] ?? 0) + 1;
    }

    return {
      total: this.messages.length,
      maxMessages: this.maxMessages,
      byType,
      latestReceivedAt: this.messages[0]?.receivedAt ?? null,
    };
  }
}
