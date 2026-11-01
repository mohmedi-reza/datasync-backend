import { randomUUID } from "node:crypto";
import { dedupeByFingerprint, messageFingerprint } from "./fingerprint.js";
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
    this._fingerprints = new Set();
    this._readIds = new Set();
  }

  #withRead(item) {
    return { ...item, read: this._readIds.has(String(item.id)) };
  }

  async getVersion() {
    return this.version;
  }

  #bump() {
    this.version += 1;
    return this.version;
  }

  async add(payload) {
    const fp = messageFingerprint(payload);
    if (this._fingerprints.has(fp)) {
      const existing = this.messages.find((m) => messageFingerprint(m) === fp);
      return { ...(existing || {}), duplicate: true };
    }

    const record = {
      id: randomUUID(),
      messageType: payload.messageType,
      sender: payload.sender,
      content: payload.content,
      timestamp: payload.timestamp ?? Date.now(),
      receivedAt: Date.now(),
    };

    this.messages.unshift(record);
    this._fingerprints.add(fp);
    this.#bump();
    return record;
  }

  async list({ limit, messageType } = {}) {
    let items = sortNewestFirst(this.messages);

    if (messageType) {
      items = items.filter((m) => m.messageType === messageType);
    }

    if (limit != null && limit > 0) items = items.slice(0, limit);
    return items.map((item) => this.#withRead(item));
  }

  async getById(id) {
    const item = this.messages.find((m) => m.id === id) ?? null;
    return item ? this.#withRead(item) : null;
  }

  async markRead(ids = []) {
    const idSet = new Set((ids || []).map(String).filter(Boolean));
    if (!idSet.size) return 0;
    let marked = 0;
    for (const id of idSet) {
      if (!this.messages.some((m) => String(m.id) === id)) continue;
      if (!this._readIds.has(id)) {
        this._readIds.add(id);
        marked += 1;
      }
    }
    return marked;
  }

  async removeByIds(ids = []) {
    const idSet = new Set((ids || []).map(String));
    if (!idSet.size) return 0;
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => !idSet.has(String(m.id)));
    const removed = before - this.messages.length;
    if (removed > 0) {
      for (const id of idSet) this._readIds.delete(id);
      this._fingerprints = new Set(this.messages.map((m) => messageFingerprint(m)));
      this.#bump();
    }
    return removed;
  }

  async dedupe() {
    const before = this.messages.length;
    this.messages = sortNewestFirst(dedupeByFingerprint(this.messages));
    this._fingerprints = new Set(this.messages.map((m) => messageFingerprint(m)));
    const removed = before - this.messages.length;
    if (removed > 0) this.#bump();
    return { before, after: this.messages.length, removed };
  }

  async clear() {
    const removed = this.messages.length;
    this.messages = [];
    this._fingerprints = new Set();
    this._readIds = new Set();
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
