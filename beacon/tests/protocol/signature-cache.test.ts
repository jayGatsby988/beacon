import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  bytesToHex, canonical, createEnvelope, createIdentity, createRequestId,
  decodePacket, encodePacket, LIMITS, verifyEnvelope,
} from "../../packages/protocol/src/index.js";

const now = 1_800_000_000_000;
const identity = createIdentity(randomBytes);
function signedRequest() {
  return createEnvelope(identity, {
    type: "sos", requestId: createRequestId(identity, randomBytes), destination: "community",
    payload: { category: "other", note: "Synthetic cache test", displayName: "Test", location: { source: "unavailable", capturedAt: now } },
  }, now, randomBytes);
}

test("cached signatures reuse verified content while rejecting mutated and forged envelopes", (t) => {
  const envelope = signedRequest();
  const verify = ed25519.verify;
  let checks = 0;
  t.mock.method(ed25519, "verify", (...args: Parameters<typeof verify>) => {
    checks++;
    return verify(...args);
  });
  for (let i = 0; i < 100; i++) assert.equal(verifyEnvelope(structuredClone(envelope)), true);
  assert.equal(checks, 0, "reading an already authenticated durable message does not repeat signature work");

  const changed = structuredClone(envelope);
  assert.equal(changed.type, "sos");
  if (changed.type !== "sos") throw new Error("Unexpected fixture");
  changed.payload.note = "Tampered after verification";
  assert.equal(verifyEnvelope(changed), false);
  const { id: _id, signature: _signature, ...unsigned } = changed;
  changed.id = bytesToHex(sha256(new TextEncoder().encode(canonical(unsigned))));
  assert.equal(verifyEnvelope(changed), false, "recomputing the content ID cannot reuse an old signature");
  assert.equal(verifyEnvelope(changed), false, "failed checks never enter the success cache");
  assert.equal(checks, 2);
  assert.equal(verifyEnvelope({ ...envelope, signature: "0".repeat(128) }), false);
  assert.equal(verifyEnvelope({ ...envelope, unexpected: true }), false, "cache hits still enforce strict schema");
  assert.equal(verifyEnvelope({ ...envelope, origin: "0".repeat(64) }), false);
  assert.equal(verifyEnvelope({ ...envelope, expiresAt: envelope.createdAt }), false);
  assert.equal(verifyEnvelope(envelope), true, "invalid inputs cannot poison the valid entry");
  const wire = encodePacket({ envelope, hops: 0 });
  assert.equal(decodePacket(wire, now).envelope.id, envelope.id);
  assert.throws(() => decodePacket(wire, envelope.expiresAt + 1), /expired/i, "warm signatures do not bypass packet expiration");
});

test("signature memo evicts old content instead of growing with relay history", { timeout: 60_000 }, (t) => {
  const oldest = signedRequest();
  for (let i = 0; i < LIMITS.messages + LIMITS.controlHistory; i++) signedRequest();
  const verify = ed25519.verify;
  let checks = 0;
  t.mock.method(ed25519, "verify", (...args: Parameters<typeof verify>) => {
    checks++;
    return verify(...args);
  });
  assert.equal(verifyEnvelope(oldest), true);
  assert.equal(checks, 1, "an evicted message must authenticate again");
  assert.equal(verifyEnvelope(structuredClone(oldest)), true);
  assert.equal(checks, 1, "successful revalidation warms the bounded memo again");
});
