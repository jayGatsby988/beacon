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
  SocialRepository,
  type StoredDirect,
  type StoredPerson,
} from "../../apps/mobile/src/storage/SocialRepository.js";
import {
  createIdentity,
  createRequestId,
  createEnvelope,
  createDirectReceipt,
  encodeDirect,
  type Identity,
} from "../../packages/protocol/src/index.js";

class Adapter implements Database {
  readonly sql: DatabaseSync;
  failOn?: RegExp;
  constructor(path = ":memory:") {
    this.sql = new DatabaseSync(path);
  }
  async execAsync(sql: string) {
    this.sql.exec(sql);
  }
  async runAsync(sql: string, ...params: SqlValue[]) {
    if (this.failOn?.test(sql)) throw new Error("Injected write failure");
    const result = this.sql.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
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
import { SocialService } from "../../apps/mobile/src/services/SocialService.js";
import type { DirectMessageView } from "../../apps/mobile/src/ui/types.js";

const NOW = 1_800_000_000_000;
const hex = (n: number) => n.toString(16).padStart(64, "0");
const person = (n = 1, scope: string | null = null): StoredPerson => ({
  nodeId: hex(n),
  publicKey: hex(n + 1000),
  name: `Person ${n}`,
  scope,
  lastSeenAt: NOW,
});
// Storage treats signed ciphertext as opaque; signature/encryption behavior is tested by the protocol suite.
const packet = (n = 1): StoredDirect => ({
  id: hex(n),
  origin: hex(2000),
  publicKey: hex(3000),
  destination: hex(4000),
  scope: null,
  createdAt: NOW,
  expiresAt: NOW + 86_400_000,
  wire: JSON.stringify({ ciphertext: "AQIDBA==", id: hex(n) }),
});

test("encrypted social storage survives disk restart with scoped contacts, dedup and recipient acknowledgments", async () => {
  const directory = mkdtempSync(join(tmpdir(), "beacon-social-"));
  const path = join(directory, "social.db");
  let db = new Adapter(path);
  try {
    let repository = new SocialRepository(db, () => NOW);
    await repository.initialize();
    await repository.savePerson(person());
    await repository.savePerson(person(1, hex(5000)));
    const p = packet();
    assert.deepEqual(
      await Promise.all([repository.savePacket(p), repository.savePacket(p)]),
      [true, false],
    );
    assert.deepEqual(
      await repository.deliveredIds(),
      [],
      "persisting ciphertext does not imply recipient delivery",
    );
    await assert.rejects(
      repository.markDelivered(p.id, hex(9999)),
      /recipient/,
    );
    await repository.markDelivered(p.id, p.destination);
    db.close();
    db = new Adapter(path);
    repository = new SocialRepository(db, () => NOW);
    await repository.initialize();
    assert.equal((await repository.people()).length, 2);
    assert.deepEqual(await repository.packets(), [p]);
    assert.deepEqual(await repository.deliveredIds(), [p.id]);
    assert.equal(await repository.savePacket(p), false);
    await repository.markDelivered(p.id, p.destination);
    await assert.rejects(
      repository.savePacket({ ...p, destination: hex(5001) }),
      /conflict/,
    );
    assert.equal((await repository.packets())[0].destination, p.destination);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capacity rejects excess contacts and live ciphertext without eviction; expired history remains seven days before packets and receipts are pruned", async () => {
  const db = new Adapter();
  let time = NOW;
  const repository = new SocialRepository(db, () => time);
  try {
    await repository.initialize();
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        repository.savePerson(person(i + 1)),
      ),
    );
    await assert.rejects(repository.savePerson(person(201)), /storage is full/);
    await repository.savePerson({
      ...person(),
      name: "Updated",
      lastSeenAt: NOW + 1,
    });
    await repository.savePerson(person());
    assert.equal(
      (await repository.people()).find((p) => p.nodeId === hex(1))?.name,
      "Updated",
    );
    await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        repository.savePacket(packet(i + 1)),
      ),
    );
    await repository.markDelivered(packet().id, packet().destination);
    assert.equal(await repository.savePacket(packet()), false);
    await assert.rejects(
      repository.savePacket(packet(1001)),
      /storage is full/,
    );
    assert.equal((await repository.packets()).length, 1000);
    assert.equal((await repository.people()).length, 200);
    time = NOW + 86_400_000;
    assert.equal((await repository.packets()).length, 1000);
    assert.deepEqual(await repository.deliveredIds(), [packet().id]);
    await assert.rejects(
      repository.savePacket({
        ...packet(1001),
        createdAt: time,
        expiresAt: time + 86_400_000,
      }),
      /storage is full/,
    );
    time += 7 * 86_400_000 - 1;
    assert.equal((await repository.packets()).length, 1000);
    time += 1;
    assert.deepEqual(await repository.packets(), []);
    assert.deepEqual(await repository.deliveredIds(), []);
    await assert.rejects(repository.savePacket(packet()), /expired/);
    await repository.savePacket({
      ...packet(1001),
      createdAt: time,
      expiresAt: time + 86_400_000,
    });
    assert.equal((await repository.packets()).length, 1);
  } finally {
    db.close();
  }
});

test("bounded explicit columns exclude extra plaintext, and failed writes roll back without poisoning retries", async () => {
  const db = new Adapter();
  const repository = new SocialRepository(db, () => NOW);
  try {
    await repository.initialize();
    const p = { ...packet(), plaintext: "do-not-persist-this-secret" };
    db.failOn = /INSERT INTO social_packets/;
    await assert.rejects(repository.savePacket(p), /Injected/);
    db.failOn = undefined;
    assert.deepEqual(await repository.packets(), []);
    await repository.savePacket(p);
    const stored = await db.getAllAsync("SELECT * FROM social_packets");
    assert.equal(JSON.stringify(stored).includes(p.plaintext), false);
    assert.deepEqual(
      (
        await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
      ).map((r) => r.name),
      ["social_packets", "social_people"],
    );
    await assert.rejects(
      repository.savePacket({ ...packet(2), wire: "é".repeat(9000) }),
      /Invalid/,
    );
    await assert.rejects(
      repository.savePacket({ ...packet(2), createdAt: NaN }),
      /Invalid/,
    );
    await assert.rejects(
      repository.savePerson({ ...person(), scope: "" }),
      /Invalid/,
    );
    await repository.savePerson(person());
    await assert.rejects(
      repository.savePerson({ ...person(), publicKey: hex(9999) }),
      /identity changed/,
    );
    assert.equal((await repository.packets()).length, 1);
  } finally {
    db.close();
  }
});

test("private group repository persists messages and forwarding but creates no cloud events or outbox", async () => {
  const db = new Adapter();
  const identity = createIdentity(randomBytes);
  const repository = new Repository(db, identity.nodeId, () => NOW, {
    privateMode: true,
  });
  try {
    await repository.initialize();
    const message = createEnvelope(
      identity,
      {
        type: "sos",
        requestId: createRequestId(identity, randomBytes),
        destination: "community",
        payload: {
          category: "other",
          note: "Private group fixture",
          displayName: "Test",
          location: { source: "unavailable", capturedAt: NOW },
        },
      },
      NOW,
      randomBytes,
    );
    await repository.saveMessage(message, 0, NOW);
    await repository.markForwarded("private-link", message.id);
    await repository.recordEvent(hex(9000), "peer_connected", "private-link");
    assert.equal((await repository.listMessages()).length, 1);
    assert.deepEqual(await repository.listForwarded("private-link"), [
      message.id,
    ]);
    for (const table of ["events", "outbox"])
      assert.equal(
        (
          await db.getFirstAsync<{ n: number }>(
            `SELECT COUNT(*) n FROM ${table}`,
          )
        )?.n,
        0,
      );
    assert.deepEqual(await repository.uploadBatch(true), []);
    assert.equal(await repository.pendingCount(), 0);
    // A mistakenly reused database must not expose preexisting public history through private readers.
    const publicRepository = new Repository(db, identity.nodeId, () => NOW);
    await publicRepository.recordEvent(
      hex(9001),
      "peer_connected",
      "public-link",
    );
    assert.equal(await publicRepository.pendingCount(), 1);
    assert.deepEqual(await repository.events(), []);
    assert.deepEqual(await repository.uploadBatch(true), []);
    assert.equal(await repository.pendingCount(), 0);
  } finally {
    db.close();
  }
});

test("real SocialService persists encrypted messages, rejects forged receipts and confirms delivery after disk restart/reconnect", async () => {
  const directory = mkdtempSync(join(tmpdir(), "beacon-social-service-"));
  const identities = {
    a: createIdentity(randomBytes),
    b: createIdentity(randomBytes),
  };
  type NodeName = keyof typeof identities;
  const queue: { from: NodeName; to: NodeName; wire: string }[] = [];
  const errors: unknown[] = [];
  const views: Record<NodeName, DirectMessageView[]> = { a: [], b: [] };
  let time = NOW;
  const nodes = new Map<
    NodeName,
    { db: Adapter; repository: SocialRepository; service: SocialService }
  >();
  async function open(name: NodeName, identity: Identity) {
    const db = new Adapter(join(directory, `${name}.db`));
    const repository = new SocialRepository(db, () => time);
    await repository.initialize();
    const service = new SocialService({
      identity,
      repository,
      scope: () => null,
      name: () => name,
      random: randomBytes,
      clock: () => time,
      send: async (peer, wire) => {
        if (peer === "a" || peer === "b")
          queue.push({ from: name, to: peer, wire });
      },
      getRead: async () => 0,
      setRead: async () => {},
      onChange: (_people, messages) => {
        views[name] = messages;
      },
      onError: (error) => {
        errors.push(error);
      },
    });
    nodes.set(name, { db, repository, service });
  }
  async function drain() {
    let count = 0;
    while (queue.length) {
      assert.ok(
        ++count < 50,
        "synthetic radio must settle without an acknowledgment loop",
      );
      const next = queue.shift()!;
      await nodes.get(next.to)!.service.receive(next.from, next.wire);
    }
  }
  try {
    await open("a", identities.a);
    await open("b", identities.b);
    let a = nodes.get("a")!,
      b = nodes.get("b")!;
    await a.service.connect("b");
    await b.service.connect("a");
    await drain();
    await a.service.sendText(identities.b.nodeId, "Encrypted restart fixture");
    await a.service.flush();
    assert.ok(
      (await a.repository.packets()).every(
        (p) => !p.wire.includes("Encrypted restart fixture"),
      ),
      "decrypted text is absent from stored wire",
    );
    assert.equal(
      views.a[0].status,
      "queued",
      "native send completion does not mean recipient persistence",
    );
    const messageId = views.a[0].id;
    const attacker = createIdentity(randomBytes);
    await a.service.connect("attacker");
    const forged = createDirectReceipt(
      attacker,
      identities.a.publicKey,
      messageId,
      null,
      time,
      randomBytes,
    );
    await a.service.receive("attacker", encodeDirect(forged));
    assert.deepEqual(
      await a.repository.deliveredIds(),
      [],
      "a different authenticated identity cannot ACK this recipient's packet",
    );
    const incoming = queue.shift()!;
    assert.equal(incoming.to, "b");
    await b.service.receive(incoming.from, incoming.wire);
    assert.equal(views.b[0].text, "Encrypted restart fixture");
    assert.equal(views.b[0].status, "received");
    assert.ok(
      queue.length > 0,
      "receiver emits a durable encrypted acknowledgment",
    );
    queue.length = 0; // Synthetic lost receipt, not a physical-radio test.
    assert.deepEqual(await a.repository.deliveredIds(), []);
    for (const node of nodes.values()) {
      node.service.reset();
      await node.service.flush();
      await node.service.refresh();
      node.db.close();
    }
    nodes.clear();
    time += 1000;
    await open("a", identities.a);
    await open("b", identities.b);
    a = nodes.get("a")!;
    b = nodes.get("b")!;
    await a.service.refresh();
    assert.equal(views.a[0].status, "queued");
    await a.service.connect("b");
    await b.service.connect("a");
    await drain();
    assert.deepEqual(await a.repository.deliveredIds(), [messageId]);
    assert.equal(views.a[0].status, "received");
    assert.equal(
      views.b.length,
      1,
      "retry deduplicates the durable incoming message",
    );
    assert.deepEqual(errors, []);
    time = NOW + 86_400_000 + 1;
    await a.service.refresh();
    assert.equal(
      views.a[0].status,
      "received",
      "confirmed history survives TTL expiry",
    );
    assert.equal(views.a[0].text, "Encrypted restart fixture");
    await a.service.tick();
    assert.ok(
      queue.every((item) => JSON.parse(item.wire).type !== "direct"),
      "retained expired history is not retransmitted",
    );
  } finally {
    for (const node of nodes.values()) node.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
