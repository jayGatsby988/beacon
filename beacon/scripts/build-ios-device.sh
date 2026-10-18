#!/usr/bin/env bash
# Local device build only; never installs dependencies, enrolls an account, or installs the app.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: scripts/build-ios-device.sh --device UDID --team TEAM_ID [--jobs COUNT]

Build the existing Beacon iOS workspace in Release with embedded JavaScript.
Both the connected physical device UDID and Apple development team ID are required.
Uses the user's existing Xcode account for automatic development provisioning.
Local test signing only: no paid enrollment, EAS, distribution, or app installation.

Requires Xcode, prepared CocoaPods workspace, installed JS dependencies, and a
trusted device with Developer Mode enabled. Xcode's .xcode.env/.local selects Node.
Build directory: tmp/DerivedData; concurrency: 2 jobs unless explicitly changed.
Log: dist/ios/device-build.log
HELP
}

fail() { printf '%s\n' "$1 Use --help for usage." >&2; exit 2; }
BEACON_DEVICE=''
BEACON_TEAM=''
BEACON_JOBS=2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --device)
      [[ -z "$BEACON_DEVICE" ]] || fail 'Duplicate --device.'
      [[ $# -ge 2 && -n "${2:-}" && "${2:-}" != --* ]] || fail 'Missing --device value.'
      BEACON_DEVICE="$2"; shift 2 ;;
    --team)
      [[ -z "$BEACON_TEAM" ]] || fail 'Duplicate --team.'
      [[ $# -ge 2 && -n "${2:-}" && "${2:-}" != --* ]] || fail 'Missing --team value.'
      BEACON_TEAM="$2"; shift 2 ;;
    --jobs)
      [[ $# -ge 2 && -n "${2:-}" && "${2:-}" != --* ]] || fail 'Missing --jobs value.'
      BEACON_JOBS="$2"; shift 2 ;;
    *) fail "Unknown argument: $1." ;;
  esac
done
[[ -n "$BEACON_DEVICE" && -n "$BEACON_TEAM" ]] || fail '--device and --team are both required.'
[[ "$BEACON_DEVICE" =~ ^[[:xdigit:]-]{16,64}$ ]] || fail 'Invalid device UDID format.'
[[ "$BEACON_TEAM" =~ ^[A-Z0-9]{10}$ ]] || fail 'Team ID must be ten uppercase letters/digits.'
[[ "$BEACON_JOBS" =~ ^[1-9][0-9]*$ ]] || fail '--jobs must be a positive integer.'

BEACON_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BEACON_IOS="$BEACON_ROOT/apps/mobile/ios"
command -v xcodebuild >/dev/null || { echo 'Xcode command-line tools are required.' >&2; exit 1; }
[[ -f "$BEACON_IOS/Beacon.xcworkspace/contents.xcworkspacedata" && -f "$BEACON_IOS/Pods/Manifest.lock" ]] || {
  echo 'Prepare the Expo iOS project and CocoaPods workspace before running this script.' >&2
  exit 1
}
mkdir -p "$BEACON_ROOT/tmp" "$BEACON_ROOT/dist/ios"
echo 'Building with your existing Xcode account and automatic development provisioning.'
NODE_ENV=production xcodebuild \
  -workspace "$BEACON_IOS/Beacon.xcworkspace" \
  -scheme Beacon -configuration Release -sdk iphoneos \
  -destination "id=$BEACON_DEVICE" \
  -derivedDataPath "$BEACON_ROOT/tmp/DerivedData" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  "DEVELOPMENT_TEAM=$BEACON_TEAM" CODE_SIGN_STYLE=Automatic \
  'CODE_SIGN_IDENTITY=Apple Development' CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES \
  ONLY_ACTIVE_ARCH=YES SKIP_BUNDLING= FORCE_BUNDLING=1 -jobs "$BEACON_JOBS" build \
  2>&1 | tee "$BEACON_ROOT/dist/ios/device-build.log"
BEACON_APP="$BEACON_ROOT/tmp/DerivedData/Build/Products/Release-iphoneos/Beacon.app"
test -s "$BEACON_APP/main.jsbundle"
test -s "$BEACON_APP/embedded.mobileprovision"
codesign --verify --deep --strict "$BEACON_APP"
printf 'Device app: %s\n' "$BEACON_APP"
echo 'Local development-signed build verified. Device installation is a separate step.'
