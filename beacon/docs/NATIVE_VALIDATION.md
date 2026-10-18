# Native transport validation — 2026-10-17

## Scope and evidence

This validation exercises actual Swift/Kotlin framing implementations and compiles the native Android module against the generated Expo SDK 54 / React Native 0.81 project. It does not substitute fake Bluetooth traffic for physical device tests.

- Swift framing: passed 28 payload-size/MTU round trips, canonical wire vector, empty/oversized payload rejection, malformed/version/order/duplicate/capacity rejection, monotonic expiration immediately before and at 90 seconds, and a clean retry after a corrupt continuation.
- Kotlin framing: the same boundary/vector/negative/deadline/recovery tests passed using Kotlin 2.1.20 on installed Temurin JDK 21.0.5.
- Revised Swift transport: CoreBluetooth API typecheck passed using Xcode SDK and a minimal Expo Promise stub; this is not an iOS app build.
- Android Gradle module compilation: **passed** (`:beacon-ble:compileDebugKotlin`, 45 tasks executed, 3m 3s) against actual Expo Modules Core and Android SDK classes.
- Android standalone ARM64 release APK: **passed** after SVG deduplication and the final map-cancellation fix. Clean regenerated project build: 1m 51s; final incremental build: 27s, 657 tasks (12 executed, 645 up-to-date). Release vital lint passed. The reusable release script produced and verified the copied artifact.
- Physical BLE transfer, radio toggling, multi-hop delivery, and iPhone/Android interoperability: not established by these tests. Follow the hardware acceptance procedure in `NATIVE_TRANSPORT.md`.

## Repairs reviewed

Android now retries failed GATT service registration and advertising on its two-second maintenance cycle. A publication callback that never arrives triggers a transport restart after 20 seconds. Scan/advertising attempts and GATT server callbacks carry lifecycle identity so old callbacks cannot revive stopped sessions. GATT client callbacks also require the current connection object. An incoming disconnect/timeout during a notification retires the complete transport generation because Android's notification completion identifies only a device; outstanding promises reject before retrying the durable application queue.

iOS uses monotonic uptime for partial-frame expiration, connection setup, queued-send age, and reconnect cooldowns. Start after stop creates fresh CoreBluetooth managers; callbacks check manager, service, peripheral, and characteristic identity as applicable. Failed advertising retries during maintenance. A closing peripheral is held out of discovery until cancellation completes; if no cancellation callback arrives within 20 seconds, the central manager is replaced before retry. Both implementations bound concurrent reassemblies and pending sends and recover from malformed continuations.

The native layer does not establish application identity or authenticated delivery. Concurrent role sessions remain independent and bounded. The shared protocol rejects self-contact and deduplicates signed event IDs. Native send completion does not prove remote durable persistence.

## Toolchain and reproduction

The installed JDK is `/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home`. Official Google command-line tools were downloaded from `https://dl.google.com/android/repository/commandlinetools-mac_arm64-16111833_latest.zip`; its SHA-1 matched the Google repository metadata: `ad03dc49bfacfd52c110b14104ea548b8a07e830`.

The current official SDK manager bootstrapped its CLI under `~/.android`; that newly created directory was moved to `.tooling/android-user-home` after installation, and subsequent builds explicitly set `ANDROID_USER_HOME` there. The local SDK resides under `.tooling/android-sdk` and Gradle cache under `.tooling/gradle`. Installed components: Android platform 36, build tools 36.0.0 and dependency-requested 35.0.0, platform tools, NDK 27.1.12297006, and CMake 3.22.1. No global package manager or npm package installation was used in this validation. Android tooling recreated a global analytics-settings file during the build; it was relocated into the local tool directory afterward.

From `apps/mobile/android` after Expo prebuild:

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
ANDROID_HOME="$PWD/../../../.tooling/android-sdk" \
ANDROID_USER_HOME="$PWD/../../../.tooling/android-user-home" \
GRADLE_USER_HOME="$PWD/../../../.tooling/gradle" \
./gradlew :beacon-ble:compileDebugKotlin --no-daemon --max-workers=2
```

Swift framing reproduction from repository root:

```sh
xcrun swiftc apps/mobile/modules/beacon-ble/ios/BeaconFrame.swift \
  apps/mobile/modules/beacon-ble/tests/main.swift -o /tmp/beacon-frame-test
/tmp/beacon-frame-test
```

Kotlin tests can use the `kotlinc` command shown in `NATIVE_TRANSPORT.md`. This validation instead invoked `org.jetbrains.kotlin.cli.jvm.K2JVMCompiler` using the Kotlin 2.1.20 compiler and dependencies downloaded by Gradle, then ran `expo.modules.beaconble.FrameTestKt` against the generated classes and Kotlin standard library.

## Verified replacement Android artifact

This artifact **replaces all earlier APKs**. A duplicate React Native SVG installation caused an observed iOS simulator startup crash; Android was rebuilt after deduplicating to one SVG 15.12.1 installation. Android startup has not been tested. The final bundle includes the completed map-cancellation and Settings fixes.

Current artifact: `dist/android/beacon-community-arm64.apk` (also present at the generated Gradle output `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`). Build log and machine-readable verification are beside the copied APK.

- Package: `org.beacon.community.dev`, version `0.1.0` / code `1`.
- Architecture: ARM64 (`arm64-v8a`); minimum Android API 24, target API 36.
- APK size: 65,729,747 bytes.
- SHA-256: `2c31c10db720d7ed14f5e8561d4f5c2cf77704e91ef80abd95642ce1905408d0`.
- `apksigner verify --verbose`: passes APK Signature Scheme v2. The generated Expo release variant uses its local debug signing key; this is an installable test artifact, not a production distribution signature.
- Embedded `assets/index.android.bundle`: 4,925,228 bytes.
- DEX inspection confirms `expo.modules.beaconble.BeaconBleModule` is packaged. Native shared libraries are ARM64.
- APK manifest confirms Bluetooth scan, advertise, and connect permissions; legacy Bluetooth permissions are capped at API 30.
- Source-map verification: all 25 bundled local source files exactly match current source, including `MapService`, `BeaconService`, and Settings. The APK bundle byte-matches the generated build output.
- SVG verification: 111 bundled SVG source files all resolve from one root `node_modules` installation; native autolinking also resolves that single SVG 15.12.1 package.
- Machine verification includes the package-lock SHA-256 and records `physical_device_tested: false`.

Build reproduction from repository root:

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
ANDROID_HOME="$PWD/.tooling/android-sdk" \
ANDROID_USER_HOME="$PWD/.tooling/android-user-home" \
GRADLE_USER_HOME="$PWD/.tooling/gradle" \
CI=1 NODE_ENV=production \
apps/mobile/android/gradlew -p apps/mobile/android :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
```

No Android physical device was connected for this validation; APK packaging and signatures do not prove startup behavior, permission UX, Bluetooth transfers, or offline map behavior.

## Reusable tooling

`python3 scripts/test-native-framing.py --language all` reproduces both native framing suites without a full app build, using temporary outputs. `python3 scripts/verify-android-apk.py dist/android/beacon-community-arm64.apk` verifies the existing artifact. Both commands passed after these scripts were added. The release build helper `bash scripts/build-android-release.sh` was executed successfully for the replacement APK using Node 24 and two Gradle workers. See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for CI, signing, and device gates.

## iOS Simulator release artifact

Full Xcode 26.0.1 Release simulator app builds passed, including BeaconBle Swift and MapLibre. The final reproducible script is `scripts/build-ios-simulator.sh`. It performs ordinary simulator ad-hoc signing (required for SecureStore), verifies code signatures, checks the embedded JavaScript bundle and writes `dist/ios/beacon-simulator.zip`. No Apple account is needed for Simulator; physical iPhone provisioning remains blocked.

Final simulator archive SHA-256: `04af4065a55dc6233ebaee1aee619bb887fd15366aa290c045719a4be9698dd1`.

Actual setup UI, test-name entry, location permission, unavailable-Bluetooth status and SQLite initialization were observed. The Mac locked before setup completion/home/SOS/map interactions; these remain unverified visually. See `VALIDATION.md`. This archive is not a physical-device IPA.
