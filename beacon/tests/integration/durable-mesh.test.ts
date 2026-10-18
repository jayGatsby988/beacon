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
  MeshRouter,
  createIdentity,
  createRequestId,
  deriveRequests,
  encodePacket,
  type Envelope,
  type Identity,
  type RequestState,
} from "../../packages/protocol/src/index.js";

// Same real node:sqlite adapter as tests/storage/repository.test.ts. Each node uses its own disk file.
// Only the radio is synthetic: these tests make no BLE, hardware, range, or background-execution claim.
class Adapter implements Database {
  readonly sql: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
  }
  async execAsync(sql: string) {
    this.sql.exec(sql);
  }
  async runAsync(sql: string, ...params: SqlValue[]) {
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
    if (!this.closed) {
      this.sql.close();
      this.closed = true;
    }
  }
}
interface Node {
  identity: Identity;
  db: Adapter;
  repository: Repository;
  router: MeshRouter;
}
class SyntheticContacts {
  time = 1_800_000_000_000;
  readonly nodes = new Map<string, Node>();
  private readonly links = new Set<string>();
  private readonly packets: { from: string; to: string; wire: string }[] = [];
  constructor(private readonly directory: string) {}
  async open(
    name: string,
    identity = createIdentity(randomBytes),
  ): Promise<Node> {
    const db = new Adapter(join(this.directory, `${name}.sqlite`));
    const repository = new Repository(db, identity.nodeId, () => this.time);
    await repository.initialize();
    const router = new MeshRouter({
      identity,
      repository,
      clock: () => this.time,
      randomBytes,
      transport: {
        send: async (to, wire) => {
          this.enqueue(name, to, wire);
        },
      },
    });
    const node = { identity, db, repository, router };
    this.nodes.set(name, node);
    return node;
  }
  private node(name: string): Node {
    const node = this.nodes.get(name);
    assert.ok(node);
    return node;
  }
  enqueue(from: string, to: string, wire: string) {
    assert.ok(
      this.links.has(`${from}:${to}`),
      "synthetic transfer requires a current explicit contact",
    );
    this.packets.push({ from, to, wire });
  }
  async connect(a: string, b: string) {
    this.links.add(`${a}:${b}`);
    this.links.add(`${b}:${a}`);
    await this.node(a).router.connect(b);
    await this.node(b).router.connect(a);
    await this.drain();
  }
  disconnect(a: string, b: string) {
    assert.equal(
      this.packets.length,
      0,
      "disconnect only after queued synthetic writes have settled",
    );
    this.links.delete(`${a}:${b}`);
    this.links.delete(`${b}:${a}`);
    this.node(a).router.disconnect(b);
    this.node(b).router.disconnect(a);
  }
  async drain() {
    let delivered = 0;
    while (this.packets.length) {
      assert.ok(
        ++delivered < 1000,
        "routing must settle without an acknowledgment loop",
      );
      const packet = this.packets.shift()!;
      assert.ok(this.links.has(`${packet.from}:${packet.to}`));
      await this.node(packet.to).router.receive(packet.from, packet.wire);
    }
  }
  async restart(name: string): Promise<Node> {
    assert.equal(this.packets.length, 0);
    for (const contact of this.links)
      assert.ok(
        !contact.split(":").includes(name),
        "restart occurs while disconnected",
      );
    const previous = this.node(name);
    // Discard both router and database handle; only identity and the SQLite file survive.
    previous.db.close();
    this.nodes.delete(name);
    this.time += 60_000;
    return this.open(name, previous.identity);
  }
  close() {
    for (const node of this.nodes.values()) node.db.close();
  }
}
async function request(node: Node, id: string): Promise<RequestState> {
  const state = deriveRequests(
    (await node.repository.listMessages()).map((record) => record.envelope),
  ).find((item) => item.id === id);
  assert.ok(state, "request must reconstruct from verified SQLite history");
  return state;
}
async function tableCounts(node: Node) {
  const counts: Record<string, number> = {};
  for (const table of [
    "messages",
    "dedup",
    "events",
    "outbox",
    "request_state",
    "offers",
    "assignments",
    "forwarding",
  ]) {
    counts[table] = (await node.db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) n FROM ${table}`,
    ))!.n;
  }
  return counts;
}
async function cachedRequest(node: Node, id: string): Promise<RequestState> {
  const row = await node.db.getFirstAsync<{ value: string }>(
    "SELECT value FROM request_state WHERE id=?",
    id,
  );
  assert.ok(row);
  return JSON.parse(row.value) as RequestState;
}

test(
  "synthetic three-node mesh uses disk SQLite through relay/requester restarts, return receipts and confirmed assignment",
  { timeout: 30_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "beacon-durable-mesh-"));
    const network = new SyntheticContacts(directory);
    try {
      let a = await network.open("A"),
        b = await network.open("B");
      const c = await network.open("C");
      const requestId = createRequestId(a.identity, randomBytes);
      const sos = await a.router.publish({
        type: "sos",
        requestId,
        destination: "community",
        payload: {
          category: "stranded",
          displayName: "Synthetic requester",
          note: "Integration test only",
          location: { source: "unavailable", capturedAt: network.time },
        },
      });
      assert.equal(
        await a.repository.pendingCount(),
        1,
        "publishing queues the durable cloud event before any contact",
      );
      await network.connect("A", "B");
      assert.equal((await b.repository.getMessage(sos.id))?.hops, 1);
      assert.equal(
        (await request(a, requestId)).receipts.length,
        0,
        "relay persistence is not an endpoint receipt",
      );
      assert.equal(
        await c.repository.getMessage(sos.id),
        undefined,
        "C has no radio path yet",
      );
      network.disconnect("A", "B");
      const relayCounts = await tableCounts(b),
        relayOutbox = await b.repository.uploadBatch(true);
      const oldRelay = b;
      b = await network.restart("B");
      assert.notEqual(b.db, oldRelay.db);
      assert.notEqual(b.router, oldRelay.router);
      assert.deepEqual(await tableCounts(b), relayCounts);
      assert.deepEqual(
        await b.repository.uploadBatch(true),
        relayOutbox,
        "restart preserves stable event IDs and sequence numbers",
      );
      assert.equal(
        (await b.repository.getMessage(sos.id))?.envelope.expiresAt,
        sos.expiresAt,
      );

      // B later encounters C without A. C explicitly becomes an endpoint and offers help.
      await network.connect("B", "C");
      assert.equal((await c.repository.getMessage(sos.id))?.hops, 2);
      const receipt = await c.router.acknowledge(sos.id);
      const offer = await c.router.publish({
        type: "offer",
        requestId,
        destination: a.identity.nodeId,
        payload: {
          displayName: "Synthetic helper",
          note: "Available in the test",
        },
      });
      await network.drain();
      assert.ok(await b.repository.getMessage(receipt.id));
      assert.ok(await b.repository.getMessage(offer.id));
      assert.equal(
        (await request(a, requestId)).receipts.length,
        0,
        "disconnected A cannot know about C yet",
      );
      network.disconnect("B", "C");
      await network.connect("A", "B");
      const returned = await request(a, requestId);
      assert.deepEqual(
        returned.receipts.map((item) => item.nodeId),
        [c.identity.nodeId],
      );
      assert.deepEqual(
        returned.offers.map((item) => item.id),
        [offer.id],
      );
      assert.equal(
        returned.status,
        "open",
        "an offer alone does not assign the helper",
      );

      const assignmentId = createRequestId(a.identity, randomBytes);
      const acceptance = await a.router.publish({
        type: "accept",
        requestId,
        destination: c.identity.nodeId,
        revision: 1,
        payload: {
          offerId: offer.id,
          helperId: c.identity.nodeId,
          assignmentId,
        },
      });
      await network.drain();
      assert.equal(
        (await request(a, requestId)).assignment?.received,
        false,
        "acceptance is pending until the helper confirms it",
      );
      network.disconnect("A", "B");
      await network.connect("B", "C");
      const confirmations = (await c.repository.listMessages()).filter(
        (record) => record.envelope.type === "assignment_receipt",
      );
      assert.equal(
        confirmations.length,
        1,
        "the real router creates exactly one helper assignment receipt",
      );
      const assignmentReceipt = confirmations[0].envelope;
      assert.equal((await request(c, requestId)).assignment?.received, true);
      assert.equal(
        (await request(a, requestId)).assignment?.received,
        false,
        "return confirmation still has no path to A",
      );
      network.disconnect("B", "C");
      await network.connect("A", "B");
      const confirmed = await request(a, requestId);
      assert.equal(confirmed.status, "accepted");
      assert.equal(confirmed.revision, 1);
      assert.equal(confirmed.assignment?.id, assignmentId);
      assert.equal(confirmed.assignment?.received, true);
      assert.deepEqual(
        await cachedRequest(a, requestId),
        confirmed,
        "transactional request cache matches durable signed history",
      );
      network.disconnect("A", "B");

      const requesterCounts = await tableCounts(a),
        requesterOutbox = await a.repository.uploadBatch(true);
      a = await network.restart("A");
      assert.deepEqual(
        await request(a, requestId),
        confirmed,
        "requester restart retains the last confirmed assistance state",
      );
      assert.deepEqual(await cachedRequest(a, requestId), confirmed);
      assert.deepEqual(await tableCounts(a), requesterCounts);
      assert.deepEqual(await a.repository.uploadBatch(true), requesterOutbox);
      for (const type of [
        "sos",
        "receipt",
        "offer",
        "accept",
        "assignment_receipt",
      ]) {
        assert.equal(
          requesterOutbox.filter((event) => event.message?.type === type)
            .length,
          1,
          `one durable ${type} observation remains queued`,
        );
      }

      await network.connect("A", "B");
      const beforeDuplicates = await tableCounts(a),
        outboxBeforeDuplicates = await a.repository.uploadBatch(true);
      const originals: Envelope[] = [
        sos,
        receipt,
        offer,
        acceptance,
        assignmentReceipt,
      ];
      for (const envelope of originals)
        for (let duplicate = 0; duplicate < 2; duplicate++) {
          network.enqueue("B", "A", encodePacket({ envelope, hops: 2 }));
        }
      await network.drain();
      assert.deepEqual(
        await tableCounts(a),
        beforeDuplicates,
        "duplicate packets create no extra messages, effects, events, or outbox rows",
      );
      assert.deepEqual(
        await a.repository.uploadBatch(true),
        outboxBeforeDuplicates,
      );
      assert.deepEqual(await request(a, requestId), confirmed);
      assert.equal(
        (await c.repository.listMessages()).filter(
          (record) => record.envelope.type === "assignment_receipt",
        ).length,
        1,
      );
    } finally {
      network.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
