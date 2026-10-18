import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Bluetooth, MapPin } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { useBeacon } from "../src/services/BeaconContext";
import { BeaconMark, Body, Button, Card, ErrorNotice, Field, Screen, styles, useAction } from "../src/components/ui";
import { colors as c, fonts } from "../src/theme/tokens";
import NotificationSettings from "../src/components/NotificationSettings";

export default function Setup() {
  const b = useBeacon();
  const [name, setName] = useState(b.displayName);
  const action = useAction();
  const bluetoothReady = b.bluetooth === "poweredOn";
  const needsSettings = b.bluetooth === "unauthorized" || b.bluetooth === "poweredOff";
  return (
    <Screen hideSettings>
      <View style={s.welcome}>
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" viewBox="0 0 360 180" preserveAspectRatio="xMidYMid slice">
            <Path d="M-20 160 48 70 95 125 153 20 220 115 265 58 385 170M-20 180 48 90 95 145 153 40 220 135 265 78 385 190M-20 200 48 110 95 165 153 60 220 155 265 98 385 210" fill="none" stroke={c.border} strokeWidth="1" opacity="0.5" />
          </Svg>
        </View>
        <BeaconMark size={54} />
        <Text accessibilityRole="header" style={s.title}>{"Help through\nnearby phones."}</Text>
        <Text style={s.intro}>Send an SOS or offer help. No account or internet required.</Text>
      </View>
      <Field label="Your name (optional)" placeholder="Participant" value={name} maxLength={40} onChangeText={setName} autoComplete="off" editable={!action.busy} />
      <Card>
        <View style={s.permission}>
          <Bluetooth color={c.text} size={23} />
          <View style={s.copy}>
            <Text style={styles.smallTitle}>Bluetooth</Text>
            <Text style={styles.caption}>{bluetoothReady ? "Ready to connect" : b.bluetooth === "unsupported" ? "Unavailable on this device or build" : needsSettings ? "Turn on Bluetooth and allow access in Settings." : "Connects to participating Beacon phones."}</Text>
          </View>
        </View>
        <View style={s.permission}>
          <MapPin color={c.secondary} size={23} />
          <View style={s.copy}>
            <Text style={styles.smallTitle}>Optional location</Text>
            <Text style={styles.caption}>Allow location to attach a position to SOS. Map sharing stays off until you enable it.</Text>
          </View>
        </View>
        {(!bluetoothReady || b.locationPermission === "undetermined") && (
          <Button secondary busy={action.busy} onPress={() => action.run(needsSettings ? () => Linking.openSettings() : b.requestPermissions)}>
            {needsSettings ? "Open phone settings" : "Set permissions"}
          </Button>
        )}
      </Card>
      <NotificationSettings />
      <ErrorNotice message={action.error || b.error} />
      <Button busy={action.busy} onPress={() => action.run(async () => {
        await b.completeSetup(name.trim() || "Participant");
        router.replace("/(tabs)");
      })}>Get started</Button>
      <Body muted style={s.note}>Keep Beacon open to connect. SOS does not call emergency services.</Body>
    </Screen>
  );
}
const s = StyleSheet.create({
  welcome: { borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: "hidden", padding: 24, alignItems: "center", gap: 12 },
  title: { fontFamily: fonts.medium, fontSize: 28, lineHeight: 33, letterSpacing: -0.9, textAlign: "center", color: c.text },
  intro: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, textAlign: "center", color: c.secondary, maxWidth: 270 },
  permission: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  copy: { flex: 1, gap: 4 },
  note: { fontSize: 12, lineHeight: 19, textAlign: "center", paddingHorizontal: 10 },
});
