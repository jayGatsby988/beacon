import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Users,
} from "lucide-react-native";
import { router } from "expo-router";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  Card,
  Heading,
  Screen,
  TextButton,
  age,
  styles,
} from "../../src/components/ui";
import { RequestCard } from "../../src/components/RequestCard";
import { colors as c, fonts } from "../../src/theme/tokens";

export default function Nearby() {
  const b = useBeacon();
  const group = b.groups.find((g) => g.id === b.activeGroupId);
  const people = b.people
    .filter((p) => p.nodeId !== b.nodeId && p.scope === b.activeGroupId)
    .sort(
      (a, z) =>
        Number(z.connected) - Number(a.connected) ||
        z.unreadCount - a.unreadCount ||
        z.lastSeenAt - a.lastSeenAt,
    );
  const requests = b.requests
    .filter(
      (r) =>
        !r.mine &&
        (r.groupId ?? null) === b.activeGroupId &&
        (r.status === "active" || r.status === "accepted"),
    )
    .sort((a, z) => z.createdAt - a.createdAt);
  return (
    <Screen network={b.relayRunning ? "Listening" : "Connection"}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sharing with ${group?.name || (b.activeGroupId ? "Private group" : "Nearby")}. Change group`}
        onPress={() => router.push("/groups")}
        style={s.scope}
      >
        {group ? (
          <LockKeyhole size={20} color={c.secondary} />
        ) : (
          <Users size={20} color={c.secondary} />
        )}
        <Text style={s.scopeName}>
          {group?.name || (b.activeGroupId ? "Private group" : "Nearby")}
        </Text>
        <ChevronDown size={20} color={c.secondary} />
      </Pressable>
      <Heading>People</Heading>
      {people.length ? (
        <View style={s.people}>
          {people.map((person, index) => (
            <Pressable
              key={person.nodeId}
              accessibilityRole="button"
              accessibilityLabel={`Message ${person.name}. ${person.connected ? "Connected" : `Last seen ${age(person.lastSeenAt)}`}${person.unreadCount ? `. ${person.unreadCount} unread messages` : ""}`}
              onPress={() => router.push(`/chat/${person.nodeId}`)}
              style={({ pressed }) => [
                s.person,
                index > 0 && s.separator,
                pressed && { opacity: 0.65 },
              ]}
            >
              <View style={s.avatar}>
                <Text style={s.initial}>
                  {person.name.trim().slice(0, 1).toUpperCase() || "?"}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.smallTitle}>{person.name}</Text>
                <Text style={styles.caption}>
                  {person.connected
                    ? "Connected"
                    : `Last seen ${age(person.lastSeenAt)}`}
                </Text>
              </View>
              {person.unreadCount > 0 && (
                <View style={s.unread}>
                  <Text style={s.unreadText}>
                    {person.unreadCount > 99 ? "99+" : person.unreadCount}
                  </Text>
                </View>
              )}
              <ChevronRight size={20} color={c.secondary} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Card>
          <Text style={styles.smallTitle}>
            {group ? "No group members connected yet" : "No people found yet"}
          </Text>
          <Text style={styles.caption}>
            {b.relayRunning
              ? "Keep Beacon open on both phones."
              : b.bluetooth === "unsupported"
                ? "Bluetooth discovery requires a supported phone."
                : b.bluetooth === "poweredOff"
                  ? "Turn on Bluetooth to find people."
                  : b.bluetooth === "unauthorized"
                    ? "Allow Bluetooth in Settings."
                    : "Enable sharing to find people."}
          </Text>
          {!b.relayRunning && b.bluetooth !== "unsupported" && (
            <TextButton onPress={() => router.push("/network")}>
              Connection settings
            </TextButton>
          )}
        </Card>
      )}
      <View style={{ gap: 5, marginTop: 10 }}>
        <Heading size={24}>Requests</Heading>
        {requests.length > 0 && (
          <Text style={styles.caption}>
            {requests.length} active · Latest first
          </Text>
        )}
      </View>
      {requests.length ? (
        requests.map((request) => (
          <RequestCard key={request.id} request={request} />
        ))
      ) : (
        <Text style={styles.caption}>No active requests.</Text>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  scope: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingVertical: 10,
  },
  scopeName: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: c.text,
    flexShrink: 1,
  },
  people: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: c.card,
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    minHeight: 80,
  },
  separator: { borderTopWidth: 1, borderTopColor: c.border },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fonts.medium, fontSize: 18, color: c.text },
  unread: {
    minWidth: 25,
    minHeight: 25,
    borderRadius: 13,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: fonts.medium, fontSize: 12, color: c.background },
});
