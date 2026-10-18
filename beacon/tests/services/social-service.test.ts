import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { SocialService } from "../../apps/mobile/src/services/SocialService.js";
import type {
  SocialRepository,
  StoredDirect,
  StoredPerson,
} from "../../apps/mobile/src/storage/SocialRepository.js";
import type {
  PersonView,
  DirectMessageView,
} from "../../apps/mobile/src/ui/types.js";
import {
  createIdentity,
  createPresence,
  createDirectMessage,
  createDirectReceipt,
  encodeDirect,
  decodeDirect,
  createRequestId,
  type DirectPacket,
} from "../../packages/protocol/src/index.js";

const NOW = 1_800_000_000_000;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
class MemorySocial {
  contacts: StoredPerson[] = [];
  messages = new Map<string, StoredDirect>();
  delivered = new Set<string>();
  personWrites = 0;
  peopleGate?: Promise<void>;
  async people() {
    await this.peopleGate;
    return this.contacts;
  }
  async savePerson(person: StoredPerson) {
    this.personWrites++;
    this.contacts = [
      ...this.contacts.filter(
        (p) => p.nodeId !== person.nodeId || p.scope !== person.scope,
      ),
      person,
    ];
  }
  async packets() {
    return [...this.messages.values()];
  }
  async savePacket(packet: StoredDirect) {
    if (this.messages.has(packet.id)) return false;
    this.messages.set(packet.id, packet);
    return true;
  }
  async deliveredIds() {
    return [...this.delivered];
  }
  async markDelivered(id: string, recipientId: string) {
    assert.equal(this.messages.get(id)?.destination, recipientId);
    this.delivered.add(id);
  }
}
function fixture() {
  const local = createIdentity(randomBytes),
    remote = createIdentity(randomBytes),
    repository = new MemorySocial();
  let scope: string | null = null,
    now = NOW;
  const sent: { peerId: string; wire: string; scope: string | null }[] = [];
  const errors: unknown[] = [],
    changes: { people: PersonView[]; messages: DirectMessageView[] }[] = [];
  const readMarkers = new Map<string, number>();
  let readQueries = 0;
  let sendGate: Promise<void> | undefined;
  let failSend = false;
  const service = new SocialService({
    identity: local,
    repository: repository as unknown as SocialRepository,
    scope: () => scope,
    name: () => "Synthetic local",
    random: randomBytes,
    send: async (peerId, wire, currentScope) => {
      if (failSend) throw new Error("Radio unavailable");
      if (JSON.parse(wire).type === "direct") await sendGate;
      sent.push({ peerId, wire, scope: currentScope });
    },
    getRead: async (key) => {
      readQueries++;
      return readMarkers.get(key) ?? 0;
    },
    setRead: async (key, value) => {
      readMarkers.set(key, value);
    },
    onChange: (people, messages) => changes.push({ people, messages }),
    onError: (error) => errors.push(error),
    clock: () => now,
  });
  const store = async (packet: DirectPacket) =>
    repository.savePacket({ ...packet, wire: encodeDirect(packet) });
  const presence = () =>
    createPresence(remote, "Synthetic remote", scope, now, randomBytes);
  const connect = async () => {
    await service.connect("peer");
    await service.receive("peer", presence());
  };
  return {
    service,
    local,
    remote,
    repository,
    sent,
    errors,
    changes,
    store,
    connect,
    presence,
    readMarkers,
    readQueries: () => readQueries,
    setScope: (next: string | null) => {
      scope = next;
      service.reset();
    },
    setNow: (next: number) => {
      now = next;
    },
    fail: (next: boolean) => {
      failSend = next;
    },
    gate: (next: Promise<void> | undefined) => {
      sendGate = next;
    },
  };
}

test("unacknowledged receipt backlog cannot starve later direct messages on periodic retry", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  for (let i = 0; i < 40; i++)
    await h.store(
      createDirectReceipt(
        h.local,
        h.remote.publicKey,
        createRequestId(h.local, randomBytes),
        null,
        NOW,
        randomBytes,
      ),
    );
  const message = createDirectMessage(
    h.local,
    h.remote.publicKey,
    "Later useful message",
    null,
    NOW + 1,
    randomBytes,
  );
  await h.store(message);
  await h.connect();
  assert.equal(
    h.sent.filter((s) => JSON.parse(s.wire).type === "direct").length,
    32,
  );
  await h.service.tick();
  assert.ok(h.sent.some((s) => decodeDirect(s.wire, NOW)?.id === message.id));
  const receiptsBefore = h.sent.filter(
    (s) =>
      JSON.parse(s.wire).type === "direct" &&
      decodeDirect(s.wire, NOW)?.id !== message.id,
  ).length;
  await h.service.tick();
  assert.equal(
    h.sent.filter(
      (s) =>
        JSON.parse(s.wire).type === "direct" &&
        decodeDirect(s.wire, NOW)?.id !== message.id,
    ).length,
    receiptsBefore,
    "receipts are not retried without a reconnect or repeated message",
  );
});

test("native send failure remains queued; only an authenticated intended-recipient receipt confirms delivery", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  h.fail(true);
  await h.service.sendText(h.remote.nodeId, "Synthetic message");
  await h.service.flush();
  const outgoing = [...h.repository.messages.values()][0]!;
  assert.equal(h.repository.delivered.size, 0);
  assert.equal(h.changes.at(-1)?.messages[0]?.status, "queued");
  assert.ok(h.errors.length > 0);
  h.fail(false);
  await h.service.tick();
  assert.ok(h.sent.some((s) => decodeDirect(s.wire, NOW)?.id === outgoing.id));
  assert.equal(h.repository.delivered.size, 0);
  const outsider = createIdentity(randomBytes);
  const forged = createDirectReceipt(
    outsider,
    h.local.publicKey,
    outgoing.id,
    null,
    NOW,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(forged));
  assert.equal(h.repository.delivered.size, 0);
  const receipt = createDirectReceipt(
    h.remote,
    h.local.publicKey,
    outgoing.id,
    null,
    NOW,
    randomBytes,
  );
  const sentBefore = h.sent.length;
  await h.service.receive("peer", encodeDirect(receipt));
  assert.ok(h.repository.delivered.has(outgoing.id));
  assert.equal(h.changes.at(-1)?.messages[0]?.status, "received");
  assert.equal(
    h.sent.length,
    sentBefore,
    "a receipt never creates another receipt",
  );
});

test("group switch hides an in-flight old snapshot and never sends a private queue through public scope", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  const privateScope = "a".repeat(64);
  h.setScope(privateScope);
  await h.repository.savePerson({
    nodeId: h.remote.nodeId,
    publicKey: h.remote.publicKey,
    name: "Private contact",
    scope: privateScope,
    lastSeenAt: NOW,
  });
  await h.store(
    createDirectMessage(
      h.local,
      h.remote.publicKey,
      "Private",
      privateScope,
      NOW,
      randomBytes,
    ),
  );
  const gate = deferred();
  h.repository.peopleGate = gate.promise;
  const refreshing = h.service.refresh();
  await turn();
  h.setScope(null);
  gate.resolve();
  await refreshing;
  assert.equal(h.changes.length, 0);
  h.repository.peopleGate = undefined;
  await h.connect();
  await h.service.tick();
  assert.equal(
    h.sent.some((s) => JSON.parse(s.wire).type === "direct"),
    false,
  );
  assert.equal(h.changes.at(-1)?.messages.length, 0);
});

test("scope change during contact lookup aborts send before persistence", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  const gate = deferred();
  h.repository.peopleGate = gate.promise;
  const sending = h.service.sendText(h.remote.nodeId, "Do not cross scopes");
  await turn();
  h.setScope("a".repeat(64));
  gate.resolve();
  await assert.rejects(sending, /group changed/);
  assert.equal(h.repository.messages.size, 0);
});

test("social receive and native sessions have bounded admission and reset the rate window", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.service.connect("peer");
  const wire = h.presence();
  for (let i = 0; i < 245; i++) await h.service.receive("peer", wire);
  assert.equal(h.repository.personWrites, 240);
  h.setNow(NOW + 60_000);
  await h.service.receive("peer", h.presence());
  assert.equal(h.repository.personWrites, 241);
  for (let i = 0; i < 15; i++) await h.service.connect(`peer-${i}`);
  await assert.rejects(h.service.connect("excess"), /limit/);
});

test("settle waits for pending native sends and suppresses late snapshots before database closure", async () => {
  const h = fixture();
  await h.connect();
  const gate = deferred();
  h.gate(gate.promise);
  await h.service.sendText(h.remote.nodeId, "Queued while write is pending");
  let settled = false;
  const settling = h.service.settle().then(() => {
    settled = true;
  });
  const snapshots = h.changes.length;
  await turn();
  assert.equal(settled, false);
  gate.resolve();
  await settling;
  assert.equal(h.changes.length, snapshots);
  await assert.rejects(
    h.service.sendText(h.remote.nodeId, "after close"),
    /closed/,
  );
});

test("refresh caches verified immutable ciphertext and invalidates changed wire or metadata", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  const packet = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Cached synthetic message",
    null,
    NOW,
    randomBytes,
  );
  await h.store(packet);
  const original = ed25519.verify;
  let verifications = 0;
  t.mock.method(ed25519, "verify", (...args: Parameters<typeof original>) => {
    verifications++;
    return original(...args);
  });
  await h.service.refresh();
  assert.ok(verifications > 0);
  const first = verifications;
  await h.service.refresh();
  assert.equal(verifications, first);
  const record = h.repository.messages.get(packet.id)!;
  h.repository.messages.set(packet.id, {
    ...record,
    destination: "a".repeat(64),
  });
  await h.service.refresh();
  assert.equal(
    h.changes.at(-1)?.messages.length,
    0,
    "cached content cannot bypass signed metadata validation",
  );
  h.repository.messages.set(packet.id, {
    ...record,
    wire: record.wire.replace(packet.signature, "0".repeat(128)),
  });
  await h.service.refresh();
  assert.equal(h.changes.at(-1)?.messages.length, 0);
  h.service.reset();
  assert.equal(
    (h.service as unknown as { contentCache: Map<string, unknown> })
      .contentCache.size,
    0,
  );
});

test("duplicate direct messages reuse one durable receipt and retry it without acknowledgment loops", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  const message = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Synthetic inbound",
    null,
    NOW,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(message));
  const firstIds = [...h.repository.messages.keys()];
  const sends = h.sent.filter(
    (s) => JSON.parse(s.wire).type === "direct",
  ).length;
  await h.service.receive("peer", JSON.stringify(message, null, 2));
  assert.deepEqual([...h.repository.messages.keys()], firstIds);
  assert.equal(firstIds.length, 2, "one message and one receipt are durable");
  assert.equal(
    h.sent.filter((s) => JSON.parse(s.wire).type === "direct").length,
    sends + 1,
  );
});

test("verified-content cache has a hard bound even for malformed retained rows", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  for (let i = 0; i < 1001; i++) {
    const id = i.toString(16).padStart(64, "0");
    h.repository.messages.set(id, {
      id,
      origin: h.local.nodeId,
      publicKey: h.local.publicKey,
      destination: h.remote.nodeId,
      scope: null,
      createdAt: NOW,
      expiresAt: NOW + 60_000,
      wire: "{}",
    });
  }
  await h.service.refresh();
  assert.equal(
    (h.service as unknown as { contentCache: Map<string, unknown> })
      .contentCache.size,
    1000,
  );
  assert.equal(h.changes.at(-1)?.messages.length, 0);
});

test("per-message read markers clear messages signed by a phone five minutes ahead", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  const packet = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Future-clock message",
    null,
    NOW + 5 * 60_000,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(packet));
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 1);
  await h.service.markChatRead(h.remote.nodeId);
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 0);
  assert.equal(
    h.readMarkers.get(`chatRead:nearby:${h.remote.nodeId}:${packet.id}`),
    1,
  );
  const queries = h.readQueries();
  await h.service.refresh();
  await h.service.refresh();
  assert.equal(
    h.readQueries(),
    queries,
    "unchanged message markers do not query SQLite repeatedly",
  );
  h.service.reset();
  await h.service.refresh();
  assert.equal(
    h.changes.at(-1)?.people[0]?.unreadCount,
    0,
    "durable marker survives clearing the memory cache",
  );
});

test("late delivery with an old signed timestamp is unread even after the chat was read", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  const first = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Already read",
    null,
    NOW,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(first));
  await h.service.markChatRead(h.remote.nodeId);
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 0);
  const late = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Arrived later, created earlier",
    null,
    NOW - 60_000,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(late));
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 1);
  await h.service.markChatRead(h.remote.nodeId);
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 0);
  assert.equal(h.readMarkers.size, 2);
});
