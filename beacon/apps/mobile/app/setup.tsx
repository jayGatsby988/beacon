import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { router } from "expo-router";
import { Bluetooth, MapPin } from "lucide-react-native";
import { useBeacon } from "../src/services/BeaconContext";
import { Body, Button, Card, ErrorNotice, Field, Screen, styles, useAction } from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";

export default function Setup() {
  const b = useBeacon();
  const [name, setName] = useState(b.displayName);
  const action = useAction();
  const bluetoothReady = b.bluetooth === "poweredOn";
  const needsSettings = b.bluetooth === "unauthorized" || b.bluetooth === "poweredOff";
  return (
    <Screen title="Welcome to Beacon">
      <Body muted>Connect with people nearby over Bluetooth. No account needed.</Body>
      <Field label="Your name (optional)" placeholder="Participant" value={name} maxLength={40} onChangeText={setName} autoComplete="given-name" editable={!action.busy} />
      <Card>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <Bluetooth color={c.text} size={23} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.smallTitle}>Bluetooth</Text>
            <Text style={styles.caption}>{bluetoothReady ? "Ready to connect" : b.bluetooth === "unsupported" ? "Unavailable on this device or build" : needsSettings ? "Allow access and turn Bluetooth on in Settings" : "Allow access to find nearby phones"}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <MapPin color={c.secondary} size={23} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.smallTitle}>Location is optional</Text>
            <Text style={styles.caption}>You choose whether to share your position on the map.</Text>
          </View>
        </View>
        {(!bluetoothReady || b.locationPermission === "undetermined") && (
          <Button secondary busy={action.busy} onPress={() => action.run(needsSettings ? () => Linking.openSettings() : b.requestPermissions)}>
            {needsSettings ? "Open phone settings" : "Set permissions"}
          </Button>
        )}
      </Card>
      <Body muted>Keep Beacon open on both phones to connect.</Body>
      <ErrorNotice message={action.error || b.error} />
      <Button busy={action.busy} onPress={() => action.run(async () => {
        await b.completeSetup(name.trim() || "Participant");
        router.replace("/(tabs)");
      })}>Get started</Button>
      <Body muted style={{ fontSize: 12, lineHeight: 19 }}>Beacon does not contact emergency services or guarantee help.</Body>
    </Screen>
  );
}
