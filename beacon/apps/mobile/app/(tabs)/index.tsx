import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Minus, Plus } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import { ErrorNotice, Field, Heading, Pill, Screen, useAction } from "../../src/components/ui";
import AudiencePicker from "../../src/components/AudiencePicker";
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
  const { active, incoming } = useMemo(() => {
    const currentRequests = b.requests.filter((request) =>
      (request.groupId ?? null) === b.activeGroupId &&
      (request.status === "active" || request.status === "accepted"));
    return {
      active: currentRequests.find((request) => request.mine),
      incoming: currentRequests.filter((request) => !request.mine).sort((a, z) => z.updatedAt - a.updatedAt),
    };
  }, [b.requests, b.activeGroupId]);
  const send = () => action.run(async () => {
    const id = await b.sendSOS({ category, note: note.trim() || undefined, place: place.trim() || undefined });
    router.push("/request/" + id);
  });
  return (
    <Screen title="Help" main showConnection>
      {active ? (
        <View style={s.active}>
          <Heading size={40}>Your SOS</Heading>
          <AudiencePicker label="Send SOS to" compact />
          <RequestCard request={active} />
        </View>
      ) : (
        <View style={s.hero}>
          <View style={s.heroHeading}>
            <Text accessibilityRole="header" style={s.title}>Need help?</Text>
            <AudiencePicker label="Send SOS to" compact />
          </View>
          <View style={s.sendBlock}>
            <Pressable accessibilityRole="button" accessibilityLabel="Send SOS now" accessibilityHint="Saves your help request immediately and queues it for people in the selected audience. Does not call emergency services." accessibilityState={{ busy: action.busy, disabled: action.busy }} onPress={send} disabled={action.busy} style={({ pressed }) => [s.sos, pressed && s.pressedSOS, action.busy && s.disabled]}>
              <Text maxFontSizeMultiplier={1.3} style={s.sosText}>SOS</Text>
              {action.busy ? <ActivityIndicator color={c.onAction} /> : <Text maxFontSizeMultiplier={1.5} style={s.sosHint}>Send request</Text>}
            </Pressable>
            <Text style={s.safety}>Does not call emergency services.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={details ? "Hide optional details" : "Add optional details"} accessibilityState={{ expanded: details }} onPress={() => setDetails((open) => !open)} style={({ pressed }) => [s.detailsToggle, pressed && s.pressed]}>
            {details ? <Minus size={24} color={c.text} /> : <Plus size={24} color={c.text} />}
            <Text style={s.detailsLabel}>{details ? "Hide details" : "Add details"}</Text>
          </Pressable>
          {details && (
            <View style={s.details}>
              <View style={s.categories}>
                {(["other", "injured", "trapped", "stranded"] as Category[]).map((value) => <Pill key={value} selected={category === value} onPress={() => setCategory(value)}>{value === "other" ? "Other" : value[0].toUpperCase() + value.slice(1)}</Pill>)}
              </View>
              <Field label="What do you need?" placeholder="Optional note" value={note} onChangeText={setNote} maxLength={140} multiline />
              <Field label="Where are you?" placeholder="Building or landmark (optional)" value={place} onChangeText={setPlace} maxLength={120} />
              {!place.trim() && b.locationPermission === "granted" && <Text style={s.caption}>Last known location attached, if available.</Text>}
            </View>
          )}
        </View>
      )}
      <ErrorNotice message={action.error || b.error} />
      <View style={s.requests}>
        <Text accessibilityRole="header" style={s.sectionTitle}>Help nearby</Text>
        {incoming.length ? incoming.map((request) => <RequestCard key={request.id} request={request} showOffer />) : <Text style={s.empty}>No requests received yet.</Text>}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  active: { gap: 12 },
  hero: { gap: 20 },
  heroHeading: { gap: 6 },
  title: { fontFamily: fonts.headline, fontSize: 42, lineHeight: 49, letterSpacing: -1.3, color: c.text },
  sendBlock: { gap: 12 },
  sos: { width: "100%", minHeight: 144, paddingHorizontal: 24, paddingVertical: 20, borderRadius: 20, backgroundColor: c.red, alignItems: "center", justifyContent: "center", gap: 0 },
  sosText: { fontFamily: fonts.headline, fontSize: 58, lineHeight: 65, color: c.onAction, textAlign: "center" },
  sosHint: { fontFamily: fonts.medium, fontSize: 21, lineHeight: 29, color: c.onAction, textAlign: "center" },
  pressedSOS: { backgroundColor: "#B3251B" },
  disabled: { opacity: 0.6 },
  detailsToggle: { minHeight: 52, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  detailsLabel: { fontFamily: fonts.body, fontSize: 18, lineHeight: 26, color: c.text, flexShrink: 1 },
  details: { gap: 16, paddingBottom: 8 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: c.secondary },
  safety: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: c.secondary, textAlign: "center" },
  requests: { gap: 16, paddingTop: 12 },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: c.text },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: c.secondary },
  pressed: { opacity: 0.65 },
});
