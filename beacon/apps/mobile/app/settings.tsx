import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import { Body, Button, Card, ErrorNotice, Field, Screen, styles, useAction } from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";

export default function Settings() {
  const b = useBeacon();
  const [name, setName] = useState(b.displayName);
  const [advanced, setAdvanced] = useState(false);
  const action = useAction();
  const hasChanges = name !== b.displayName;
  return (
    <Screen back title="Settings">
      <Card>
        <Field label="Your name" value={name} onChangeText={setName} maxLength={40} editable={!action.busy} />
        {hasChanges && (
          <Button secondary busy={action.busy} onPress={() => action.run(async () => {
            const displayName = name.trim() || "Participant";
            await b.saveSettings({ displayName });
            setName(displayName);
          })}>Save name</Button>
        )}
      </Card>
      <Card>
        <View style={s.row}>
          <View style={s.copy}>
            <Text style={styles.smallTitle}>Nearby sharing</Text>
            <Body muted style={s.detail}>{b.relayEnabled ? "Send and receive while Beacon is open." : "Paused. Your saved messages stay on this phone."}</Body>
          </View>
          <Switch accessibilityLabel="Nearby sharing" value={b.relayEnabled} disabled={action.busy} onValueChange={(value) => action.run(() => b.setRelayEnabled(value))} trackColor={{ false: c.border, true: c.secondary }} thumbColor={c.text} />
        </View>
        <SettingsLink title="Phone permissions" detail={b.bluetooth === "poweredOn" ? "Bluetooth is ready" : b.bluetooth === "unsupported" ? "Bluetooth is unavailable on this device or build" : "Check Bluetooth and location access"} disabled={action.busy} onPress={() => action.run(() => Linking.openSettings())} />
      </Card>
      <ErrorNotice message={action.error} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced((value) => !value)} style={s.disclosure}>
        <Text style={styles.smallTitle}>Advanced</Text>
        {advanced ? <ChevronDown size={20} color={c.secondary} /> : <ChevronRight size={20} color={c.secondary} />}
      </Pressable>
      {advanced && (
        <Card>
          <SettingsLink title="Connection details" onPress={() => router.push("/network")} />
          <SettingsLink title="Request history" onPress={() => router.push("/history")} />
          <SettingsLink title="Incident connection" detail="Optional upload and shared history." onPress={() => router.push("/incident")} />
          <SettingsLink title="Export diagnostics" detail="No names, notes or precise locations." disabled={action.busy} onPress={() => action.run(b.exportDiagnostics)} />
          <SettingsLink title="Clear old history" disabled={action.busy} onPress={() => Alert.alert("Clear old history?", "Remove eligible expired requests and older activity on this phone. Active requests and pending uploads stay saved.", [
            { text: "Cancel", style: "cancel" },
            { text: "Clear old history", style: "destructive", onPress: () => { void action.run(b.clearHistory); } },
          ])} />
        </Card>
      )}
    </Screen>
  );
}
function SettingsLink({ title, detail, disabled, onPress }: { title: string; detail?: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.row, s.link, (pressed || disabled) && { opacity: 0.6 }]}>
    <View style={s.copy}><Body>{title}</Body>{detail && <Body muted style={s.detail}>{detail}</Body>}</View>
    <ChevronRight size={20} color={c.secondary} />
  </Pressable>;
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 16 },
  copy: { flex: 1, gap: 5 },
  detail: { fontSize: 13, lineHeight: 19 },
  link: { minHeight: 48, paddingVertical: 8 },
  disclosure: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: 4 },
});
