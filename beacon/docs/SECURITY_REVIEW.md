# Beacon adversarial review

Review date: 2026-10-17. Scope: signed protocol, requester authority, replay and expiration, router resource bounds, native framing and callback recovery, followed by mobile storage/service integration when available. This is a source review and deterministic test exercise, not a penetration-test certification or physical radio validation.

## Reproduced and repaired protocol defects

| Severity | Finding and reproduced evidence | Repair |
| --- | --- | --- |
| High | Arbitrary inventory IDs accumulated indefinitely in each peer's `sent` set. A 32-message test retained 2,048 IDs despite a 2,000-message durable limit; continued controls increased it indefinitely. | Remember only known inventory IDs; cap rolling suppression IDs, forced-request cooldowns, and control replay history. |
| High | One valid `missing` control containing the same ID 64 times transmitted a record 64 times; replaying it transmitted again. Fresh concurrent controls also raced around async repository reads. | Deduplicate control IDs and requested IDs, reserve requested records after async reads, suppress repeated requests for one minute, cap sends at 240/minute/session, and cap concurrent receives and data sends at eight. |
| Medium | Zod `.trim()` transformed signed display names during verification while the original envelope was returned. Adding 1,000 unsigned spaces to `Alice` passed signature verification and bypassed the original field-length bound. | Validation now checks the original signed string, including its length, without transforming it. Unsigned padding is rejected. |
| Medium | Two simultaneous endpoint acknowledgments produced two different durable receipts. | One in-flight operation per SOS; the existing durable receipt is reused. Assignment reconciliation is also serialized and reruns when concurrent arrivals change history. |
| Medium | Repeated `connect` calls on an existing session reset its receive throttle; controls could use long application TTLs. | Existing connect calls are idempotent. Controls require a 60-second TTL, zero request ID/revision/hops, and bounded replay tracking. Self-announcements and changed identities within one session are rejected. |

`tests/adversarial/security.test.ts` contains executable regression tests. Five initial regressions were observed failing before repairs. The combined protocol/adversarial suite currently passes 23 tests, including send-budget recovery, requester-only cancellation/completion, forged signatures, self contacts, changed session identities, oversized Unicode wire data, immutable expiry, repeated and concurrent controls, capacity, and acknowledgment races.

Command:

```sh
node --import tsx --test tests/protocol/*.test.ts tests/adversarial/*.test.ts
```

## Native review handoff

Native frame parsers cap complete messages at 16 KiB, frame values at 512 bytes, two partial messages per session, and exact ordered fragment completion. Both transports limit connections and native outgoing message queues. Existing Swift/Kotlin framing fixtures cover MTU boundaries, canonical bytes, invalid version/order/duplicates, capacity, and expiration.

Source review identified Android advertisement/service recovery that stopped retrying once a server object existed, stale callbacks after stop/start, and iOS wall-clock-based resource expiration. The native validation workstream reports lifecycle generation checks, publication retries, and monotonic-timeout repairs. Both actual Swift/Kotlin frame implementations passed their boundary, malformed-data, capacity, and exact monotonic-deadline tests. Its build/test report determines full-module compilation status; none of this establishes physical BLE reliability.

## Explicit remaining trust limits

- A valid signature proves possession of a self-generated key. It does not verify a name, qualification, physical location, claimed emergency, or successful real-world assistance. Sybil identities remain possible.
- Inventory announcements are signed but are replayable across physical BLE sessions; they are not challenge-response authentication. Independent central/peripheral sessions may claim the same identity. They remain separately bounded and must be described as links, not unique people. Automatically evicting another session based only on such a claim would permit impersonation-based denial of service.
- Payloads are plaintext. Directed destinations constrain application semantics but do not hide content from relays. BLE advertisements and transport addresses are not identity credentials.
- Hop counts are cooperative routing metadata. A hostile relay can reset hop counts, but cannot extend the signed expiration. Device wall-clock errors still affect live-message acceptance; no trusted clock synchronization is implemented.
- Per-session quotas do not eliminate connection churn, colluding devices, radio jamming, native event flooding, or network-wide denial of service. A full durable queue must fail visibly rather than silently evict active emergency data.
- Native send completion is not recipient persistence. A signed receipt is a remote device's assertion, not a guarantee of rescue or even an honest human.
- Full Android/iOS release builds and physical device tests are required before making hardware interoperability or operational reliability claims. Pure TypeScript and frame-unit tests do not establish these properties.

## SQLite integration

The actual repository was tested with a `node:sqlite` `DatabaseSync` adapter through the same asynchronous database interface used by mobile. Seven tests in `tests/storage/repository.test.ts` pass on bundled Node 24. They exercise real SQLite transactions and disk restart rather than mocked SQL results.

Repairs made during review:

- Repeated forwarding of an already uploaded event no longer re-enqueues it in the cloud outbox. Existing events remain idempotent even when event capacity is full.
- Message and forwarding event IDs are stable SHA-256 values, staying inside the API's event-ID length limit.
- Receipt timestamps supplied to persistence must be nonnegative safe integers.
- State reconstruction during a write queries only the affected request's history, avoiding repeated reduction of unrelated requests.

Tests cover rollback of message/dedup/state/event on an injected outbox failure; later successful retry; restart durability; shorter-route deduplication; upload confirmation leaving endpoint-receipt state untouched; forwarding counters; pending-upload retention; cascading eligible deletion; transactional message/event capacity; bounded upload errors/backoff; and concurrent duplicate writers.

The existing retention policy intentionally protects pending cloud events even after the replay window. A user who never enables cloud upload may therefore fill local storage and cannot clear those pending records through the eligible-history operation. The UI must explain this limitation; any future discard action must explicitly describe the data being removed.

## Mobile service integration

Source review and repairs now cover the actual `BeaconService`:

- Register router sessions synchronously before recording peer events, preventing the first incoming application packet from racing session registration.
- Save SOS and incoming data durably before scheduling nonblocking forwarding; slow native sends no longer delay the caller's saved result. Coalesce flush work and independently flush peer links. A regression holds a native send pending, verifies durable publication returns, then verifies its eventual failure reaches the error handler without creating a delivery receipt.
- Bound incoming complete-message work to 32 queued operations, local actions to 16, and pending peer-event recording to 32. Protocol/native limits apply independently.
- Validate restored secure-store identity key consistency, preserve private identity material and cloud tokens in secure storage, and keep mesh payloads out of diagnostic exports.
- Verify requester authority and current request expiration before offers, acceptance, cancellation, or completion. An old accepted-assignment receipt never confirms a later cancellation/completion. Terminal updates remain pending because this version does not implement terminal-update recipient confirmations.
- Reserve sync exclusivity before asynchronous settings reads; revalidate stored cloud URLs as HTTPS without embedded credentials/query strings; validate uploaded IDs against the actual batch; and avoid doubling backoff attempts for a partial rejection. Synchronization remains a user-invoked action.
- Dispose event subscriptions, timer, native transport and database connection on provider unmount; deferred disposal allows React development effect replay to reacquire the service.

The combined protocol, adversarial, SQLite, and service-policy suite passes 32 tests. Service-policy tests verify terminal confirmation semantics and unsafe sync URL rejection. They do not execute React Native APIs or replace a complete device workflow test. The platform response reader checks Content-Length when supplied and limits parsed response text to 5 MB, but the React Native `response.text()` fallback may allocate a larger response before rejecting it; this remains a transport-memory limitation with a malicious configured cloud server.

The root workstream owns final maps, release builds, and UI integration. Physical BLE behavior, OS lifecycle behavior, permission prompts, and cloud/mobile end-to-end operation still require device acceptance tests.
