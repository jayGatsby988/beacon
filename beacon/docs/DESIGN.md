# Beacon interface

Beacon is a quiet, high-contrast tool for asking nearby participants for help. The two primary destinations are **Help** and **Nearby**. Help contains the one-tap SOS action, the current request, and incoming assistance requests. Nearby opens a conversation list; its People / Map switch reveals the location view only when wanted. Connection diagnostics and history live under Settings → Advanced.

## Visual system

- Background `#111317`, cards `#191C22`, borders `#2A2E36`.
- Primary text `#F5F5F4`, secondary text `#B3B7BF`, quiet text `#8C929E`.
- Action red `#D23A3A`; pending region `#2A1519` with `#C2393B` border and `#F07070` labels.
- Small text on red uses pure white for contrast. Primary gray-white on this red is 4.37:1, below the 4.5:1 small-text threshold; pure white is above it. Large SOS text can use the primary text token.
- Inter Tight Black headlines, locally bundled Inter body and controls, Barlow Condensed Bold wordmark. Fonts ship in the application; no runtime font CDN.
- 24-point screen margins, rounded gray surfaces, generous spacing between sections, and at least 44-point touch controls. A single page title replaces the previous brand-plus-title stack.
- Native text scaling is enabled. Content scrolls instead of relying on fixed screen heights. Cards and fields grow with their text. No animation is required to understand status; navigation animation is disabled.
- Completed and received evidence stays white. One grouped red focal element per screen: the SOS control, offer/accept action, setup action, message send action, or selected replay marker. Discovery and utility controls are neutral.

The vector beacon mark remains neutral when a primary action is red. It is a small angular signal shape with a point of origin, and does not introduce color outside the palette.

## Interaction contract

`apps/mobile/src/ui/types.ts` is the presentation contract implemented by `src/services/BeaconContext.tsx`. UI state comes from persisted domain operations. There are no seeded peers, fabricated request counts, simulated live locations, or fake confirmations.

After setup, **Send SOS** immediately calls the persistence-backed action. Categories, a short note and a place description are collapsed optional details; none blocks sending. A synchronous in-flight guard prevents repeated UI action invocation while a save is pending. Successful persistence returns the request ID and opens its details. Failure is shown in the current screen.

Setup explains Bluetooth, optional location, and foreground operation. Permission failure does not prevent reaching a screen from which the user can save an SOS. An online account is never required for local operation.

Request details distinguish:

1. Saved on this phone.
2. Passed to a participating phone.
3. Recipient persistence receipt.
4. Human seen acknowledgment.
5. Offered assistance, requester acceptance, helper assignment receipt.
6. Requester-confirmed completion.

A recipient receipt does not mean a human has read a request. A relay transfer does not imply recipient delivery. Cloud sync never changes these labels. Cancellation and completion disclose pending propagation when other devices may retain earlier state.

The request map is delegated to `services/RequestMap.tsx`; capture time, accuracy and a Not live label remain visible. Raw coordinates expand on request. Offer notes, delivery details and cancellation options start collapsed; confirmations remain explicit. There is no assumed physical distance from Bluetooth signal strength.

## Secondary screens

**Connection:** actual locally observed peers, actual current connection lines, queue count, Bluetooth state, internet state, and relay controls. The compact SVG graph is not a geography display or an inferred global topology. Its ring is decorative; no peers are drawn when none were observed.

**History:** persisted local events are available offline. Combined incident events are explicitly separate. The replay controls step through actual recorded events, with a single red selected marker; missing and late-arriving events are acknowledged. Historical hop labels appear only when the event contains node evidence.

**Settings:** local name, nearby participation, and phone permissions. The name-save action appears only after editing. Advanced expands connection details, request history, redacted diagnostics export, and guarded history clearing. Location sharing has one control in Nearby → Map.

**Groups:** choose an audience from Help or Nearby. Join and Create reveal one form at a time, replacing the list until completed or canceled. Invite sharing is explicit.

**Chat:** one person-name header, connection state, messages, and the composer. Delivery remains queued/received/expired. Calls retain an experimental label; this redesign does not establish functioning Bluetooth audio.

## Accessibility and verification

Shared buttons have explicit roles, disabled/busy semantics, minimum touch size, visible text and icons. Category pills expose selection; optional details expose expansion. Network diagrams have descriptive accessible text; decorative mark art is hidden from screen readers. Destructive request changes require an explicit confirmation.

Static contrast checked: secondary text on cards 8.49:1; quiet text on background 5.95:1; light-red label on alert background 5.95:1. Native dynamic type, VoiceOver/TalkBack order, real map attribution, and smallest-device layout still need the actual builds and devices. Compile success does not establish BLE functionality or recipient delivery.
