# Simulator UI validation

Observed through native CUA against the existing **iPhone 17 Pro / iOS 26.0 Simulator**, October 17, 2026, approximately 21:40–21:42 America/Los_Angeles. This was the rebuilt Release app after the fractional location timestamp correction. No production source was changed during this smoke test.

## Confirmed from the running app

- Home showed exactly the two primary tabs, a single red Send SOS action, collapsed optional details, a dated location report, and an honest Bluetooth-unavailable message.
- One tap on **Send SOS**, with optional fields untouched, created synthetic local request **E5D5AC11** at 21:40 and opened its details. The previous timestamp-validation error did not recur.
- Details displayed **Waiting for a connection**, **Saved on this phone**, and explicitly pending connection, recipient receipt, and human response. It showed zero offers and did not claim delivery.
- The actual native map viewport rendered the bundled UW building polygons and roads with a white reported-location marker. OpenStreetMap/ODbL attribution was visible. The explicitly simulated report was **47.65500, -122.30600**, accuracy **±5 meters**, captured October 17 at 21:40.
- **Cancel request** displayed a confirmation explaining delayed propagation. Confirming produced **Canceled** and the explicit statement that the cancellation was saved locally and waiting to travel.
- **View recorded history** showed exactly two local events, **SOS saved** and **Request canceled**, two pending uploads, and **Never synced**. No incident was connected and no cloud sync was enabled or performed.
- Advancing incident replay selected **SOS saved**, **1 of 2**, and a single red selected event marker.
- Back navigation returned through the canceled request to home; home again offered **Send SOS** rather than presenting the canceled request as active.

The map screenshot was saved using Simulator’s **Save Screen** toolbar action and copied without modification from its native Desktop destination:

![Native simulator map viewport, simulated UW location](screenshots/simulator-uw-map.png)

## Boundaries

This verifies the local simulator UI and the displayed map viewport. It does **not** verify Bluetooth transfer, real recipient receipts, offers/assignment exchange, physical-device location, airplane-mode cold-start mapping, cloud ingestion, restart persistence, or a ten-run reliability result. The simulator explicitly reports Bluetooth unavailable. This smoke used one synthetic request and canceled it afterward. No physical iPhone or Xcode UI was controlled in this pass.

Wheel/drag attempts did not move the simulator viewport through CUA, while accessibility-targeted actions successfully brought their controls into view. Map rendering was visually observed after cancellation shortened the request page. This is a tool-interaction observation, not evidence of a touch-scrolling defect in the app.

## Minimal interface pass — October 17, approximately 22:47–22:50

Removed slogans and promotional paragraphs from the app. Home prioritizes one Send SOS control; optional category, note, place and phone-location report are collapsed. Connection, history and settings use accessible header buttons. Nearby requests use compact cards. Request delivery status appears before offers and completion controls; offer/accept controls precede the map. Advanced map, cloud and local-data settings are collapsed, with Save settings fixed outside the scroll area.

Validation used the existing native Simulator binary with a freshly exported production Hermes JavaScript bundle and assets, then an ad-hoc signature and reinstall. Native code was unchanged. This was not a full native rebuild under the newly installed Xcode.

- Expanded and collapsed optional SOS fields through native accessibility controls.
- Created one synthetic local SOS with one tap, with details left blank.
- Observed Waiting for a connection and Saved on this phone; no delivery was claimed.
- Observed the bundled UW map and timestamped location marked Not live.
- Completion retained a confirmation. Confirming returned home to Send SOS after relaunch.
- Verified primary tab navigation and the empty nearby-request state.
- Verified collapsed settings and expanded offline map controls; Save settings stayed available.
- Workspace TypeScript and ESLint passed. Existing suite: 53 passed, 0 failed, 1 database-dependent skip.

The Simulator has no BLE transport. This pass does not establish real phone receipt/offer/acceptance or delivery reliability. The connected new iPhone requires its own signed build and installation.

![Simplified SOS home in the simulator](screenshots/simulator-minimal-home.png)

## Nearby and groups — October 17, approximately 23:08–23:15

Xcode 27.1 exposes simulator UI through Device Hub. This pass used the existing native iOS Simulator app with the newly exported production Hermes bundle, signed and installed locally. It is separate from the full signed physical-device build.

- Created a local `QA group` through the actual group form; selected scope appeared on Home and Nearby.
- Sent one synthetic group SOS with optional details untouched. It showed Waiting for a connection and Saved on this phone, with no location or delivery invented.
- Canceled that synthetic request through its confirmation. The closed state explained that other phones could still have an older state.
- Relaunched the app and verified selected-group restoration, Send SOS, and removal of the unrelated slow-location error banner.
- Inspected Nearby, the group selector, and the chat layout. A single explicitly labeled `QA contact (test)` was inserted into the simulator database solely to inspect navigation to an empty conversation; this was not Bluetooth discovery. The empty Send control was disabled. The fixture contact was removed afterward.
- Device Hub automation could fill the single-line group name through accessibility, but did not enter text into the multiline composer. Manual text entry/send is therefore not claimed by this UI pass. Actual service tests separately verify message persistence and authenticated delivery acknowledgment using synthetic links.

This simulator has no Bluetooth transport. New physical nearby-message/group delivery still requires two updated phones. The screenshot shows the simulator's actual Home and its honest Bluetooth-unavailable state.

![Group-scoped Beacon home, local simulator QA group](screenshots/simulator-group-home.png)

## Simplification and keyboard pass — October 18, 00:24–00:27

Observed through Device Hub on iPhone 17 Pro / iOS 26.0.1 Simulator. A freshly exported production iOS JavaScript bundle and assets were installed into a copy of the existing simulator native app (`tmp/simplified-ui/Beacon.app`), ad-hoc signed, then launched. This is current UI evidence, not native-call evidence.

- Home has one Settings header button, a group selector, immediate Send SOS, collapsed optional details, and an honest Bluetooth-unavailable message. No additional SOS was sent in this pass.
- Nearby displays one empty state without empty request cards or invented people.
- Groups displays scope selection and Join/Create actions. Opening Join reveals its fields; the submit button stays disabled for empty required fields. Cancel returns to the compact group screen. The existing local QA group was not modified.
- Settings exposes name, sharing, History, and Connection status; permission, map, cloud, and advanced controls start collapsed. No Save button appears before an edit.
- Found and fixed Save changes being covered by the iOS software keyboard. A `KeyboardAvoidingView` now keeps it visibly above the keyboard. Re-exported and reinstalled, then verified the corrected layout with a temporary name draft. Restored the original draft without saving it, returned to Home, and left no new request or changed profile.
- Settings ESLint and mobile TypeScript checks passed after the correction. Default simulator text size was visually checked; this was not a large Dynamic Type or VoiceOver session.

Screenshots were captured through Device Hub's Screenshot button and copied unchanged from its Desktop output:

| Screen | Evidence |
| --- | --- |
| Home | [home.png](screenshots/simplified/home.png) |
| Nearby | [nearby.png](screenshots/simplified/nearby.png) |
| Groups | [groups.png](screenshots/simplified/groups.png) |
| Settings | [settings.png](screenshots/simplified/settings.png) |
| Corrected keyboard layout | [settings-keyboard.png](screenshots/simplified/settings-keyboard.png) |

No peers, receipts, or call states were injected. No cloud sync or physical-phone interaction occurred. Bluetooth calls are unsupported in this old simulator native build; this pass establishes neither audio transport nor physical-device delivery.

## Removal pass — October 18, approximately 00:33

The user requested actual removal of excess controls after the preceding collapsed-settings approach. Settings now contains only the profile name, Nearby sharing toggle, and Phone permissions action. Cloud configuration, custom map download controls, diagnostics, history links, and connection-status links are removed from the visible app flow. Their underlying routes/storage/transport remain intact and unlinked; they are not presented as retained user-facing features.

Request details retain receipt-versus-volunteer-confirmation distinctions, offer/accept/close actions, and the reported-location map. Request IDs, history links, manual Mark as seen, and seen counts were removed. Opening another participant's active request now triggers an idempotent acknowledgment in the background, guarded by request ID; this last effect passed TypeScript and lint but was added after the simulator bundle used for the following Home/Settings screenshots.

Fresh current visual code was exported into the same old simulator native app. Actual Home and the three-control Settings screen rendered without clipping. Editing a temporary name showed Save name above the software keyboard; the draft was restored without saving, and the app was left on Home. No SOS, peer, or call was generated. Native-call verification is outside this simulator pass.

- [Current Home](screenshots/simplified/home-core.png)
- [Current Settings](screenshots/simplified/settings-core.png)
- [Current Settings with keyboard](screenshots/simplified/settings-core-keyboard.png)

All changed UI files passed scoped ESLint; mobile TypeScript passed after the automatic acknowledgment addition. No production source edits followed this freeze.

## Nearby map and invite flow — October 18, approximately 00:54–00:55

Current production JavaScript and assets were exported into `tmp/simplified-ui/Beacon.app`, ad-hoc signed, installed, and launched on the existing iPhone 17 Pro / iOS 26.0.1 Simulator. This uses the older compatible simulator native binary; physical-device builds and Bluetooth testing are separate.

- Nearby rendered the actual OpenFreeMap Positron map with readable UW campus street/place labels. No person pins were present. The map accurately said “No shared positions yet” and “Online map · area overview.” The native attribution control was visible; opening its contents was not verified.
- Share my location was visibly off, with “With everyone nearby” identifying its audience. It was not enabled during this pass.
- The existing simulator reported Bluetooth unavailable and disabled Find people. No discovery, Bluetooth call, position receipt, or selected-person Message action is claimed by this visual pass.
- Tapping the group chip opened Groups. Join showed only the invite-code field, with its empty submit disabled. Cancel and Back returned to Nearby. No group, profile, or scope was changed; the visible QA group predates this pass.
- Native map-drag automation returned a no-windows-available error despite subsequent accessibility reads working. Map panning and recenter behavior were therefore not verified. No fake contacts, positions, receipts, or requests were inserted.
- Scoped ESLint and mobile TypeScript passed. Freshness filtering uses the protocol's 120-second lifetime and five-second future-clock tolerance; age labels clamp negative age to zero. Active help requests remain above the map in the UI structure, but none were active for these screenshots.

The public online style was checked against [OpenFreeMap's official quick start](https://openfreemap.org/quick_start/) and fetched successfully before use. The component retains the bundled UW fallback; this pass observed the online path, not a forced network-failure transition.

Screenshots were saved with Device Hub's native Screenshot control, copied unchanged from Desktop, and visually inspected:

- [Nearby map, sharing off](screenshots/simplified/nearby-map.png)
- [Invite-only join form](screenshots/simplified/group-invite-only.png)

No production UI source changed after the final Positron style selection. The app was left on Nearby with sharing off.
