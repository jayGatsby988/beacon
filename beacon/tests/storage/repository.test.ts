import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  Repository,
  type Database,
  type SqlValue,
} from "../../apps/mobile/src/storage/Repository.js";
import {
  createIdentity,
  createRequestId,
  createEnvelope,
  deriveRequests,
  LIMITS,
} from "../../packages/protocol/src/index.js";

class Adapter implements Database {
  sql: DatabaseSync;
  failOn: RegExp | undefined;
  constructor(path = ":memory:") {
    this.sql = new DatabaseSync(path);
  }
  async execAsync(sql: string) {
    this.sql.exec(sql);
  }
  async runAsync(sql: string, ...params: SqlValue[]) {
    if (this.failOn?.test(sql)) throw new Error("Injected transaction failure");
    const r = this.sql.prepare(sql).run(...params);
    return {
      changes: Number(r.changes),
      lastInsertRowId: Number(r.lastInsertRowid),
    };
  }
  async getAllAsync<T>(sql: string, ...params: SqlValue[]) {
    return this.sql.prepare(sql).all(...params) as T[];
  }
  async getFirstAsync<T>(sql: string, ...params: SqlValue[]) {
    return (this.sql.prepare(sql).get(...params) ?? null) as T | null;
  }
  close() {
    this.sql.close();
  }
}
const initialTime = 1_800_000_000_000;
async function fixture(path?: string) {
  const db = new Adapter(path),
    id = createIdentity(randomBytes);
  let time = initialTime;
  const repository = new Repository(db, id.nodeId, () => time);
  await repository.initialize();
  const sos = () =>
    createEnvelope(
      id,
      {
        type: "sos",
        requestId: createRequestId(id, randomBytes),
        destination: "community",
        payload: {
          category: "other",
          note: "Synthetic storage test",
          displayName: "Test",
          location: { source: "unavailable", capturedAt: time },
        },
      },
      time,
      randomBytes,
    );
  return {
    db,
    id,
    repository,
    sos,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
async function counts(db: Adapter) {
  const result: Record<string, number> = {};
  for (const table of [
    "messages",
    "dedup",
    "request_state",
    "events",
    "outbox",
    "forwarding",
  ])
    result[table] = (await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) n FROM ${table}`,
    ))!.n;
  return result;
}

test("injected outbox failure rolls back message, dedup, request state and event; later retry succeeds", async () => {
  const f = await fixture();
  try {
    const m = f.sos();
    f.db.failOn = /INSERT OR IGNORE INTO outbox/;
    await assert.rejects(
      f.repository.saveMessage(m, 0, initialTime),
      /Injected/,
    );
    assert.deepEqual(await counts(f.db), {
      messages: 0,
      dedup: 0,
      request_state: 0,
      events: 0,
      outbox: 0,
      forwarding: 0,
    });
    f.db.failOn = undefined;
    assert.equal(await f.repository.saveMessage(m, 0, initialTime), true);
    assert.deepEqual(await counts(f.db), {
      messages: 1,
      dedup: 1,
      request_state: 1,
      events: 1,
      outbox: 1,
      forwarding: 0,
    });
  } finally {
    f.db.close();
  }
});

test("disk restart preserves dedup, shorter route and outbox; upload ACK does not become endpoint receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "beacon-storage-")),
    path = join(directory, "beacon.db");
  const f = await fixture(path);
  const m = f.sos();
  try {
    await f.repository.saveMessage(m, 5, initialTime);
    await f.repository.saveMessage(m, 2, initialTime + 1);
    await f.repository.markForwarded("radio-session", m.id);
    const batch = await f.repository.uploadBatch();
    assert.equal(batch.length, 2);
    assert.ok(batch.every((e) => e.id.length === 64));
    await f.repository.confirmUpload(batch.map((e) => e.id));
    assert.equal(await f.repository.pendingCount(), 0);
    await f.repository.markForwarded("radio-session", m.id);
    assert.equal(
      await f.repository.pendingCount(),
      0,
      "duplicate forwarding must not resurrect an uploaded event",
    );
    f.db.close();
    const db = new Adapter(path),
      restored = new Repository(db, f.id.nodeId, () => initialTime);
    await restored.initialize();
    try {
      assert.equal(await restored.saveMessage(m, 4, initialTime), false);
      assert.equal((await restored.getMessage(m.id))!.hops, 2);
      assert.deepEqual(await restored.listForwarded("radio-session"), [m.id]);
      assert.equal((await restored.forwardingCounts())[m.requestId], 1);
      assert.equal(await restored.pendingCount(), 0);
      const state = deriveRequests(
        (await restored.listMessages()).map((r) => r.envelope),
      )[0];
      assert.equal(state.receipts.length, 0);
      assert.equal(state.status, "open");
      assert.equal(
        (await db.getFirstAsync<{ attempts: number }>(
          "SELECT attempts FROM forwarding",
        ))!.attempts,
        2,
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retention protects recent received history and pending upload, then cascades eligible deletion", async () => {
  const f = await fixture();
  try {
    const m = f.sos();
    await f.repository.saveMessage(m, 0, initialTime);
    await f.repository.markForwarded("session", m.id);
    f.advance(LIMITS.maxTtlMs + LIMITS.futureSkewMs - 1);
    await f.repository.clearEligibleHistory();
    assert.ok(await f.repository.getMessage(m.id));
    f.advance(2);
    await f.repository.clearEligibleHistory();
    assert.ok(
      await f.repository.getMessage(m.id),
      "pending outbox protects retained history",
    );
    await f.repository.confirmUpload(
      (await f.repository.uploadBatch(true)).map((e) => e.id),
    );
    await f.repository.clearEligibleHistory();
    assert.deepEqual(await counts(f.db), {
      messages: 0,
      dedup: 0,
      request_state: 0,
      events: 0,
      outbox: 0,
      forwarding: 0,
    });
  } finally {
    f.db.close();
  }
});

test("message capacity is checked inside the transaction and preserves existing data", async () => {
  const f = await fixture();
  try {
    // Fill only storage rows to isolate capacity admission from unrelated signature CPU cost.
    const insert = f.db.sql.prepare(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
    );
    for (let i = 0; i < LIMITS.messages; i++)
      insert.run(
        String(i),
        "synthetic",
        f.id.nodeId,
        "sos",
        "{}",
        0,
        initialTime,
        initialTime + 1,
      );
    await assert.rejects(
      f.repository.saveMessage(f.sos(), 0, initialTime),
      /storage is full/,
    );
    assert.equal((await counts(f.db)).messages, LIMITS.messages);
    assert.equal((await counts(f.db)).dedup, 0);
  } finally {
    f.db.close();
  }
});

test("event capacity rolls back forwarding and messages, but permits idempotent existing events", async () => {
  const f = await fixture();
  try {
    const m = f.sos();
    await f.repository.saveMessage(m, 0, initialTime);
    await f.repository.markForwarded("existing", m.id);
    const insert = f.db.sql.prepare(
      "INSERT INTO events(id,kind,recorded_at,data) VALUES(?,?,?,?)",
    );
    for (let i = 2; i < 12000; i++)
      insert.run(`synthetic:${i}`, "test", initialTime, "{}");
    await f.repository.markForwarded("existing", m.id);
    await assert.rejects(
      f.repository.markForwarded("new", m.id),
      /history is full/,
    );
    assert.deepEqual(await f.repository.listForwarded("new"), []);
    await assert.rejects(
      f.repository.saveMessage(f.sos(), 0, initialTime),
      /history is full/,
    );
    assert.equal((await counts(f.db)).messages, 1);
    assert.equal((await counts(f.db)).dedup, 1);
  } finally {
    f.db.close();
  }
});

test("failed uploads back off, preserve local state, bound errors and forced retry selects pending events", async () => {
  const f = await fixture();
  try {
    await f.repository.saveMessage(f.sos(), 0, initialTime);
    const batch = await f.repository.uploadBatch();
    await f.repository.failUpload(
      batch.map((e) => e.id),
      "x".repeat(1000),
    );
    assert.equal((await f.repository.uploadBatch()).length, 0);
    assert.equal((await f.repository.uploadBatch(true)).length, 1);
    const row = await f.db.getFirstAsync<{
      attempts: number;
      error: string;
      next_attempt: number;
    }>("SELECT * FROM outbox");
    assert.equal(row!.attempts, 1);
    assert.equal(row!.error.length, 120);
    assert.equal(row!.next_attempt, initialTime + 5000);
    f.advance(5000);
    assert.equal((await f.repository.uploadBatch()).length, 1);
    assert.equal((await f.repository.listMessages()).length, 1);
  } finally {
    f.db.close();
  }
});

test("concurrent duplicate saves are serialized and invalid local receipt times are rejected", async () => {
  const f = await fixture();
  try {
    const m = f.sos();
    const results = await Promise.all([
      f.repository.saveMessage(m, 3, initialTime),
      f.repository.saveMessage(m, 1, initialTime),
    ]);
    assert.deepEqual(results, [true, false]);
    assert.equal((await f.repository.getMessage(m.id))!.hops, 1);
    for (const invalid of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])
      await assert.rejects(
        f.repository.saveMessage(f.sos(), 0, invalid),
        /Invalid message/,
      );
    assert.equal((await counts(f.db)).events, 1);
  } finally {
    f.db.close();
  }
});
