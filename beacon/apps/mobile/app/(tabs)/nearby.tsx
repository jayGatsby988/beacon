import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ChevronRight, Users } from "lucide-react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useBeacon } from "../../src/services/BeaconContext";
import { ErrorNotice, Screen, age, useAction } from "../../src/components/ui";
import AudiencePicker from "../../src/components/AudiencePicker";
import NearbyMap, { freshLocation, locationRefreshDelay } from "../../src/components/NearbyMap";
import { colors as c, fonts } from "../../src/theme/tokens";
import { keepMapLocationFresh } from "../../src/services/mapLocationRefresh";

export default function Nearby() {
  const b = useBeacon();
  const { height, width, fontScale } = useWindowDimensions();
  const stacked = width < 350 || fontScale >= 1.3;
  const [mode, setMode] = useState<"people" | "map">("people");
  const { view } = useLocalSearchParams<{ view?: string | string[] }>();
  useEffect(() => {
    if (view !== "map" && view !== "people") return;
    setMode(view);
    // Consume explicit navigation intent so later tab visits preserve the user's mode.
    router.setParams({ view: undefined });
  }, [view]);
  const [now, setNow] = useState(Date.now);
  const [mapFocusRevision, setMapFocusRevision] = useState(0);
  const findAction = useAction();
  const shareAction = useAction();
  const { locationPermission, refreshLocation } = b;
  useFocusEffect(
    useCallback(() => {
      if (mode !== "map" || locationPermission !== "granted") return;
      return keepMapLocationFresh({
        refresh: refreshLocation,
        onInitialFix: () => setMapFocusRevision((revision) => revision + 1),
        isForeground: () => AppState.currentState === "active",
        onForeground: (refresh) => {
          const listener = AppState.addEventListener("change", (state) => {
            if (state === "active") refresh();
          });
          return () => listener.remove();
        },
      });
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
  const clockLocations = useMemo(() => [b.location, ...connected.map((person) => person.location)], [b.location, connected]);
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
            : undefined;
  return (
    <Screen title="Nearby" main>
      <View style={s.heading}>
        <Text accessibilityRole="header" style={s.title}>Nearby</Text>
        <AudiencePicker label="Audience" compact />
      </View>
      <View accessibilityRole="tablist" style={s.tabs}>
        {(["people", "map"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === item }}
            onPress={() => setMode(item)}
            style={({ pressed }) => [
              s.tab,
              mode === item && s.tabSelected,
              pressed && s.pressed,
            ]}
          >
            <Text
              style={[s.tabText, mode === item && s.tabTextSelected]}
            >
              {item === "people" ? "People" : "Map"}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === "people" ? (
        <>
          <View style={[s.connection, stacked && s.stacked]}>
            <View style={[s.connectionCopy, stacked && s.stackedCopy]}>
              <Text accessibilityLiveRegion="polite" style={s.count}>
                {connected.length} connected
              </Text>
              {status && <Text accessibilityLiveRegion="polite" style={s.caption}>{status}</Text>}
            </View>
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
                stacked && s.actionStacked,
                (finding || unavailable) && s.disabled,
                pressed && s.pressed,
              ]}
            >
              {finding ? (
                <ActivityIndicator color={c.text} />
              ) : null}
              <Text style={s.findText}>
                {finding ? "Finding" : "Find people"}
              </Text>
              {!finding && <ChevronRight color={c.text} size={19} />}
            </Pressable>
          </View>
          <ErrorNotice message={findAction.error} />
          {people.length ? (
            <View style={s.people}>
              {people.map((person) => (
                <View
                  key={person.nodeId}
                  style={[s.person, stacked && s.stacked]}
                >
                  <View style={[s.personInfo, stacked && s.stackedCopy]}>
                    <View style={s.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Text maxFontSizeMultiplier={1.4} style={s.initial}>
                        {person.name.trim().slice(0, 2).toUpperCase() || "?"}
                      </Text>
                      {person.connected && <View style={s.connectedDot} />}
                    </View>
                    <View style={s.personCopy}>
                      <View style={s.nameRow}>
                        <Text style={s.personName}>{person.name}</Text>
                        {person.unreadCount > 0 && (
                          <View style={s.unread}>
                            <Text style={s.unreadText}>
                              {person.unreadCount > 99 ? "99+" : person.unreadCount}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.caption}>
                        {person.connected
                          ? "Connected"
                          : `Last seen ${age(person.lastSeenAt)}`}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${person.name}. ${person.connected ? "Connected" : `Last seen ${age(person.lastSeenAt)}`}${person.unreadCount ? `. ${person.unreadCount} unread messages` : ""}`}
                    onPress={() => router.push(`/chat/${person.nodeId}`)}
                    style={({ pressed }) => [s.message, stacked && s.actionStacked, pressed && s.pressed]}
                  >
                    <Text style={s.messageText}>Message</Text>
                  </Pressable>
                </View>
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
                    ? "Open this group on both phones, then tap Find people."
                    : "Open Beacon on another phone, then tap Find people."}
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={[s.sharing, stacked && s.stacked]}>
            <View style={[s.sharingCopy, stacked && s.stackedCopy]}>
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
              trackColor={{ false: c.border, true: c.text }}
              thumbColor={c.onAction}
              style={[s.shareSwitch, stacked && s.actionStacked]}
            />
          </View>
          <ErrorNotice message={shareAction.error} />
          <NearbyMap
            key={b.activeGroupId ?? "public"}
            ownLocation={b.location}
            focusRevision={mapFocusRevision}
            pins={pins}
            requests={b.requests.filter((request) =>
              (request.groupId ?? null) === b.activeGroupId &&
              (request.status === "active" || request.status === "accepted"),
            )}
            connectedCount={connected.length}
            internet={b.internet}
            map={b.map}
            onLocate={b.locateOnMap}
            onSaveArea={b.downloadMap}
            onCancelSave={b.cancelMapDownload}
            now={now}
            height={Math.max(200, Math.min(280, height * 0.26))}
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
  heading: { alignItems: "flex-start", gap: 2 },
  title: { fontFamily: fonts.headline, fontSize: 40, lineHeight: 46, letterSpacing: -1.2, color: c.text },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    gap: 28,
  },
  tab: {
    flexShrink: 1,
    minWidth: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingVertical: 10,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabSelected: { borderBottomColor: c.text },
  tabText: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 24,
    color: c.secondary,
  },
  tabTextSelected: { color: c.text },
  connection: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  connectionCopy: { flex: 1, gap: 4 },
  count: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 23, color: c.text },
  find: {
    minHeight: 48,
    flexShrink: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 0,
    paddingVertical: 12,
  },
  findText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: c.text,
    flexShrink: 1,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
  },
  people: { marginTop: -8 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 20,
    minHeight: 92,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  personInfo: { flexDirection: "row", alignItems: "center", flex: 1, gap: 12, minWidth: 0 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    flexShrink: 0,
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
    backgroundColor: c.text,
    borderWidth: 2,
    borderColor: c.background,
  },
  personCopy: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  personName: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 25,
    color: c.text,
    flexShrink: 1,
  },
  message: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: c.text, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  messageText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: c.text, flexShrink: 1 },
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
    paddingHorizontal: 12,
    paddingVertical: 40,
    gap: 14,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: fonts.headline,
    fontSize: 22,
    lineHeight: 28,
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
  sharing: { flexDirection: "row", alignItems: "center", gap: 16, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: c.border },
  sharingCopy: { flex: 1, gap: 4 },
  shareSwitch: { minHeight: 44, minWidth: 48 },
  sharingTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 23,
    color: c.text,
  },
  stacked: { flexDirection: "column", alignItems: "stretch", gap: 12 },
  stackedCopy: { flex: 0, width: "100%" },
  actionStacked: { alignSelf: "flex-start" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
});
