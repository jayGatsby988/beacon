import { useState } from "react";
import { Alert, Keyboard, Linking, Pressable, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { Bluetooth, ChevronDown, ChevronRight, Clock3, LockKeyhole, Map, Radio, type LucideIcon } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import { Body, Button, Card, ErrorNotice, Field, Screen, styles, useAction } from "../src/components/ui";
import { colors as c, fonts } from "../src/theme/tokens";

export default function Settings() {
  const b = useBeacon();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 350 || fontScale >= 1.4;
  const [name, setName] = useState(b.displayName);
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const action = useAction();
  const hasChanges = name.trim() !== b.displayName;
  const saveName = () => {
    if (!hasChanges || action.busy) return;
    void action.run(async () => {
      const displayName = name.trim() || "Participant";
      await b.saveSettings({ displayName });
      setName(displayName);
      setEditing(false);
      Keyboard.dismiss();
    });
  };
  const initials = b.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "B";
  return (
    <Screen back title="Profile">
      <View style={[s.identity, stacked && { flexDirection: "column", alignItems: "flex-start" }]}>
        <View style={s.avatar}><Text maxFontSizeMultiplier={1.4} style={s.initials}>{initials}</Text></View>
        <View style={[s.copy, stacked && { flex: 0, width: "100%" }]}>
          <Text style={s.name}>{b.displayName || "Participant"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Cancel editing name" : "Edit name"} accessibilityState={{ expanded: editing, disabled: action.busy }} disabled={action.busy} onPress={() => { setName(b.displayName); setEditing((value) => !value); }} style={s.edit}><Text style={s.editText}>{editing ? "Cancel" : "Edit"}</Text></Pressable>
      </View>
      {editing && <Card>
        <Field label="Your name" value={name} onChangeText={setName} maxLength={40} editable={!action.busy} autoFocus returnKeyType="done" onSubmitEditing={saveName} />
        <Button secondary disabled={!hasChanges} busy={action.busy} onPress={saveName}>Save name</Button>
      </Card>}
      <View style={s.section}>
        <Text style={s.sectionTitle}>YOUR NETWORK</Text>
        <View style={s.links}>
          <SettingsLink icon={LockKeyhole} title="Private groups" detail={b.groups.length ? `${b.groups.length} saved ${b.groups.length === 1 ? "group" : "groups"}` : undefined} onPress={() => router.push("/groups")} />
          <SettingsLink icon={Radio} title="Connections" onPress={() => router.push("/network")} />
          <SettingsLink icon={Map} title="Location & map" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "map" } })} />
          <SettingsLink icon={Clock3} title="Request history" last onPress={() => router.push("/history")} />
        </View>
      </View>
      <Card>
        <View style={s.row}>
          <View style={s.copy}>
            <Text style={styles.smallTitle}>Nearby sharing</Text>
            <Body muted style={s.detail}>{b.relayEnabled ? "Send, receive and relay while open." : "Paused. Saved messages stay here."}</Body>
          </View>
          <Switch accessibilityLabel="Nearby sharing" value={b.relayEnabled} disabled={action.busy} onValueChange={(value) => action.run(() => b.setRelayEnabled(value))} trackColor={{ false: c.border, true: c.text }} thumbColor={c.onAction} />
        </View>
        <SettingsLink icon={Bluetooth} title="Phone permissions" detail={b.bluetooth === "poweredOn" ? "Bluetooth is ready" : b.bluetooth === "unsupported" ? "Bluetooth unavailable in this build" : "Check Bluetooth and location access"} last plain disabled={action.busy} onPress={() => action.run(() => Linking.openSettings())} />
      </Card>
      <ErrorNotice message={action.error} />
      <View style={s.section}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced((value) => !value)} style={s.disclosure}>
          <Text style={styles.smallTitle}>Advanced</Text>
          {advanced ? <ChevronDown size={20} color={c.secondary} /> : <ChevronRight size={20} color={c.secondary} />}
        </Pressable>
        {advanced && <View style={s.links}>
          <SettingsLink title="Incident connection" detail="Optional cloud history" onPress={() => router.push("/incident")} />
          <SettingsLink title="Export diagnostics" detail="No names, notes or precise locations" disabled={action.busy} onPress={() => action.run(b.exportDiagnostics)} />
          <SettingsLink title="Clear old history" last disabled={action.busy} onPress={() => Alert.alert("Clear old history?", "Remove eligible expired requests and older activity on this phone. Active requests and pending uploads stay saved.", [
            { text: "Cancel", style: "cancel" },
            { text: "Clear old history", style: "destructive", onPress: () => { void action.run(b.clearHistory); } },
          ])} />
        </View>}
      </View>
    </Screen>
  );
}
function SettingsLink({ title, detail, icon: Icon, last, plain, disabled, onPress }: { title: string; detail?: string; icon?: LucideIcon; last?: boolean; plain?: boolean; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.row, s.link, !last && s.separator, plain && { paddingHorizontal: 0 }, (pressed || disabled) && { opacity: 0.6 }]}>
    {Icon && <View style={s.linkIcon}><Icon size={20} strokeWidth={1.7} color={c.secondary} /></View>}
    <View style={s.copy}><Text style={s.linkTitle}>{title}</Text>{detail && <Text style={s.detail}>{detail}</Text>}</View>
    <ChevronRight size={18} color={c.muted} />
  </Pressable>;
}
const s = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 },
  avatar: { width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: c.border, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: fonts.medium, fontSize: 20, color: c.text },
  name: { fontFamily: fonts.medium, fontSize: 22, lineHeight: 28, color: c.text, letterSpacing: -0.6 },
  edit: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  editText: { fontFamily: fonts.medium, fontSize: 14, color: c.text },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, gap: 4 },
  detail: { fontFamily: fonts.body, color: c.secondary, fontSize: 12, lineHeight: 18 },
  section: { gap: 10 },
  sectionTitle: { fontFamily: fonts.medium, color: c.muted, fontSize: 11, letterSpacing: 1.4 },
  links: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: "hidden" },
  link: { minHeight: 60, paddingVertical: 14, paddingHorizontal: 16 },
  linkTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 15, lineHeight: 21 },
  linkIcon: { width: 28, alignItems: "center" },
  separator: { borderBottomWidth: 1, borderBottomColor: c.border },
  disclosure: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: 4 },
});
