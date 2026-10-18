# Beacon interface

Beacon uses a white canvas, deep green typography, generous spacing and a clear red SOS action. The only bottom tabs are **Help** and **Nearby**. Help leads with a wide SOS control and follows it with incoming requests. People and Map live in Nearby; Help has no People / Map shortcut tiles. The main header contains the Beacon wordmark and icons with visible **Messages** and **Profile** labels. Messages shows the real unread count. Help also has one compact connection row below the header controls.

## Visual system

- Background `#FFFFFF`, cards `#F7F9F8`, raised surfaces `#EEF3F0`, borders `#DDE5E1`.
- Primary text `#082D25`, secondary text `#52616B`, quiet text `#65736E`, connected indicator `#268641`.
- Action red `#CF2C20`; alert surface `#FFF4F1`, alert border `#EAC2BA`, alert labels `#B32318`. These values come from `apps/mobile/src/theme/tokens.ts`.
- Text and icons on solid red or deep green action surfaces use white (`#FFFFFF`). Status also has a text label; color alone does not establish delivery or connection state.
- Locally bundled Inter Regular and SemiBold carry body copy and controls. Inter Tight Black gives main headings and the Beacon wordmark their stronger weight. Barlow Condensed remains available in the font bundle. No runtime font CDN is used.
- Screen margins are 24 points, reduced to 20 on narrow layouts. Most content shares a centered 640-point maximum width. Rows use thin separators; pale surfaces and restrained borders group controls where needed. Touch controls are at least 44 points. Secondary screens use a back arrow and one title.
- Native text scaling is enabled. Content scrolls, text wraps, and key rows stack on narrow screens or at larger font sizes. Decorative initials and selected compact labels have explicit scaling caps. No animation is required to understand status; navigation animation is disabled.
- The SOS control is a wide rounded rectangle with large white **SOS** and **Send request** text. It uses a flat red surface without a halo, gradient or shadow. Deep green headings and controls keep the surrounding interface quiet. Incoming requests and inbox conversations use open rows rather than enclosing cards.
- Map controls use white surfaces. The bundled campus map uses light neutral land, muted green parks, pale blue water, and gray-green buildings and roads. People and own-location markers remain visually distinct from red SOS markers.

The vector beacon mark and restrained setup line art remain decorative. They do not imply network coverage or live activity.

## Interaction contract

`apps/mobile/src/ui/types.ts` is the presentation contract implemented by `src/services/BeaconContext.tsx`. UI state comes from persisted domain operations. There are no seeded peers, fabricated request counts, simulated live locations, or fake confirmations.

After setup, **Need help?** presents one **SOS / Send request** control that immediately calls the persistence-backed action. The audience appears above it as **To: [audience]**, and the emergency-services limitation appears below. Category, note, landmark and the explanation of last-known location stay inside collapsed **Add details**; none blocks sending. A synchronous in-flight guard prevents repeated action invocation while saving. Successful persistence opens the request; failure stays visible. An active request replaces the hero with **Your SOS**.

The single connection row in the Help header shows the actual current state. Tapping it runs discovery, resumes participation, opens phone settings, or opens connection details as appropriate. The row exposes the corresponding **Find**, **Resume**, **Settings**, or **Details** action in its accessible label. It is not repeated beneath the SOS control.

**Help nearby** lists incoming requests as flat rows with the participant name, request information and a separator. Eligible requests expose **Offer help** directly in the row; the action stacks below the copy on narrow layouts or at larger font sizes. It saves an offer without requiring a visit to request details. Existing offers and accepted requests display their recorded state rather than another offer action. Selecting the request copy opens its details. An empty list uses one quiet sentence.

Setup is one concise screen: optional name, Bluetooth and optional-location explanations, a permission/settings action when relevant, and Get started. It states that Beacon must remain open and SOS does not call emergency services. Permission failure does not prevent reaching a screen from which the user can save an SOS. An online account is never required for local operation.

The inline audience control on Help and Nearby opens a selection sheet for **Everyone nearby** or a saved private group. This public-audience label is consistent across screens and means people using Beacon, not all phones in range. Selection changes the active audience used by SOS, people and messages; it is not a browse-only filter. The sheet says this explicitly and provides a link to join or create a group. Current-scope identity and request filters remain in place when rendering counts, lists and map pins.

Request details distinguish:

1. Saved on this phone.
2. Passed to a participating phone.
3. Recipient persistence receipt.
4. Human seen acknowledgment.
5. Offered assistance, requester acceptance, helper assignment receipt.
6. Requester-confirmed completion.

A recipient receipt does not mean a human has read a request. A relay transfer does not imply recipient delivery. Cloud sync never changes these labels. Cancellation and completion disclose pending propagation when other devices may retain earlier state.

Request details lead with the audience, current status and supplied note. **Help offers** and the relevant offer or acceptance action appear before **Reported location**. A requester can choose **Accept [name]** directly on an offer; an accepted offer distinguishes waiting for confirmation from a volunteer confirmation. Received offer notes remain visible. The optional note composer, **Location map**, and **Delivery details** start collapsed. Completion uses **I no longer need help**; completion and cancellation retain explicit confirmations. The location summary preserves capture time, accuracy and a **Not live** label; it uses the supplied place description or coordinates. The expanded map is delegated to `services/RequestMap.tsx`. There is no assumed physical distance from Bluetooth signal strength.

After acceptance, the requester and selected helper get a direct **Message [name]** action when that person is a known contact in the current audience. Disconnected contacts may queue messages; unknown or other-audience contacts do not get an invalid chat link. Service guards keep repeated accepts idempotent and prevent an accepted helper from being replaced by a stale action.

Nearby opens **People** and uses underlined **People / Map** tabs. People shows the real connected count, a **Find people** action, and rows for current-audience participants. Each row has an outlined **Message** action that opens that person's conversation. Names and status copy wrap, with actions moving below on narrow layouts or at larger font sizes. The empty state explains how to establish a connection without adding example people.

Nearby → Map distinguishes voluntarily shared, fresh positions from SOS reported positions. People pins require a current connection and a fresh shared coordinate. SOS pins use valid coordinates attached to active or accepted requests in the current audience; they are not live person tracking. Their preview identifies a reported location, shows its capture time when supplied, and opens the request. Missing coordinates never produce an invented pin. Locate does not enable sharing. While Map is focused, foreground GPS refreshes every 30 seconds without changing the sharing preference. Returning to the foreground refreshes immediately; leaving Map or backgrounding the app stops polling. Only the first focused fix recenters the map, preserving later user pans. Map options retain the existing save-area operation and its states; each provider attempt has a 30-second deadline covering headers and body, and cancellation settles even when native networking ignores abort. A failed replacement preserves the existing map. Provider errors remain possible; the bundled map does not imply worldwide offline street coverage.

## Secondary screens

**Connection:** actual locally observed peers, actual current connection lines, queue count, Bluetooth state, internet state, and relay controls. The compact SVG graph is not a geography display or an inferred global topology. Its ring is decorative; no peers are drawn when none were observed.

**History:** persisted local events are available offline. Combined incident events are explicitly separate. The replay controls step through actual recorded events, with a single red selected marker; missing and late-arriving events are acknowledged. Historical hop labels appear only when the event contains node evidence.

**Profile & settings:** local name with an explicit edit action, nearby participation, and phone permissions. The main list links to private groups, connections, Location & map, and request history. Advanced contains the optional incident connection, redacted diagnostics export, and guarded history clearing. Location sharing has one control in Nearby → Map.

**Groups:** reached from the audience sheet or Profile & settings. Join and Create reveal one form at a time, replacing the list until completed or canceled. Invite sharing is explicit.

**Messages:** a secondary full-screen inbox with a back action and one compact audience/unread line. Real conversations are ordered by recent activity, with circular initials, previews, timestamps, unread counts and subtle separators on white. Names wrap, and metadata stacks at larger font sizes or narrow widths. When there are no conversations, connected contacts appear immediately under **Start a conversation**. Only an audience with neither conversations nor connected contacts shows **Find people**, opening Nearby → People directly. No context card, count panel, explanatory footer, request-to-chat association or example conversation is added.

**Chat:** one person-name title, a compact avatar/status row with a 48-point options button, pale message bubbles on white, and a large composer with a solid deep green send control. Message width expands at larger font sizes. The empty conversation asks for a first message without an instructional paragraph. Delivery remains Queued / Received / Expired; direct messages do not claim relaying or human read acknowledgments. Send clears the draft only after persistence resolves, and changing peer or audience resets conversation UI state. Delivery explanations and experimental calls stay inside collapsed options with the existing support, connection, busy and permission gates. This redesign does not establish functioning Bluetooth audio.

## Accessibility and verification

Shared buttons have explicit roles, disabled/busy semantics, minimum touch size, visible text and icons. Category pills expose selection; optional details expose expansion. Network diagrams have descriptive accessible text; decorative mark art is hidden from screen readers. Destructive request changes require an explicit confirmation.

This document describes the intended interface and implemented presentation choices, not a record of device acceptance. Native dynamic type, VoiceOver/TalkBack order, keyboard layouts, map attribution and smallest-device behavior require build/device checks. Compile or simulator success does not establish BLE delivery, Bluetooth audio, or saved-area download reliability.
