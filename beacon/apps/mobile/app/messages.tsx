import { useMemo } from "react";
import { router } from "expo-router";
import { ChevronRight, MessageCircle, Radio } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "../src/components/ui";
import { useBeacon } from "../src/services/BeaconContext";
import { colors as c, fonts } from "../src/theme/tokens";
import { deliveryLabel, inboxRows, inboxTime, initials } from "../src/ui/inbox";
import type { DirectMessageView, PersonView } from "../src/ui/types";

function PersonRow({ person, latest, separated = false }: { person: PersonView; latest?: DirectMessageView; separated?: boolean }) {
  const unread = person.unreadCount;
  const preview = latest ? `${latest.mine ? "You: " : ""}${latest.text}` : "Connected nearby";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message ${person.name}. ${person.connected ? "Connected nearby." : "Not connected."} ${unread ? `${unread} unread. ` : ""}${preview}${latest ? `. ${inboxTime(latest.createdAt)}` : ""}${latest?.mine ? `. ${deliveryLabel(latest.status)}` : ""}`}
      onPress={() => router.push(`/chat/${person.nodeId}`)}
      style={({ pressed }) => [s.row, separated && s.separator, pressed && { backgroundColor: c.raised }]}
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
  const { conversations, connected } = useMemo(
    () => inboxRows(b.people, b.messages, b.activeGroupId),
    [b.people, b.messages, b.activeGroupId],
  );
  const group = b.groups.find((item) => item.id === b.activeGroupId);
  const unread = conversations.reduce((total, row) => total + row.person.unreadCount, 0);
  return (
    <Screen back title="Messages">
      <Text style={s.context}>
        {b.activeGroupId ? group?.name || "Private group" : "Everyone nearby"}{unread > 0 ? ` · ${unread} unread` : ""}
      </Text>
      {conversations.length > 0 && (
        <View style={s.list}>{conversations.map(({ person, latest }, index) => <PersonRow key={person.nodeId} person={person} latest={latest} separated={index > 0} />)}</View>
      )}
      {connected.length > 0 && <>
        <Text accessibilityRole="header" style={s.sectionTitle}>{conversations.length ? "Connected nearby" : "Start a conversation"}</Text>
        <View style={s.list}>{connected.map((person, index) => <PersonRow key={person.nodeId} person={person} separated={index > 0} />)}</View>
      </>}
      {!conversations.length && !connected.length && (
        <View style={s.empty}>
          <View style={s.emptyIcon}><MessageCircle size={30} color={c.secondary} /></View>
          <Text style={s.emptyTitle}>{b.loading ? "Loading messages…" : "Find someone nearby"}</Text>
          {!b.loading && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "people" } })} style={({ pressed }) => [s.nearby, pressed && { opacity: 0.7 }]}>
            <Radio size={19} color={c.text} /><Text style={s.nearbyText}>Find people</Text><ChevronRight size={18} color={c.secondary} />
          </Pressable>}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  context: { fontFamily: fonts.body, color: c.muted, fontSize: 13, lineHeight: 20 },
  sectionTitle: { fontFamily: fonts.medium, color: c.secondary, fontSize: 14, lineHeight: 21 },
  list: { borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", gap: 14, paddingVertical: 17, paddingHorizontal: 4, alignItems: "center", minHeight: 84 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  avatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: fonts.medium, fontSize: 15, color: c.secondary },
  connectedDot: { position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: c.secondary, borderWidth: 2, borderColor: c.background },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: c.text },
  time: { fontFamily: fonts.body, fontSize: 11, color: c.muted },
  preview: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: c.muted },
  unreadPreview: { color: c.secondary },
  delivery: { fontFamily: fonts.body, color: c.muted, fontSize: 11, lineHeight: 16 },
  badge: { minWidth: 22, minHeight: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, color: c.text },
  empty: { paddingHorizontal: 20, paddingVertical: 48, alignItems: "center", gap: 20 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.raised },
  emptyTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 21, lineHeight: 28, textAlign: "center" },
  nearby: { minHeight: 52, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16, backgroundColor: c.raised, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  nearbyText: { fontFamily: fonts.medium, color: c.text, fontSize: 15, flexShrink: 1 },
});
