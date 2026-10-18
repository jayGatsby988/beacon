import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createIdentity,
  createEnvelope,
  createRequestId,
  encodePacket,
  decodePacket,
  createSocialGroup,
  joinSocialGroup,
  sealGroup,
  openGroup,
  createPresence,
  verifyPresence,
  createDirectMessage,
  createDirectReceipt,
  encodeDirect,
  decodeDirect,
  openDirect,
  SOCIAL_LIMITS,
  type DirectPacket,
} from "../../packages/protocol/src/index.js";

const now = 1_800_000_000_000;
const identity = () => createIdentity(randomBytes);
const modify = (wire: string, patch: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(wire), ...patch });
const flip = (text: string) => (text[0] === "a" ? "b" : "a") + text.slice(1);

test("strong invites rejoin the same group and never travel in encrypted wrappers", () => {
  const group = createSocialGroup("Prepared group", randomBytes);
  assert.match(group.inviteCode, /^beacon1-[0-9a-f]{64}$/);
  assert.equal(
    joinSocialGroup("Local group label", ` ${group.inviteCode.toUpperCase()} `)
      .id,
    group.id,
  );
  const wire = sealGroup(group, "Synthetic private group content", randomBytes);
  assert.equal(openGroup(group, wire), "Synthetic private group content");
  assert.equal(wire.includes(group.inviteCode), false);
  assert.equal(wire.includes(group.inviteCode.slice(8)), false);
  assert.equal(wire.includes("Synthetic private group content"), false);
  assert.throws(() => joinSocialGroup("Group", "short-password"));
  assert.throws(() => joinSocialGroup("", group.inviteCode));
  assert.throws(() => createSocialGroup("Group", () => new Uint8Array(16)));
});

test("wrong groups and forged group metadata or ciphertext fail authentication", () => {
  const group = createSocialGroup("A", randomBytes),
    other = createSocialGroup("B", randomBytes);
  const wire = sealGroup(group, "private", randomBytes),
    packet = JSON.parse(wire);
  assert.equal(openGroup(other, wire), null);
  assert.equal(openGroup(other, modify(wire, { groupId: other.id })), null);
  assert.equal(
    openGroup({ ...group, inviteCode: other.inviteCode }, wire),
    null,
  );
  assert.equal(
    openGroup(group, modify(wire, { ciphertext: flip(packet.ciphertext) })),
    null,
  );
  assert.equal(
    openGroup(group, modify(wire, { nonce: flip(packet.nonce) })),
    null,
  );
  assert.equal(openGroup(group, modify(wire, { extra: "unsigned" })), null);
  assert.equal(openGroup(group, "{}"), null);
});

test("group wrapping preserves an actual authenticated mesh SOS and stays under native cap", () => {
  const sender = identity(),
    group = createSocialGroup("Demo", randomBytes);
  const envelope = createEnvelope(
    sender,
    {
      type: "sos",
      requestId: createRequestId(sender, randomBytes),
      destination: "community",
      payload: {
        category: "other",
        note: "Synthetic group SOS",
        displayName: "A",
        location: { source: "unavailable", capturedAt: now },
      },
    },
    now,
    randomBytes,
  );
  const inner = encodePacket({ envelope, hops: 1 });
  const outer = sealGroup(group, inner, randomBytes);
  assert.ok(new TextEncoder().encode(outer).length <= SOCIAL_LIMITS.wireBytes);
  assert.deepEqual(decodePacket(openGroup(group, outer)!, now), {
    envelope,
    hops: 1,
  });
});

test("presence is signed, identity-bound, scope-bound, short lived, and rejects added fields", () => {
  const sender = identity(),
    scope = createSocialGroup("Group", randomBytes).id;
  const wire = createPresence(sender, "Alice", scope, now, randomBytes);
  assert.deepEqual(verifyPresence(wire, now), {
    nodeId: sender.nodeId,
    publicKey: sender.publicKey,
    name: "Alice",
    scope,
    createdAt: now,
  });
  for (const patch of [
    { nodeId: identity().nodeId },
    { publicKey: identity().publicKey },
    { name: "Mallory" },
    { name: " Alice " },
    { scope: null },
    { createdAt: now + 1 },
    { extra: "ignored?" },
  ]) {
    assert.equal(verifyPresence(modify(wire, patch), now), null);
  }
  assert.equal(verifyPresence(wire, now + SOCIAL_LIMITS.presenceTtlMs), null);
  assert.equal(
    verifyPresence(wire, now - SOCIAL_LIMITS.presenceFutureSkewMs - 1),
    null,
  );
  assert.throws(() =>
    createPresence(
      { ...sender, nodeId: identity().nodeId },
      "Alice",
      null,
      now,
      randomBytes,
    ),
  );
  assert.throws(() =>
    createPresence(sender, "x".repeat(49), null, now, randomBytes),
  );
});

test("direct message decrypts for intended recipient and sender history, never a third device", () => {
  const sender = identity(),
    recipient = identity(),
    outsider = identity();
  const packet = createDirectMessage(
    sender,
    recipient.publicKey,
    "Synthetic café message 🧭",
    null,
    now,
    randomBytes,
  );
  const wire = encodeDirect(packet),
    decoded = decodeDirect(wire, now)!;
  assert.ok(decoded);
  assert.equal(packet.destination, recipient.nodeId);
  assert.equal(packet.origin, sender.nodeId);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(wire.includes("Synthetic café"), false);
  assert.equal("kind" in packet, false);
  assert.deepEqual(openDirect(recipient, decoded), {
    kind: "message",
    text: "Synthetic café message 🧭",
  });
  assert.deepEqual(openDirect(sender, decoded), {
    kind: "message",
    text: "Synthetic café message 🧭",
  });
  assert.equal(openDirect(outsider, decoded), null);
  assert.equal(
    openDirect({ ...recipient, privateKey: outsider.privateKey }, decoded),
    null,
  );
});

test("direct receipts encrypt referenced IDs and return only to the message sender", () => {
  const a = identity(),
    b = identity(),
    group = createSocialGroup("Group", randomBytes);
  const message = createDirectMessage(
    a,
    b.publicKey,
    "Synthetic",
    group.id,
    now,
    randomBytes,
  );
  const receipt = createDirectReceipt(
    b,
    a.publicKey,
    message.id,
    group.id,
    now + 1,
    randomBytes,
  );
  const wire = encodeDirect(receipt);
  assert.equal(wire.includes(message.id), false);
  assert.equal(wire.includes('"receipt"'), false);
  assert.deepEqual(openDirect(a, decodeDirect(wire, now + 1)!), {
    kind: "receipt",
    messageId: message.id,
  });
  const grouped = sealGroup(group, wire, randomBytes);
  assert.deepEqual(
    openDirect(a, decodeDirect(openGroup(group, grouped)!, now + 1)!),
    { kind: "receipt", messageId: message.id },
  );
  assert.throws(() =>
    createDirectReceipt(
      b,
      a.publicKey,
      "not-a-message-id",
      group.id,
      now,
      randomBytes,
    ),
  );
});

test("direct signature rejects spoofed identities, recipient changes, scopes, headers and ciphertext", () => {
  const a = identity(),
    b = identity(),
    outsider = identity();
  const packet = createDirectMessage(
      a,
      b.publicKey,
      "Synthetic",
      null,
      now,
      randomBytes,
    ),
    wire = encodeDirect(packet);
  const patches = [
    { origin: outsider.nodeId },
    { publicKey: outsider.publicKey },
    { destination: outsider.nodeId },
    { recipientPublicKey: outsider.publicKey },
    { scope: "a".repeat(64) },
    { createdAt: now + 1 },
    { expiresAt: packet.expiresAt + 1 },
    { nonce: flip(packet.nonce) },
    { ciphertext: flip(packet.ciphertext) },
    { id: flip(packet.id) },
    { signature: flip(packet.signature) },
    { extra: "unsigned field" },
  ];
  for (const patch of patches) {
    assert.equal(decodeDirect(modify(wire, patch), now), null);
    assert.equal(openDirect(b, { ...packet, ...patch } as DirectPacket), null);
  }
  assert.throws(() =>
    createDirectMessage(
      { ...a, publicKey: outsider.publicKey },
      b.publicKey,
      "Fake identity",
      null,
      now,
      randomBytes,
    ),
  );
  assert.throws(() =>
    createDirectMessage(
      a,
      "0".repeat(64),
      "Invalid recipient",
      null,
      now,
      randomBytes,
    ),
  );
});

test("direct expiry is enforced on receive while authenticated local history can still be decrypted", () => {
  const a = identity(),
    b = identity();
  const packet = createDirectMessage(
      a,
      b.publicKey,
      "History",
      null,
      now,
      randomBytes,
    ),
    wire = encodeDirect(packet);
  assert.ok(decodeDirect(wire, packet.expiresAt - 1));
  assert.equal(decodeDirect(wire, packet.expiresAt), null);
  assert.equal(
    decodeDirect(wire, now - SOCIAL_LIMITS.directFutureSkewMs - 1),
    null,
  );
  assert.equal(decodeDirect(wire, Number.NaN), null);
  assert.deepEqual(openDirect(a, packet), { kind: "message", text: "History" });
});

test("malformed, oversized, and excessive Unicode input are bounded before crypto work", () => {
  const a = identity(),
    b = identity(),
    group = createSocialGroup("Group", randomBytes);
  for (const wire of [
    "{",
    "null",
    "[]",
    "x".repeat(SOCIAL_LIMITS.wireBytes + 1),
    "🧭".repeat(SOCIAL_LIMITS.wireBytes),
  ]) {
    assert.equal(decodeDirect(wire, now), null);
    assert.equal(verifyPresence(wire, now), null);
    assert.equal(openGroup(group, wire), null);
  }
  assert.throws(
    () => sealGroup(group, "x".repeat(SOCIAL_LIMITS.wireBytes), randomBytes),
    /16 KiB/,
  );
  assert.throws(() =>
    createDirectMessage(
      a,
      b.publicKey,
      "x".repeat(SOCIAL_LIMITS.messageChars + 1),
      null,
      now,
      randomBytes,
    ),
  );
  assert.throws(() =>
    createDirectMessage(a, b.publicKey, "   ", null, now, randomBytes),
  );
  assert.throws(() =>
    createDirectMessage(
      a,
      b.publicKey,
      "Valid",
      null,
      now,
      () => new Uint8Array(12),
    ),
  );
  const packet = createDirectMessage(
    a,
    b.publicKey,
    "🧭".repeat(SOCIAL_LIMITS.messageChars / 2),
    group.id,
    now,
    randomBytes,
  );
  assert.ok(
    new TextEncoder().encode(
      sealGroup(group, encodeDirect(packet), randomBytes),
    ).length <= SOCIAL_LIMITS.wireBytes,
  );
});

test("fresh random nonces produce distinct authenticated IDs and ciphertexts", () => {
  const a = identity(),
    b = identity(),
    group = createSocialGroup("Group", randomBytes);
  const first = createDirectMessage(
    a,
    b.publicKey,
    "same",
    null,
    now,
    randomBytes,
  );
  const second = createDirectMessage(
    a,
    b.publicKey,
    "same",
    null,
    now,
    randomBytes,
  );
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(
    sealGroup(group, "same", randomBytes),
    sealGroup(group, "same", randomBytes),
  );
});
