import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPendingUpdate,
  validatedCloudUrl,
  locationForSOS,
} from "../../apps/mobile/src/services/ServicePolicy.js";
import {
  createIdentity,
  createRequestId,
  createEnvelope,
  type RequestState,
} from "../../packages/protocol/src/index.js";
import { randomBytes } from "node:crypto";

test("fractional native location timestamps can be signed into an SOS without blocking it", () => {
  const now = 1_800_000_000_000;
  const identity = createIdentity(randomBytes);
  const location = locationForSOS(
    {
      source: "device",
      latitude: 47.655,
      longitude: -122.306,
      accuracy: 5.25,
      capturedAt: now - 12.75,
    },
    undefined,
    now,
  );
  const message = createEnvelope(
    identity,
    {
      type: "sos",
      requestId: createRequestId(identity, randomBytes),
      destination: "community",
      payload: {
        category: "other",
        displayName: "Synthetic",
        note: "",
        location,
      },
    },
    now,
    randomBytes,
  );
  assert.equal(message.payload.location.capturedAt, now - 13);
  assert.equal(message.payload.location.accuracyM, 5.25);
  assert.equal(message.payload.location.source, "device");
});

test("invalid optional device reports fall back without blocking SOS and manual descriptions still win", () => {
  const now = 1_800_000_000_000;
  const valid = {
    source: "device" as const,
    latitude: 47.655,
    longitude: -122.306,
    capturedAt: now - 100,
  };
  for (const invalid of [
    { latitude: NaN },
    { latitude: 91 },
    { longitude: undefined },
    { capturedAt: NaN },
    { capturedAt: Infinity },
    { capturedAt: -0.5 },
    { capturedAt: Number.MAX_SAFE_INTEGER + 1 },
    { capturedAt: undefined },
    { source: "unavailable" as const },
  ]) {
    assert.deepEqual(locationForSOS({ ...valid, ...invalid }, undefined, now), {
      source: "unavailable",
      capturedAt: now,
    });
  }
  for (const accuracy of [-1, Infinity, NaN, 100_001]) {
    const result = locationForSOS({ ...valid, accuracy }, undefined, now);
    assert.equal(result.source, "device");
    assert.equal(result.accuracyM, undefined);
  }
  assert.deepEqual(
    locationForSOS({ source: "unavailable" }, "  North entrance  ", now),
    {
      source: "manual_description",
      description: "North entrance",
      capturedAt: now,
    },
  );
});

const request: RequestState = {
  id: "request",
  requesterId: "requester",
  messageId: "sos",
  createdAt: 1,
  expiresAt: 2,
  revision: 1,
  category: "other",
  note: "",
  displayName: "Synthetic",
  location: { source: "unavailable", capturedAt: 1 },
  status: "accepted",
  offers: [],
  receipts: [],
  seenBy: [],
  lastEventAt: 1,
  assignment: {
    id: "assignment",
    helperId: "helper",
    offerId: "offer",
    messageId: "accept",
    revision: 1,
    received: true,
  },
};

test("confirmed acceptance does not falsely confirm a later cancellation or completion", () => {
  assert.equal(hasPendingUpdate(request, "requester"), false);
  assert.equal(
    hasPendingUpdate(
      { ...request, assignment: { ...request.assignment!, received: false } },
      "requester",
    ),
    true,
  );
  for (const status of ["canceled", "completed"] as const) {
    assert.equal(
      hasPendingUpdate({ ...request, status, revision: 2 }, "requester"),
      true,
    );
    assert.equal(
      hasPendingUpdate({ ...request, status, revision: 2 }, "helper"),
      false,
    );
  }
  assert.equal(
    hasPendingUpdate(
      { ...request, status: "open", revision: 0, assignment: undefined },
      "requester",
    ),
    false,
  );
});

test("sync destinations reject plaintext transport, embedded credentials and accidental secret query strings", () => {
  assert.equal(
    validatedCloudUrl("https://example.test/api/"),
    "https://example.test/api",
  );
  for (const url of [
    "http://example.test",
    "file:///tmp/data",
    "https://name:password@example.test",
    "https://example.test?token=secret",
    "https://example.test#secret",
    "not a url",
  ])
    assert.throws(() => validatedCloudUrl(url));
});

test("changing cloud connection discards previous report provenance while keeping the local queue count", async () => {
  const { resetCloudSnapshot } =
    await import("../../apps/mobile/src/services/ServicePolicy.js");
  const old = {
    status: "error" as const,
    pendingCount: 7,
    lastSyncedAt: 123,
    error: "old incident error",
    combinedEvents: [
      {
        id: "old",
        type: "sos",
        title: "Old incident",
        createdAt: 1,
        uploaded: true,
      },
    ],
    summary: {
      incidentId: "old",
      updatedAt: 1,
      incomplete: true as const,
      requestCount: 1,
      requestsWithRecipientReceipt: 0,
      completedRequests: 0,
      requestStatisticsTruncated: false,
      activityBuckets: [],
      activityBucketsLimit: 1000,
      aggregateRefreshPending: false,
      localReceiptRoundTripMs: { sampleCount: 0, p50: null, p95: null },
    },
  };
  assert.deepEqual(resetCloudSnapshot(old, true), {
    status: "idle",
    pendingCount: 7,
  });
  assert.deepEqual(resetCloudSnapshot(old, false), {
    status: "disabled",
    pendingCount: 7,
  });
  assert.equal(old.summary.incidentId, "old");
});
