#!/usr/bin/env bash
# Builds only when invoked; does not run npm install, prebuild, or signing-key setup.
set -euo pipefail
if [[ "${1:-}" == '--help' ]]; then
  echo 'Usage: scripts/build-android-release.sh'
  echo 'Requires Node 24, a prepared Expo Android project, JDK, and Android SDK 36/NDK 27.1.12297006.'
  echo 'Uses project-local .tooling defaults; respects JAVA_HOME, ANDROID_HOME, ANDROID_USER_HOME, GRADLE_USER_HOME.'
  echo 'Produces dist/android/beacon-community-arm64.apk and verification.json. Existing Expo signing config applies.'
  exit 0
fi
if [[ "$#" -ne 0 ]]; then echo 'Unexpected argument; use --help.' >&2; exit 2; fi
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Use Node.js 24 for reproducible release bundling."); process.exit(1); }'
if [[ ! -x apps/mobile/android/gradlew ]]; then
  echo 'Prepare the native project first: cd apps/mobile && npx expo prebuild --platform android --no-install' >&2
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-$PWD/.tooling/android-sdk}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$PWD/.tooling/android-user-home}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PWD/.tooling/gradle}"
if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  JAVA_HOME="$(/usr/libexec/java_home)"; export JAVA_HOME
fi
if [[ ! -f "$ANDROID_HOME/platforms/android-36/android.jar" ]]; then echo 'Android SDK platform 36 is missing.' >&2; exit 1; fi
for component in build-tools/36.0.0/aapt2 build-tools/35.0.0/aapt2 ndk/27.1.12297006/source.properties cmake/3.22.1/bin/cmake; do
  if [[ ! -f "$ANDROID_HOME/$component" ]]; then echo "Missing Android toolchain component: $component" >&2; exit 1; fi
done
mkdir -p dist/android
CI=1 NODE_ENV=production apps/mobile/android/gradlew -p apps/mobile/android \
  :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2 \
  2>&1 | tee dist/android/build.log
python3 scripts/verify-android-apk.py apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
  --output dist/android/verification.json
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk dist/android/beacon-community-arm64.apk
