# Nearby messages and private groups

This flow requires the updated native Beacon build on every participating phone. An earlier SOS-only build does not provide people discovery, direct messages, or private groups. Keep Beacon open on both phones with Bluetooth and nearby sharing enabled. No hosted service, online account, or paid resource is required.

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

### Final native build — 2026-10-18 06:14 UTC

Mobile/API typecheck and the incremental signed iOS Release build passed with Xcode 27.1, iOS deployment target 15.1, and two build jobs. The build used the generic iOS destination because the intended phone was disconnected. `codesign --verify --deep --strict` passed, and the final provisioning profile matches `org.beacon.community.dev`, includes the intended iPhone, and expires on 2026-10-25 at 05:51 UTC.

The app at `tmp/DerivedData/Build/Products/Release-iphoneos/Beacon.app` contains the freshly generated 7,697,743-byte JavaScript bundle, newer than the mobile/protocol source files checked, including the durable per-message unread-marker fix in `SocialService.ts`. Its SHA-256 is `3a37d80edc4ab5c1f537872d372798f10041cd4d27bb7ba5731030df1606a9fe`. Local evidence is saved in `tmp/nearby-groups-device-build.log` and `tmp/nearby-groups-signing-verification.json`.

The most recent device check at 06:11 UTC reported the iPhone unavailable; no further device polling was performed during this rebuild. The preceding installation attempt failed with CoreDevice error 4016 (trusted connectivity/services unavailable); its evidence is in `tmp/nearby-groups-install.json`. The final app has **not been installed or launched on the physical phone**, and this build does not establish physical direct-message or group delivery. Reconnect the phone to install, launch, and perform the checks above.
