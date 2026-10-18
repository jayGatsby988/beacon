# Release and handoff checklist

Current deliverable is a research/test build, not a certified emergency service. No hosting, paid build service, public release, or deployment is performed by the scripts below.

## Reproducible checks

Use Node.js 24 and the committed `package-lock.json`:

```sh
npm ci
bash scripts/check-workspace.sh
python3 scripts/test-native-framing.py --language all
```

The workspace script requires Node 24, then runs typechecks, all test suites, and lint if defined. Native framing checks compile the actual source into a temporary directory and remove it afterward. Swift requires Xcode tools on macOS. Kotlin uses `KOTLINC`/`kotlinc` when supplied or the exact Kotlin 2.1.20 compiler dependencies already downloaded by the documented Android build. It does not install a compiler.

The repository-root workflow [`.github/workflows/beacon-ci.yml`](../../.github/workflows/beacon-ci.yml) runs Node 24 with `npm ci` on Ubuntu and Swift framing on macOS. Both jobs execute inside `beacon/`. It is **manual-only** (`workflow_dispatch`): pushes and pull requests do not launch hosted jobs. Actions are pinned to official release commit hashes and receive read-only repository permissions. CI has no deployment credentials or release step. Local execution passed typechecks, lint, and 50 tests with a real isolated Timescale database (zero skipped). Without a test database URL, 49 pass and that one database test is explicitly skipped. Both Swift and Kotlin framing suites also passed through the new runner. The hosted workflow has not been run. Local checks do not use paid hosted runners. A maintainer may manually run hosted checks only within the account’s existing Actions budget; do not enable paid capacity or trigger a run without confirming that budget. Record a successful hosted result if a manual run is performed.

## Android test artifact

- [x] Actual BLE module and complete ARM64 release variant compile against Expo SDK 54 / RN 0.81.5 / Android API 36.
- [x] Replacement APK built after SVG deduplication and final map-cancellation fixes; signature, embedded JS, native module, ARM64 libraries, and exact bundled-source correspondence verified. Earlier APKs are superseded. Android startup remains unverified.
- [ ] Run the physical [device acceptance checklist](DEVICE_ACCEPTANCE.md); no Android hardware test has been recorded.
- [ ] For public distribution, configure an appropriate release signing identity and package policy. The current release variant uses the generated **debug signing key** and development package ID, so it is a local installation artifact.

Rebuild only after dependencies, generated native projects, and signing configuration are ready:

```sh
# If the generated Android directory is absent, from apps/mobile:
npx expo prebuild --platform android --no-install
# From the beacon/ workspace directory:
bash scripts/build-android-release.sh
```

The build script uses existing SDK/JDK tooling, assembles ARM64 with embedded JS, verifies the result, and copies it to `dist/android/beacon-community-arm64.apk`. It does not run npm installation, prebuild, or signing-key setup. `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_USER_HOME`, and `GRADLE_USER_HOME` can override local defaults. The exact toolchain and current artifact hash are in [NATIVE_VALIDATION.md](NATIVE_VALIDATION.md).

Inspect an existing APK without rebuilding:

```sh
python3 scripts/verify-android-apk.py dist/android/beacon-community-arm64.apk
```

The verifier checks ZIP integrity, configured package name, a verified APK v2-or-newer signature, embedded JS, Beacon DEX class, and ARM64 libraries. It does not claim startup, BLE, map, or permission behavior.

## iOS gate

- [x] Swift framing tests and CoreBluetooth source/API typecheck pass.
- [x] Full iOS simulator release build passes after dependency deduplication and native location normalization. Resumed UI checks verified setup, SOS creation, visible native UW map and cancellation. See [VALIDATION.md](VALIDATION.md).
- [x] After the user signed into Xcode, a Personal Team development-signed Release build with embedded JavaScript installed on the connected iPhone 17 Pro Max. No paid enrollment was used. `scripts/build-ios-device.sh` reproduces the build with explicit device/team inputs.
- [x] Launch on the phone succeeded after the initial security/profile-trust denial; its process was observed running 19 seconds later.
- [ ] Execute physical permission, offline map, BLE, restart, and three-phone acceptance cases. Installation and process launch do not establish these behaviors.

A simulator cannot validate Bluetooth radio behavior. Declaring background modes does not establish reliable background relaying; retain the foreground limitation until measured otherwise.

## Remaining release blockers

- [ ] **Physical reliability:** no recorded two/three-phone BLE transfer, cross-platform interoperability, return receipt, interruption, or restart-durability run. Report measured results rather than claiming delivery guarantees.
- [ ] **Dependency risk:** the documented audit reports unresolved vulnerable dependencies, including a mobile URL-decoding path with a native-intent mitigation. Review [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md), validate mitigations through actual OS links, and resolve or explicitly accept remaining risks before broader distribution. Do not apply `npm audit fix --force` to the SDK-constrained app.
- [ ] **Cloud evidence, if cloud is included:** real local Timescale/PostgreSQL integration and authenticated HTTP checks pass. No hosted HTTPS/mobile end-to-end verification exists. Keep cloud disabled/unconfigured until the database/API contract and authenticated sync are tested; offline BLE does not depend on this deployment.
- [ ] **State semantics:** preserve separate local save, native send, remote receipt, volunteer offer, requester acceptance, and terminal-update status. Current terminal updates lack recipient confirmations and must remain labeled accordingly.
- [ ] **Privacy and operations:** review the self-generated identity model, plaintext relay payloads, bounded queues, expiry, retention, and denial-of-service limits documented in [SECURITY_REVIEW.md](SECURITY_REVIEW.md). Do not present identity signatures as verified personal identities or assistance guarantees.
- [ ] Archive artifact hash, toolchain, test output, actual device matrix, and observed failures with the eventual release record.
