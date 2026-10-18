import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MessageCircle, UserRound } from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../services/BeaconContext";
import { colors as c, fonts } from "../theme/tokens";

export default function MainHeader({ brand }: { brand: ReactNode }) {
  const b = useBeacon();
  const people = b.people.filter((person) => person.scope === b.activeGroupId && person.nodeId !== b.nodeId);
  const unread = people.reduce((count, person) => count + person.unreadCount, 0);
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
            <MessageCircle size={23} strokeWidth={2} color={c.text} />
            <Text maxFontSizeMultiplier={1.3} style={s.actionLabel}>Messages</Text>
            {unread > 0 && <View pointerEvents="none" style={s.badge}><Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text></View>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [s.icon, pressed && s.pressed]}
          >
            <UserRound size={23} strokeWidth={2} color={c.text} />
            <Text maxFontSizeMultiplier={1.3} style={s.actionLabel}>Profile</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 20, paddingTop: 3, paddingBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  actions: { flexDirection: "row", flexShrink: 0, gap: 8 },
  actionLabel: { fontFamily: fonts.medium, color: c.secondary, fontSize: 10, lineHeight: 14 },
  icon: { minWidth: 54, minHeight: 54, borderRadius: 12, gap: 4, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -2, right: -3, minWidth: 19, minHeight: 19, borderRadius: 10, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: c.text, borderWidth: 2, borderColor: c.background },
  badgeText: { color: c.background, fontFamily: fonts.medium, fontSize: 10 },
  pressed: { opacity: 0.65 },
});
