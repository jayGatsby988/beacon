import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createIdentity,
  createLocation,
  verifyLocation,
  createSocialGroup,
  sealGroup,
  openGroup,
  LOCATION_LIMITS,
} from "../../packages/protocol/src/index.js";
const NOW = 1_800_000_000_000;
const sender = createIdentity(randomBytes),
  other = createIdentity(randomBytes);
const point = { latitude: 1.25, longitude: -2.5, accuracy: 8, capturedAt: NOW };
test("location signature binds identity, scope, coordinates, capture time and withdrawal", () => {
  const wire = createLocation(sender, point, null, NOW, randomBytes);
  assert.deepEqual(verifyLocation(wire, NOW)?.location, point);
  assert.ok(Buffer.byteLength(wire) < LOCATION_LIMITS.wireBytes);
  for (const patch of [
    { nodeId: other.nodeId },
    { publicKey: other.publicKey },
    { scope: "a".repeat(64) },
    { location: { ...point, latitude: 2 } },
    { createdAt: NOW + 1 },
    { expiresAt: NOW + 300000 },
    { surprise: true },
  ])
    assert.equal(
      verifyLocation(JSON.stringify({ ...JSON.parse(wire), ...patch }), NOW),
      null,
    );
  assert.equal(
    verifyLocation(createLocation(sender, null, null, NOW, randomBytes), NOW)
      ?.location,
    null,
  );
  assert.throws(() =>
    createLocation(
      { ...sender, nodeId: other.nodeId },
      point,
      null,
      NOW,
      randomBytes,
    ),
  );
});
test("location expires by both message TTL and original fix age", () => {
  const wire = createLocation(sender, point, null, NOW, randomBytes);
  assert.ok(verifyLocation(wire, NOW + 119999));
  assert.equal(verifyLocation(wire, NOW + 120000), null);
  const reannounced = createLocation(
    sender,
    point,
    null,
    NOW + 119000,
    randomBytes,
  );
  assert.equal(verifyLocation(reannounced, NOW + 120000), null);
  assert.equal(verifyLocation(wire, NOW - 5001), null);
  assert.throws(() =>
    createLocation(
      sender,
      { ...point, capturedAt: NOW - 120000 },
      null,
      NOW,
      randomBytes,
    ),
  );
  assert.throws(() =>
    createLocation(
      sender,
      { ...point, capturedAt: NOW + 5001 },
      null,
      NOW,
      randomBytes,
    ),
  );
});
test("location strict schema rejects malformed and excessive input", () => {
  for (const location of [
    { ...point, latitude: 91 },
    { ...point, longitude: -181 },
    { ...point, accuracy: -1 },
    { ...point, accuracy: 100001 },
    { ...point, latitude: NaN },
    { ...point, capturedAt: 1.5 },
    { ...point, hidden: "extra" },
  ])
    assert.throws(() =>
      createLocation(sender, location, null, NOW, randomBytes),
    );
  for (const wire of ["{", "null", "x".repeat(2049)])
    assert.equal(verifyLocation(wire, NOW), null);
});
test("group location uses existing group sealing and cannot be opened with another invite", () => {
  const group = createSocialGroup("Synthetic group", randomBytes),
    otherGroup = createSocialGroup("Other synthetic", randomBytes);
  const wire = createLocation(sender, point, group.id, NOW, randomBytes),
    sealed = sealGroup(group, wire, randomBytes);
  assert.ok(!sealed.includes("latitude"));
  assert.equal(openGroup(otherGroup, sealed), null);
  assert.equal(verifyLocation(openGroup(group, sealed)!, NOW)?.scope, group.id);
});
