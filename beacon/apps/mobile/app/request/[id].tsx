import { Redirect } from "expo-router";

// Compatibility for previously opened routes. All SOS actions now stay on Help.
export default function LegacyRequestRoute() {
  return <Redirect href="/(tabs)" />;
}
