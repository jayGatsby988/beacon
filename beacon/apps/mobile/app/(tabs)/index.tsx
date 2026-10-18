import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronDown, ChevronRight, Radio, MapPin, Plus, HeartHandshake } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  Field,
  Heading,
  Pill,
  Screen,
  useAction,
} from "../../src/components/ui";
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
  const group = b.groups.find((g) => g.id === b.activeGroupId);
  const currentRequests = b.requests.filter(
    (request) =>
      (request.groupId ?? null) === b.activeGroupId &&
      (request.status === "active" || request.status === "accepted"),
  );
  const active = currentRequests.find((request) => request.mine);
  const incoming = currentRequests
    .filter((request) => !request.mine)
    .sort((a, z) => z.updatedAt - a.updatedAt);
  const send = () =>
    action.run(async () => {
      const id = await b.sendSOS({
        category,
        note: note.trim() || undefined,
        place: place.trim() || undefined,
      });
      router.push(`/request/${id}`);
    });
  return (
    <Screen title="Help" main>
      <View style={s.intro}>
        <Heading size={26}>Need help?</Heading>
        <View style={s.audienceWrap}><AudiencePicker label="Send SOS to" /></View>
      </View>
      {active ? (
        <View style={{ gap: 12 }}>
          <Heading size={20}>Your active SOS</Heading>
          <RequestCard request={active} />
        </View>
      ) : (
        <View style={s.compose}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send SOS now"
            accessibilityHint="Saves your help request immediately and queues it for people in the selected audience. Does not call emergency services."
            accessibilityState={{ busy: action.busy, disabled: action.busy }}
            onPress={send}
            disabled={action.busy}
            style={({ pressed }) => [
              s.sos,
              pressed && { opacity: 0.8 },
              action.busy && { opacity: 0.55 },
            ]}
          >
            <View style={s.outerRing}>
              <View style={s.innerRing}>
                <View style={s.sosCircle}>
                  <Radio color={c.onAction} size={25} />
                  <Text maxFontSizeMultiplier={1.4} style={s.sosText}>SOS</Text>
                  <Text style={s.sosHint}>{action.busy ? "SAVING…" : "TAP TO SEND"}</Text>
                </View>
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            onPress={() => setDetails((open) => !open)}
            style={s.detailsToggle}
          >
            <View style={s.detailsStart}>
              <Plus size={18} color={c.secondary} />
              <Text style={s.detailsLabel}>{details ? "Hide details" : "Add details"}</Text>
            </View>
            <View style={s.detailsEnd}>
              {!details && <Text style={s.caption}>Optional</Text>}
              <ChevronDown color={c.secondary} size={19} style={{ transform: [{ rotate: details ? "180deg" : "0deg" }] }} />
            </View>
          </Pressable>
          {details && (
            <View style={s.details}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["other", "injured", "trapped", "stranded"] as Category[]).map((value) => (
                  <Pill key={value} selected={category === value} onPress={() => setCategory(value)}>
                    {value === "other" ? "Other" : value[0].toUpperCase() + value.slice(1)}
                  </Pill>
                ))}
              </View>
              <Field label="What do you need?" placeholder="A short note" value={note} onChangeText={setNote} maxLength={140} multiline />
              <Field label="Where are you?" placeholder="Building, floor or landmark" value={place} onChangeText={setPlace} maxLength={120} />
            </View>
          )}
          <View style={s.locationLine}>
            <MapPin size={14} color={c.muted} />
            <Text style={s.caption}>{place.trim() ? "Your landmark will be attached" : b.locationPermission === "granted" ? "Last known location, if available" : "You can send without a location"}</Text>
          </View>
          <Text style={s.safety}>Does not call emergency services.</Text>
        </View>
      )}
      <ErrorNotice message={action.error || b.error} />
      {!b.relayRunning && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Bluetooth settings"
          onPress={() => router.push("/settings")}
          style={s.connectionNotice}
        >
          <Text style={[s.caption, { flex: 1 }]}>
            {b.bluetooth === "unsupported"
              ? "Bluetooth unavailable. SOS stays on this phone."
              : b.bluetooth === "poweredOff"
                ? "Turn on Bluetooth to reach nearby people."
                : "Enable nearby sharing to reach other phones."}
          </Text>
          <ChevronRight size={19} color={c.secondary} />
        </Pressable>
      )}
      <View style={s.requests}>
        <View style={s.sectionHeader}>
          <Heading size={20}>Requests you can help with</Heading>
          {incoming.length > 0 && <Text style={s.count}>{incoming.length}</Text>}
        </View>
        {incoming.length ? incoming.map((request) => (
          <RequestCard key={request.id} request={request} showOffer />
        )) : (
          <View style={s.emptyCard}>
            <View style={s.emptyIcon}><HeartHandshake size={23} color={c.secondary} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.emptyTitle}>Nothing received yet</Text>
              <Text style={s.empty}>Requests from {group ? "this group" : "the public network"} will appear when they reach your phone.</Text>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  intro: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, paddingTop: 4 },
  audienceWrap: { maxWidth: "65%" },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.secondary, flexShrink: 1 },
  compose: { gap: 0 },
  sos: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 22, justifyContent: "center", alignItems: "center", gap: 15 },
  outerRing: { borderRadius: 999, borderWidth: 1, borderColor: "#37282E", padding: 12, maxWidth: "100%" },
  innerRing: { borderRadius: 999, borderWidth: 1, borderColor: "#663139", padding: 10 },
  sosCircle: { minWidth: 164, minHeight: 164, borderRadius: 999, padding: 22, backgroundColor: c.red, alignItems: "center", justifyContent: "center", gap: 3 },
  sosText: { fontFamily: fonts.headline, fontSize: 58, lineHeight: 64, letterSpacing: 1, color: c.onAction, textAlign: "center", flexShrink: 1 },
  sosHint: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, letterSpacing: 1.5, color: c.onAction, textAlign: "center" },
  detailsToggle: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 3 },
  detailsStart: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  detailsLabel: { fontFamily: fonts.medium, fontSize: 14, color: c.text, flexShrink: 1 },
  detailsEnd: { flexDirection: "row", alignItems: "center", gap: 5 },
  details: { gap: 16, paddingTop: 3, paddingBottom: 18 },
  locationLine: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginBottom: 5 },
  safety: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.muted, textAlign: "center" },
  connectionNotice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 16, padding: 16, minHeight: 52 },
  requests: { paddingTop: 2, gap: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  count: { fontFamily: fonts.medium, fontSize: 12, color: c.text, paddingVertical: 4, paddingHorizontal: 9, backgroundColor: c.raised, borderRadius: 8 },
  emptyCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 18, flexDirection: "row", alignItems: "center", gap: 13 },
  emptyIcon: { width: 42, height: 42, backgroundColor: c.raised, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: c.text },
  empty: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: c.secondary },
});
