const fs = require('node:fs');
const path = require('node:path');
const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

const marker = '// @beacon-scene-lifecycle';
const sceneDelegate = fs.readFileSync(path.join(__dirname, 'beacon-scene-delegate.swift'), 'utf8');

function addSceneLifecycle(source) {
  if (source.includes(marker)) return source;
  const legacyWindow = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s+#endif/;
  if (!source.includes('var window: UIWindow?') || !legacyWindow.test(source)) {
    throw new Error('Beacon scene plugin expected the Expo SDK 54 Swift AppDelegate. Review scene integration after changing the native template.');
  }
  return source
    .replace('var window: UIWindow?', 'var window: UIWindow?\n  var beaconLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
    .replace(legacyWindow, '    // The scene creates its UIWindow and starts React Native after Expo initialization.\n    beaconLaunchOptions = launchOptions')
    + '\n' + marker + '\n' + sceneDelegate;
}

function addSceneManifest(infoPlist) {
  infoPlist.UIApplicationSceneManifest = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{
        UISceneConfigurationName: 'Beacon',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).BeaconSceneDelegate',
      }],
    },
  };
  return infoPlist;
}

module.exports = config => {
  config = withInfoPlist(config, mod => {
    mod.modResults = addSceneManifest(mod.modResults);
    return mod;
  });
  return withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw new Error('Beacon scene plugin requires a Swift AppDelegate.');
    mod.modResults.contents = addSceneLifecycle(mod.modResults.contents);
    return mod;
  });
};
module.exports.addSceneLifecycle = addSceneLifecycle;
module.exports.addSceneManifest = addSceneManifest;
