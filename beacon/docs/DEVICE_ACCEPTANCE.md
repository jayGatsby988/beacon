# Physical device acceptance

Use installed standalone builds with embedded JavaScript. A simulator, a native send resolving, and a successful build are not evidence of remote receipt. Run only with consenting testers and invented requests; do not contact emergency services.

## Record each run

| Run | A / OS / build | B / OS / build | C / OS / build | Contact schedule | Request ID | Signed receipt IDs | Result / elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |

Record package/build version and artifact hash, Bluetooth permissions, foreground/background state, role/session IDs when available, and relevant error codes. Preserve diagnostic exports without private keys, tokens, or real personal information. Repeat the complete A–B–C sequence ten times and report the observed pass count and failures.

## Prepare and prove the baseline

- [ ] Use three physical phones. Test Android–Android first, then Android–iPhone in each central/peripheral role, then iPhone–iPhone when hardware is available. Record combinations actually tested.
- [ ] Enable airplane mode on every phone, then explicitly enable Bluetooth. Disable Wi-Fi and cellular; airplane mode alone may leave Wi-Fi on. Keep apps foregrounded and the screens awake for the supported baseline.
- [ ] Grant Bluetooth permissions. Test denied permission and Bluetooth-off states once: the UI must explain the condition and recover after the user grants permission or enables the radio.
- [ ] Confirm the bundled campus map renders with all network access disabled. Outside its coverage, show the actual coverage limitation. A missing GPS fix stays missing; a cached location retains its age and accuracy.
- [ ] Exchange a request in both directions on two phones. Confirm a remote persisted request and a validated signed receipt; local queue acceptance or cloud upload must not show recipient delivery.

## Three-phone store-and-forward proof

A is requester, B is relay, and C is recipient/helper. Prevent direct A–C contact with distance or an explicit contact schedule; a diagram alone does not establish isolation.

1. **A ↔ B only:** keep C out of range or its Bluetooth off. Create an invented request on A. Confirm A saves it and B stores it. Record its exact signed ID. Do not mark A delivered before the return receipt.
2. **B ↔ C only:** separate A, then allow B and C to connect. Confirm C receives that same request ID and persists it. C's receipt must reference the original request. B stores the return traffic.
3. **B ↔ A only:** separate C and reunite B with A. Confirm A receives the validated receipt and the request's delivery state changes. Record elapsed time and receipt ID. Verify A never contacted C directly during this run.
4. **Assistance:** relay C's offer to A, A's acceptance to C, and the accepted-assignment receipt back to A through the same isolated contact phases. Confirm requester/helper identities and assignment revisions match. An offer alone must not become requester acceptance.
5. **Terminal state:** relay requester cancellation or completion. Verify unauthorized helpers cannot cancel or complete someone else's request. This version lacks terminal-update recipient receipts: cancellation/completion must not reuse an earlier assignment receipt as confirmation.

## Failure and durability cases

- [ ] Toggle Bluetooth off during an active send. Confirm the send fails visibly, the durable request remains, sessions disconnect, and the complete event retries after reconnect. No receipt should be invented by a retry.
- [ ] Repeat disconnect/reconnect and simultaneous role connections. Confirm duplicate signed event IDs do not create duplicate requests, offers, or receipts; counts must describe links rather than unique people unless independently established.
- [ ] After B stores A's request but before B meets C, force-close B and reopen it. Complete B→C and C→B→A. Repeat with A restarted before the return receipt. Check saved identity and outbox survive.
- [ ] Restart while a cloud upload is pending, with network still off. Verify pending history remains local and mesh delivery status is independent of upload status. Do not enable or configure cloud upload for the offline baseline.
- [ ] Let a test request expire. Confirm it is no longer forwarded or actionable and expiration is not extended by relay/reconnect. Use correctly set device clocks; document clock-skew behavior separately.
- [ ] Exercise a near-limit valid request and a burst of requests. Record backpressure/failure rather than treating a full queue as successful delivery. Native framing unit tests cover 16 KiB transport boundaries; ordinary UI fields may have lower limits.

## iOS and lifecycle limits

Foreground operation is the acceptance baseline. iOS declares Bluetooth background modes, but suspension, screen lock, discovery throttling, force quit, OS resource pressure, and peripheral-role restrictions can interrupt relaying. Android also has background execution restrictions. Test lock/background/force-quit separately on every OS/version and label the outcomes as observations, not continuous availability guarantees.

On iOS, notification send completion means CoreBluetooth accepted the fragments; it is not a delivery acknowledgment. iOS cannot forcibly disconnect a subscribed central from the peripheral role. Timed-out sessions reject further writes until reconnect. Require a signed application receipt after persistence for delivery evidence on both platforms.

Current state: this checklist is **not yet executed**. Native builds and deterministic tests are recorded in [NATIVE_VALIDATION.md](NATIVE_VALIDATION.md).
