# Native transport validation — 2026-10-17

## Scope and evidence

This validation exercises actual Swift/Kotlin framing implementations and compiles the native Android module against the generated Expo SDK 54 / React Native 0.81 project. It does not substitute fake Bluetooth traffic for physical device tests.

- Swift framing: passed 28 payload-size/MTU round trips, canonical wire vector, empty/oversized payload rejection, malformed/version/order/duplicate/capacity rejection, monotonic expiration immediately before and at 90 seconds, and a clean retry after a corrupt continuation.
- Kotlin framing: the same boundary/vector/negative/deadline/recovery tests passed using Kotlin 2.1.20 on installed Temurin JDK 21.0.5.
- Revised Swift transport: CoreBluetooth API typecheck passed using Xcode SDK and a minimal Expo Promise stub; this is not an iOS app build.
- Android Gradle module compilation: **passed** (`:beacon-ble:compileDebugKotlin`, 45 tasks executed, 3m 3s) against actual Expo Modules Core and Android SDK classes.
- Android standalone release APK build: in progress.
- Physical BLE transfer, radio toggling, multi-hop delivery, and iPhone/Android interoperability: not established by these tests. Follow the hardware acceptance procedure in `NATIVE_TRANSPORT.md`.

## Repairs reviewed

Android now retries failed GATT service registration and advertising on its two-second maintenance cycle. A publication callback that never arrives triggers a transport restart after 20 seconds. Scan/advertising attempts and GATT server callbacks carry lifecycle identity so old callbacks cannot revive stopped sessions. GATT client callbacks also require the current connection object. An incoming disconnect/timeout during a notification retires the complete transport generation because Android's notification completion identifies only a device; outstanding promises reject before retrying the durable application queue.

iOS uses monotonic uptime for partial-frame expiration, connection setup, queued-send age, and reconnect cooldowns. Start after stop creates fresh CoreBluetooth managers; callbacks check manager, service, peripheral, and characteristic identity as applicable. Failed advertising retries during maintenance. A closing peripheral is held out of discovery until cancellation completes; if no cancellation callback arrives within 20 seconds, the central manager is replaced before retry. Both implementations bound concurrent reassemblies and pending sends and recover from malformed continuations.

The native layer does not establish application identity or authenticated delivery. Concurrent role sessions remain independent and bounded. The shared protocol rejects self-contact and deduplicates signed event IDs. Native send completion does not prove remote durable persistence.

## Toolchain and reproduction

The installed JDK is `/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home`. Official Google command-line tools were downloaded from `https://dl.google.com/android/repository/commandlinetools-mac_arm64-16111833_latest.zip`; its SHA-1 matched the Google repository metadata: `ad03dc49bfacfd52c110b14104ea548b8a07e830`.

The current official SDK manager bootstrapped its CLI under `~/.android`; that newly created directory was moved to `.tooling/android-user-home` after installation, and subsequent builds explicitly set `ANDROID_USER_HOME` there. The local SDK resides under `.tooling/android-sdk` and Gradle cache under `.tooling/gradle`. Installed components: Android platform 36, build tools 36.0.0 and dependency-requested 35.0.0, platform tools, NDK 27.1.12297006, and CMake 3.22.1. No global package manager or npm package installation was used in this validation.

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
