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
