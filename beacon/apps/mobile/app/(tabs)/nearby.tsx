import { Text, View } from "react-native";
import { Radio } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  Card,
  Heading,
  Screen,
  TextButton,
  styles,
} from "../../src/components/ui";
import { RequestCard } from "../../src/components/RequestCard";
import { colors as c } from "../../src/theme/tokens";

export default function Nearby() {
  const b = useBeacon();
  const requests = b.requests
    .filter(
      (r) => !r.mine && (r.status === "active" || r.status === "accepted"),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Screen network={b.relayRunning ? "Listening" : "Connection"}>
      <View style={{ gap: 6 }}>
        <Heading>Help nearby</Heading>
        {requests.length > 0 && (
          <Text style={styles.caption}>
            {requests.length} active{" "}
            {requests.length === 1 ? "request" : "requests"} · Latest first
          </Text>
        )}
      </View>
      {requests.length > 0 ? (
        <>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
          <Text style={styles.caption}>
            Relayed requests may come from farther away.
          </Text>
        </>
      ) : (
        <Card style={{ gap: 12, paddingVertical: 24 }}>
          <Radio size={28} color={c.secondary} />
          <Heading size={24}>No active requests</Heading>
          <Text style={styles.caption}>
            {b.relayRunning
              ? "Keep Beacon open to receive requests."
              : b.bluetooth === "unsupported"
                ? "Bluetooth unavailable on this device."
                : "Enable Bluetooth to receive requests."}
          </Text>
          {!b.relayRunning && b.bluetooth !== "unsupported" && (
            <TextButton onPress={() => router.push("/network")}>
              Connection settings
            </TextButton>
          )}
        </Card>
      )}
    </Screen>
  );
}
