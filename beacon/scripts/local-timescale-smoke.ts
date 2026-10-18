import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createIdentity,
  createRequestId,
  createEnvelope,
} from "../packages/protocol/src/index.ts";
import { createApp, tokenHash } from "../apps/api/src/app.ts";
import {
  createPool,
  PgRepository,
  refreshAggregates,
} from "../apps/api/src/repository.ts";
async function main() {
  const destination = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(destination.hostname),
    "Smoke test requires a loopback database",
  );
  assert.equal(
    destination.pathname,
    "/beacon_validation",
    "Smoke test requires the disposable beacon_validation database",
  );
  assert.ok(
    destination.port && destination.port !== "5432",
    "Use an isolated nondefault PostgreSQL port",
  );
  const pool = createPool();
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    const pg = (await pool.query("SHOW server_version")).rows[0].server_version;
    const extension = (
      await pool.query(
        "SELECT extversion FROM pg_extension WHERE extname='timescaledb'",
      )
    ).rows[0]?.extversion;
    assert.ok(extension, "A real Timescale extension must be installed");
    const hypertables = await pool.query(
      "SELECT hypertable_schema,hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='events'",
    );
    assert.equal(hypertables.rowCount, 1);
    const identity = createIdentity(randomBytes),
      helper = createIdentity(randomBytes),
      token = randomBytes(32).toString("base64url");
    const incident = "synthetic-local-validation";
    await pool.query("INSERT INTO incidents(id,name) VALUES($1,$2)", [
      incident,
      "Synthetic local integration evidence only",
    ]);
    await pool.query("INSERT INTO devices(id) VALUES($1),($2)", [
      identity.nodeId,
      helper.nodeId,
    ]);
    await pool.query(
      "INSERT INTO incident_participants(incident_id,device_id) VALUES($1,$2)",
      [incident, identity.nodeId],
    );
    await pool.query(
      "INSERT INTO device_tokens(token_hash,device_id) VALUES($1,$2)",
      [tokenHash(token), identity.nodeId],
    );
    const repository = new PgRepository(pool);
    server = createApp(repository).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const at = Date.now() - 30 * 86400000,
      requestId = createRequestId(identity, randomBytes);
    const sos = createEnvelope(
      identity,
      {
        type: "sos",
        requestId,
        destination: "community",
        payload: {
          category: "other",
          displayName: "Synthetic requester",
          note: "Local database smoke test, no emergency",
          location: { source: "unavailable", capturedAt: at },
        },
      },
      at,
      randomBytes,
    );
    const receipt = createEnvelope(
      helper,
      {
        type: "receipt",
        requestId,
        destination: identity.nodeId,
        payload: { messageId: sos.id },
      },
      at + 60000,
      randomBytes,
    );
    const events = [sos, receipt].map((message, index) => ({
      id: `synthetic-${index}`,
      deviceId: identity.nodeId,
      sequence: index + 1,
      recordedAt: at + index * 90000,
      kind: message.type,
      requestId,
      message,
    }));
    const upload = () =>
      fetch(`${base}/v1/events/batch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ incidentId: incident, events }),
      });
    const health = await fetch(`${base}/healthz`),
      ready = await fetch(`${base}/readyz`);
    assert.equal(health.status, 200);
    assert.equal(ready.status, 200);
    const accepted = await upload();
    assert.equal(accepted.status, 200);
    assert.deepEqual(
      (await accepted.json()).accepted,
      events.map((e) => e.id),
    );
    const duplicate = await upload();
    assert.equal(duplicate.status, 200);
    assert.deepEqual(
      (await duplicate.json()).duplicates,
      events.map((e) => e.id),
    );
    const spoof = await fetch(`${base}/v1/events/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        incidentId: incident,
        events: [{ ...events[0], id: "spoof", deviceId: helper.nodeId }],
      }),
    });
    assert.equal((await spoof.json()).rejected.length, 1);
    const unauthorized = await fetch(`${base}/v1/incidents/${incident}/events`);
    assert.equal(unauthorized.status, 401);
    const forbidden = await fetch(
      `${base}/v1/incidents/other-incident/events`,
      { headers },
    );
    assert.equal(forbidden.status, 403);
    const replay = await (
      await fetch(`${base}/v1/incidents/${incident}/events`, { headers })
    ).json();
    assert.equal(replay.events.length, 2);
    assert.equal(replay.incomplete, true);
    assert.ok(replay.events.every((e: any) => e.ingestedAt > e.recordedAt));
    const before = await (
      await fetch(`${base}/v1/incidents/${incident}/summary`, { headers })
    ).json();
    assert.equal(before.requestCount, 1);
    assert.equal(before.requestsWithRecipientReceipt, 1);
    assert.equal(before.aggregateRefreshPending, true);
    const refreshed = await refreshAggregates(pool);
    assert.ok(refreshed >= 1);
    const after = await (
      await fetch(`${base}/v1/incidents/${incident}/summary`, { headers })
    ).json();
    assert.equal(after.requestCount, 1);
    assert.equal(after.requestsWithRecipientReceipt, 1);
    assert.equal(after.aggregateRefreshPending, false);
    assert.equal(
      after.activityBuckets.reduce(
        (sum: number, row: any) => sum + row.event_count,
        0,
      ),
      2,
    );
    assert.ok(
      after.activityBuckets.every(
        (row: any) => Date.parse(row.bucket) < Date.now() - 29 * 86400000,
      ),
    );
    await pool.query(
      "UPDATE device_tokens SET revoked_at=now() WHERE token_hash=$1",
      [tokenHash(token)],
    );
    const revoked = await fetch(`${base}/v1/incidents/${incident}/events`, {
      headers,
    });
    assert.equal(revoked.status, 401);
    console.log(
      JSON.stringify(
        {
          scope:
            "Actual local TimescaleDB + Express HTTP; synthetic signed fixtures; not Tiger Cloud/Vultr/hardware",
          testedAt: new Date().toISOString(),
          postgresVersion: pg,
          timescaleVersion: extension,
          hypertables: hypertables.rows,
          healthStatus: health.status,
          readinessStatus: ready.status,
          acceptedEvents: 2,
          duplicateEvents: 2,
          spoofedObserverRejected: true,
          unauthorizedStatus: unauthorized.status,
          crossIncidentStatus: forbidden.status,
          revokedTokenStatus: revoked.status,
          replayCount: replay.events.length,
          requestCount: after.requestCount,
          requestsWithVerifiedRecipientReceipt:
            after.requestsWithRecipientReceipt,
          lateUploadDays: 30,
          refreshedBuckets: refreshed,
          historicalAggregateObservations: after.activityBuckets.reduce(
            (sum: number, row: any) => sum + row.event_count,
            0,
          ),
          aggregateRefreshPending: after.aggregateRefreshPending,
        },
        null,
        2,
      ),
    );
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
