import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  MessageCircle,
  Map,
  Radar,
  Users,
} from "lucide-react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useBeacon } from "../../src/services/BeaconContext";
import { ErrorNotice, Screen, age, useAction } from "../../src/components/ui";
import AudiencePicker from "../../src/components/AudiencePicker";
import NearbyMap, { freshLocation, locationRefreshDelay } from "../../src/components/NearbyMap";
import { colors as c, fonts } from "../../src/theme/tokens";

export default function Nearby() {
  const b = useBeacon();
  const [mode, setMode] = useState<"people" | "map">("people");
  const { view, requestId } = useLocalSearchParams<{ view?: string | string[]; requestId?: string | string[] }>();
  const [requestFocus, setRequestFocus] = useState<{ id: string; revision: number; scope: string | null }>();
  useEffect(() => {
    if (view !== "map" && view !== "people") return;
    setMode(view);
    if (view === "map" && typeof requestId === "string") {
      setRequestFocus((previous) => ({ id: requestId, revision: (previous?.revision ?? 0) + 1, scope: b.activeGroupId }));
    } else setRequestFocus(undefined);
    // Consume explicit navigation intent so later tab visits preserve the user's mode.
    router.setParams({ view: undefined, requestId: undefined });
  }, [view, requestId, b.activeGroupId]);
  useEffect(() => {
    if (requestFocus && requestFocus.scope !== b.activeGroupId) setRequestFocus(undefined);
  }, [requestFocus, b.activeGroupId]);
  const [now, setNow] = useState(Date.now);
  const [mapFocusRevision, setMapFocusRevision] = useState(0);
  const findAction = useAction();
  const shareAction = useAction();
  const { locationPermission, refreshLocation } = b;
  useFocusEffect(
    useCallback(() => {
      if (mode !== "map") return;
      let focused = true;
      let refreshing = false;
      const refresh = async (recenter: boolean) => {
        if (refreshing) return;
        refreshing = true;
        try {
          await refreshLocation();
          if (focused && recenter) setMapFocusRevision((revision) => revision + 1);
        } catch {
          // Keep the last report visible until its freshness limit expires.
        } finally {
          refreshing = false;
        }
      };
      let clock: ReturnType<typeof setInterval> | undefined;
      if (locationPermission === "granted") {
        void refresh(true);
        clock = setInterval(() => void refresh(false), 45_000);
      }
      return () => {
        focused = false;
        clearInterval(clock);
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
  const connected = useMemo(() => people.filter((person) => person.connected), [people]);
  const clockLocations = useMemo(
    () => [b.location, ...connected.map((person) => person.location)],
    [b.location, connected],
  );
  useFocusEffect(
    useCallback(() => {
      let clock: ReturnType<typeof setTimeout>;
      const tick = () => {
        const current = Date.now();
        setNow(current);
        clock = setTimeout(tick, mode === "map" ? locationRefreshDelay(clockLocations, current) : 30_000);
      };
      tick();
      return () => clearTimeout(clock);
    }, [mode, clockLocations]),
  );
  const pins = useMemo(() => connected.flatMap((person) =>
    freshLocation(person.location, now)
      ? [
          {
            nodeId: person.nodeId,
            name: person.name,
            location: person.location,
          },
        ]
      : [],
  ), [connected, now]);
  const requests = useMemo(() => b.requests.filter((request) =>
    (request.groupId ?? null) === b.activeGroupId &&
    (request.status === "active" || request.status === "accepted" || request.id === requestFocus?.id),
  ), [b.requests, b.activeGroupId, requestFocus?.id]);
  const finding = b.findingPeople || findAction.busy;
  const unavailable = b.bluetooth === "unsupported";
  const bluetoothSettings = b.bluetooth === "poweredOff" || b.bluetooth === "unauthorized";
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
              ? `${connected.length} connected`
              : b.relayRunning
                ? "Ready to connect"
                : "Not connected";
  return (
    <Screen title="Nearby" main scroll={mode !== "map"} contentStyle={mode === "map" ? s.mapContent : undefined}>
      {mode === "people" && <View style={s.titleRow}>
        <Text accessibilityRole="header" style={s.title}>Nearby</Text>
        <View style={s.audience}><AudiencePicker label="Audience" compact /></View>
      </View>}
      <View accessibilityRole="tablist" style={s.segments}>
        {(["people", "map"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === item }}
            onPress={() => { setMode(item); setRequestFocus(undefined); }}
            style={({ pressed }) => [
              s.segment,
              mode === item && s.segmentSelected,
              pressed && s.pressed,
            ]}
          >
            {item === "people" ? <Users size={18} color={mode === item ? c.background : c.secondary} /> : <Map size={18} color={mode === item ? c.background : c.secondary} />}
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
                finding ? "Finding nearby people" : bluetoothSettings ? "Open Bluetooth settings" : "Find nearby people"
              }
              accessibilityState={{
                busy: finding,
                disabled: finding || unavailable,
              }}
              disabled={finding || unavailable}
              onPress={() => void findAction.run(bluetoothSettings ? () => Linking.openSettings() : b.findPeople)}
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
                {finding ? "Finding" : bluetoothSettings ? "Bluetooth settings" : "Find people"}
              </Text>
            </Pressable>
          </View>
          <ErrorNotice message={findAction.error} />
          {people.length ? (
            <View style={s.people}>
              {people.map((person) => (
                <Pressable
                  key={person.nodeId}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${person.name}. ${person.connected ? "Connected" : `Last seen ${age(person.lastSeenAt)}`}${person.unreadCount ? `. ${person.unreadCount} unread messages` : ""}`}
                  onPress={() => router.push(`/chat/${person.nodeId}`)}
                  style={({ pressed }) => [
                    s.person,
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
                    <Text numberOfLines={1} style={s.personName}>{person.name}</Text>
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
                  <View style={s.messageAction}><MessageCircle size={18} color={c.text} /><Text style={s.messageLabel}>Message</Text></View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Users size={30} strokeWidth={1.5} color={c.secondary} />
              </View>
              <Text style={s.emptyTitle}>
                {unavailable ? "Nearby unavailable" : "No connections yet"}
              </Text>
              <Text style={s.emptyCopy}>
                {unavailable
                  ? "This device or build cannot connect over Bluetooth."
                  : b.activeGroupId
                    ? "Open the same group on both phones."
                    : "Open Beacon on another phone nearby."}
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={s.sharing}>
            <View style={s.mapAudience}><AudiencePicker label="Map audience" compact /></View>
            <View style={s.sharingControl}>
            <Text style={s.sharingTitle}>Share location</Text>
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
          </View>
          <ErrorNotice message={shareAction.error} />
          <NearbyMap
            key={b.activeGroupId ?? "public"}
            ownLocation={b.location}
            focusRevision={mapFocusRevision}
            focusRequestId={requestFocus?.scope === b.activeGroupId ? requestFocus.id : undefined}
            requestFocusRevision={requestFocus?.revision}
            pins={pins}
            requests={requests}
            connectedCount={connected.length}
            internet={b.internet}
            map={b.map}
            onLocate={b.locateOnMap}
            onSaveArea={b.downloadMap}
            onCancelSave={b.cancelMapDownload}
            now={now}
          />
        </>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  mapContent: { gap: 10, paddingTop: 8, paddingHorizontal: 12, paddingBottom: 6 },
  titleRow: { gap: 4 },
  audience: { alignSelf: "flex-start", maxWidth: "100%" },
  title: { fontFamily: fonts.headline, fontSize: 38, lineHeight: 43, letterSpacing: -1, color: c.text },
  segments: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    backgroundColor: c.card,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
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
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    color: c.text,
  },
  find: {
    minHeight: 48,
    maxWidth: "52%",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: "transparent",
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
  people: {},
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 18,
    minHeight: 88,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  messageAction: { flexDirection: "row", alignItems: "center", gap: 6 },
  messageLabel: { fontFamily: fonts.medium, fontSize: 13, color: c.text },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.raised,
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
    backgroundColor: "#87C999",
    borderWidth: 2,
    borderColor: c.background,
  },
  personCopy: { flex: 1, gap: 4, minWidth: 0 },
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
    paddingVertical: 36,
    gap: 10,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: fonts.headline,
    fontSize: 25,
    lineHeight: 30,
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
  sharing: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 2 },
  mapAudience: { flex: 1, minWidth: 0 },
  sharingControl: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "48%" },
  sharingTitle: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
    color: c.text,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
});
