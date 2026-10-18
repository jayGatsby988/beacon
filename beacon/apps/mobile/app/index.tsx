import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useBeacon } from "../src/services/BeaconContext";
import { Brand, Body } from "../src/components/ui";
import { colors } from "../src/theme/tokens";
export default function Index() {
  const b = useBeacon();
  if (b.loading)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <View>
          <Brand />
        </View>
        <ActivityIndicator color={colors.text} />
        <Body muted>Opening your local connection.</Body>
      </View>
    );
  return <Redirect href={b.setupComplete ? "/(tabs)" : "/setup"} />;
}
