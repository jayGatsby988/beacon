const { withXcodeProject } = require('@expo/config-plugins');

function quoteBundlePath(project) {
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase;
  for (const phase of Object.values(phases)) {
    if (!phase || typeof phase !== 'object' || !phase.shellScript) continue;
    const script = JSON.parse(phase.shellScript);
    const before = '`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'"`';
    const after = 'BEACON_BUNDLE_SCRIPT="$("$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'")"\n"$BEACON_BUNDLE_SCRIPT"';
    if (script.includes(before)) phase.shellScript = JSON.stringify(script.replace(before, after));
  }
  return project;
}

module.exports = config => withXcodeProject(config, mod => {
  quoteBundlePath(mod.modResults);
  return mod;
});
module.exports.quoteBundlePath = quoteBundlePath;
