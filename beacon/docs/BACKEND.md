# Beacon API, Tiger Data and Vultr

The repository contains an Express 5 TypeScript API, transactional PostgreSQL ingestion, Timescale migrations, authenticated replay, and a Docker/Caddy deployment recipe. **No paid resources were provisioned, no service was deployed, and no Tiger database connection is claimed.** API TypeScript checking passed and six API contract/security/replay-size tests passed using an injectable in-memory repository; one opt-in Timescale integration test was skipped because no test database was supplied. The integration test must pass against an actual disposable Timescale instance before claiming database validation. A Docker build and a live HTTPS smoke test are separate evidence gates.

## Contract and trust

`POST /v1/events/batch` accepts `Authorization: Bearer <device token>` and JSON:

```json
{"incidentId":"campus","events":[{"id":"stable-local-event-id","deviceId":"64-character-lowercase-hex-node-id","sequence":1,"recordedAt":1792252800000,"kind":"peer_connected","peerId":"session-peer-id"}]}
```

Each event may also contain `requestId` (64 hex characters), `message` (an authenticated `@beacon/protocol` Envelope), and `peerId`. Unknown fields are rejected. IDs allow letters, digits, colon, underscore, and hyphen, up to 160 characters. `kind` starts with a lowercase letter and uses lowercase letters, digits, underscore, dot or hyphen, up to 64 characters. There are at most 100 events per batch and 2 MB per HTTP request. Device sequences must monotonically identify persistent local records and cannot be reused after clearing history unless the device identity changes. A response is `{accepted:string[],duplicates:string[],rejected:[{id,reason}]}`. Only accepted or duplicate IDs may be removed from the mobile outbox. Rejected events require review; retryable HTTP/network failures keep the outbox unchanged.

A token authenticates the **observing phone**, whose `deviceId` must match every uploaded record. Signed envelopes can originate from a different phone because relays observe remote messages. Each envelope is cryptographically verified, and `requestId` must match it. Local event claims remain observer claims; they are never converted into delivery receipts. Expired signed messages are accepted as history. Invalid signatures, mutable conflicting IDs, and wrong incident membership are rejected. Registration uses the public-key-derived node ID shown by the app; offline mesh use needs no enrollment or internet login.

`GET /v1/incidents/:id/events` returns `{events:[...event,ingestedAt],updatedAt,incomplete:true,nextCursor?}` with at most 2,000 records and a 4 MB event payload per page, below the mobile client’s 5 MB response limit. Continue with `?cursor=<nextCursor>`. Order is server ingestion time with stable ID tie-breaking; display replay in observation-time order and retain the distinction. `incomplete:true` is deliberate: disconnected phones may never upload. Concurrent uploads can arrive after pagination finishes; refresh again when needed.

`GET /v1/incidents/:id/summary` returns event counts, unique signed SOS request counts, requests with verified endpoint receipts, requester-confirmed completions, first-receipt p50/p95 latency, and hourly continuous-aggregate activity. Signed request state uses the same protocol reducer as mobile, including requester authority and endpoint receipt checks. Negative device-clock differences are excluded from latency. Positive skew remains possible and is disclosed. Request statistics cap at 20,000 distinct signed envelopes and set `requestStatisticsTruncated`; activity shows at most the most recent 1,000 bucket/kind rows. `updatedAt` is the latest successful event ingestion for this incident, not proof all phones synchronized. Hourly activity counts observations, not unique requests. `aggregateRefreshPending` indicates queued work (conservatively across the whole database).

`GET /healthz` checks the process. `GET /readyz` checks database access and migration presence. Authenticated endpoints are limited to 120 requests per token per minute per process. Invalid tokens still require a DB lookup; add host/network abuse controls and measured fleet limits before public use. Logs include random request ID, method, status, and elapsed time, excluding authorization, message contents, location, and request URLs.

## Local setup and enrollment

From the repository root, install dependencies once with `npm ci`. Use an existing, authorized database and keep credentials server-side:

```sh
export DATABASE_URL='postgresql://...'
export DB_SSL=require
npm --workspace @beacon/api run migrate
npm --workspace @beacon/api run admin -- create-incident campus 'Campus preparedness drill'
npm --workspace @beacon/api run admin -- enroll campus PUBLIC_KEY_DERIVED_NODE_ID
npm --workspace @beacon/api run dev
```

`enroll` prints a new secret token once to stdout only when explicitly invoked. Transfer it privately into the app's secure token storage. Tokens have 256 random bits, are stored as SHA-256 hashes, and can be revoked with `npm --workspace @beacon/api run admin -- revoke-device NODE_ID`. Enrollment does not silently revoke previous tokens. TLS verifies the database certificate; never disable verification to fix a connection failure. Plaintext DB transport is allowed only for localhost development. Use separate migration and runtime database credentials. The runtime needs DML on these tables, SELECT on aggregates, and owner-equivalent permission to refresh this aggregate; use a tightly scoped database role/owned refresh function if your organization separates those duties.

## Existing Vultr host deployment recipe

This is preparation only. **The user's no-spending instruction prohibits provisioning Vultr instances, Tiger services, domains, or any paid resource.** Execute only when the user later supplies an already-authorized host and explicitly requests deployment.

1. Prepare an existing Linux host with Docker Engine/Compose, security updates, a restricted SSH account, and firewall permitting 80/443 publicly; do not publish port 3000 or PostgreSQL. Point an existing domain A/AAAA record to that host. Restrict database access to the host's egress IP where supported.
2. Copy the repository to the host. Copy `infra/vultr/.env.example` to `infra/vultr/.env`, fill secrets privately, and `chmod 600 infra/vultr/.env`. It must be excluded from Git and Docker build context.
3. Build using `docker compose --env-file infra/vultr/.env -f infra/vultr/compose.yaml build`. Run migrations using `docker compose --env-file infra/vultr/.env -f infra/vultr/compose.yaml run --rm api npm --workspace @beacon/api run migrate` with migration credentials, then restore runtime credentials.
4. Start with `docker compose --env-file infra/vultr/.env -f infra/vultr/compose.yaml up -d`. Caddy automatically obtains and renews TLS; persist its volumes. Check HTTPS `/healthz`, `/readyz`, an unauthorized upload (401), and an enrolled device upload/retry/replay.
5. Confirm real signed SOS/receipt uploads on physical devices after connectivity returns. Save redacted logs and DB query evidence. Do not label a cloud upload as recipient delivery.

The API container runs as non-root with a read-only filesystem, bounded memory/CPU, all Linux capabilities dropped, private port exposure, health checks, restart policy, and bounded logs. `tsx` remains in the runtime intentionally because workspace protocol exports TypeScript. Lockfile-based install pins resolved versions; review image updates and pin digest revisions before real operational use. Back up Tiger data, verify restoration, and record retention policy before storing real emergency reports or locations.

## Verification commands

```sh
npm --workspace @beacon/api run typecheck
npm --workspace @beacon/api test
BEACON_TEST_DATABASE_URL='postgresql://DISPOSABLE_TIMESCALE_DATABASE' npm --workspace @beacon/api test
```

The integration test creates and drops a unique schema, may install TimescaleDB in the disposable database, and tests concurrent duplicate upload, rollback after dedupe insertion, conflicting content, 30-day-late aggregate refresh, and replay. Without the explicit environment variable it is **skipped**, not passed.

See [database details](../database/README.md). Official references: [Tiger continuous-aggregate refresh](https://www.tigerdata.com/docs/reference/timescaledb/continuous-aggregates/refresh_continuous_aggregate), [Vultr container deployment](https://docs.vultr.com/how-to-containerize-node-js-web-applications), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
