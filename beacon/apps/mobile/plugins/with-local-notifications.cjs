const { withEntitlementsPlist } = require('@expo/config-plugins');

// Register BEFORE expo-notifications: Expo runs this mod chain in reverse order,
// so removal executes after the standard notification mod adds its entitlement.
// Local UNUserNotificationCenter alerts do not
// require APNs, and Personal Team profiles cannot sign the push entitlement.
module.exports = config => withEntitlementsPlist(config, mod => {
  delete mod.modResults['aps-environment'];
  return mod;
});
