# Beacon interface

Beacon is a quiet, high-contrast tool for asking nearby participants for help. The reference-inspired interface uses compact charcoal utility surfaces and a prominent SOS control. The only bottom tabs are **Help** and **Nearby**. Help contains the one-tap SOS action, the current request, and incoming assistance requests. Nearby opens People; its People / Map switch reveals the location view. The shared main header contains the Beacon mark, a Messages entry with the real unread count, a Profile & settings entry, and a link to connection details.

## Visual system

- Background `#0B1014`, cards `#141B21`, raised surfaces `#1D262E`, borders `#2A343D`.
- Primary text `#F7F9FA`, secondary text `#BAC4CC`, quiet text `#96A3AD`.
- Action red `#D9363E`; alert surface `#251418`, alert border `#713039`, alert labels `#FF8A91`. These values come from `apps/mobile/src/theme/tokens.ts`.
- Small text on red uses pure white (`#FFFFFF`), with a calculated contrast ratio of 4.62:1.
- Locally bundled Inter Regular and SemiBold carry body copy, controls, main headings and the compact Beacon wordmark. Inter Tight Black and Barlow Condensed remain available to existing screens. No runtime font CDN is used.
- 20-point screen margins, mostly 16-point card radii, thin borders, compact section labels, and at least 44-point touch controls. Secondary screens use a back arrow and one title.
- Native text scaling is enabled. Content scrolls instead of relying on fixed screen heights. Cards and fields grow with their text. No animation is required to understand status; navigation animation is disabled.
- Red is concentrated on SOS and consequential primary actions. Discovery, inbox rows, message bubbles, message send and utility controls are neutral. Completed request cards use a light surface with dark text; receipt evidence uses explicit text rather than a color-only signal.

The vector beacon mark remains neutral when a primary action is red. It is a small angular signal shape with a diamond at its point of origin. Restrained line art on setup and concentric SOS rings add depth without implying network coverage or live activity.

## Interaction contract

`apps/mobile/src/ui/types.ts` is the presentation contract implemented by `src/services/BeaconContext.tsx`. UI state comes from persisted domain operations. There are no seeded peers, fabricated request counts, simulated live locations, or fake confirmations.

After setup, **Send SOS** immediately calls the persistence-backed action. Categories, a short note and a place description are collapsed optional details; none blocks sending. A synchronous in-flight guard prevents repeated UI action invocation while a save is pending. Successful persistence returns the request ID and opens its details. Failure is shown in the current screen.

Setup is one concise screen: optional name, Bluetooth and optional-location explanations, a permission/settings action when relevant, and Get started. It states that Beacon must remain open and SOS does not call emergency services. Permission failure does not prevent reaching a screen from which the user can save an SOS. An online account is never required for local operation.

The audience pill on Help and Nearby opens a selection sheet for Public Nearby or a saved private group. Selection changes the active audience used by SOS, people and messages; it is not a browse-only filter. The sheet says this explicitly and provides a link to join or create a group. Current-scope identity and request filters remain in place when rendering counts, lists and map pins.

Request details distinguish:

1. Saved on this phone.
2. Passed to a participating phone.
3. Recipient persistence receipt.
4. Human seen acknowledgment.
5. Offered assistance, requester acceptance, helper assignment receipt.
6. Requester-confirmed completion.

A recipient receipt does not mean a human has read a request. A relay transfer does not imply recipient delivery. Cloud sync never changes these labels. Cancellation and completion disclose pending propagation when other devices may retain earlier state.

The request map is delegated to `services/RequestMap.tsx`; capture time, accuracy and a Not live label remain visible. Raw coordinates expand on request. Offer notes, delivery details and cancellation options start collapsed; confirmations remain explicit. There is no assumed physical distance from Bluetooth signal strength.

Nearby → Map distinguishes voluntarily shared, fresh positions from SOS reported positions. People pins require a current connection and a fresh shared coordinate. SOS pins use valid coordinates attached to active or accepted requests in the current audience; they are not live person tracking. Their preview identifies a reported location, shows its capture time when supplied, and opens the request. Missing coordinates never produce an invented pin. Locate does not enable sharing. Map options retain the existing save-area operation and its states; this visual redesign does not establish that downloads work on physical devices.

## Secondary screens

**Connection:** actual locally observed peers, actual current connection lines, queue count, Bluetooth state, internet state, and relay controls. The compact SVG graph is not a geography display or an inferred global topology. Its ring is decorative; no peers are drawn when none were observed.

**History:** persisted local events are available offline. Combined incident events are explicitly separate. The replay controls step through actual recorded events, with a single red selected marker; missing and late-arriving events are acknowledged. Historical hop labels appear only when the event contains node evidence.

**Profile & settings:** local name with an explicit edit action, nearby participation, and phone permissions. The main list links to private groups, connections, Location & map, and request history. Advanced contains the optional incident connection, redacted diagnostics export, and guarded history clearing. Location sharing has one control in Nearby → Map.

**Groups:** reached from the audience sheet or Profile & settings. Join and Create reveal one form at a time, replacing the list until completed or canceled. Invite sharing is explicit.

**Messages:** a secondary full-screen inbox with a back action, current-audience context, real conversations ordered by recent activity, initials, message previews, timestamps and unread counts. Connected people without a conversation appear separately. No request-to-chat association or example conversation is fabricated.

**Chat:** one person-name header, connection state, neutral message bubbles, and a large composer. Delivery remains Queued / Received / Expired; direct messages do not claim relaying or human read acknowledgments. Send clears the draft only after the persistence-backed operation resolves. Changing peer or audience resets conversation UI state. Experimental calls live inside collapsed Conversation options and retain the existing support, connection, busy and permission gates. This redesign does not establish functioning Bluetooth audio.

## Accessibility and verification

Shared buttons have explicit roles, disabled/busy semantics, minimum touch size, visible text and icons. Category pills expose selection; optional details expose expansion. Network diagrams have descriptive accessible text; decorative mark art is hidden from screen readers. Destructive request changes require an explicit confirmation.

Calculated token contrast: secondary text on cards 9.81:1; quiet text on background 7.41:1; light-red label on alert background 7.80:1. These calculations do not establish physical-device acceptance. Native dynamic type, VoiceOver/TalkBack order, keyboard layouts, real map attribution and smallest-device behavior require build/device checks. Compile or simulator success does not establish BLE delivery, Bluetooth audio, or saved-area download reliability.
