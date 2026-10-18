import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Bluetooth, ChevronRight, MessageCircle, UserRound } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../services/BeaconContext";
import { colors as c, fonts } from "../theme/tokens";

export default function MainHeader({ brand }: { brand: ReactNode }) {
  const b = useBeacon();
  const people = b.people.filter((person) => person.scope === b.activeGroupId && person.nodeId !== b.nodeId);
  const connected = people.filter((person) => person.connected).length;
  const unread = people.reduce((count, person) => count + person.unreadCount, 0);
  const status = b.bluetooth === "unsupported"
    ? "Bluetooth unavailable"
    : b.bluetooth === "unauthorized"
      ? "Bluetooth access needed"
      : b.bluetooth === "poweredOff"
        ? "Bluetooth is off"
        : !b.relayEnabled
          ? "Nearby is paused"
          : connected
            ? `Bluetooth · ${connected} connected`
            : b.relayRunning
              ? "Bluetooth ready · no connections yet"
              : "Bluetooth not ready";
  return (
    <View style={s.header}>
      <View style={s.row}>
        {brand}
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unread ? `Messages, ${unread} unread` : "Messages"}
            onPress={() => router.push("/messages")}
            style={({ pressed }) => [s.icon, pressed && s.pressed]}
          >
            <MessageCircle size={22} strokeWidth={1.7} color={c.text} />
            {unread > 0 && <View pointerEvents="none" style={s.badge}><Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text></View>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [s.icon, pressed && s.pressed]}
          >
            <UserRound size={22} strokeWidth={1.7} color={c.text} />
          </Pressable>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${status}. Connection details`}
        onPress={() => router.push("/network")}
        style={({ pressed }) => [s.connection, pressed && s.pressed]}
      >
        <Bluetooth size={14} color={c.secondary} />
        <Text style={s.status}>{status}</Text>
        <ChevronRight size={14} color={c.muted} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  header: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 20, paddingTop: 3, paddingBottom: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  actions: { flexDirection: "row", gap: 5 },
  icon: { width: 48, minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  connection: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start" },
  status: { color: c.secondary, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  badge: { position: "absolute", top: -2, right: -3, minWidth: 19, minHeight: 19, borderRadius: 10, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: c.text, borderWidth: 2, borderColor: c.background },
  badgeText: { color: c.background, fontFamily: fonts.medium, fontSize: 10 },
  pressed: { opacity: 0.65 },
});
