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
import { ErrorNotice, Screen, age, useAction } from "../../src/components/ui";
import NearbyMap, { freshLocation } from "../../src/components/NearbyMap";
import { colors as c, fonts } from "../../src/theme/tokens";

export default function Nearby() {
  const b = useBeacon();
  const { height } = useWindowDimensions();
  const [mode, setMode] = useState<"people" | "map">("people");
  const [now, setNow] = useState(Date.now);
  const [mapFocusRevision, setMapFocusRevision] = useState(0);
  const findAction = useAction();
  const shareAction = useAction();
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const clock = setInterval(
        () => setNow(Date.now()),
        mode === "map" ? 1000 : 30_000,
      );
      return () => clearInterval(clock);
    }, [mode]),
  );
  const { locationPermission, refreshLocation } = b;
  useFocusEffect(
    useCallback(() => {
      if (mode !== "map") return;
      let focused = true;
      if (locationPermission === "granted") {
        void refreshLocation()
          .then(() => {
            if (focused) setMapFocusRevision((revision) => revision + 1);
          })
          .catch(() => {});
      }
      return () => {
        focused = false;
      };
    }, [locationPermission, refreshLocation, mode]),
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
  const finding = b.findingPeople || findAction.busy;
  const unavailable = b.bluetooth === "unsupported";
  const status = finding
    ? "Looking nearby…"
    : unavailable
      ? "Bluetooth unavailable"
      : b.bluetooth === "poweredOff"
        ? "Bluetooth is off"
        : b.bluetooth === "unauthorized"
          ? "Bluetooth access needed"
          : !b.relayEnabled
            ? "Nearby sharing is off"
            : connected.length
              ? "Connected nearby"
              : b.relayRunning
                ? "Ready to connect"
                : "Not connected";
  return (
    <Screen title="Nearby">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Audience: ${scopeName}. Change group`}
        onPress={() => router.push("/groups")}
        style={({ pressed }) => [s.scope, pressed && s.pressed]}
      >
        {b.activeGroupId ? (
          <LockKeyhole size={17} color={c.secondary} />
        ) : (
          <Users size={17} color={c.secondary} />
        )}
        <Text style={s.scopeName}>{scopeName}</Text>
        <ChevronDown size={17} color={c.secondary} />
      </Pressable>
      <View accessibilityRole="tablist" style={s.segments}>
        {(["people", "map"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === item }}
            onPress={() => setMode(item)}
            style={({ pressed }) => [
              s.segment,
              mode === item && s.segmentSelected,
              pressed && s.pressed,
            ]}
          >
            <Text
              style={[s.segmentText, mode === item && s.segmentTextSelected]}
            >
              {item === "people" ? "People" : "Map"}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === "people" ? (
        <>
          <View style={s.connection}>
            <Text accessibilityLiveRegion="polite" style={s.status}>
              {status}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                finding ? "Finding nearby people" : "Find nearby people"
              }
              accessibilityState={{
                busy: finding,
                disabled: finding || unavailable,
              }}
              disabled={finding || unavailable}
              onPress={() => void findAction.run(b.findPeople)}
              style={({ pressed }) => [
                s.find,
                (finding || unavailable) && s.disabled,
                pressed && s.pressed,
              ]}
            >
              {finding ? (
                <ActivityIndicator color={c.text} />
              ) : (
                <Radar color={c.text} size={18} />
              )}
              <Text style={s.findText}>
                {finding ? "Finding" : "Find people"}
              </Text>
            </Pressable>
          </View>
          <ErrorNotice message={findAction.error} />
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
                    pressed && s.pressed,
                  ]}
                >
                  <View style={s.avatar}>
                    <Text style={s.initial}>
                      {person.name.trim().slice(0, 2).toUpperCase() || "?"}
                    </Text>
                    {person.connected && <View style={s.connectedDot} />}
                  </View>
                  <View style={s.personCopy}>
                    <Text style={s.personName}>{person.name}</Text>
                    <Text style={s.caption}>
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
                  <ChevronRight size={20} color={c.muted} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Users size={30} strokeWidth={1.5} color={c.secondary} />
              </View>
              <Text style={s.emptyTitle}>
                {unavailable ? "Nearby unavailable" : "Find each other."}
              </Text>
              <Text style={s.emptyCopy}>
                {unavailable
                  ? "This device or build cannot connect over Bluetooth."
                  : b.activeGroupId
                    ? "Open Beacon in this group on both phones, then tap Find people."
                    : "Open Beacon on both phones, then tap Find people."}
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={s.sharing}>
            <View style={s.sharingCopy}>
              <Text style={s.sharingTitle}>Share my location</Text>
              <Text style={s.caption}>{scopeName} · while Beacon is open</Text>
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
          <ErrorNotice message={shareAction.error} />
          <NearbyMap
            key={b.activeGroupId ?? "public"}
            ownLocation={b.location}
            focusRevision={mapFocusRevision}
            pins={pins}
            connectedCount={connected.length}
            internet={b.internet}
            map={b.map}
            onLocate={b.locateOnMap}
            onSaveArea={b.downloadMap}
            onCancelSave={b.cancelMapDownload}
            now={now}
            height={Math.max(310, Math.min(470, height * 0.48))}
          />
          {connected.length > 0 && pins.length === 0 && (
            <Text style={s.caption}>
              People appear here when they share their location.
            </Text>
          )}
        </>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  scope: {
    alignSelf: "flex-start",
    minHeight: 48,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: c.border,
  },
  scopeName: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: c.text,
    flexShrink: 1,
  },
  segments: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 16,
    backgroundColor: c.card,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  segmentSelected: { backgroundColor: c.text },
  segmentText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    color: c.secondary,
  },
  segmentTextSelected: { color: c.background },
  connection: { flexDirection: "row", alignItems: "center", gap: 16 },
  status: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
  },
  find: {
    minHeight: 48,
    maxWidth: "52%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  findText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 19,
    color: c.text,
    flexShrink: 1,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
  },
  people: { borderTopWidth: 1, borderColor: c.border },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 20,
    minHeight: 88,
  },
  separator: { borderTopWidth: 1, borderTopColor: c.border },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: c.card,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fonts.medium, fontSize: 16, color: c.text },
  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    position: "absolute",
    bottom: -1,
    right: -1,
    backgroundColor: c.text,
    borderWidth: 2,
    borderColor: c.background,
  },
  personCopy: { flex: 1, gap: 4 },
  personName: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 25,
    color: c.text,
  },
  unread: {
    minWidth: 24,
    minHeight: 24,
    borderRadius: 12,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: fonts.medium, fontSize: 12, color: c.background },
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 14,
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 24,
    backgroundColor: c.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: fonts.headline,
    fontSize: 30,
    lineHeight: 35,
    color: c.text,
    textAlign: "center",
  },
  emptyCopy: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
    color: c.secondary,
    textAlign: "center",
    maxWidth: 300,
  },
  sharing: { flexDirection: "row", alignItems: "center", gap: 16 },
  sharingCopy: { flex: 1, gap: 4 },
  sharingTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 23,
    color: c.text,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
});
