# Beacon native BLE transport

This local Expo module implements actual CoreBluetooth central/peripheral roles on iOS and Android BLE scanner/advertiser/GATT client/GATT server roles. There is no simulated transport or Expo Go fallback. The intended first mode is foreground, installed standalone apps with Bluetooth enabled and all other connectivity disabled.

## Integration

SDK 54 / React Native 0.81 are selected by the app. The module uses the installed Expo Modules Core Promise APIs and local module autolinking. Its podspec requires iOS 15.1 or later; SDK 54 itself may require a higher app deployment target. Android SDK/AGP/Kotlin versions come from the parent Expo project. Build from `apps/mobile` with `npx expo prebuild` then `npx expo run:ios` / `npx expo run:android`. Production offline demonstrations need a release build with the JavaScript bundle included, not a Metro-dependent development launch.

Import the default native module from `modules/beacon-ble`. Subscribe to events before `start`:

```ts
const dataSubscription = BeaconBle.addListener('onData', ({peerId, base64}) => { /* validate + persist in shared protocol */ });
await BeaconBle.start({nodeId});
await BeaconBle.send(peerId, base64);
await BeaconBle.stop();
dataSubscription.remove();
```

API:

- `start({nodeId, serviceUuid?})`: enable both roles, return current state. Radio initialization and advertising are asynchronous; observe subsequent `onState` and `onError`.
- `stop()`: stop advertising/scanning, cancel sessions, reject queued sends.
- `getState()`: current `state`, `advertising`, `scanning`. Before native initialization, state is `unknown`.
- `send(peerId, base64)`: accepts 1–16,384 decoded bytes, rejects malformed input, missing session, or a full queue.
- `onPeer`: transient session `peerId`; `discovered`, `connected` (notification channel established), or `disconnected`; optional `rssi`, `mtu`.
- `onData`: reassembled complete application message `{peerId, base64}`.
- `onState`: `poweredOn`, `poweredOff`, `unauthorized`, `unsupported`, `unknown`, plus actual advertising/scanning flags.
- `onError`: actionable `code`, `message`, optional `peerId`.

`nodeId` is validated but deliberately not advertised or interpreted by the native layer. The shared TypeScript protocol sends the versioned node-identity handshake after each `connected` event, validates it, rejects self-contact, and deduplicates signed application events. The transport never equates a Bluetooth address with persistent application identity. Both phones can connect to each other simultaneously; these are independent bounded sessions that may resolve to the same application node. The native transport does not collapse sessions based on an unchallenged identity announcement; durable signed event deduplication remains the correctness boundary.

### Permissions

On iOS the app must set `NSBluetoothAlwaysUsageDescription` before starting. CoreBluetooth prompts when initialized. Missing usage descriptions can terminate an iOS app. No background mode is requested by this module.

On Android request runtime `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` on API 31+, or `ACCESS_FINE_LOCATION` on API 30 and older, before `start`. On older Android versions system Location must also be enabled for scanning. The module manifest declares these permissions. `neverForLocation` states that Beacon does not infer physical location from BLE observations; GPS permissions are independently used by the app. The location declaration intentionally has no max SDK restriction to avoid disabling the app's separate GPS location feature during manifest merging.

A phone without peripheral advertising support reports `ADVERTISE_UNSUPPORTED`; its scanner/client can still connect to another advertising phone. This capability difference must be tested on actual target hardware.

## Shared transport frame v1

Fixed UUIDs:

| Purpose | UUID |
| --- | --- |
| Service | `7C51A100-1B15-4F0D-9B8D-0E4B8D638010` |
| Write with response | `7C51A101-1B15-4F0D-9B8D-0E4B8D638010` |
| Notify | `7C51A102-1B15-4F0D-9B8D-0E4B8D638010` |
| Android client configuration descriptor | `00002902-0000-1000-8000-00805F9B34FB` |

Each GATT value contains a 12-byte header followed by nonempty payload. Multi-byte fields are unsigned big endian.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 1 | Magic `B7` |
| 1 | 1 | Transport frame version `01` |
| 2 | 4 | Per-direction message sequence, randomized initial value |
| 6 | 2 | Zero-based fragment index |
| 8 | 2 | Fragment count |
| 10 | 2 | Complete decoded message byte length |
| 12 | variable | Payload |

Canonical vector for payload `abc`, sequence `0x12345678` is `b7 01 12 34 56 78 00 00 00 01 00 03 61 62 63`. Transport IDs are session-local; signed application event IDs supply durable identity and deduplication.

Outgoing values are at most `min(platform write limit, 512)` bytes. Android requests MTU 185, uses the callback-reported negotiated value minus three, and falls back to 23 when negotiation fails. iOS uses `maximumWriteValueLength(.withResponse)` or the subscribed central's `maximumUpdateValueLength`. A default MTU 23 permits 20-byte values with 8 payload bytes. Larger negotiated values improve throughput; no fixed MTU is assumed.

The parser rejects invalid versions, missing/out-of-order/duplicate fragments, inconsistent totals, oversized messages, excessive concurrent partial messages, and values over 512 bytes. It emits only an exactly complete message. Integrity/authentication and replay protection belong to the shared signed application protocol; this framing is not encryption and GATT access is not authenticated.

## Bounds, completion, and recovery

| Resource | Limit / behavior |
| --- | --- |
| Complete message | 16 KiB (application packets should usually be much smaller) |
| Per-peer pending messages | 8, including active message |
| Outgoing connections | 4 |
| Incoming sessions | 4 |
| Concurrent reassemblies per session | 2 |
| Partial reassembly age | 90 seconds |
| Send age | 90 seconds, including time queued |
| Connection setup | 20 seconds |
| Reconnect cooldown | 2, 4, 8, 16, 32 seconds; later advertisements retrigger connection |
| Maintenance | Every 2 seconds while started |

All native state transitions and callback processing are serialized on the main thread. Timeout and reconnect deadlines use monotonic clocks on both platforms, so changing the phone clock cannot extend retained partials or queued sends. Android callbacks are scoped to a lifecycle generation and scan/advertising attempt; service publication failures retry on maintenance, and a missing publication callback forces a transport restart after 20 seconds. If an Android incoming connection closes during a pending notification, the transport retires the server callback generation and rejects all sessions, preventing a late device-only completion from completing a replacement session’s send. iOS creates fresh managers on restart and checks manager/service/characteristic identity before acting on asynchronous callbacks; failed advertising retries on maintenance. Outgoing iOS reconnects wait for cancellation completion; a missing cancellation callback retires the central manager after 20 seconds. Android GATT setup waits for each MTU/discovery/descriptor callback. Client fragments wait for `onCharacteristicWrite` / `didWriteValueFor`. Android server notifications are globally serialized and wait for `onNotificationSent`. iOS server notification production pauses when `updateValue` returns false and resumes in `peripheralManagerIsReady(toUpdateSubscribers:)`.

A resolved send means that client writes completed or the native notification path accepted/completed all fragments. In particular **CoreBluetooth has no per-notification delivery callback**; on iOS peripheral sends, resolution means its transmit queue accepted the fragments. Neither platform's send resolution proves remote application persistence or human receipt. Only a validated application receipt after durable storage establishes that evidence.

Disconnection, timeout, radio loss, and stop reject outstanding sends and discard session reassembly. The shared durable outbox must retry by whole application message on a later handshake. Android can explicitly cancel an incoming GATT connection; iOS peripheral APIs cannot forcibly disconnect a subscribed central, so a timed-out incoming session is discarded and rejects subsequent writes until the central unsubscribes/reconnects. Duplicate application deliveries are expected and must be deduplicated by the shared protocol.

## Verification and outstanding physical tests

Implemented deterministic native framing tests in `apps/mobile/modules/beacon-ble/tests`. Run from repo root:

```sh
xcrun swiftc apps/mobile/modules/beacon-ble/ios/BeaconFrame.swift apps/mobile/modules/beacon-ble/tests/main.swift -o /tmp/beacon-frame-test
/tmp/beacon-frame-test
kotlinc apps/mobile/modules/beacon-ble/android/src/main/java/expo/modules/beaconble/BeaconFrame.kt apps/mobile/modules/beacon-ble/tests/FrameTest.kt -include-runtime -d /tmp/beacon-frame-test.jar
java -jar /tmp/beacon-frame-test.jar
```

Observed during implementation: Swift framing passed 28 boundary-size/MTU round trips, canonical vector, malformed/version/order/duplicate/size/capacity/expiry rejection. The full CoreBluetooth transport typechecked against the installed Xcode 26.0.1 macOS SDK using only a minimal Expo Promise stub. That is source/API validation, not an iOS app build or BLE hardware validation. The installed Expo Modules Core Promise signatures were also inspected. Expo autolinking resolve successfully discovers the local module on both Apple and Android. The follow-up validation installs Android tooling locally and runs the generated Expo Gradle project; current results and reproducible commands are recorded in `docs/NATIVE_VALIDATION.md`.

No radio behavior has been claimed verified. Shortest acceptance procedure:

1. Install release builds on two physical Android phones. Grant permissions, disable Wi-Fi/cellular, leave Bluetooth on and apps foregrounded. Confirm both roles' observed state and an application handshake.
2. Exchange small messages in both directions, then 1 KiB and 16 KiB messages. Compare exact bytes and confirm persisted application receipts independently of native send completion.
3. Turn Bluetooth off during a transfer. Confirm rejected send, disconnected session, preserved durable queue, and whole-message retry after Bluetooth returns. Restart with queued messages.
4. Repeat Android/iPhone in both connection roles, then iPhone/iPhone. Record phone models, OS builds, chosen role, negotiated MTU, failures, and elapsed time.
5. Three-phone A–B–C: physically or temporally prevent direct A–C contact; prove forwarding and return receipt with real event IDs. Repeat ten times and report the actual count.
6. Separately exercise screen lock/background/force quit and label results as observations. Foreground support does not establish background reliability.

## Primary API references

- [Expo local native modules](https://docs.expo.dev/workflow/customizing/) and [Expo Module API](https://docs.expo.dev/modules/module-api/).
- [Android BLE permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).
- [Android BluetoothGattServer](https://developer.android.com/reference/android/bluetooth/BluetoothGattServer) including API 33 value-taking notification overload.
- [Apple notification backpressure callback](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanagerdelegate/peripheralmanagerisready%28toupdatesubscribers%3A%29).
- [Apple CoreBluetooth](https://developer.apple.com/documentation/corebluetooth).
