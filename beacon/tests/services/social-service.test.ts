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
  createLocation,
  verifyLocation,
  type SharedLocation,
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
  const peerGates = new Map<string, Promise<void>>();
  let failSend = false;
  let location: SharedLocation | null = null;
  let locationGate: Promise<void> | undefined;
  let presenceGate: Promise<void> | undefined;
  let presenceAttempts = 0;
  const service = new SocialService({
    identity: local,
    repository: repository as unknown as SocialRepository,
    scope: () => scope,
    name: () => "Synthetic local",
    location: () => location,
    random: randomBytes,
    send: async (peerId, wire, currentScope) => {
      if (failSend) throw new Error("Radio unavailable");
      if (JSON.parse(wire).type === "presence") {
        presenceAttempts++;
        await presenceGate;
      }
      if (JSON.parse(wire).type === "direct") await (peerGates.get(peerId) ?? sendGate);
      if (JSON.parse(wire).type === "location") await locationGate;
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
    peerGates,
    readQueries: () => readQueries,
    presenceAttempts: () => presenceAttempts,
    presenceGate: (next: Promise<void> | undefined) => {
      presenceGate = next;
    },
    setLocation: (next: SharedLocation | null) => {
      location = next;
    },
    locationGate: (next: Promise<void> | undefined) => {
      locationGate = next;
    },
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

test("one stalled peer cannot block another peer's message receipt", async (t) => {
  const h = fixture();
  const gate = deferred();
  t.after(async () => { gate.resolve(); await h.service.settle(); });
  await h.connect();
  h.peerGates.set("peer", gate.promise);
  await h.service.sendText(h.remote.nodeId, "Slow link");
  await turn();
  const other = createIdentity(randomBytes);
  await h.service.connect("other");
  await h.service.receive("other", createPresence(other, "Other", null, NOW, randomBytes));
  const incoming = createDirectMessage(other, h.local.publicKey, "Need a receipt", null, NOW, randomBytes);
  await h.service.receive("other", encodeDirect(incoming));
  await turn();
  assert.ok(h.sent.some((s) => s.peerId === "other" && decodeDirect(s.wire, NOW)),
    "a healthy peer must receive its encrypted receipt before the slow write completes");
  assert.equal(h.repository.delivered.size, 0);
});

test("reconnection drains the durable queue before an old native write settles", async (t) => {
  const h = fixture();
  const gate = deferred();
  t.after(async () => { gate.resolve(); await h.service.settle(); });
  await h.connect();
  h.peerGates.set("peer", gate.promise);
  await h.service.sendText(h.remote.nodeId, "First queued message");
  await turn();
  h.service.disconnect("peer");
  await h.service.sendText(h.remote.nodeId, "Queued out of range");
  await h.service.connect("reconnected");
  await h.service.receive("reconnected", h.presence());
  await turn();
  const packets = [...h.repository.messages.values()];
  const resent = h.sent.filter((s) => s.peerId === "reconnected").map((s) => decodeDirect(s.wire, NOW)?.id);
  for (const packet of packets) assert.ok(resent.includes(packet.id), "reconnected peer must make immediate progress");
  assert.equal(h.repository.delivered.size, 0, "write completion is not recipient acknowledgment");
  gate.resolve();
  await h.service.flush();
  await turn();
  assert.equal(h.sent.filter((s) => s.peerId === "peer" && decodeDirect(s.wire, NOW)).length, 1,
    "retired session must not send the second queued message");
});

test("repeated flush requests do not overlap native writes or duplicate a peer's queue", async (t) => {
  const h = fixture();
  const gate = deferred();
  t.after(async () => { gate.resolve(); await h.service.settle(); });
  await h.connect();
  h.gate(gate.promise);
  await h.service.sendText(h.remote.nodeId, "First");
  await h.service.sendText(h.remote.nodeId, "Second");
  const flushing = Promise.all(Array.from({ length: 20 }, () => h.service.flush()));
  await turn();
  gate.resolve();
  await flushing;
  const ids = h.sent.flatMap((s) => {
    const packet = decodeDirect(s.wire, NOW);
    return packet ? [packet.id] : [];
  });
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test("a retired private session cannot resume its queue through a replacement public session", async (t) => {
  const h = fixture();
  const gate = deferred();
  t.after(async () => { gate.resolve(); await h.service.settle(); });
  const privateScope = "a".repeat(64);
  h.setScope(privateScope);
  await h.connect();
  h.gate(gate.promise);
  await h.service.sendText(h.remote.nodeId, "Private write already started");
  await turn();
  await h.service.sendText(h.remote.nodeId, "Private write still queued");
  h.setScope(null);
  h.gate(undefined);
  await h.connect();
  await h.service.sendText(h.remote.nodeId, "Public session");
  await h.service.flush();
  const directSends = () => h.sent.filter((s) => decodeDirect(s.wire, NOW));
  assert.equal(directSends().length, 1, "replacement session progresses before the old write settles");
  assert.equal(directSends()[0].scope, null);
  gate.resolve();
  await turn();
  await h.service.flush();
  assert.equal(directSends().filter((s) => s.scope === privateScope).length, 1,
    "only the private write submitted before the switch may finish");
  assert.equal(directSends().filter((s) => s.scope === null).length, 1);
});

test("periodic message retry is independent of stalled presence and location updates", async (t) => {
  for (const kind of ["presence", "location"] as const) {
    const h = fixture();
    const gate = deferred();
    t.after(async () => { gate.resolve(); await h.service.settle(); });
    await h.connect();
    await h.service.sendText(h.remote.nodeId, "Retry until acknowledged");
    await h.service.flush();
    const before = h.sent.filter((s) => decodeDirect(s.wire, NOW)).length;
    h.setNow(NOW + 31_000);
    if (kind === "presence") h.presenceGate(gate.promise);
    else { h.setLocation(syntheticPoint()); h.locationGate(gate.promise); }
    const ticking = h.service.tick();
    await turn();
    assert.ok(h.sent.filter((s) => decodeDirect(s.wire, NOW)).length > before,
      `${kind} must not hold up retries of unacknowledged messages`);
    gate.resolve();
    await ticking;
  }
});

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
  await turn();
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

test("unacknowledged messages do not starve newer messages or receipts on retry", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  for (let i = 0; i < 40; i++)
    await h.store(createDirectMessage(h.local, h.remote.publicKey, `Queued ${i}`, null, NOW, randomBytes));
  const later = createDirectReceipt(h.local, h.remote.publicKey, createRequestId(h.remote, randomBytes), null, NOW + 1, randomBytes);
  await h.store(later);
  await h.connect();
  await turn();
  assert.equal(h.sent.filter((s) => JSON.parse(s.wire).type === "direct").length, 32);
  await h.service.tick();
  const ids = new Set(h.sent.map((s) => decodeDirect(s.wire, NOW)?.id));
  assert.ok(ids.has(later.id), "a receipt behind unacknowledged messages must get a turn");
  for (const packet of h.repository.messages.values()) assert.ok(ids.has(packet.id));
  assert.equal(h.repository.delivered.size, 0, "sending never implies delivery");
});

test("stalled outgoing radio does not block persisting incoming messages or receipts", async (t) => {
  const h = fixture();
  const gate = deferred();
  t.after(async () => {
    gate.resolve();
    await h.service.settle();
  });
  await h.connect();
  h.gate(gate.promise);
  await h.service.sendText(h.remote.nodeId, "Outgoing");
  const outgoing = [...h.repository.messages.values()][0]!;
  const incoming = createDirectMessage(h.remote, h.local.publicKey, "Incoming", null, NOW, randomBytes);
  const receipt = createDirectReceipt(h.remote, h.local.publicKey, outgoing.id, null, NOW, randomBytes);
  let completed = false;
  const inbound = h.service.receive("peer", encodeDirect(incoming))
    .then(() => h.service.receive("peer", encodeDirect(receipt)))
    .then(() => {
      completed = true;
    });
  await turn();
  const advancedBeforeRadio = completed;
  gate.resolve();
  await inbound;
  assert.equal(advancedBeforeRadio, true, "receive queue must advance without waiting for native sends");
  assert.ok(h.repository.delivered.has(outgoing.id));
  assert.ok(h.changes.at(-1)?.messages.some((m) => m.id === incoming.id));
  await h.service.flush();
});

test("stalled presence replies are coalesced and cannot block receiving", async (t) => {
  const h = fixture();
  const gate = deferred();
  t.after(async () => {
    gate.resolve();
    await h.service.settle();
  });
  await h.connect();
  h.setNow(NOW + 6_000);
  h.presenceGate(gate.promise);
  const before = h.presenceAttempts();
  let completed = false;
  const receive = h.service.receive("peer", h.presence())
    .then(() => h.service.receive("peer", h.presence()))
    .then(() => {
      completed = true;
    });
  await turn();
  const advancedBeforeRadio = completed;
  gate.resolve();
  await receive;
  assert.equal(advancedBeforeRadio, true);
  assert.equal(h.presenceAttempts(), before + 1);
  assert.equal(h.changes.at(-1)?.people[0]?.connected, true);
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

test("direct-before-presence creates a durable visible contact; later presence supplies its name", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.service.connect("peer");
  const packet = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Arrived before presence",
    null,
    NOW,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(packet));
  assert.equal(
    h.repository.messages.size,
    2,
    "message is followed by a persisted receipt",
  );
  assert.equal(
    h.changes.at(-1)?.people[0]?.name,
    `Beacon user ${h.remote.nodeId.slice(0, 8)}`,
  );
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 1);
  h.service.disconnect("peer");
  await h.service.refresh();
  await h.service.settle();
  const restarted = new SocialService({
    identity: h.local,
    repository: h.repository as unknown as SocialRepository,
    scope: () => null,
    name: () => "Synthetic local",
    random: randomBytes,
    send: async () => {},
    getRead: async (key) => h.readMarkers.get(key) ?? 0,
    setRead: async (key, value) => {
      h.readMarkers.set(key, value);
    },
    onChange: (people, messages) => h.changes.push({ people, messages }),
    onError: (error) => h.errors.push(error),
    clock: () => NOW,
  });
  t.after(() => restarted.settle());
  await restarted.refresh();
  assert.equal(h.changes.at(-1)?.people[0]?.connected, false);
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 1);
  assert.equal(h.changes.at(-1)?.messages[0]?.text, "Arrived before presence");
  await restarted.connect("new-peer");
  await restarted.receive("new-peer", h.presence());
  assert.equal(h.changes.at(-1)?.people[0]?.name, "Synthetic remote");
  await restarted.receive("new-peer", encodeDirect(packet));
  assert.equal(
    h.changes.at(-1)?.people[0]?.name,
    "Synthetic remote",
    "duplicate message must preserve the signed presence name",
  );
});

test("contact persistence failure prevents receipt and retry makes the conversation reachable", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.service.connect("peer");
  const packet = createDirectMessage(
    h.remote,
    h.local.publicKey,
    "Contact storage must succeed",
    null,
    NOW,
    randomBytes,
  );
  const original = h.repository.savePerson.bind(h.repository);
  h.repository.savePerson = async () => {
    throw new Error("Contact storage is full");
  };
  await assert.rejects(
    h.service.receive("peer", encodeDirect(packet)),
    /Contact storage is full/,
  );
  assert.equal(h.repository.messages.size, 1, "only incoming packet persisted");
  assert.equal(
    h.sent.some((p) => JSON.parse(p.wire).type === "direct"),
    false,
    "no receipt before contact persistence",
  );
  h.repository.savePerson = original;
  await h.service.receive("peer", encodeDirect(packet));
  assert.equal(h.repository.messages.size, 2);
  assert.equal(h.changes.at(-1)?.people[0]?.unreadCount, 1);
});

test("an incoming receipt cannot create an unsolicited contact", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.service.connect("peer");
  const receipt = createDirectReceipt(
    h.remote,
    h.local.publicKey,
    createRequestId(h.local, randomBytes),
    null,
    NOW,
    randomBytes,
  );
  await h.service.receive("peer", encodeDirect(receipt));
  assert.equal(h.repository.contacts.length, 0);
  assert.equal(h.repository.messages.size, 0);
});

const syntheticPoint = (capturedAt = NOW): SharedLocation => ({
  latitude: 1.25,
  longitude: -2.5,
  accuracy: 8,
  capturedAt,
});
const locationsSent = (h: ReturnType<typeof fixture>) =>
  h.sent.filter((message) => JSON.parse(message.wire).type === "location");
const displayedLocation = (h: ReturnType<typeof fixture>) =>
  h.changes.at(-1)?.people.find((person) => person.nodeId === h.remote.nodeId)
    ?.location;

test("locations default off; opt-in announces only to authenticated sessions, periodically, and withdraws immediately", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  await h.service.tick();
  await h.service.announceLocation();
  assert.equal(locationsSent(h).length, 0);
  h.setLocation(syntheticPoint());
  await h.service.announceLocation();
  assert.deepEqual(
    verifyLocation(locationsSent(h)[0].wire, NOW)?.location,
    syntheticPoint(),
  );
  await h.service.tick();
  assert.equal(locationsSent(h).length, 1);
  h.setNow(NOW + 30000);
  await h.service.tick();
  assert.equal(locationsSent(h).length, 2);
  h.setLocation(null);
  await h.service.announceLocation();
  assert.equal(
    verifyLocation(locationsSent(h).at(-1)!.wire, NOW + 30000)?.location,
    null,
  );
  const count = locationsSent(h).length;
  await h.service.announceLocation();
  await h.service.tick();
  assert.equal(locationsSent(h).length, count);
  const g = fixture();
  t.after(() => g.service.settle());
  g.setLocation(syntheticPoint());
  await g.service.connect("peer");
  assert.equal(locationsSent(g).length, 0);
  await g.service.receive("peer", g.presence());
  assert.equal(locationsSent(g).length, 1);
});
test("remote pins require session identity/scope; location traffic never writes storage or forwards", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.service.connect("peer");
  const wire = createLocation(
    h.remote,
    syntheticPoint(),
    null,
    NOW,
    randomBytes,
  );
  assert.equal(await h.service.receive("peer", wire), true);
  assert.equal(displayedLocation(h), undefined);
  await h.service.receive("peer", h.presence());
  const writes = h.repository.personWrites,
    packets = h.repository.messages.size,
    sends = h.sent.length;
  await h.service.receive(
    "peer",
    createLocation(
      createIdentity(randomBytes),
      syntheticPoint(),
      null,
      NOW,
      randomBytes,
    ),
  );
  await h.service.receive(
    "peer",
    createLocation(
      h.remote,
      syntheticPoint(),
      "a".repeat(64),
      NOW,
      randomBytes,
    ),
  );
  assert.equal(displayedLocation(h), undefined);
  await h.service.receive("peer", wire);
  assert.deepEqual(displayedLocation(h), syntheticPoint());
  assert.equal(h.repository.personWrites, writes);
  assert.equal(h.repository.messages.size, packets);
  assert.equal(h.sent.length, sends);
});
test("location update watermarks reject stale packets, older fixes, and replay after withdrawal/disconnect", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  h.setNow(NOW + 1000);
  const latest = createLocation(
    h.remote,
    syntheticPoint(NOW + 1000),
    null,
    NOW + 1000,
    randomBytes,
  );
  await h.service.receive("peer", latest);
  await h.service.receive(
    "peer",
    createLocation(h.remote, syntheticPoint(), null, NOW, randomBytes),
  );
  await h.service.receive(
    "peer",
    createLocation(h.remote, syntheticPoint(), null, NOW + 1001, randomBytes),
  );
  assert.equal(displayedLocation(h)?.capturedAt, NOW + 1000);
  await h.service.receive(
    "peer",
    createLocation(h.remote, null, null, NOW + 1002, randomBytes),
  );
  await h.service.receive("peer", latest);
  assert.equal(displayedLocation(h), undefined);
  const newer = createLocation(
    h.remote,
    syntheticPoint(NOW + 1003),
    null,
    NOW + 1003,
    randomBytes,
  );
  await h.service.receive("peer", newer);
  h.service.disconnect("peer");
  await h.service.refresh();
  assert.equal(displayedLocation(h), undefined);
  await h.connect();
  await h.service.receive("peer", newer);
  assert.equal(displayedLocation(h), undefined);
});
test("pin expiry respects original capture age; scope reset and restart cannot retain locations", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  h.setNow(NOW + 119000);
  await h.service.receive(
    "peer",
    createLocation(h.remote, syntheticPoint(), null, NOW + 119000, randomBytes),
  );
  assert.ok(displayedLocation(h));
  h.setNow(NOW + 120000);
  await h.service.tick();
  assert.equal(displayedLocation(h), undefined);
  await h.service.receive(
    "peer",
    createLocation(
      h.remote,
      syntheticPoint(NOW + 120000),
      null,
      NOW + 120000,
      randomBytes,
    ),
  );
  assert.ok(displayedLocation(h));
  h.setScope("a".repeat(64));
  await h.service.refresh();
  assert.equal(displayedLocation(h), undefined);
  assert.ok(h.repository.contacts.every((person) => !("location" in person)));
  assert.equal(h.repository.messages.size, 0);
});
test("opt-out during an in-flight location sends a newer withdrawal and shutdown drains it", async () => {
  const h = fixture();
  await h.connect();
  const gate = deferred();
  h.locationGate(gate.promise);
  h.setLocation(syntheticPoint());
  const sharing = h.service.announceLocation();
  await turn();
  h.setLocation(null);
  const withdrawal = h.service.announceLocation();
  gate.resolve();
  await Promise.all([sharing, withdrawal]);
  const updates = locationsSent(h).map((message) =>
    verifyLocation(message.wire, NOW)!,
  );
  assert.equal(updates.length, 2);
  assert.ok(updates[0].location);
  assert.equal(updates[1].location, null);
  assert.ok(updates[1].createdAt > updates[0].createdAt);
  const gate2 = deferred();
  h.locationGate(gate2.promise);
  h.setLocation(syntheticPoint());
  const pending = h.service.announceLocation();
  await turn();
  let settled = false;
  const done = h.service.settle().then(() => {
    settled = true;
  });
  await turn();
  assert.equal(settled, false);
  gate2.resolve();
  await Promise.all([pending, done]);
  assert.equal(settled, true);
});
test("stale own GPS withdraws instead of repeatedly extending its lifetime", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  h.setLocation(syntheticPoint());
  await h.connect();
  h.setNow(NOW + 120000);
  await h.service.tick();
  assert.equal(
    verifyLocation(locationsSent(h).at(-1)!.wire, NOW + 120000)?.location,
    null,
  );
});

test("opt-out during a multi-peer broadcast prevents new disclosures to remaining peers", async (t) => {
  const h = fixture();
  t.after(() => h.service.settle());
  await h.connect();
  await h.service.connect("peer2");
  await h.service.receive("peer2", h.presence());
  const gate = deferred();
  h.locationGate(gate.promise);
  h.setLocation(syntheticPoint());
  const publishing = h.service.announceLocation();
  await turn();
  h.setLocation(null);
  const withdrawing = h.service.announceLocation();
  gate.resolve();
  await Promise.all([publishing, withdrawing]);
  const positive = locationsSent(h).filter(
    (message) => verifyLocation(message.wire, NOW)?.location,
  );
  assert.deepEqual(
    positive.map((message) => message.peerId),
    ["peer"],
    "only the already-started native send may disclose; opt-out cancels the remaining peers",
  );
  assert.equal(
    verifyLocation(locationsSent(h).at(-1)!.wire, NOW)?.location,
    null,
  );
});
