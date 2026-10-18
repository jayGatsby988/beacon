import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronDown, ChevronRight, LockKeyhole, Radio, Users } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  Field,
  Heading,
  Pill,
  Screen,
  useAction,
} from "../../src/components/ui";
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
  const audience = group?.name || (b.activeGroupId ? "Private group" : "Everyone nearby");
  const currentRequests = b.requests.filter(
    (request) =>
      (request.groupId ?? null) === b.activeGroupId &&
      (request.status === "active" || request.status === "accepted"),
  );
  const active = currentRequests.find((request) => request.mine);
  const incoming = currentRequests
    .filter((request) => !request.mine)
    .sort((a, z) => z.createdAt - a.createdAt);
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
    <Screen title="Help">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Send to ${audience}. Change group`}
        onPress={() => router.push("/groups")}
        style={({ pressed }) => [s.audience, pressed && { opacity: 0.65 }]}
      >
        <View style={s.audienceIcon}>
          {b.activeGroupId ? <LockKeyhole size={20} color={c.text} /> : <Users size={20} color={c.text} />}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.caption}>Send to</Text>
          <Text style={s.audienceName}>{audience}</Text>
        </View>
        <ChevronDown size={20} color={c.secondary} />
      </Pressable>
      {active ? (
        <View style={{ gap: 12 }}>
          <Heading size={24}>Your SOS</Heading>
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
            <View style={s.sosSymbol}><Radio color={c.onAction} size={32} /></View>
            <Text style={s.sosText}>{action.busy ? "Saving…" : "Send SOS"}</Text>
            <Text style={s.sosHint}>Ask for help in one tap</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            onPress={() => setDetails((open) => !open)}
            style={s.detailsToggle}
          >
            <Text style={s.detailsLabel}>{details ? "Hide details" : "Add details"}</Text>
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
          <Heading size={23}>Help requests</Heading>
          {incoming.length > 0 && <Text style={s.count}>{incoming.length}</Text>}
        </View>
        {incoming.length ? incoming.map((request) => (
          <RequestCard key={request.id} request={request} />
        )) : (
          <Text style={s.empty}>No requests in {group ? "this group" : "your area"}.</Text>
        )}
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  audience: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 4 },
  audienceIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: c.raised, justifyContent: "center", alignItems: "center" },
  audienceName: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 23, color: c.text },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: c.secondary },
  compose: { gap: 0 },
  sos: { backgroundColor: c.red, borderRadius: 30, padding: 26, minHeight: 225, justifyContent: "center", alignItems: "center", gap: 13 },
  sosSymbol: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", justifyContent: "center", alignItems: "center" },
  sosText: { fontFamily: fonts.headline, fontSize: 46, lineHeight: 53, letterSpacing: -1, color: c.onAction, textAlign: "center" },
  sosHint: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: c.onAction, textAlign: "center" },
  detailsToggle: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingHorizontal: 3 },
  detailsLabel: { fontFamily: fonts.medium, fontSize: 15, color: c.text, flexShrink: 1 },
  detailsEnd: { flexDirection: "row", alignItems: "center", gap: 8 },
  details: { gap: 16, paddingTop: 3, paddingBottom: 18 },
  safety: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: c.muted, textAlign: "center" },
  connectionNotice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 16, padding: 16, minHeight: 52 },
  requests: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 23, gap: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  count: { fontFamily: fonts.medium, fontSize: 13, color: c.text, paddingVertical: 4, paddingHorizontal: 9, backgroundColor: c.raised, borderRadius: 12 },
  empty: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: c.secondary, paddingBottom: 10 },
});
