# Beacon identity

Beacon uses a neutral signal mark, a compact Inter SemiBold wordmark, charcoal surfaces, and restrained red emphasis around SOS. The reference-inspired interface is a practical nearby-help tool: Help and Nearby are its two main destinations, while messages and profile/settings stay secondary in the header. The app's functional interface is native React Native UI; the launcher icon is a static bundled asset.

The palette is near-black `#0B1014`, card charcoal `#141B21`, raised charcoal `#1D262E`, gray borders `#2A343D`, and white-gray text `#F7F9FA`. Red `#D9363E` marks urgent actions; utility controls and conversation surfaces remain neutral. Completed request cards use a light surface with dark text. Initials represent real participants; the interface does not invent profile photos, people, or network activity.

## Generated icon

File: `apps/mobile/assets/beacon-icon.png`.

Created with OpenAI image generation from this design brief: a simple, memorable white beacon/signal symbol on a near-black square, geometric and high contrast, readable at small mobile icon sizes, no wording, gradients, shadows, extra colors, or decorative details. The mark should communicate a point of origin and an outward signal without resembling an official emergency-services seal.

The neutral icon is used for the launcher and splash. A small angular vector mark with a diamond at its origin stays neutral beside the red SOS action. Simple setup line art and SOS rings are decorative, not coverage or connectivity evidence. Colors, typography, interaction patterns, and accessibility decisions are documented in [DESIGN.md](DESIGN.md).

## Map attribution

The bundled UW geometry is derived from OpenStreetMap and separately licensed under ODbL. See `apps/mobile/assets/maps/LICENSE.md`. It is not an illustration or generated geography. The app shows attribution in its map views, and custom provider styles retain their native attribution control. SOS markers identify reported request positions; connected-person markers use fresh shared positions. Neither decorative artwork nor Bluetooth signal strength supplies geographic coordinates.
