import {
  deriveRequests,
  hash,
  LIMITS,
  verifyEnvelope,
  type Envelope,
  type MessageRepository,
  type StoredMessage,
} from "@beacon/protocol";
import { SCHEMA } from "./schema";

export type SqlValue = string | number | null;
export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    ...params: SqlValue[]
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
}
export interface CloudEvent {
  id: string;
  deviceId: string;
  sequence: number;
  recordedAt: number;
  kind: string;
  requestId?: string;
  message?: Envelope;
  peerId?: string;
}
interface MessageRow {
  envelope: string;
  hops: number;
  received_at: number;
}
export interface EventRow {
  id: string;
  sequence: number;
  kind: string;
  request_id: string | null;
  recorded_at: number;
  data: string;
  uploaded: number;
}
const RETAIN_MS = LIMITS.maxTtlMs + LIMITS.futureSkewMs;

/** One writer owns this connection: transaction boundaries include state, event, and upload queue. */
export class Repository implements MessageRepository {
  private writeTail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly db: Database,
    readonly nodeId: string,
    private readonly clock = Date.now,
    private readonly options: { privateMode?: boolean } = {},
  ) {}
  async initialize() {
    await this.db.execAsync(SCHEMA);
  }
  private write<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.writeTail.then(operation, operation);
    this.writeTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.db.execAsync("BEGIN IMMEDIATE");
    try {
      const result = await operation();
      await this.db.execAsync("COMMIT");
      return result;
    } catch (error) {
      await this.db.execAsync("ROLLBACK");
      throw error;
    }
  }
  private decode(row: MessageRow): StoredMessage {
    const envelope: unknown = JSON.parse(row.envelope);
    if (!verifyEnvelope(envelope))
      throw new Error("Stored message integrity check failed.");
    return { envelope, hops: row.hops, receivedAt: row.received_at };
  }
  async listMessages(): Promise<StoredMessage[]> {
    await this.writeTail;
    return (
      await this.db.getAllAsync<MessageRow>(
        "SELECT envelope,hops,received_at FROM messages ORDER BY received_at,id",
      )
    ).map((r) => this.decode(r));
  }
  async getMessage(id: string): Promise<StoredMessage | undefined> {
    await this.writeTail;
    const row = await this.db.getFirstAsync<MessageRow>(
      "SELECT envelope,hops,received_at FROM messages WHERE id=?",
      id,
    );
    return row ? this.decode(row) : undefined;
  }
  async saveMessage(
    envelope: Envelope,
    hops: number,
    receivedAt: number,
  ): Promise<boolean> {
    if (
      !verifyEnvelope(envelope) ||
      !Number.isInteger(hops) ||
      hops < 0 ||
      hops > envelope.hopLimit ||
      !Number.isSafeInteger(receivedAt) ||
      receivedAt < 0
    )
      throw new Error("Invalid message");
    return this.write(() =>
      this.transaction(async () => {
        const old = await this.db.getFirstAsync<{ message_id: string }>(
          "SELECT message_id FROM dedup WHERE message_id=?",
          envelope.id,
        );
        if (old) {
          await this.db.runAsync(
            "UPDATE messages SET hops=MIN(hops,?) WHERE id=?",
            hops,
            envelope.id,
          );
          return false;
        }
        const count = await this.db.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM messages",
        );
        if ((count?.n ?? 0) >= LIMITS.messages)
          throw new Error(
            "Local message storage is full. Retained requests are protected; clear eligible history in Settings.",
          );
        await this.db.runAsync(
          "INSERT INTO dedup(message_id,received_at) VALUES(?,?)",
          envelope.id,
          receivedAt,
        );
        await this.db.runAsync(
          "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
          envelope.id,
          envelope.requestId,
          envelope.origin,
          envelope.type,
          JSON.stringify(envelope),
          hops,
          receivedAt,
          envelope.expiresAt,
        );
        const rows = await this.db.getAllAsync<MessageRow>(
          "SELECT envelope,hops,received_at FROM messages WHERE request_id=?",
          envelope.requestId,
        );
        const state = deriveRequests(
          rows.map((r) => this.decode(r).envelope),
        ).find((s) => s.id === envelope.requestId);
        if (state) {
          await this.db.runAsync(
            "INSERT OR REPLACE INTO request_state VALUES(?,?,?,?)",
            state.id,
            state.revision,
            state.status,
            JSON.stringify(state),
          );
          for (const offer of state.offers)
            await this.db.runAsync(
              "INSERT OR REPLACE INTO offers VALUES(?,?,?)",
              offer.id,
              state.id,
              JSON.stringify(offer),
            );
          if (state.assignment)
            await this.db.runAsync(
              "INSERT OR REPLACE INTO assignments VALUES(?,?,?)",
              state.id,
              state.revision,
              JSON.stringify(state.assignment),
            );
        }
        await this.appendEventInTransaction(
          hash(`${this.nodeId}:${envelope.id}`),
          envelope.type,
          envelope.requestId,
          receivedAt,
          { message: envelope },
        );
        return true;
      }),
    );
  }
  private async appendEventInTransaction(
    id: string,
    kind: string,
    requestId: string | undefined,
    time: number,
    data: { message?: Envelope; peerId?: string },
  ) {
    if (this.options.privateMode) return;
    const existing = await this.db.getFirstAsync<{ id: string }>(
      "SELECT id FROM events WHERE id=?",
      id,
    );
    if (existing) return;
    const count = await this.db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events",
    );
    if ((count?.n ?? 0) >= 12_000)
      throw new Error(
        "Event history is full. Clear eligible history before recording more traffic.",
      );
    await this.db.runAsync(
      "INSERT OR IGNORE INTO events(id,kind,request_id,recorded_at,data) VALUES(?,?,?,?,?)",
      id,
      kind,
      requestId ?? null,
      time,
      JSON.stringify(data),
    );
    await this.db.runAsync(
      "INSERT OR IGNORE INTO outbox(event_id) VALUES(?)",
      id,
    );
  }
  async recordEvent(id: string, kind: string, peerId?: string) {
    return this.write(() =>
      this.transaction(() =>
        this.appendEventInTransaction(id, kind, undefined, this.clock(), {
          peerId,
        }),
      ),
    );
  }
  async listForwarded(peerId: string): Promise<string[]> {
    await this.writeTail;
    return (
      await this.db.getAllAsync<{ message_id: string }>(
        "SELECT message_id FROM forwarding WHERE peer_id=?",
        peerId,
      )
    ).map((r) => r.message_id);
  }
  async markForwarded(peerId: string, messageId: string) {
    return this.write(() =>
      this.transaction(async () => {
        const time = this.clock();
        await this.db.runAsync(
          "INSERT INTO forwarding(peer_id,message_id,last_at) VALUES(?,?,?) ON CONFLICT(peer_id,message_id) DO UPDATE SET attempts=attempts+1,last_at=excluded.last_at",
          peerId,
          messageId,
          time,
        );
        const msg = await this.db.getFirstAsync<{ request_id: string }>(
          "SELECT request_id FROM messages WHERE id=?",
          messageId,
        );
        await this.appendEventInTransaction(
          hash(`${this.nodeId}:forward:${peerId}:${messageId}`),
          "forwarded",
          msg?.request_id,
          time,
          { peerId },
        );
      }),
    );
  }
  async forwardingCounts(): Promise<Record<string, number>> {
    await this.writeTail;
    const rows = await this.db.getAllAsync<{ request_id: string; n: number }>(
      "SELECT m.request_id,COUNT(DISTINCT f.peer_id) n FROM forwarding f JOIN messages m ON m.id=f.message_id WHERE m.type='sos' GROUP BY m.request_id",
    );
    return Object.fromEntries(rows.map((r) => [r.request_id, r.n]));
  }
  async getSetting<T>(key: string, fallback: T): Promise<T> {
    await this.writeTail;
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key=?",
      key,
    );
    return row ? (JSON.parse(row.value) as T) : fallback;
  }
  async setSetting(key: string, value: unknown) {
    await this.write(() =>
      this.db.runAsync(
        "INSERT OR REPLACE INTO settings VALUES(?,?)",
        key,
        JSON.stringify(value),
      ),
    );
  }
  async events(): Promise<EventRow[]> {
    if (this.options.privateMode) return [];
    await this.writeTail;
    return this.db.getAllAsync<EventRow>(
      "SELECT * FROM events ORDER BY sequence DESC LIMIT 2000",
    );
  }
  async pendingCount(): Promise<number> {
    if (this.options.privateMode) return 0;
    await this.writeTail;
    return (
      (
        await this.db.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) n FROM outbox",
        )
      )?.n ?? 0
    );
  }
  async uploadBatch(force = false): Promise<CloudEvent[]> {
    if (this.options.privateMode) return [];
    await this.writeTail;
    const rows = await this.db.getAllAsync<EventRow>(
      "SELECT e.* FROM events e JOIN outbox o ON o.event_id=e.id WHERE o.next_attempt<=? ORDER BY e.sequence LIMIT 50",
      force ? Number.MAX_SAFE_INTEGER : this.clock(),
    );
    return rows.map((r) => ({
      id: r.id,
      deviceId: this.nodeId,
      sequence: r.sequence,
      recordedAt: r.recorded_at,
      kind: r.kind,
      ...(r.request_id ? { requestId: r.request_id } : {}),
      ...JSON.parse(r.data),
    }));
  }
  async confirmUpload(ids: string[]) {
    await this.write(() =>
      this.transaction(async () => {
        for (const id of ids) {
          await this.db.runAsync("UPDATE events SET uploaded=1 WHERE id=?", id);
          await this.db.runAsync("DELETE FROM outbox WHERE event_id=?", id);
        }
      }),
    );
  }
  async failUpload(ids: string[], reason: string) {
    await this.write(() =>
      this.transaction(async () => {
        for (const id of ids)
          await this.db.runAsync(
            "UPDATE outbox SET attempts=attempts+1,next_attempt=?+MIN(3600000,5000*(1<<MIN(attempts,9))),error=? WHERE event_id=?",
            this.clock(),
            reason.slice(0, 120),
            id,
          );
      }),
    );
  }
  /** Keep all live request dependencies and cancellation/completion tombstones for the full replay window. */
  async clearEligibleHistory() {
    await this.write(() =>
      this.transaction(async () => {
        const cutoff = this.clock() - RETAIN_MS;
        const expired = await this.db.getAllAsync<{ request_id: string }>(
          "SELECT request_id FROM messages GROUP BY request_id HAVING MAX(expires_at)<? AND MAX(received_at)<?",
          this.clock(),
          cutoff,
        );
        for (const { request_id: id } of expired) {
          const pending = await this.db.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM events e JOIN outbox o ON o.event_id=e.id WHERE e.request_id=?",
            id,
          );
          if (pending?.n) continue;
          await this.db.runAsync("DELETE FROM events WHERE request_id=?", id);
          await this.db.runAsync("DELETE FROM offers WHERE request_id=?", id);
          await this.db.runAsync(
            "DELETE FROM assignments WHERE request_id=?",
            id,
          );
          await this.db.runAsync("DELETE FROM request_state WHERE id=?", id);
          await this.db.runAsync("DELETE FROM messages WHERE request_id=?", id);
        }
        await this.db.runAsync(
          "DELETE FROM dedup WHERE received_at<? AND message_id NOT IN (SELECT id FROM messages)",
          cutoff,
        );
        await this.db.runAsync(
          "DELETE FROM events WHERE request_id IS NULL AND recorded_at<? AND uploaded=1",
          cutoff,
        );
      }),
    );
  }
}
