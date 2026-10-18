// Expo SDK 54's EXConstants script loses shell quoting when the checkout has spaces.
// Keep this narrow patch until upgrading to a release that handles those paths.
const fs = require('node:fs');
const path = require('node:path');
const base = path.dirname(require.resolve('expo-constants/package.json'));
function patch(file, before, after) {
  const target = path.join(base, file);
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Expo path patch needs review: ${file}`);
  fs.writeFileSync(target, source.replace(before, after));
}
patch('scripts/get-app-config-ios.sh', '$(basename $PROJECT_DIR)', '$(basename "$PROJECT_DIR")');
patch('ios/EXConstants.podspec',
  ':script => "bash -l -c \\"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"",',
  ':script => \'bash "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"\',');
console.log('Expo Constants shell paths are quoted.');
