import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MessageSquare, UserRound } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../services/BeaconContext";
import { colors as c, fonts } from "../theme/tokens";
import ConnectionControl from "./ConnectionControl";

export default function MainHeader({ brand, showConnection = false }: { brand: ReactNode; showConnection?: boolean }) {
  const b = useBeacon();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 350 && fontScale > 1.25 || fontScale > 1.6;
  const people = b.people.filter((person) => person.scope === b.activeGroupId && person.nodeId !== b.nodeId);
  const unread = people.reduce((count, person) => count + person.unreadCount, 0);
  return (
    <View style={[s.header, { paddingHorizontal: width < 360 ? 20 : 24 }]}>
      <View style={[s.row, stacked && s.stacked]}>
        <View style={[s.brand, stacked && s.stackedBrand]}>{brand}</View>
        <View style={s.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Messages, ${unread} unread` : "Messages"} onPress={() => router.push("/messages")} style={({ pressed }) => [s.icon, pressed && s.pressed]}>
            <View><MessageSquare size={25} strokeWidth={1.8} color={c.text} />
              {unread > 0 && <View pointerEvents="none" style={s.badge}><Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text></View>}
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.label}>Messages</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" onPress={() => router.push("/settings")} style={({ pressed }) => [s.icon, pressed && s.pressed]}>
            <UserRound size={25} strokeWidth={1.8} color={c.text} />
            <Text maxFontSizeMultiplier={1.4} style={s.label}>Profile</Text>
          </Pressable>
        </View>
      </View>
      {showConnection && <ConnectionControl compact />}
    </View>
  );
}

const s = StyleSheet.create({
  header: { width: "100%", maxWidth: 640, alignSelf: "center", paddingTop: 8, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 60 },
  stacked: { flexDirection: "column", alignItems: "flex-start", gap: 4 },
  brand: { flex: 1, minWidth: 0 },
  stackedBrand: { flex: 0, width: "100%" },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { minWidth: 48, minHeight: 56, paddingVertical: 4, alignItems: "center", justifyContent: "center", gap: 5 },
  label: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: c.secondary },
  badge: { position: "absolute", top: -7, right: -12, minWidth: 19, minHeight: 19, borderRadius: 10, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: c.text, borderWidth: 2, borderColor: c.background },
  badgeText: { color: c.background, fontFamily: fonts.medium, fontSize: 10 },
  pressed: { opacity: 0.65 },
});
