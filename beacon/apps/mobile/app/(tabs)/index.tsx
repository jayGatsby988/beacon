import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ArrowUpRight, ChevronDown, Map, Plus, Users } from "lucide-react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useBeacon } from "../../src/services/BeaconContext";
import { ErrorNotice, Field, Heading, Pill, Screen, useAction } from "../../src/components/ui";
import AudiencePicker from "../../src/components/AudiencePicker";
import ConnectionControl from "../../src/components/ConnectionControl";
import { RequestCard } from "../../src/components/RequestCard";
import { Category } from "../../src/ui/types";
import { colors as c, fonts } from "../../src/theme/tokens";

export default function Home() {
  const b = useBeacon();
  return <HelpContent key={b.activeGroupId ?? "public"} b={b} />;
}

function HelpContent({ b }: { b: ReturnType<typeof useBeacon> }) {
  const [details, setDetails] = useState(false);
  const [category, setCategory] = useState<Category>("other");
  const [note, setNote] = useState("");
  const [place, setPlace] = useState("");
  const action = useAction();
  const currentRequests = b.requests.filter((request) =>
    (request.groupId ?? null) === b.activeGroupId &&
    (request.status === "active" || request.status === "accepted"));
  const active = currentRequests.find((request) => request.mine);
  const incoming = currentRequests.filter((request) => !request.mine).sort((a, z) => z.updatedAt - a.updatedAt);
  const connected = b.people.filter((person) => person.nodeId !== b.nodeId && person.scope === b.activeGroupId && person.connected).length;
  const send = () => action.run(async () => {
    const id = await b.sendSOS({ category, note: note.trim() || undefined, place: place.trim() || undefined });
    router.push("/request/" + id);
  });
  return (
    <Screen title="Help" main>
      {active ? (
        <View style={s.active}>
          <View style={s.activeHeading}><Heading size={26}>Your SOS</Heading><AudiencePicker label="Send SOS to" compact /></View>
          <RequestCard request={active} />
        </View>
      ) : (
        <View style={s.hero}>
          <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
            <Svg width="100%" height="100%" viewBox="0 0 360 360" preserveAspectRatio="xMidYMid slice">
              <Defs><RadialGradient id="sos-glow" cx="50%" cy="48%" rx="65%" ry="65%"><Stop offset="0" stopColor="#6B353C" stopOpacity="0.5" /><Stop offset="1" stopColor="#211B20" stopOpacity="0" /></RadialGradient></Defs>
              <Circle cx="180" cy="175" r="230" fill="url(#sos-glow)" />
              <Circle cx="180" cy="175" r="113" stroke="#AF6064" strokeOpacity="0.17" fill="none" />
              <Circle cx="180" cy="175" r="142" stroke="#AF6064" strokeOpacity="0.10" fill="none" />
            </Svg>
          </View>
          <View style={s.heroHeading}>
            <Text accessibilityRole="header" style={s.title}>Need help?</Text>
            <View><AudiencePicker label="Send SOS to" compact /></View>
          </View>
          <View style={s.sosArea}>
            <Pressable accessibilityRole="button" accessibilityLabel="Send SOS now" accessibilityHint="Saves your help request immediately and queues it for people in the selected audience. Does not call emergency services." accessibilityState={{ busy: action.busy, disabled: action.busy }} onPress={send} disabled={action.busy} style={({ pressed }) => [s.sos, pressed && s.pressedSOS, action.busy && s.disabled]}>
              <Text maxFontSizeMultiplier={1.3} style={s.sosText}>SOS</Text>
              {action.busy ? <ActivityIndicator color={c.onAction} /> : <Text maxFontSizeMultiplier={1.3} style={s.sosHint}>Send request</Text>}
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={details ? "Hide optional details" : "Add optional details"} accessibilityState={{ expanded: details }} onPress={() => setDetails((open) => !open)} style={({ pressed }) => [s.detailsToggle, pressed && s.pressed]}>
            <Plus size={16} color={c.secondary} /><Text style={s.detailsLabel}>{details ? "Hide details" : "Add details"}</Text><ChevronDown size={15} color={c.secondary} style={{ transform: [{ rotate: details ? "180deg" : "0deg" }] }} />
          </Pressable>
          {details && (
            <View style={s.details}>
              <View style={s.categories}>
                {(["other", "injured", "trapped", "stranded"] as Category[]).map((value) => <Pill key={value} selected={category === value} onPress={() => setCategory(value)}>{value === "other" ? "Other" : value[0].toUpperCase() + value.slice(1)}</Pill>)}
              </View>
              <Field label="What do you need?" placeholder="A short note (optional)" value={note} onChangeText={setNote} maxLength={140} multiline />
              <Field label="Where are you?" placeholder="Building or landmark (optional)" value={place} onChangeText={setPlace} maxLength={120} />
              <Text style={s.caption}>{place.trim() ? "Your landmark will be attached." : b.locationPermission === "granted" ? "Last known location attached, if available." : "Location is optional."}</Text>
            </View>
          )}
          <Text style={s.safety}>Does not call emergency services.</Text>
        </View>
      )}
      <ErrorNotice message={action.error || b.error} />
      <ConnectionControl />
      <View style={s.shortcuts}>
        <Pressable accessibilityRole="button" accessibilityLabel="Find and message nearby people" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "people" } })} style={({ pressed }) => [s.shortcut, s.peopleTile, pressed && s.pressed]}>
          <View style={s.shortcutTop}><Users size={25} strokeWidth={1.7} color="#C0DECF" /><ArrowUpRight size={17} color="#A7C3B8" /></View>
          <Text style={s.shortcutTitle}>People</Text>
          <Text style={s.shortcutCaption}>{connected ? connected + " connected" : "Find & message"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open nearby map" onPress={() => router.push({ pathname: "/(tabs)/nearby", params: { view: "map" } })} style={({ pressed }) => [s.shortcut, s.mapTile, pressed && s.pressed]}>
          <View style={s.shortcutTop}><Map size={25} strokeWidth={1.7} color="#D0C9E8" /><ArrowUpRight size={17} color="#B9B1D2" /></View>
          <Text style={s.shortcutTitle}>Map</Text>
          <Text style={s.shortcutCaption}>Shared locations</Text>
        </Pressable>
      </View>
      <View style={s.requests}>
        <View style={s.sectionHeader}><Text accessibilityRole="header" style={s.sectionTitle}>Help nearby</Text>{incoming.length > 0 && <Text style={s.count}>{incoming.length}</Text>}</View>
        {incoming.length ? incoming.map((request) => <RequestCard key={request.id} request={request} showOffer />) : <Text style={s.empty}>No requests received yet.</Text>}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  active: { gap: 14 },
  activeHeading: { gap: 3 },
  hero: { borderRadius: 28, overflow: "hidden", backgroundColor: "#211B20", paddingHorizontal: 22, paddingTop: 20, paddingBottom: 16 },
  heroHeading: { alignItems: "center" },
  title: { fontFamily: fonts.medium, fontSize: 28, lineHeight: 34, letterSpacing: -1, color: c.text },
  sosArea: { alignItems: "center", paddingVertical: 13 },
  sos: { minWidth: 166, minHeight: 166, padding: 26, borderRadius: 999, backgroundColor: c.red, borderTopWidth: 2, borderTopColor: "#EA6A6D", borderBottomWidth: 2, borderBottomColor: "#AC252E", alignItems: "center", justifyContent: "center", shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, gap: 1 },
  sosText: { fontFamily: fonts.headline, fontSize: 48, lineHeight: 55, color: c.onAction, textAlign: "center" },
  sosHint: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: c.onAction, textAlign: "center" },
  pressedSOS: { backgroundColor: "#BF2932", transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.6 },
  detailsToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  detailsLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: c.secondary },
  details: { gap: 14, paddingVertical: 14 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.secondary },
  safety: { fontFamily: fonts.body, fontSize: 11, lineHeight: 17, color: c.secondary, textAlign: "center" },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  shortcut: { flex: 1, minWidth: 132, borderRadius: 22, padding: 17, gap: 5 },
  peopleTile: { backgroundColor: "#1B2F2C" },
  mapTile: { backgroundColor: "#29273A" },
  shortcutTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  shortcutTitle: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: c.text },
  shortcutCaption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: "#C2CCD1" },
  requests: { gap: 10, paddingTop: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: c.text },
  count: { fontFamily: fonts.medium, fontSize: 12, color: c.secondary },
  empty: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: c.muted },
  pressed: { opacity: 0.7 },
});
