# Offline help notifications

Beacon can show an OS banner/sound when a verified SOS reaches your phone, someone offers to help with your request, the requester accepts your offer, or your selected volunteer confirms receiving the assignment. Tapping opens the request. If its audience is no longer selected, Beacon opens Groups and asks you to select the original audience first. Terminal requests remain readable in the request screen.

## Enable on phones

1. Install dependencies from `beacon/` with Node 24: `npm ci`.
2. Rebuild and reinstall the native app using the README's iOS or Android instructions. `expo-notifications` adds native code; Metro refresh or an update to JavaScript alone is insufficient. Expo Go does not support Beacon's native Bluetooth modules.
3. In Setup or **Profile & settings → Help notifications**, turn on the switch and allow the phone's notification prompt. If previously denied, use **Allow notifications in phone settings** and return to Beacon. This is optional and never blocks SOS creation.
4. On each participating phone, keep Bluetooth on and Beacon open for reliable reception. Wi-Fi and cellular can remain off.

These are local notifications, not APNs/FCM pushes. No cloud token, internet connection, Google service configuration, paid push service, or Apple push entitlement is used. Notification permission does not grant background Bluetooth execution. A suspended or force-closed app may not receive BLE messages or run the JavaScript observer; this feature does not promise delivery in those states. A request received through relays also does not prove that its sender is within direct Bluetooth range or a particular geographic radius.

## Implementation

- `NotificationPolicy.ts` consumes the same verified/reduced request views that power the UI. Transport receipts, forwarding events, self-created SOS, terminal requests, and inactive audiences are not presented as new help.
- `NotificationContext.tsx` owns permission state, Android's high-importance `beacon-help` channel, foreground presentation, OS interaction, and validated request routing. It is separate from Bluetooth, SQLite message transactions, and delivery acknowledgments. Notification failure cannot prevent saving or forwarding a request.
- `NotificationSettings.tsx` provides the optional toggle in Setup and Settings. Returning from phone settings refreshes permission. The foreground handler only presents app-owned notifications for the selected audience; names, notes, medical categories, and coordinates never enter notification text.
- The local SQLite key/value store holds a versioned enable preference and an audience/device-specific ledger. First observation baselines restored history; later state changes are compared against that ledger. Disabling alerts or denying permission quietly records arrivals instead of replaying them later. Reconnecting, refreshing, or restarting does not repeat the same notification.
- At most six new alerts per minute are presented. Overflow remains visible in the app and is not replayed later. The ledger retains at most 2,048 keys per scope for 48 hours. Native presentation failures can retry on a later view refresh. App startup baselines old state rather than emitting a historical flood; this is not a durable background inbox processor.
- The notification is a historical event, not a guarantee of current request status. Opening it reads the latest locally known state. No badge count is set.

The Expo SDK 54-compatible `expo-notifications` package autolinks its native modules and notification delegate. Its Android library already declares notification permission; `app.json` also declares it explicitly. The standard config plugin unconditionally adds `aps-environment`, and Expo also auto-applies notification configuration when the dependency is installed. Therefore `with-local-notifications.cjs` is registered **before** the standard plugin: Expo executes the entitlement mod chain in reverse registration order, so removal runs last and deletes only that APNs entitlement. Local alerts should remain compatible with Personal Team signing. An integration test introspects the entire Expo prebuild configuration to verify this ordering, retain Bluetooth background modes, and check Android permission. Runtime channel setup uses the system sound; no custom bundled sound is needed. Revisit the local-only plugin before ever adding remote APNs push.

Reference: [Expo notification APIs](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/), checked against the installed 0.32.17 implementation.

## Verification

Automated coverage in `tests/services/notifications.test.ts` checks participant targeting, acceptance versus assignment receipt, generic text, terminal states, audience isolation, permission denial/revocation, duplicate/concurrent updates, persisted restart deduplication, first-load baselining, native failure retry, burst limits, disposal, and safe tap payloads.

These tests exercise the real policy/coordinator with a fake OS notification port. They do not prove native banner/sound behavior or physical Bluetooth reception. Native rebuild and physical device testing for this addition remain required.

### Physical acceptance test

1. Install the new native build on phones A and B. Turn off Wi-Fi/cellular, leave Bluetooth on, keep both apps open, and enable Help notifications.
2. A sends SOS. B should get one **New help request** alert. Tap it and verify the correct request opens.
3. B offers help. A should get **Someone offered to help**. A accepts; B should get **Your offer was accepted**. A gets **Volunteer confirmed** only after the actual assignment-receipt state arrives.
4. Disconnect/reconnect B and open the screens repeatedly: the same events should not alert again. A new SOS or new offer should still alert. Reopen both apps: restored history should remain quiet.
5. Deny OS permission and repeat: SOS and offers still work, with no banner. Restore permission in Settings and send a new request to test recovery.
6. Repeat in a private group. An inactive group's history must not alert or open as public data. Tap an older group notification while another audience is active: the app should ask you to select the original audience.
7. Check sound/banner with Focus/Do Not Disturb disabled. Separately measure foreground, background, locked, and force-closed behavior on each platform; do not infer background reliability from a foreground success.
