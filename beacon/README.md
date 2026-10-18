# Beacon

Community help when connectivity disappears. Beacon is an iPhone/Android app with a simple SOS interface, real native Bluetooth transport, persistent queues, and explicit volunteer assistance confirmation.

> Research/test build. Beacon does not contact emergency services, verify a volunteer's qualifications, guarantee delivery, or guarantee that help will arrive. Keep participating apps open for the most dependable operation.

## What is implemented

- **I need help:** one tap saves and queues an SOS after setup. Category, note, location and place description are optional.
- **Help nearby:** actual received requests, volunteer offers, requester acceptance, and separate helper assignment receipts.
- **Honest status:** waiting, forwarded, received, offered, accepted and confirmed remain distinct. Last confirmed state survives restart/disconnection.
- **Real transport:** Swift CoreBluetooth and Kotlin Android GATT scan/advertise/connect/send/receive, bounded fragmentation, retries and reconnection. No Expo Go or simulated transport in the shipped app.
- **Durability:** SQLite transactions persist signed messages, deduplication, derived state, forwarding history and upload outbox; SecureStore protects device keys and cloud tokens.
- **Offline request maps:** a bundled OpenStreetMap UW campus geometry extract works without external tiles/fonts/sprites. Coordinates and location accuracy remain visible. Optional provider regions use MapLibre downloads.
- **Secondary tools:** connection diagnostics, actual local event history, redacted diagnostic export, settings, and optional authenticated incident replay/summary after connectivity returns.
- **Optional backend:** Express API, PostgreSQL/Timescale migrations, scoped enrollment tokens, idempotent ingestion, replay pagination, late aggregate refresh, container and Vultr/Caddy configuration. No hosted service is provisioned by this repository.

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

For a physical iPhone, open `ios/Beacon.xcworkspace`, select your own development team in Signing & Capabilities, connect and trust the phone, enable Developer Mode, then build. No Apple credential is included in this repository. This workspace's attempted physical install was blocked by missing account/provisioning setup; a certificate alone was insufficient.

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

The latest measured build, startup and interaction results are recorded in [VALIDATION.md](docs/VALIDATION.md). The automated suite passes **48 tests with the real local Timescale test database configured**. A normal run without a database URL passes 47 and explicitly skips that one integration test. Both app TypeScript checks and ESLint pass. Swift and Kotlin framing suites each pass 28 payload/MTU round trips and malformed/order/timeout/capacity/recovery cases. Three-node application tests use explicitly synthetic radio links and actual disk-backed SQLite; they are not evidence of physical radio behavior.

Native Android and iOS simulator compilation passed. The replacement Android APK includes the SVG deduplication and final map fixes; physical Android startup remains untested. Only one iPhone was available, with installation blocked by signing setup. **Real three-phone BLE relaying, Android/iPhone interoperability, hosted cloud deployment, and production performance remain unverified. Local Timescale migrations and authenticated HTTP ingestion/replay were verified.** Unresolved dependency advisories and native-intent mitigations are recorded in [DEPENDENCY_AUDIT.md](docs/DEPENDENCY_AUDIT.md).

Hosted CI is manual-only to avoid consuming private-repository runner minutes automatically. All local checks run without paid services.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Native transport](docs/NATIVE_TRANSPORT.md)
- [Design](docs/DESIGN.md) · [Brand and logo](docs/BRAND.md) · [Map license](apps/mobile/assets/maps/LICENSE.md)
- [Native build evidence](docs/NATIVE_VALIDATION.md) · [Security review](docs/SECURITY_REVIEW.md)
- [Local Timescale evidence and reproduction](docs/LOCAL_TIMESCALE_VALIDATION.md)
- [Device acceptance](docs/DEVICE_ACCEPTANCE.md) · [Release checklist](docs/RELEASE_CHECKLIST.md)

Production readiness needs a separate validation phase: multi-device and background/foreground reliability, battery and storage-pressure tests, privacy/security review, supported-device accessibility, secure distribution signing, and optional live cloud operation. A reasonable planning range is several weeks (roughly 4–8 for a small experienced team), adjusted by measured failures and distribution scope; tonight's build cannot establish those properties.
