import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Bluetooth, ChevronRight } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../services/BeaconContext";
import { colors as c, fonts } from "../theme/tokens";
import { ErrorNotice, useAction } from "./ui";

/** A single truthful connection summary with the relevant recovery action. */
export default function ConnectionControl({ compact = false }: { compact?: boolean }) {
  const b = useBeacon();
  const action = useAction();
  const connected = b.people.filter((p) => p.nodeId !== b.nodeId && p.scope === b.activeGroupId && p.connected).length;
  const unavailable = b.bluetooth === "unsupported";
  const needsSettings = b.bluetooth === "poweredOff" || b.bluetooth === "unauthorized";
  const busy = action.busy || b.findingPeople;
  const paused = !b.relayEnabled;
  const status = unavailable ? "Bluetooth unavailable"
    : b.bluetooth === "poweredOff" ? "Bluetooth is off"
      : b.bluetooth === "unauthorized" ? "Bluetooth access needed"
        : paused ? "Nearby is paused"
          : busy ? "Looking nearby…"
            : connected ? connected + (connected === 1 ? " person connected" : " people connected")
              : b.relayRunning ? "No one connected yet" : "Bluetooth not ready";
  const label = unavailable ? "Details" : needsSettings ? "Settings" : paused ? "Resume" : connected > 0 ? "Details" : "Find";
  const run = () => action.run(async () => {
    if (unavailable || (connected > 0 && !needsSettings && !paused)) router.push("/network");
    else if (needsSettings) await Linking.openSettings();
    else if (paused) await b.setRelayEnabled(true);
    else await b.findPeople();
  });
  if (compact) return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={label + ": " + status} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void run()} style={({ pressed }) => [s.compact, pressed && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator color={c.text} size="small" /> : connected > 0 && !paused && !needsSettings && !unavailable ? <View style={s.dot} /> : <Bluetooth size={14} color={c.secondary} />}
        <Text accessibilityLiveRegion="polite" style={s.compactText}>{status}</Text>
        <ChevronRight size={16} color={c.secondary} />
      </Pressable>
      <ErrorNotice message={action.error} />
    </View>
  );
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Bluetooth size={16} color={connected && !paused && !needsSettings ? c.connected : c.secondary} />
        <Text accessibilityLiveRegion="polite" style={s.status}>{status}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={label + ": " + status} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void run()} style={({ pressed }) => [s.action, pressed && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={c.text} size="small" /> : <><Text style={s.actionText}>{label}</Text><ChevronRight size={14} color={c.secondary} /></>}
        </Pressable>
      </View>
      <ErrorNotice message={action.error} />
    </View>
  );
}

const s = StyleSheet.create({
  compact: { minHeight: 44, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingVertical: 6 },
  compactText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: c.secondary },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.connected },
  wrap: { gap: 6 },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  status: { flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.secondary },
  action: { minHeight: 44, minWidth: 52, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 },
  actionText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: c.text },
});
