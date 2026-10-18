import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPool, refreshAggregates } from "./repository.js";
import { tokenHash } from "./app.js";
import { IncidentId } from "./contracts.js";
const pool = createPool();
try {
  const [command, arg1, arg2] = process.argv.slice(2);
  if (command === "migrate") {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(186924,2)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const directory = fileURLToPath(
        new URL("../../../database/migrations/", import.meta.url),
      );
      for (const name of (await readdir(directory))
        .filter((n) => /^\d+.*\.sql$/.test(n))
        .sort()) {
        if (
          (
            await client.query(
              "SELECT 1 FROM schema_migrations WHERE version=$1",
              [name],
            )
          ).rowCount
        )
          continue;
        await client.query("BEGIN");
        try {
          await client.query(await readFile(`${directory}/${name}`, "utf8"));
          await client.query(
            "INSERT INTO schema_migrations(version) VALUES($1)",
            [name],
          );
          await client.query("COMMIT");
          console.log(`Applied ${name}`);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(186924,2)");
      client.release();
    }
  } else if (command === "create-incident") {
    const id = IncidentId.parse(arg1);
    if (!arg2 || arg2.length > 120)
      throw new Error("Provide a name (1–120 characters)");
    await pool.query("INSERT INTO incidents(id,name) VALUES($1,$2)", [
      id,
      arg2,
    ]);
    console.log(`Created incident ${id}`);
  } else if (command === "enroll") {
    const incidentId = IncidentId.parse(arg1);
    if (!arg2 || !/^[0-9a-f]{64}$/.test(arg2))
      throw new Error(
        "Device ID must be its public-key-derived 64-character node ID",
      );
    const token = randomBytes(32).toString("base64url");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO devices(id) VALUES($1) ON CONFLICT DO NOTHING",
        [arg2],
      );
      await client.query(
        "INSERT INTO incident_participants(incident_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [incidentId, arg2],
      );
      await client.query(
        "INSERT INTO device_tokens(token_hash,device_id) VALUES($1,$2)",
        [tokenHash(token), arg2],
      );
      await client.query("COMMIT");
      // The secret is printed only when the operator explicitly invokes enroll, never at server startup.
      console.log(token);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else if (command === "revoke-device") {
    if (!arg1 || !/^[0-9a-f]{64}$/.test(arg1))
      throw new Error("Device ID required");
    await pool.query(
      "UPDATE device_tokens SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
      [arg1],
    );
    console.log("Device credentials revoked");
  } else if (command === "refresh") {
    console.log(`Refreshed ${await refreshAggregates(pool)} hourly buckets`);
  } else
    throw new Error(
      "Usage: admin.ts migrate | create-incident ID NAME | enroll INCIDENT NODE_ID | revoke-device NODE_ID | refresh",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operation failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
