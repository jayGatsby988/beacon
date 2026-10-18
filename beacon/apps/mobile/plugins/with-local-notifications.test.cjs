const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getPrebuildConfigAsync } = require('@expo/prebuild-config');
const { compileModsAsync } = require('@expo/config-plugins');

test('the complete Expo config keeps local notifications without an APNs signing requirement', async () => {
  const projectRoot = path.join(__dirname, '..');
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ['ios', 'android'] });
  const compiled = await compileModsAsync(exp, { projectRoot, introspect: true });
  const ios = compiled._internal.modResults.ios;
  assert.equal(ios.entitlements['aps-environment'], undefined);
  assert.deepEqual(ios.infoPlist.UIBackgroundModes, ['bluetooth-central', 'bluetooth-peripheral']);
  const permissions = compiled._internal.modResults.android.manifest.manifest['uses-permission'];
  assert.ok(permissions.some(item => item.$['android:name'] === 'android.permission.POST_NOTIFICATIONS'));
  assert.ok(compiled._internal.pluginHistory['expo-notifications']);
});
