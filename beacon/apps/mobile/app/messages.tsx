import { router } from "expo-router";
import { ChevronRight, MessageCircle, Radio } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "../src/components/ui";
import { useBeacon } from "../src/services/BeaconContext";
import { colors as c, fonts } from "../src/theme/tokens";
import { deliveryLabel, inboxRows, inboxTime, initials } from "../src/ui/inbox";
import type { DirectMessageView, PersonView } from "../src/ui/types";

function PersonRow({ person, latest }: { person: PersonView; latest?: DirectMessageView }) {
  const unread = person.unreadCount;
  const preview = latest ? `${latest.mine ? "You: " : ""}${latest.text}` : "Connected nearby · Start a conversation";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message ${person.name}. ${person.connected ? "Connected nearby." : "Not connected."} ${unread ? `${unread} unread. ` : ""}${preview}${latest ? `. ${inboxTime(latest.createdAt)}` : ""}${latest?.mine ? `. ${deliveryLabel(latest.status)}` : ""}`}
      onPress={() => router.push(`/chat/${person.nodeId}`)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.raised }]}
    >
      <View style={s.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={s.initials}>{initials(person.name)}</Text>
        {person.connected && <View style={s.connectedDot} />}
      </View>
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text numberOfLines={1} style={s.name}>{person.name}</Text>
          {latest && <Text style={s.time}>{inboxTime(latest.createdAt)}</Text>}
        </View>
        <View style={s.rowTop}>
          <Text numberOfLines={2} style={[s.preview, unread > 0 && s.unreadPreview]}>{preview}</Text>
          {unread > 0 ? <View style={s.badge}><Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text></View> : <ChevronRight size={16} color={c.muted} />}
        </View>
        {latest?.mine && <Text style={s.delivery}>{deliveryLabel(latest.status)}</Text>}
      </View>
    </Pressable>
  );
}

export default function Messages() {
  const b = useBeacon();
  const { conversations, connected } = inboxRows(b.people, b.messages, b.activeGroupId);
  const group = b.groups.find((item) => item.id === b.activeGroupId);
  const unread = conversations.reduce((total, row) => total + row.person.unreadCount, 0);
  return (
    <Screen back title="Messages">
      <View style={s.context}>
        <View style={s.contextIcon}><MessageCircle size={20} color={c.secondary} /></View>
        <View style={s.rowBody}>
          <Text style={s.contextTitle}>{b.activeGroupId ? group?.name || "Private group" : "Public nearby"}</Text>
          <Text style={s.contextDetail}>Direct messages · {unread ? `${unread} unread` : "No unread messages"}</Text>
        </View>
      </View>
      <View style={s.sectionHeading}>
        <Text accessibilityRole="header" style={s.sectionTitle}>Conversations</Text>
        <Text style={s.count}>{conversations.length}</Text>
      </View>
      {conversations.length ? (
        <View style={s.list}>{conversations.map(({ person, latest }) => <PersonRow key={person.nodeId} person={person} latest={latest} />)}</View>
      ) : (
        <View style={s.empty}>
          <MessageCircle size={28} color={c.muted} />
          <Text style={s.emptyTitle}>{b.loading ? "Loading conversations…" : "No conversations yet"}</Text>
          <Text style={s.emptyDetail}>Connect with someone nearby to start a direct conversation.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/nearby")} style={({ pressed }) => [s.nearby, pressed && { opacity: 0.7 }]}>
            <Radio size={18} color={c.text} /><Text style={s.nearbyText}>Find people nearby</Text><ChevronRight size={18} color={c.secondary} />
          </Pressable>
        </View>
      )}
      {connected.length > 0 && <>
        <View style={s.sectionHeading}><Text accessibilityRole="header" style={s.sectionTitle}>Connected nearby</Text><Text style={s.count}>{connected.length}</Text></View>
        <View style={s.list}>{connected.map((person) => <PersonRow key={person.nodeId} person={person} />)}</View>
      </>}
      <Text style={s.footnote}>Messages stay on this device and send directly when you connect to the recipient.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  context: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border },
  contextIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  contextTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 15, lineHeight: 21 },
  contextDetail: { fontFamily: fonts.body, color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  sectionTitle: { fontFamily: fonts.medium, color: c.secondary, fontSize: 13, lineHeight: 20 },
  count: { fontFamily: fonts.medium, color: c.muted, fontSize: 12 },
  list: { borderRadius: 16, backgroundColor: c.card, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  row: { flexDirection: "row", gap: 12, padding: 16, alignItems: "center", minHeight: 88 },
  avatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: fonts.medium, fontSize: 15, color: c.secondary },
  connectedDot: { position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: c.secondary, borderWidth: 2, borderColor: c.card },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: c.text },
  time: { fontFamily: fonts.body, fontSize: 11, color: c.muted },
  preview: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: c.muted },
  unreadPreview: { color: c.secondary },
  delivery: { fontFamily: fonts.body, color: c.muted, fontSize: 11, lineHeight: 16 },
  badge: { minWidth: 22, minHeight: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, color: c.text },
  empty: { borderRadius: 16, padding: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: "center", gap: 12 },
  emptyTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 17, textAlign: "center" },
  emptyDetail: { fontFamily: fonts.body, color: c.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  nearby: { marginTop: 4, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  nearbyText: { fontFamily: fonts.medium, color: c.text, fontSize: 13 },
  footnote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.muted, textAlign: "center", paddingHorizontal: 12 },
});
