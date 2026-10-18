# Nearby messages and private groups

This flow requires the updated native Beacon build on every participating phone. An earlier SOS-only build does not provide people discovery, direct messages, or private groups. Keep Beacon open on both phones with Bluetooth and nearby sharing enabled. No hosted service, online account, or paid resource is required.

## Nearby map and connection refresh

The Nearby map shows only current, directly connected Beacon users who explicitly enabled **Share my location** in the selected audience. Each report carries its original GPS capture time and optional accuracy. Pins disappear after 120 seconds or disconnection; a map pin is not a guarantee of a person’s present position. Location sharing defaults off, requires foreground permission, and stops on background, group change, or pausing Nearby. Enabling it again is an explicit action.

The sharing switch sits above the map. The **People** list can show connected people even when they have not shared a position; the map distinguishes a connection from a shared position. To see each other, open Beacon on both phones, select the same audience, and enable **Share my location** on both. Visiting phone Settings to disable Wi-Fi backgrounds Beacon and stops sharing, so re-enable it after returning. The locate button refreshes only your own GPS fix and fits the current positions on screen; it does not turn sharing on.

Location packets are signed, session-bound, scope-checked, and ordered. Private-group packets use the existing group encryption; public Nearby shares with authenticated Beacon peers in public mode. Shared peer positions stay in memory and do not enter SQLite, cloud upload, chat history, or mesh forwarding. Opt-out withdraws the report, and checks between sends prevent a queued update from reaching additional peers after opt-out. A disconnected receiver may retain its last report until its short expiry.

The map opens using the saved area, or the bundled UW campus geometry when no saved area is available. **View online** explicitly selects the free [OpenFreeMap public service](https://openfreemap.org/quick_start/). Tile requests reveal the viewed geographic area to that provider; Beacon does not send peer names or message contents. Returning to **Use offline map** restores the local map. Outside local coverage, position markers remain visible with a coverage label; street detail is not invented. Request details retain the reported position outside map coverage too. No account, paid map key, or cloud deployment is required.

The expanded UW bundle includes 7,027 real map features in an approximately two-kilometer square, including the area just outside the original campus rectangle. No download is needed within that coverage. Returning to Nearby refits the map after its local position refresh; normal location updates do not continually reset a user's map gesture. [Coverage and source evidence](evidence/expanded-offline-map.json) records the public bounds and geometry provenance.

**Save my area** needs internet once and a fresh device location. It requests OpenStreetMap roads, buildings, parks, and water for roughly two kilometers around the phone through [Private.coffee's public Overpass API](https://overpass.private.coffee/), with one attempt through [FOSSGIS Overpass](https://overpass-api.de/) if the first provider is temporarily unavailable, then saves a self-contained map style. This explicit action sends the area's bounding box to the provider(s) and stores the coverage bounds on the phone. It does not enable peer location sharing or send peer coordinates. The saved geometry needs no remote tiles, fonts, or sprites; it does not include street labels or navigation. The included UW map is available before any download.

A save makes at most two requests, each limited to 30 seconds, and another save cannot begin within a minute. The query's server working-memory budget is separate from the eight-megabyte response/file cap. A provider error, partial response, oversized result, or cancellation never becomes a completed map. If both free providers are unavailable, the error remains visible and the previous saved area stays usable.

Current limitation: actual iOS-simulator saves still failed with a first-provider HTTP 500 and fallback timeout during the October 18 check. Host download success is not proof that this app flow works. The expanded bundled UW map is available independently of that unresolved save path.

Saved areas use app-owned relative filenames so an iOS container-path change during an update does not invalidate them. Startup can recover a valid existing geometry file when an older version lost its metadata; it does not download anything during recovery. Explicitly removing a saved area remains respected.

**Find people** refreshes scanning and clears peer retry delays without resetting live connections or durable queues. Native scan refreshes are coalesced; Android scan attempts are paced at least 10 seconds apart and rate-limit failures back off 30 seconds. The iOS watchdog defers a central-manager reset during a call. Joining a group requires only its invite; an optional local name can be supplied.

## Nearby

The **Nearby** tab lists people whose Beacon apps have exchanged signed identity announcements over direct Bluetooth connections. It does not scan arbitrary phones or identify their owners. A display name is self-reported; the cryptographic identity belongs to that app installation.

Tap a person to send a message. Messages are encrypted to the recipient's identity and signed by the sender. Nearby direct messages travel only over a connection to that recipient; they do not use other phones as relays. You can save a message while disconnected and retry when that contact reconnects.

| Status | Meaning |
| --- | --- |
| Queued | Ciphertext is saved locally; no valid recipient acknowledgment has arrived. A completed Bluetooth write alone does not change this status. |
| Received | The recipient app persisted the message and returned an authenticated acknowledgment. This is not a read receipt. |
| Expired | The 24-hour delivery window ended without a confirmed acknowledgment. The message is no longer retried. |

Message ciphertext and delivery status survive restart. Local history remains for seven days after the message's expiry, including confirmed messages; expired history is not retransmitted. Decrypted direct-message text is presented in memory rather than stored in the message database. Contacts are capped at 200 scoped entries and retained ciphertext packets at 1,000, including acknowledgment packets. Full storage rejects additional entries instead of silently removing retained messages.

## Private groups

Use the scope selector on Home or Nearby to create or join a group. Creating a group produces an invite containing a random 256-bit shared secret. Joining the same invite selects the same group even if members choose different local group names. Invites and device identity secrets are stored in SecureStore.

**Sharing an invite grants membership.** Anyone holding it can join and decrypt group traffic. There is no administrator approval, member revocation, or forward-secrecy guarantee. Use a new group and invite when a different membership boundary is needed; this does not revoke access to old group content. The app supports up to eight saved groups.

Only the selected scope—Nearby or one private group—is active. All participants must select the same group to exchange its requests or messages. Switching scope changes the visible requests, contacts, and conversations; it does not move their data into the newly selected scope.

- **Group SOS:** signed request and assistance messages use a separate database per group. Native Bluetooth writes encrypt the group packet with the invite secret. Requests can be stored and relayed through participating phones in that same active group, with offers, requester acceptance, and assignment receipts preserved.
- **Group direct messages:** one-to-one conversations still encrypt to the recipient identity, inside the group transport encryption. They require direct contact with that recipient; this is not a group-wide chat.
- **Cloud isolation:** group request databases create no event history or cloud outbox entries. Direct-message storage has no cloud outbox. Optional incident sync uses the separate Nearby SOS repository, never group requests or direct messages.

Queued private requests remain private when switching to Nearby. Earlier Nearby requests do not become private-group requests. Restart restores the selected group and its local request state. Group SOS content is stored locally in its request database; transport encryption does not imply that every local database is encrypted at rest.

## Verification

Automated tests exercise the real protocol, storage, and service implementations:

- `tests/protocol/social.test.ts`: cryptographic packet validation and scope boundaries.
- `tests/storage/social-repository.test.ts`: disk restart, deduplication, capacity, retention, private outbox isolation, and actual SocialService message/acknowledgment behavior, including a lost acknowledgment and a forged receipt.
- `tests/services/group-isolation.test.ts`: actual BeaconService with separate disk-backed SQLite databases; encrypted native-write payloads, same-invite reception, rejection by a different group and Nearby, queued scope switching, restored group selection, and offer/accept/assignment-receipt exchange.

The service tests explicitly mock native Bluetooth and operating-system APIs. They establish application behavior, not radio range, background reliability, or physical delivery of the updated feature. See [VALIDATION.md](VALIDATION.md) for the current complete test/build record and dated device observations. Earlier measured SOS radio transfers and native artifacts must not be represented as verification that this new messaging/group build is installed on a phone.

For a physical check, update both phones, discover each other in Nearby, exchange a direct message and recipient acknowledgment, then join the same invite and repeat with a group SOS. A phone in Nearby or a different group must not receive that private request. Disconnect/reconnect and restart each phone to check queued delivery and selected-group restoration. These checks remain separate from the existing three-phone SOS relay acceptance procedure in [DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md).

### Pre-scene native build — 2026-10-18 06:45 UTC

Mobile/API typecheck and the incremental signed iOS Release build passed with Xcode 27.1, iOS deployment target 15.1, and two build jobs. The build used the generic iOS destination because the intended phone was disconnected. `codesign --verify --deep --strict` passed, and the final provisioning profile matches `org.beacon.community.dev`, includes the intended iPhone, and expires on 2026-10-25 at 05:51 UTC.

The app at `tmp/DerivedData/Build/Products/Release-iphoneos/Beacon.app` contains the freshly generated 7,698,213-byte JavaScript bundle, newer than the mobile/protocol source files checked, including the latest protocol fix and durable per-message unread markers in `SocialService.ts`. Its SHA-256 is `38cd3a697647d12d82398d7475d547090507628beb572389f26e6822a0561fdf`. Local evidence is saved in `tmp/nearby-groups-device-build.log` and `tmp/nearby-groups-signing-verification.json`.

The device check at 06:45 UTC reported the intended iPhone unavailable. After the user reconnected a phone, the connected device was Darshan's iPhone 17 Pro; Vaibhav's iPhone remained unavailable. The profile also includes this connected phone. The final app installed and launched successfully on it, and a subsequent process query confirmed Beacon still running as PID 1997. Local evidence is in `tmp/latest-connected-install.json`, `tmp/latest-connected-launch.json`, and `tmp/latest-connected-processes.json`.

The user then connected Pravanram's iPhone 17 Pro Max. The same signed app and embedded bundle installed and launched successfully; a subsequent process query confirmed PID 2034 still running. Local evidence is in `tmp/latest-second-phone-install.json`, `tmp/latest-second-phone-launch.json`, and `tmp/latest-second-phone-processes.json`. A read-only application database snapshot passed `quick_check` for both the request and social databases. It contained no social contacts or direct messages, and its existing `relayEnabled` setting was false. The user was asked to enable Nearby sharing through the app before the paired test.

This confirms installation and process startup on both physical phones, connected to the Mac in turn. It does not establish physical direct-message or group delivery. Enable Nearby sharing, keep both apps open in the same scope, and perform the paired checks above.

### Physical discovery after enabling sharing — 2026-10-18 06:55 UTC

After the user enabled Nearby sharing, a fresh read-only snapshot from the connected phone confirmed `relayEnabled=true` and the default Nearby scope. Both databases passed `quick_check`. The social database contained one contact with a new announcement at 06:55:20 UTC; connection and forwarding events were recorded at 06:55:19–20 UTC. This is fresh physical Nearby discovery evidence from the updated app. There were no direct-message packets yet, so the user was asked to send a test message and reply. A later snapshot transfer lost its device socket and was incomplete; it is not used as evidence of message delivery or failure.

### Third phone installation

The user subsequently connected Vaibhav's iPhone 18 Pro Max. The same build installed successfully; the provisioning profile includes this device and strict signature verification passed. Initial launch was denied pending developer trust. After trust was granted, actual process/crash checks exposed a separate iOS 27 failure: UIKit requires scene lifecycle adoption for builds using the latest SDK. The earlier iOS 26 phones did not encounter this requirement.

### Scene-compatible build — 2026-10-18 07:08 UTC

The native startup fix uses one scene-owned window and preserves the Expo factory, links, and lifecycle subscribers. Its config plugin and Swift template are committed so Expo prebuild retains the fix. The signed Release build and four new plugin tests pass; the full workspace now passes 90 tests with real local TimescaleDB and no skips, plus typechecking and lint. The JavaScript bundle hash remains the same as above because this correction changes native startup.

The corrected build installed and launched successfully on Vaibhav's iOS 27.0.1 phone. Its process was observed running, both request and social databases initialized and passed integrity checks, and the user confirmed reaching Home after setup. Saved setup and two freshly discovered Nearby contacts were then verified in a read-only snapshot. No new Beacon crash reports were present at the 07:09:02 UTC recheck. Direct-message packets remained zero, so no message exchange is inferred. Native build/install/startup files are under `tmp/scene-lifecycle-*`; [sanitized evidence](evidence/ios-scene-launch.json) includes executable and JavaScript hashes.
