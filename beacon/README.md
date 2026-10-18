# Beacon

Community help when connectivity disappears. Beacon is an iPhone/Android app with SOS requests, encrypted nearby messages, private groups, real native Bluetooth transport, and persistent queues.

> Research/test build. Beacon does not contact emergency services, verify a volunteer's qualifications, guarantee delivery, or guarantee that help will arrive. Keep participating apps open for the most dependable operation.

## What is implemented

- **Help:** one tap saves and queues an SOS after setup. Optional details stay collapsed. Incoming requests, volunteer offers, requester acceptance, and helper confirmation are reached here.
- **Nearby:** opens a People list for direct conversations, with a separate Map view. It discovers participating Beacon apps, not arbitrary phones. Audience selection stays visible; advanced tools are under Settings.
- **Encrypted direct messages:** ciphertext is saved for reconnect retry. Received requires an authenticated acknowledgment after recipient persistence, not a Bluetooth write or a read receipt. Delivery expires after 24 hours; local history remains for seven days after expiry.
- **Private groups:** create or join an invite-based group. Only the selected scope is active. Group SOS uses encrypted Bluetooth packets and a separate database without cloud event/outbox entries; it can relay through phones in that same active group. Direct messages remain one-to-one and require direct contact. Sharing the invite grants membership; no revocation or forward secrecy is claimed. See [Nearby messages and private groups](docs/NEARBY_GROUPS.md).
- **Honest status:** waiting, forwarded, received, offered, accepted and confirmed remain distinct. Last confirmed state survives restart/disconnection.
- **Real transport:** Swift CoreBluetooth and Kotlin Android GATT scan/advertise/connect/send/receive, bounded fragmentation, retries and reconnection. No Expo Go or simulated transport in the shipped app.
- **Durability:** SQLite transactions persist signed requests, encrypted direct-message packets, deduplication, derived state and forwarding history. Only Nearby SOS events enter the optional upload outbox. SecureStore protects device keys, group invites and cloud tokens.
- **Offline request maps:** expanded bundled OpenStreetMap UW geometry renders without external tiles/fonts/sprites. Position markers remain available outside street coverage. The optional **Save my area** flow is implemented but currently fails native provider requests; see [the measured limitation](docs/NEARBY_GROUPS.md). Saved area bounds stay on the phone.
- **Nearby map:** opt-in location reports from connected Beacon users, with age/accuracy and 120-second expiry. Shared peer positions stay in memory, and sharing stops on background or group change. Saved maps open by default; a free online map is optional. **Find people** refreshes discovery without dropping working links.
- **Secondary tools:** connection diagnostics, actual local event history, redacted diagnostic export, settings, and optional authenticated incident replay/summary after connectivity returns.
- **Optional backend:** Express API, PostgreSQL/Timescale migrations, scoped enrollment tokens, idempotent ingestion, replay pagination, late aggregate refresh, container and Vultr/Caddy configuration. No hosted service is provisioned by this repository.

All participating phones need the updated native build for people, messages, and groups; existing SOS-only binaries do not contain this flow.

This is an AI-assisted mock-hackathon/research build. Authorized GitHub account rotation is a workflow exercise, not evidence of independent human authorship. Six specialist AI workstreams contributed implementation and review; the root task integrated and verified their work.

## Quick start

From this directory (`beacon/` inside the Git repository):

```sh
# Node.js 24; use nvm use if nvm is installed
npm ci
bash scripts/check-workspace.sh
```

Node 24 is pinned in `.nvmrc`. The checks run strict mobile/API TypeScript, protocol/security/persistence/integration/API tests, and ESLint. Native framing checks use installed Xcode and Kotlin tooling:

```sh
python3 scripts/test-native-framing.py --language all
```

### iPhone and simulator

Requires macOS, Xcode and CocoaPods. From `apps/mobile`:

```sh
npx expo prebuild --platform ios --no-install
cd ios
pod install
cd ..
npx expo run:ios --configuration Release
```

For a physical iPhone, open `ios/Beacon.xcworkspace`, select your own development team in Signing & Capabilities, connect and trust the phone, enable Developer Mode, then build. No Apple credential is included in this repository. On October 17, 2026, an earlier Personal Team development-signed SOS Release build installed successfully on the connected iPhone 17 Pro Max. This predates the messaging/group update. Launch may require the user to trust the development profile in iPhone Settings → General → VPN & Device Management.

Beacon uses Expo with custom native Bluetooth and MapLibre modules. **Expo Go cannot run it.** The installed Release app includes its JavaScript and opens from its own icon without a development server. To reproduce the device build from this directory with your existing Xcode account:

```sh
bash scripts/build-ios-device.sh --device YOUR_DEVICE_UDID --team YOUR_TEAM_ID
xcrun devicectl device install app --device YOUR_DEVICE_UDID \
  tmp/DerivedData/Build/Products/Release-iphoneos/Beacon.app
```

Two narrow Expo SDK 54 shell-path fixes are committed so a checkout containing spaces can build: an idempotent postinstall patch for Expo Constants and a config plugin for the React Native bundle phase. Both quote script paths; they do not bypass signing or security checks.

### Android

Requires JDK 21 and Android SDK 36. From `apps/mobile`, generate the project with `npx expo prebuild --platform android --no-install`, then run from this directory:

```sh
bash scripts/build-android-release.sh
```

The script builds and verifies `dist/android/beacon-community-arm64.apk` with embedded JavaScript. The generated Expo release variant uses a local debug signing key; this is a test installation artifact, not public-store signing. The app does not need Metro to run. `npm run mobile` is available for normal dev-client iteration.

### Optional cloud

Local SOS and BLE do not require any backend, online account or map key. Leave cloud settings empty for local use. See [BACKEND.md](docs/BACKEND.md) for database migration, enrollment, API and deployment configuration. Deploying may incur provider charges; no Vultr/Tiger Data resources were created and no paid build service was used. Local incident events remain saved until configured uploads receive durable acknowledgments.

## Verification and boundaries

Current measured checks, native builds, and device interactions are recorded in [VALIDATION.md](docs/VALIDATION.md). The automated suite covers protocol validation, persistence, startup resilience, messaging acknowledgments, and private-group isolation. New messaging/group tests use actual service code and disk-backed SQLite with explicitly mocked Bluetooth; they do not establish physical radio behavior. See [the feature verification details](docs/NEARBY_GROUPS.md#verification).

**Dated baseline, October 17, 2026:** Android and iOS native compilation passed. The earlier Android APK included SVG deduplication, map fixes, and native location normalization; physical Android startup remained untested. A signed SOS build installed and launched on an iPhone 17 Pro Max. Simulator interaction verified SOS creation, native map display, cancellation, and history. Later physical SOS reception and receiver-acknowledgment observations are recorded separately in the validation log. These results predate the new messaging/group binaries and do not prove that the updated app is installed or physically tested.

Swift and Kotlin framing suites cover payload/MTU round trips and malformed/order/timeout/capacity/recovery cases. Real local Timescale migrations and authenticated HTTP ingestion/replay were verified. **Three-phone physical BLE relaying, Android/iPhone interoperability, physical messaging/group delivery, hosted cloud deployment, and production performance remain unverified unless later evidence explicitly records them.** Unresolved dependency advisories and native-intent mitigations are recorded in [DEPENDENCY_AUDIT.md](docs/DEPENDENCY_AUDIT.md).

Hosted CI is manual-only to avoid consuming private-repository runner minutes automatically. All local checks run without paid services.

## Documentation

- [Nearby messages and private groups](docs/NEARBY_GROUPS.md)
- [Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Native transport](docs/NATIVE_TRANSPORT.md)
- [Design](docs/DESIGN.md) · [Brand and logo](docs/BRAND.md) · [Map license](apps/mobile/assets/maps/LICENSE.md)
- [Native build evidence](docs/NATIVE_VALIDATION.md) · [Security review](docs/SECURITY_REVIEW.md)
- [Simulator UI checks and map screenshot](docs/SIMULATOR_UI_VALIDATION.md)
- [Local Timescale evidence and reproduction](docs/LOCAL_TIMESCALE_VALIDATION.md)
- [Device acceptance](docs/DEVICE_ACCEPTANCE.md) · [Release checklist](docs/RELEASE_CHECKLIST.md)

Production readiness needs a separate validation phase: multi-device and background/foreground reliability, battery and storage-pressure tests, privacy/security review, supported-device accessibility, secure distribution signing, and optional live cloud operation. A reasonable planning range is several weeks (roughly 4–8 for a small experienced team), adjusted by measured failures and distribution scope; tonight's build cannot establish those properties.
