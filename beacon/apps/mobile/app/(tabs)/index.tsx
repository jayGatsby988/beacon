import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ArrowUpRight, Map, Users } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import { ErrorNotice, Heading, Screen, useAction } from "../../src/components/ui";
import AudiencePicker from "../../src/components/AudiencePicker";
import ConnectionControl from "../../src/components/ConnectionControl";
import { RequestCard } from "../../src/components/RequestCard";
import { colors as c, fonts } from "../../src/theme/tokens";

export default function Home() {
  const b = useBeacon();
  return <HelpContent key={b.activeGroupId ?? "public"} b={b} />;
}

function HelpContent({ b }: { b: ReturnType<typeof useBeacon> }) {
  const action = useAction();
  const { active, incoming } = useMemo(() => {
    const current = b.requests.filter((request) =>
      (request.groupId ?? null) === b.activeGroupId &&
      (request.status === "active" || request.status === "accepted"));
    return {
      active: current.find((request) => request.mine),
      incoming: current.filter((request) => !request.mine).sort((a, z) => z.updatedAt - a.updatedAt),
    };
  }, [b.requests, b.activeGroupId]);
  const connected = b.people.filter((person) => person.nodeId !== b.nodeId && person.scope === b.activeGroupId && person.connected).length;
  const send = () => action.run(async () => {
    const id = await b.sendSOS({ category: "other" });
    router.push("/request/" + id);
  });
  return (
    <Screen title="Help" main>
      {active ? (
        <View style={s.section}>
          <View style={s.heading}><Heading size={36}>Your SOS</Heading><AudiencePicker label="Send SOS to" compact /></View>
          <RequestCard request={active} />
        </View>
      ) : (
        <View style={s.hero}>
          <View style={s.heading}>
            <Text accessibilityRole="header" style={s.title}>Need help?</Text>
            <AudiencePicker label="Send SOS to" compact />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send SOS now"
            accessibilityHint="Saves your help request immediately and queues it for people in the selected audience. Does not call emergency services."
            accessibilityState={{ busy: action.busy, disabled: action.busy }}
            onPress={send}
            disabled={action.busy}
            style={({ pressed }) => [s.sos, pressed && s.pressedSOS, action.busy && s.disabled]}
          >
            <Text maxFontSizeMultiplier={1.4} style={s.sosText}>SOS</Text>
            <View style={s.sosLabel}>
              {action.busy && <ActivityIndicator color={c.onAction} size="small" />}
              <Text maxFontSizeMultiplier={1.4} style={s.sosHint}>{action.busy ? "Saving request…" : "Send request"}</Text>
            </View>
          </Pressable>
          <Text style={s.safety}>Does not call emergency services.</Text>
        </View>
      )}
      <ErrorNotice message={action.error || b.error} />
      <ConnectionControl />
      <View style={s.shortcuts}>
        <Pressable accessibilityRole="button" accessibilityLabel="Find and message nearby people" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "people" } })} style={({ pressed }) => [s.shortcut, pressed && s.pressed]}>
          <Users size={22} strokeWidth={2} color={c.text} />
          <View style={s.shortcutCopy}><Text style={s.shortcutTitle}>People</Text><Text style={s.shortcutCaption}>{connected ? connected + " connected" : "Find & message"}</Text></View>
          <ArrowUpRight size={17} color={c.secondary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open nearby map" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "map" } })} style={({ pressed }) => [s.shortcut, pressed && s.pressed]}>
          <Map size={22} strokeWidth={2} color={c.text} />
          <Text style={s.shortcutTitle}>Map</Text>
          <ArrowUpRight size={17} color={c.secondary} />
        </Pressable>
      </View>
      <View style={s.section}>
        <View style={s.sectionHeader}><Text accessibilityRole="header" style={s.sectionTitle}>Help nearby</Text>{incoming.length > 0 && <Text style={s.count}>{incoming.length}</Text>}</View>
        {incoming.length ? incoming.map((request) => <RequestCard key={request.id} request={request} showOffer />) : <Text style={s.empty}>No requests received yet.</Text>}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { gap: 14 },
  hero: { gap: 14 },
  heading: { gap: 2 },
  title: { fontFamily: fonts.headline, fontSize: 42, lineHeight: 48, letterSpacing: -1.2, color: c.text },
  sos: { minHeight: 180, paddingHorizontal: 24, paddingVertical: 24, borderRadius: 20, backgroundColor: c.red, alignItems: "center", justifyContent: "center", gap: 2 },
  sosText: { fontFamily: fonts.headline, fontSize: 64, lineHeight: 72, color: c.onAction, textAlign: "center", letterSpacing: -1.5 },
  sosLabel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  sosHint: { fontFamily: fonts.medium, fontSize: 19, lineHeight: 27, color: c.onAction, textAlign: "center" },
  pressedSOS: { backgroundColor: "#B82931", transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.7 },
  safety: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.secondary, textAlign: "center" },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  shortcut: { flex: 1, minWidth: 140, minHeight: 74, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: 14, paddingVertical: 14 },
  shortcutCopy: { flex: 1, gap: 3 },
  shortcutTitle: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 23, color: c.text, flexShrink: 1 },
  shortcutCaption: { fontFamily: fonts.body, fontSize: 11, lineHeight: 16, color: c.secondary },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 24, lineHeight: 29, letterSpacing: -0.5, color: c.text },
  count: { fontFamily: fonts.medium, fontSize: 13, color: c.secondary },
  empty: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: c.muted },
  pressed: { backgroundColor: c.raised },
});
