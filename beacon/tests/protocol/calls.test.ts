import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createIdentity,
  createCallSignal,
  encodeCallSignal,
  decodeCallSignal,
  openCallSignal,
  CALL_LIMITS,
  type CallContent,
} from "../../packages/protocol/src/index.js";
const NOW = 1_800_000_000_000;
const alice = createIdentity(randomBytes),
  bob = createIdentity(randomBytes),
  eve = createIdentity(randomBytes);
const callId = "a".repeat(64),
  keyBase64 = randomBytes(32).toString("base64");
const invite: CallContent = {
  version: 1,
  callId,
  kind: "invite",
  keyBase64,
  initiator: true,
  psm: 0,
};
test("call controls and ephemeral media key are encrypted for the recipient", () => {
  const contents: CallContent[] = [
    invite,
    { version: 1, callId, kind: "accept", psm: 131 },
    ...(["decline", "end", "busy"] as const).map((kind) => ({
      kind,
      version: 1 as const,
      callId,
    })),
  ];
  for (const content of contents) {
    const packet = createCallSignal(
        alice,
        bob.publicKey,
        content,
        null,
        NOW,
        randomBytes,
      ),
      wire = encodeCallSignal(packet);
    assert.ok(Buffer.byteLength(wire) < CALL_LIMITS.wireBytes);
    assert.ok(!wire.includes(keyBase64));
    assert.ok(!wire.includes(callId));
    assert.deepEqual(decodeCallSignal(wire, NOW), packet);
    assert.deepEqual(openCallSignal(bob, packet, NOW), content);
    assert.equal(openCallSignal(eve, packet, NOW), null);
    assert.equal(openCallSignal(alice, packet, NOW), null);
  }
});
test("call signatures bind identities, recipient, scope, clock, nonce and ciphertext", () => {
  const packet = createCallSignal(
    alice,
    bob.publicKey,
    invite,
    "c".repeat(64),
    NOW,
    randomBytes,
  );
  for (const change of [
    { origin: eve.nodeId },
    { publicKey: eve.publicKey },
    { destination: eve.nodeId },
    { recipientPublicKey: eve.publicKey },
    { scope: null },
    { createdAt: NOW - 1 },
    { expiresAt: NOW + 60_000 },
    { nonce: "0".repeat(48) },
    { ciphertext: Buffer.alloc(64).toString("base64") },
    { signature: "0".repeat(128) },
    { surprise: true },
  ])
    assert.equal(
      decodeCallSignal(JSON.stringify({ ...packet, ...change }), NOW),
      null,
    );
  assert.throws(() =>
    createCallSignal(
      { ...alice, nodeId: eve.nodeId },
      bob.publicKey,
      invite,
      null,
      NOW,
      randomBytes,
    ),
  );
});
test("call signals expire after 30 seconds and reject clock abuse, oversized or malformed input", () => {
  const packet = createCallSignal(
      alice,
      bob.publicKey,
      invite,
      null,
      NOW,
      randomBytes,
    ),
    wire = encodeCallSignal(packet);
  assert.ok(decodeCallSignal(wire, NOW + 29_999));
  assert.equal(decodeCallSignal(wire, NOW + 30_000), null);
  assert.equal(openCallSignal(bob, packet, NOW + 30_000), null);
  assert.equal(decodeCallSignal(wire, NOW - 5_001), null);
  for (const invalid of [
    "{",
    "null",
    "x".repeat(16385),
    JSON.stringify({ ...packet, ciphertext: "x".repeat(3000) }),
  ])
    assert.equal(decodeCallSignal(invalid, NOW), null);
  assert.equal(decodeCallSignal(wire, NaN), null);
});
test("call content validates capability, key length and role/PSM and forbids keys outside invite", () => {
  for (const content of [
    { ...invite, version: 2 },
    { ...invite, keyBase64: Buffer.alloc(31).toString("base64") },
    { ...invite, psm: 5 },
    { ...invite, initiator: false },
    { version: 1, callId, kind: "accept", psm: 65536 },
    { version: 1, callId, kind: "end", keyBase64 },
  ])
    assert.throws(() =>
      createCallSignal(
        alice,
        bob.publicKey,
        content as CallContent,
        null,
        NOW,
        randomBytes,
      ),
    );
  assert.throws(() =>
    createCallSignal(
      alice,
      bob.publicKey,
      invite,
      null,
      NOW,
      () => new Uint8Array(1),
    ),
  );
  const one = createCallSignal(
      alice,
      bob.publicKey,
      invite,
      null,
      NOW,
      randomBytes,
    ),
    two = createCallSignal(
      alice,
      bob.publicKey,
      invite,
      null,
      NOW,
      randomBytes,
    );
  assert.notEqual(one.nonce, two.nonce);
  assert.notEqual(one.ciphertext, two.ciphertext);
});
