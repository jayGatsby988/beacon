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
    </View>
  );
}

const s = StyleSheet.create({
  header: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 20, paddingTop: 3, paddingBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  actions: { flexDirection: "row", gap: 5 },
  icon: { width: 48, minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.card },
  badge: { position: "absolute", top: -2, right: -3, minWidth: 19, minHeight: 19, borderRadius: 10, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: c.text, borderWidth: 2, borderColor: c.background },
  badgeText: { color: c.background, fontFamily: fonts.medium, fontSize: 10 },
  pressed: { opacity: 0.65 },
});
