const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { addSceneLifecycle, addSceneManifest } = require('./with-scene-lifecycle.cjs');

const expoRoot = path.dirname(require.resolve('expo/package.json'));
const template = execFileSync('tar', ['-xOzf', path.join(expoRoot, 'template.tgz'),
  'package/ios/HelloWorld/AppDelegate.swift'], { encoding: 'utf8' });

test('migrates the installed Expo template while preserving Expo startup and link overrides', () => {
  const migrated = addSceneLifecycle(template);
  assert.match(migrated, /UIWindow\(windowScene: windowScene\)/);
  assert.doesNotMatch(migrated, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
  assert.equal(migrated.split('factory.startReactNative(').length - 1, 1);
  assert.equal(migrated.split('return super.application(application, didFinishLaunchingWithOptions: launchOptions)').length - 1, 1);
  assert.match(migrated, /bindReactNativeFactory\(factory\)/);
  const existingLinkHandlers = template.slice(template.indexOf('  // Linking API'));
  assert.ok(migrated.includes(existingLinkHandlers));
  assert.ok(migrated.indexOf('forwardConnectionLinks(connectionOptions)\n    let sceneWindow') < migrated.indexOf('factory.startReactNative('));
  assert.match(migrated, /launchOptions\[\.userActivityDictionary\]/);
  assert.match(migrated, /launchOptions\[\.url\]/);
});

test('reapplying migration is idempotent and does not start a second React runtime', () => {
  const migrated = addSceneLifecycle(template);
  assert.equal(addSceneLifecycle(migrated), migrated);
  assert.equal(migrated.split('class BeaconSceneDelegate:').length - 1, 1);
  assert.match(migrated, /if let existingWindow = delegate.window \{[\s\S]*?existingWindow.windowScene = windowScene[\s\S]*?return/);
});

test('unsupported or already scene-enabled templates fail explicitly', () => {
  assert.throws(() => addSceneLifecycle('class AppDelegate {}'), /expected the Expo SDK 54/);
  assert.throws(() => addSceneLifecycle(template.replace('UIScreen.main.bounds', 'anotherFrame')), /expected the Expo SDK 54/);
});

test('scene manifest preserves unrelated app metadata and configures one application scene', () => {
  const info = { CFBundleURLTypes: [{ CFBundleURLSchemes: ['beacon'] }], UIBackgroundModes: ['bluetooth-central'] };
  const updated = addSceneManifest(info);
  assert.deepEqual(updated.CFBundleURLTypes, [{ CFBundleURLSchemes: ['beacon'] }]);
  assert.deepEqual(updated.UIBackgroundModes, ['bluetooth-central']);
  assert.equal(updated.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes, false);
  const scenes = updated.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).BeaconSceneDelegate');
  assert.deepEqual(addSceneManifest(structuredClone(updated)), updated);
});
