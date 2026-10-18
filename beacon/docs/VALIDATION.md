# Beacon verification record

Implementation, automated checks, native compilation, and physical acceptance are separate evidence. This document does not infer radio delivery or rescue from a build passing.

## Map coverage and camera repair — October 18, 01:39 Pacific

The reported “Map not saved here” problem had two distinct causes. The original bundled rectangle excluded the phones’ recent reported position, while a camera guard could leave the view at an old position after returning to Nearby even though GPS refreshed. The app now includes 7,027 real OpenStreetMap features over the larger UW area and refits the camera once after the focused screen's location refresh. This does not continuously override map gestures. Shared coverage metadata is used by both Nearby and request details; old bundled-map metadata refreshes automatically on startup. The expanded geometry needs no network rendering resources. See [source and geometry validation](evidence/expanded-offline-map.json).

The actual simulator app reproduced the stale-camera failure, then verified the repair: after visiting an outside-coverage position, returning to Nearby at a point outside the old bounds but inside the expanded area centered the fresh “You” pin over streets and buildings without tapping Locate. Location sharing stayed off. This is genuine app rendering with simulated GPS, not a fabricated peer or a successful Bluetooth location exchange. The explicit locate action also refreshes local GPS without publishing it. See [native UI evidence](SIMULATOR_UI_VALIDATION.md).

The complete local Timescale workspace check passes **159 tests, zero failures, zero skips**, with mobile/API TypeScript, ESLint and real local HTTP/database checks. Tests include 25 map-service cases, local-only location refresh, and two protocol/service-to-UI tests for People rows and map pins through receipt, withdrawal, disconnect, reconnect and audience changes. OS/radio APIs and native rendering are stubbed in those automated tests; physical paired location visibility remains a separate user check.

Online **Save my area** still failed in the actual simulator: Private.coffee GET returned HTTP 500 and the one fallback request timed out. A host GET succeeded, but neither switching request method nor the tested identity-encoding header established native save success; the unproven header was reverted. No downloaded-area restart success is claimed. The bundled expanded UW area avoids that download for the covered area. Existing downloaded files now use portable filenames, and interrupted replacement/cancellation preserves the previous valid map. Saving other areas remains an unresolved limitation.

The final development-signed Release build installed on both connected iPhones. Signature verification, profile validity/device inclusion, and freshness against all 121 relevant local source/asset files pass. iOS initially denied remote launch with a Security verification error. After the user confirmed opening both manually, process checks matched each running Beacon process to its newly installed application path. Installation and startup are confirmed; paired physical pin visibility still needs its own check. See [sanitized build and phone evidence](evidence/map-coverage-camera-repair.json).

## Offline map repair and physical audio diagnosis — October 18, 01:10 Pacific

The complete workspace passes **143 tests, zero failures, zero skips**, including mobile/API TypeScript, lint, and actual local PostgreSQL/Timescale HTTP checks. Thirteen map-service regressions cover the default geometry download, stale GPS rejection, cancellation during GPS/fetch/native creation, saved-area restoration, interrupted restart, and native SDK completion rather than rounded percentages. The native host checker passes the codec/crypto/PCM pipeline and bounded diagnostic-store tests; the updated audio source also passes an arm64 iOS-targeted Swift typecheck.

The Nearby screen previously ignored saved map state and selected a remote map whenever internet was available. It now defaults to local geometry, explicitly offers the online map, preserves an existing area during replacement, and retains reported pins outside street coverage. Simulator checks rendered the bundled map in the real app, a generated saved style from a local file, and an outside-coverage request pin in labeled renderer fixtures. A real bounded UW query to Private.coffee's Overpass endpoint returned HTTP 200 in 3.24 seconds; the production converter produced 7,027 features in a 1.7 MB self-contained style. This verifies the provider response and conversion, separately from the pending physical Save my area/offline-reopen check. The initial provider returned an error and timed out; it is not used by the default save action.

A paired physical call on the preceding build established authenticated Bluetooth streams and exchanged control packets, but neither phone invoked the microphone tap: both sent and received zero audio frames. The revised native graph explicitly consumes microphone input with a sink and connects the mixer to the output using the matching voice I/O format. A three-second capture watchdog ends a stalled call with a readable error. Bounded metadata-only diagnostics persist across relaunch. This repair targets the observed capture failure; successful two-way speech still requires the revised build's physical retest.

The final signed Release build installed on both connected iPhones. Strict signature verification and source-to-bundle freshness checks pass. iOS initially rejected remote launch with a Security verification error; the user subsequently reported that Beacon opens manually on both phones. Remote launch remained blocked, so the paired retest uses the persistent diagnostic files. See [sanitized evidence](evidence/offline-map-audio-repair.json) and [simulator evidence](SIMULATOR_UI_VALIDATION.md).

## Nearby map and discovery refresh — October 18

The combined workspace check passes **132 tests, zero failures, zero skips**, with TypeScript, lint, and actual local PostgreSQL/Timescale HTTP checks. New protocol/service regressions cover location signature/scope validation, original-fix expiry, replay/withdrawal ordering, disconnect cleanup, opt-out during an in-flight multi-peer send, explicit permission, background/group cancellation, no location persistence, and preserving SOS while refreshing discovery. Test coordinates and radio/OS APIs are synthetic; no physical location exchange is inferred.

The actual Android BeaconBle Kotlin module compiles successfully. A retained test against the production scan pacing policy covers retry boundaries, ordinary errors, and the 30-second rate-limit backoff. The signed iOS Release build passes strict signature verification and contains a JavaScript bundle newer than every relevant source. It installed and launched on both Pravanram’s iPhone 17 Pro Max and Vaibhav’s iPhone 18 Pro Max; subsequent process checks confirmed both running. Initial iOS verification blocked the first launch on the iPhone 17 Pro Max, and a later launch succeeded. Simulator checks verified the readable online map, sharing off, invite-only joining, and Cancel/Back navigation. Map gestures and shared-pin interaction were not verified through automation; physical position exchange still awaits the paired user check. See [sanitized map evidence](evidence/nearby-map-ios.json) and [UI screenshots](SIMULATOR_UI_VALIDATION.md).

## Bluetooth calls and minimal interface — October 18

The final signed iPhone Release build includes direct Bluetooth LE L2CAP calling, Opus speech, authenticated encrypted audio, explicit acceptance, mute/speaker controls, and call cleanup. The complete local Timescale workspace check passes **116 tests, zero failures, zero skips**. Final mobile/API typechecking and lint pass. Native checks also pass: 100 actual Opus encode/decode frames, CryptoKit authentication/replay tests, and 22 real AVAudioConverter/production PCM scenarios. A fresh run also passes 350 synthetic speech/silence/speech frames through the actual Objective-C codec wrapper and production PCM helper, including DTX recovery. These are distinct from a successful hardware call.

The first build installed and launched on both available iPhones. The user reported that both call timers ran, microphone permission was allowed, and both phones remained silent even with Speaker and volume raised. Investigation reproduced two concrete capture bugs: valid 4,800-frame/48 kHz microphone blocks exceeded a fixed 4,096-frame guard, and 4,096-frame/16 kHz blocks exceeded a 3,200-sample accumulator guard. The correction bounds input by duration and splits all accepted converted PCM into 320-sample codec frames. The retained native regressions exercise these actual production helpers. Whether these bugs caused the observed physical silence still needs a retest; no successful two-way speech result is claimed.

The corrected build, including the final UI cleanup, installed and launched on the iPhone 17 Pro. Updating the iPhone 17 Pro Max failed with CoreDevice error 4016 after its connection became unavailable. The iPhone 18 Pro Max subsequently connected and received the same corrected build, but iOS denied launch with a Security error (CoreDevice 10002). Developer Mode is enabled; independent signature, certificate/profile validity, device inclusion, and entitlement checks all pass. A subsequent connection successfully launched the same build, and the console confirmed Bluetooth service publication and peer discovery. The other two phones remained unavailable to the Mac. The user reported continued silence, but the phone pairing and both build versions were not confirmed; the captured console has not yet recorded a voice session, so it does not identify the failing audio stage. Sanitized build, test, installation, and unresolved hardware status are recorded in [the calling evidence](evidence/bluetooth-calls-ios.json).

Settings now contains only name, Nearby sharing, and phone permissions. Cloud/map-download configuration, diagnostics/history navigation, request identifiers, and the manual “Mark seen” control were removed from the normal interface. Opening an active incoming request now queues its receipt automatically; the assistance offer/accept/confirmed workflow remains separate. Current Home and Settings were visually checked in Simulator, including the Save button above the keyboard. The visual QA uses a compatible older simulator native binary and proves no Bluetooth audio behavior. See [UI evidence](SIMULATOR_UI_VALIDATION.md) and [calling architecture/limits](BLUETOOTH_CALLS.md).

## iOS 27 startup correction — October 18, 00:08 Pacific

After the third phone's developer profile was trusted, an actual launch check found a native startup crash that the earlier iOS 26 phones did not expose. UIKit trapped in `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before SQLite initialization. Apple requires [scene lifecycle adoption for apps built with the latest SDK on iOS 27](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle).

Beacon now creates its window and starts React Native from a single scene delegate. A local Expo config plugin preserves this change across prebuilds, including Expo startup/splash hooks, initial and subsequent links, and lifecycle subscribers. Four new tests exercise the installed Expo template, repeat application, unsupported-template rejection, and preservation of unrelated manifest settings. The default test command includes them. The complete local Timescale suite passes **90 tests, zero failures, zero skips**; typechecking and lint also pass.

The signed Release build was installed and launched on the iPhone 18 Pro Max running iOS 27.0.1. The app initialized both databases, which passed `quick_check`; the user confirmed reaching Home after setup. A subsequent snapshot confirmed saved setup and two Nearby contacts with fresh Bluetooth announcements. No newer Beacon crash report existed when checked at 00:09:02 Pacific. This validates startup and physical discovery; direct-message delivery, group exchange, and explicit scene background/foreground and deep-link UI checks remain separate acceptance items. See [sanitized device evidence](evidence/ios-scene-launch.json).

## Subsequent phone reconnection

After the final recheck, the user connected Darshan's iPhone 17 Pro, then Pravanram's iPhone 17 Pro Max. The same final signed build installed and launched successfully on each, and subsequent process queries confirmed Beacon still running. Vaibhav's phone remained unavailable. The second phone's read-only database snapshot had intact request/social databases but Nearby sharing disabled; the user was asked to enable it through the app. This supersedes the installation blocker below, but physical direct-message exchange and private-group delivery between the updated phones remain unverified. See [the installation record](NEARBY_GROUPS.md).

After enabling sharing, a fresh intact snapshot confirmed Nearby mode, a newly discovered contact, and recent Bluetooth connection/forwarding events at 23:55 Pacific. No direct-message packets were stored in that snapshot. Discovery is now physically observed on the updated app; message exchange still needs the requested send/reply check.

## Final recheck — October 17, 23:45 local

The complete workspace passes **86 tests, zero failures, zero skips**, using real local PostgreSQL 18.6 / TimescaleDB 2.30.2. Mobile/API TypeScript and ESLint pass. Migrations and HTTP checks also pass, including signed upload deduplication, incident access controls, revoked credentials, replay, and late aggregate refresh. The isolated database was stopped and its temporary data and password file removed afterward. Sanitized output is in [the workspace evidence](evidence/local-timescale-workspace-check.txt) and [HTTP evidence](evidence/local-timescale-http.json).

This audit found and fixed a message-ordering bug: an authenticated direct message arriving before presence could be saved and acknowledged without a visible conversation. The receiver now persists a neutral, scoped contact before generating its receipt. Three regressions verify visibility and unread state after reconnect/restart, later replacement by the sender's announced name, failure/retry when contact storage is unavailable, and no contact creation from an unsolicited receipt.

Swift and Kotlin framing checks were repeated successfully: 28 round trips per language plus malformed, ordering, duplicate, size, capacity, timeout, and recovery cases. Ten signed/encrypted social payload variants, including maximum-size message text, fit the native framing limits. These checks do not substitute for a physical radio test.

The simulator launched the final signed build's exact production JavaScript bundle using the existing compatible simulator native binary. Its empty conversation layout was inspected again with an explicitly synthetic contact before the final rebuild. Device Hub automation still could not enter multiline text, so a manual composer-send result is not claimed. The fixture was removed and its database passed `quick_check`; final Home and empty Nearby navigation were verified after installing the updated bundle. Physical installation and two-phone validation remain pending because the intended iPhone is unavailable. Final rebuilt binary details are recorded in [Nearby/groups evidence](NEARBY_GROUPS.md).

## Nearby and private groups update — October 17, 23:15 local

The expanded suite passes **82 tests, zero failures, one database-dependent skip**. Mobile/API TypeScript and ESLint pass. Tests use real signed/encrypted protocol packets and disk-backed SQLite with explicitly synthetic radio links. New checks cover direct-message persistence, lost and forged acknowledgments, reconnect/restart, receipt-queue starvation, bounded traffic/cache limits, future-clock and late-arrival unread tracking, private group isolation, queued scope changes, and a complete private SOS offer/accept/assignment receipt flow. Optional GPS timeout no longer leaves an unrelated action error on Home.

The signed iOS Release build passes under Xcode 27.1 and its development profile includes the intended new iPhone. Installation is pending because the phone disconnected: CoreDevice returned error 4016. [Nearby/groups evidence](NEARBY_GROUPS.md) records the final bundle/signature information. Earlier installations and the existing exported Android/Simulator archives predate this update and do not establish delivery of these new features.

The iOS Simulator ran a freshly exported production Hermes bundle with the existing compatible native binary. Actual UI checks verified group creation/selection, selected-group restoration after restart, private SOS creation/cancellation, the simplified Home, and the chat screen with an explicitly synthetic contact. The contact was removed after inspection. Multiline typing through Device Hub automation was unavailable, so no manual composer-send or physical messaging result is claimed; real service tests cover sending/persistence/acknowledgments. See [simulator checks](SIMULATOR_UI_VALIDATION.md).

## Earlier automated evidence

The earlier Node 24 workspace baseline passed strict mobile/API TypeScript, ESLint with zero warnings, and **49 tests**. That default run skipped one additional Timescale integration test when no database URL was configured. With real PostgreSQL 18.6 / TimescaleDB 2.30.2 configured, the earlier complete suite passed **50 tests with zero failures and zero skips**, including regressions for fractional native location timestamps and malformed optional location reports. The larger update suite is recorded above; the earlier build/artifact observations below retain their original scope.

Coverage includes canonical Ed25519 vectors, malformed/expired/over-hop messages, forwarding without false delivery evidence, return receipts, authorization of assignment/terminal state, late dependencies, replay and flood limits, persistence failure rollback, restart recovery, outbox retry/acknowledgment, native-link rejection, and map cancellation races. A three-node test uses real disk-backed SQLite with explicitly synthetic radio links, restarts the relay/requester, and checks a confirmed volunteer assignment and duplicate suppression.

Swift and Kotlin framing tests each pass 28 payload-size/MTU round trips and negative/order/capacity/timeout/recovery cases against the actual native frame implementations. These are not physical BLE tests.

The bundled UW map's actual style passed the official MapLibre style-spec 26.4.4 validator with zero errors. All 2,764 features match compatible layers; geometry checks found no invalid coordinates, unclosed or zero-area rings, or duplicate IDs. The style has no remote rendering resources. Some polygon exterior rings use noncanonical clockwise winding, which GeoJSON parsers are instructed to tolerate. This is static validation, not evidence of native map rendering. See the [map validation report](evidence/map-style-validation.json).

## Native builds

| Artifact | Evidence | Boundary |
| --- | --- | --- |
| Android ARM64 release APK | Full Gradle build and release vital lint passed; APK v2 signature, package, native Beacon DEX class, ARM64 libraries and embedded JavaScript verified. All 25 bundled local source files match current source. | Local debug signing; no physical Android startup or BLE test. |
| iOS Simulator release | Full Xcode app/native-module build passed with bundled JavaScript. Simulator ad-hoc signing allows SecureStore access. | Simulator Bluetooth is unavailable; this does not validate an iPhone radio. |
| Physical iPhone | After the user signed into Xcode, the Personal Team development-signed Release build passed signature verification, installed and launched on the connected iPhone 17 Pro Max. Its process remained running 19 seconds later. | First launch was denied by iOS pending developer-profile trust; a subsequent launch succeeded. Physical screen interaction, BLE transfer and sustained reliability remain unverified. |

Android artifact: `dist/android/beacon-community-arm64.apk`.

SHA-256: `e0405eec440eb1f022f1a12ead9a9a1456a069f6cf76f555e7e966eb206f3820`.

See [NATIVE_VALIDATION.md](NATIVE_VALIDATION.md) for toolchains and machine evidence. The simulator archive, build log and checksum are generated by `scripts/build-ios-simulator.sh` under `dist/ios/`; that archive is not an iPhone-installable IPA. Its SHA-256 is `8d5e0abcf6da5e952a40735cbe89055908329b71fe9a882addb3365278a77c92`.

## Initial simulator interaction

On an iPhone 17 Pro / iOS 26.0 simulator, the signed release app opened its actual setup interface without Metro. The name field accepted a test name, the app requested location permission, and granting it returned to the interface. The test location was explicitly simulated at UW; it was not a real user's location. The interface correctly reported Bluetooth unavailable and location permission allowed. No fake peers or successful deliveries were injected.

Native SecureStore initialization succeeded after using normal simulator ad-hoc signing. The app created its SQLite tables; a read-only `PRAGMA integrity_check` returned `ok`. No SOS was created by these UI checks.

The Mac locked before the **Start using Beacon** interaction could complete. Computer-use automation could not unlock it; the user was asked to unlock or continue without more visual testing. Consequently, home/SOS/volunteer/map/replay screen interaction, dynamic-type screenshots, and an installed-app restart scenario are **not marked visually verified**. Automated service/protocol/persistence tests do not substitute for those UI checks.

Two actual startup/build defects were found and repaired:

1. Expo SDK 54 shell scripts lost quoting in workspace paths containing spaces. An idempotent postinstall patch and config plugin quote those paths.
2. npm had installed two React Native SVG versions, causing duplicate native-view registration at launch. An exact compatible override deduplicates SVG; React, React Native and SVG each have one installed copy. Expo Doctor passes 18/18 checks.

An entirely unsigned simulator app could not access SecureStore. The simulator build script now uses ordinary ad-hoc signing; no production fallback stores private keys in plaintext.

## Location failure found during resumed UI testing

Once the Mac was unlocked, setup completed and an actual Send SOS interaction exposed a validation failure: Expo iOS supplies fractional milliseconds for a captured location, while the signed protocol intentionally requires integer timestamps. The request did not persist. The mobile boundary now normalizes valid capture timestamps to whole milliseconds, omits invalid optional accuracy, and falls back to unavailable location for invalid coordinates/timestamps. It never relabels stale coordinates with a new capture time. The protocol's strict validation remains unchanged.

Two regression tests cover successfully signing a request with fractional native timestamps and preserving SOS availability when optional location is invalid. The complete real Timescale workspace run passed 50 tests afterward. Android, simulator, and physical-device builds were regenerated with this fix. The physical app installed and launched successfully, and its process was observed running 19 seconds after launch. The temporary device profile expires October 24, 2026 at 9:33 PM Pacific; it is local development signing rather than App Store distribution.

The rebuilt simulator then completed a real one-tap SOS interaction, showing saved-on-this-phone and waiting-for-a-connection status with no false receipt or volunteer confirmation. Its details showed the simulated UW coordinates and accuracy. A screenshot visibly showed native map buildings, roads, the reported-location dot and OpenStreetMap attribution. Cancellation completed through the confirmation dialog and explicitly showed the local update waiting to travel. These checks use the simulator's synthetic location and no physical radio; they do not establish an actual no-network cold-start map test or delivery to a second phone.

Local history then showed the SOS and cancellation events with two pending uploads and Never synced. Replay selected the first event, and back navigation returned to Home with Send SOS available again. See the [simulator UI record and screenshot](SIMULATOR_UI_VALIDATION.md).

## Physical reception investigation, October 17 at 22:15 Pacific

A read-only snapshot of the connected iPhone's application database passed SQLite `quick_check`. It contained a foreign signed SOS, durably received at 21:50:45 Pacific with one radio hop. Actual protocol derivation returned it as open, unexpired, and belonging to a different origin from the locally created SOS. It therefore qualifies for the Help nearby list. A separate local SOS had been canceled. Recorded events showed five connected link sessions, four disconnections, and nine forwards; link sessions are not a count of distinct physical phones.

This is evidence of at least one actual phone-to-phone reception. It does not establish that the user's latest attempted SOS arrived, how quickly an available route delivered it, three-phone relaying, or successful return acknowledgments. No seen, offer, or receipt message existed in this snapshot. The app sends a receipt on the explicit seen/offer action; forwarding alone is not a human response. The receiver's screen was not visually inspected during this investigation.

Review found a separate startup resilience defect: optional map, location-permission, and network-status queries could delay or prevent the radio from starting. Those probes now run without blocking BLE. Four actual-service regressions cover stalled probes, optional failures, foreign native-data ingestion into a request view, and disposal. The workspace passed 53 tests with one explicit real-database skip; TypeScript, ESLint, Swift typechecking, and native framing regressions passed. This run did not restart the local Timescale database.

The Help nearby tab now shows the number of active incoming requests in a white badge. Native Bluetooth diagnostics report operational stages and error codes without message contents. Neither change is claimed as a proven fix for the user's reported latest delivery attempt. Android and simulator artifacts from the earlier build do not yet contain these follow-up changes.

A second read-only snapshot at 22:18 showed a newer remote SOS and a remote cancellation received at 22:15. The newer request had been created about eleven minutes before reception; this interval includes unknown time without an available connection, so it is not a measured connected-radio latency. No seen/offer/receipt was present.

The follow-up iPhone build passed Xcode compilation and code-signature verification, installed on the connected iPhone 17 Pro, and launched at 22:18:37 with the Help nearby URL. Its attached native console confirmed powered-on central/peripheral managers, successful service publication and advertising, peer discovery, both connection roles becoming ready by 22:18:40, and multiple fully reassembled received packets from 22:18:40 onward. This provides direct radio/session evidence; the other phone's screen and a complete offer/accept/return-receipt loop remain unverified.

At 22:19:27, a further intact database snapshot confirmed an explicit receiver interaction: a receipt and seen message were created locally at 22:18:50, both referencing the received SOS and targeting its actual origin. Both had completed forwarding records for central and peripheral BLE sessions at 22:18:51. Derived state showed one receipt and one seen acknowledgment, zero offers, and no assignment. This verifies local acknowledgment creation and native transmission completion. Persistence or UI display of that acknowledgment on the sender, and the volunteer offer/acceptance loop, still require confirmation.

## Cloud and cost

No Vultr/Tiger Data cloud resources, paid build service, public release, or hosted CI run were created. Local PostgreSQL/Timescale test tooling is free; its isolated test daemon was stopped after validation. Real Express HTTP checks passed readiness, signed uploads, retry deduplication, observer spoof rejection, incident authorization, replay/summary, token revocation, and a 30-day-late aggregate refresh. Hosted CI is manual-only to avoid automatic private-runner usage. Local BLE operation does not require cloud credentials.

The [local Timescale validation record](LOCAL_TIMESCALE_VALIDATION.md) includes exact versions, reproduction commands, sanitized test output, HTTP results, and daemon shutdown evidence.

The latest expanded-map Release build was also installed and launched successfully on the newly connected iPhone 17 Pro. Its running executable matched the new installation path. This confirms installation and startup, not paired map-pin or audio behavior.

## Interface redesign — October 18, 2026

Help now owns both the one-tap SOS action and incoming requests. Nearby opens People, with a separate Map view and one explicit location-sharing switch. Group forms, request delivery details, and advanced settings use progressive disclosure. Optional SOS drafts reset on audience changes. No transport or storage implementation changed in this update.

The real local Timescale workspace run passed **162 tests with no failures or skips**, plus mobile/API TypeScript and ESLint. Three added real-Home rendering tests verify scoped incoming requests, detail navigation, duplicate-send suppression, and the explicit SOS action. The existing signed-presence/SQLite tests now separately render People and Map, verifying scope filtering, withdrawals, reconnects, and pin creation. These replace native UI primitives and are not hardware evidence. After the final audience-reset change, the three Home tests and typecheck passed again; lint passed after the final setup-link removal.

The actual simulator walkthrough verified SOS send/cancel, People/Map switching, offline geometry and Locate with sharing off, group form cancellation, name-save visibility, and clearing SOS drafts after audience changes. No active QA request or draft remains. Larger text and software-keyboard overlap were not verified. See [the dated UI record and screenshots](SIMULATOR_UI_VALIDATION.md).

The iOS Release build succeeded and its strict code signature passed. Its embedded JavaScript is newer than every checked UI/service/protocol asset source. All known physical phones were unavailable at build completion, so this redesign has not yet been installed on a physical phone. Artifact details and limitations are in [the redesign evidence](evidence/ui-redesign.json).

## Required before broader use

- Run the [device acceptance checklist](DEVICE_ACCEPTANCE.md) on three phones, including Android/iPhone interoperability, disconnections, radio toggles, return acknowledgments, actual app restarts and expiry.
- Finish volunteer and hosted-replay interaction, actual no-internet cold-start map testing, screen-reader/dynamic-type checks, and physical release performance/battery measurements.
- Configure distribution signing and resolve the documented dependency/security risks; current development signing is temporary.
- If deploying cloud, verify the configured hosted HTTPS path, backups, membership administration and mobile sync against that specific deployment.

The final release gate is [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Current work is a research/test build, not an operational emergency service.
