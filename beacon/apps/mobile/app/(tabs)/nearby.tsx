import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Radar,
  Users,
} from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  Heading,
  Screen,
  age,
  styles,
  useAction,
} from "../../src/components/ui";
import NearbyMap, {
  freshLocation,
  locationLabel,
} from "../../src/components/NearbyMap";
import { RequestCard } from "../../src/components/RequestCard";
import { colors as c, fonts } from "../../src/theme/tokens";

export default function Nearby() {
  const b = useBeacon();
  const { height } = useWindowDimensions();
  const [now, setNow] = useState(Date.now);
  const findAction = useAction();
  const shareAction = useAction();
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const clock = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(clock);
    }, []),
  );
  const group = b.groups.find((g) => g.id === b.activeGroupId);
  const scopeName =
    group?.name || (b.activeGroupId ? "Private group" : "Everyone nearby");
  const people = useMemo(
    () =>
      b.people
        .filter((p) => p.nodeId !== b.nodeId && p.scope === b.activeGroupId)
        .sort(
          (a, z) =>
            Number(z.connected) - Number(a.connected) ||
            z.unreadCount - a.unreadCount ||
            z.lastSeenAt - a.lastSeenAt,
        ),
    [b.people, b.nodeId, b.activeGroupId],
  );
  const connected = people.filter((person) => person.connected);
  const pins = connected.flatMap((person) =>
    freshLocation(person.location, now)
      ? [
          {
            nodeId: person.nodeId,
            name: person.name,
            location: person.location,
          },
        ]
      : [],
  );
  const requests = b.requests
    .filter(
      (r) =>
        !r.mine &&
        (r.groupId ?? null) === b.activeGroupId &&
        (r.status === "active" || r.status === "accepted"),
    )
    .sort((a, z) => z.createdAt - a.createdAt);
  const finding = b.findingPeople || findAction.busy;
  const status = finding
    ? "Looking for people…"
    : connected.length
      ? `${connected.length} ${connected.length === 1 ? "person" : "people"} connected`
      : b.bluetooth === "unsupported"
        ? "Bluetooth unavailable"
        : b.bluetooth === "poweredOff"
          ? "Bluetooth is off"
          : b.bluetooth === "unauthorized"
            ? "Bluetooth permission needed"
            : !b.relayEnabled
              ? "Nearby sharing is off"
              : b.relayRunning
                ? "Ready to connect"
                : "Not connected";
  return (
    <Screen>
      <View style={s.headingRow}>
        <View style={{ flex: 1, gap: 7 }}>
          <Heading size={34}>Nearby</Heading>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sharing with ${scopeName}. Change group`}
          onPress={() => router.push("/groups")}
          style={s.scope}
        >
          {b.activeGroupId ? (
            <LockKeyhole size={16} color={c.text} />
          ) : (
            <Users size={16} color={c.text} />
          )}
          <Text numberOfLines={2} style={s.scopeName}>
            {group?.name || (b.activeGroupId ? "Private group" : "Everyone")}
          </Text>
          <ChevronDown size={16} color={c.secondary} />
        </Pressable>
      </View>
      {requests.length > 0 && (
        <View style={{ gap: 14 }}>
          <Heading size={22}>Help nearby</Heading>
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </View>
      )}
      <View style={s.connection}>
        <View style={{ flex: 1, gap: 5 }}>
          <View style={s.statusRow}>
            <View
              style={[
                s.statusDot,
                connected.length > 0 && { backgroundColor: c.text },
              ]}
            />
            <Text accessibilityLiveRegion="polite" style={s.status}>
              {status}
            </Text>
          </View>
          {!connected.length && (
            <Text style={s.caption}>Keep Beacon open on both phones.</Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            finding ? "Finding nearby people" : "Find nearby people"
          }
          accessibilityState={{
            busy: finding,
            disabled: finding || b.bluetooth === "unsupported",
          }}
          disabled={finding || b.bluetooth === "unsupported"}
          onPress={() => void findAction.run(b.findPeople)}
          style={({ pressed }) => [
            s.find,
            (finding || b.bluetooth === "unsupported") && { opacity: 0.55 },
            pressed && { opacity: 0.75 },
          ]}
        >
          {finding ? (
            <ActivityIndicator color={c.onAction} />
          ) : (
            <Radar color={c.onAction} size={20} />
          )}
          <Text style={s.findText}>{finding ? "Finding" : "Find people"}</Text>
        </Pressable>
      </View>
      <ErrorNotice message={findAction.error || shareAction.error} />
      <NearbyMap
        key={b.activeGroupId ?? "public"}
        ownLocation={b.location}
        pins={pins}
        internet={b.internet}
        map={b.map}
        onSaveArea={b.downloadMap}
        onCancelSave={b.cancelMapDownload}
        now={now}
        height={Math.max(300, Math.min(420, height * 0.43))}
      />
      <View style={s.sharing}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={s.sharingTitle}>Share my location</Text>
          <Text style={s.caption}>
            {b.activeGroupId
              ? `With ${scopeName} only`
              : "With everyone nearby"}
            {b.locationSharing ? " · while open" : ""}
          </Text>
        </View>
        <Switch
          accessibilityLabel={`Share my location with ${scopeName}`}
          accessibilityHint="Only recent location reports are shared while Beacon is open."
          value={b.locationSharing}
          disabled={shareAction.busy}
          onValueChange={(enabled) =>
            void shareAction.run(() => b.setLocationSharing(enabled))
          }
          trackColor={{ false: c.border, true: c.secondary }}
          thumbColor={c.text}
        />
      </View>
      <View style={s.sectionHeading}>
        <Heading size={22}>People</Heading>
        {!!people.length && <Text style={s.sectionCount}>{people.length}</Text>}
      </View>
      {people.length ? (
        <View style={s.people}>
          {people.map((person, index) => {
            const location =
              person.connected && freshLocation(person.location, now)
                ? person.location
                : undefined;
            return (
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
                    {person.name.trim().slice(0, 2).toUpperCase() || "?"}
                  </Text>
                  {person.connected && <View style={s.connectedDot} />}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.smallTitle}>{person.name}</Text>
                  <Text style={s.caption}>
                    {location
                      ? `Location ${locationLabel(location, now)}`
                      : person.connected
                        ? "Connected · no recent location"
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
            );
          })}
        </View>
      ) : (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Users size={24} color={c.secondary} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={s.sharingTitle}>No one connected yet</Text>
            <Text style={s.caption}>
              {b.activeGroupId
                ? "Use the same group invite on both phones."
                : "Tap Find people on both phones."}
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  headingRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  scope: {
    minHeight: 48,
    maxWidth: "52%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  scopeName: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: c.text,
    flexShrink: 1,
  },
  connection: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.muted },
  status: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 19,
    color: c.text,
    flexShrink: 1,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
  },
  find: {
    minHeight: 48,
    maxWidth: "48%",
    borderRadius: 16,
    backgroundColor: c.red,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 13,
  },
  findText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: c.onAction,
    flexShrink: 1,
  },
  sharing: {
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  sharingTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 22,
    color: c.text,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  sectionCount: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: c.secondary,
    backgroundColor: c.card,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  people: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: c.card,
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 16,
    minHeight: 86,
  },
  separator: { borderTopWidth: 1, borderTopColor: c.border },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    position: "absolute",
    bottom: 0,
    right: 1,
    backgroundColor: c.text,
    borderWidth: 2,
    borderColor: c.card,
  },
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
  empty: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    paddingVertical: 10,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: c.card,
    alignItems: "center",
    justifyContent: "center",
  },
});
