#!/usr/bin/env bash
set -euo pipefail
BEACON_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" == '--help' ]]; then
  echo 'Build an embedded-bundle iOS Simulator app from the existing CocoaPods project.'
  echo 'Requires Xcode, npm ci, Expo iOS prebuild, and pod install. No Apple account is needed for the simulator.'
  exit 0
fi
mkdir -p "$BEACON_ROOT/tmp" "$BEACON_ROOT/dist/ios"
xcodebuild \
  -workspace "$BEACON_ROOT/apps/mobile/ios/Beacon.xcworkspace" \
  -scheme Beacon -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BEACON_ROOT/tmp/SimulatorBuild" \
  CODE_SIGN_IDENTITY=- IPHONEOS_DEPLOYMENT_TARGET=15.1 -jobs 4 \
  > "$BEACON_ROOT/dist/ios/build.log" 2>&1
BEACON_APP="$BEACON_ROOT/tmp/SimulatorBuild/Build/Products/Release-iphonesimulator/Beacon.app"
test -s "$BEACON_APP/main.jsbundle"
codesign --verify --deep --strict "$BEACON_APP"
ditto -c -k --sequesterRsrc --keepParent "$BEACON_APP" "$BEACON_ROOT/dist/ios/beacon-simulator.zip"
shasum -a 256 "$BEACON_ROOT/dist/ios/beacon-simulator.zip" > "$BEACON_ROOT/dist/ios/SHA256SUMS"
echo "Simulator artifact: $BEACON_ROOT/dist/ios/beacon-simulator.zip"
echo 'This archive is for Simulator only. Physical iPhone installation requires development signing and provisioning.'
