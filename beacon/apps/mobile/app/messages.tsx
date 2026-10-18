import { memo, useMemo } from "react";
import { router } from "expo-router";
import { ChevronRight, MessageCircle, Radio } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Screen } from "../src/components/ui";
import { useBeacon } from "../src/services/BeaconContext";
import { colors as c, fonts } from "../src/theme/tokens";
import { deliveryLabel, inboxRows, inboxTime, initials } from "../src/ui/inbox";
import type { DirectMessageView, PersonView } from "../src/ui/types";

const PersonRow = memo(function PersonRow({ person, latest, stacked, separated = false }: { person: PersonView; latest?: DirectMessageView; stacked: boolean; separated?: boolean }) {
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
        <Text maxFontSizeMultiplier={1.4} style={s.initials}>{initials(person.name)}</Text>
        {person.connected && <View style={s.connectedDot} />}
      </View>
      <View style={s.rowBody}>
        <View style={[s.rowTop, stacked && s.stackedMeta]}>
          <Text style={s.name}>{person.name}</Text>
          {latest && <Text style={s.time}>{inboxTime(latest.createdAt)}</Text>}
        </View>
        <View style={s.rowTop}>
          <Text numberOfLines={stacked ? undefined : 2} style={[s.preview, unread > 0 && s.unreadPreview]}>{preview}</Text>
          {unread > 0 ? <View style={s.badge}><Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text></View> : <ChevronRight size={16} color={c.muted} />}
        </View>
        {latest?.mine && <Text style={s.delivery}>{deliveryLabel(latest.status)}</Text>}
      </View>
    </Pressable>
  );
});

export default function Messages() {
  const b = useBeacon();
  const { fontScale, width } = useWindowDimensions();
  const stacked = fontScale >= 1.5 || width < 350;
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
        <View style={s.list}>{conversations.map(({ person, latest }, index) => <PersonRow key={person.nodeId} person={person} latest={latest} stacked={stacked} separated={index > 0} />)}</View>
      )}
      {connected.length > 0 && <>
        <Text accessibilityRole="header" style={s.sectionTitle}>{conversations.length ? "Connected nearby" : "Start a conversation"}</Text>
        <View style={s.list}>{connected.map((person, index) => <PersonRow key={person.nodeId} person={person} stacked={stacked} separated={index > 0} />)}</View>
      </>}
      {!conversations.length && !connected.length && (
        <View style={s.empty}>
          <View style={s.emptyIcon}><MessageCircle size={30} color={c.secondary} /></View>
          <Text style={s.emptyTitle}>{b.loading ? "Loading messages…" : "Find someone nearby"}</Text>
          {!b.loading && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "people" } })} style={({ pressed }) => [s.nearby, pressed && { opacity: 0.7 }]}>
            <Radio size={19} color={c.onAction} /><Text style={s.nearbyText}>Find people</Text><ChevronRight size={18} color={c.onAction} />
          </Pressable>}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  context: { fontFamily: fonts.body, color: c.secondary, fontSize: 14, lineHeight: 21 },
  sectionTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 16, lineHeight: 23 },
  list: { width: "100%" },
  row: { flexDirection: "row", gap: 16, paddingVertical: 20, alignItems: "flex-start", minHeight: 88 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.raised, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  initials: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
  connectedDot: { position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: c.connected, borderWidth: 2, borderColor: c.background },
  rowBody: { flex: 1, minWidth: 0, gap: 5 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stackedMeta: { flexDirection: "column", gap: 3 },
  name: { flexGrow: 1, flexShrink: 1, fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: c.text },
  time: { flexShrink: 0, fontFamily: fonts.body, fontSize: 12, lineHeight: 19, color: c.muted },
  preview: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.secondary },
  unreadPreview: { color: c.text },
  delivery: { fontFamily: fonts.body, color: c.muted, fontSize: 12, lineHeight: 18 },
  badge: { minWidth: 24, minHeight: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: c.text, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.medium, fontSize: 12, color: c.onAction },
  empty: { paddingVertical: 56, alignItems: "center", gap: 24 },
  emptyIcon: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: fonts.medium, color: c.text, fontSize: 24, lineHeight: 31, textAlign: "center" },
  nearby: { minHeight: 52, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, backgroundColor: c.text, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  nearbyText: { fontFamily: fonts.medium, color: c.onAction, fontSize: 16, lineHeight: 23, flexShrink: 1 },
});
