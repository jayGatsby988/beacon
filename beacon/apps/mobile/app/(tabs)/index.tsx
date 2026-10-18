import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronDown, MapPin, Radio } from "lucide-react-native";
import { useBeacon } from "../../src/services/BeaconContext";
import {
  ErrorNotice,
  Field,
  Heading,
  Pill,
  Screen,
  TextButton,
  useAction,
  formatReportTime,
  styles as shared,
} from "../../src/components/ui";
import { RequestCard } from "../../src/components/RequestCard";
import { Category } from "../../src/ui/types";
import { colors as c, fonts } from "../../src/theme/tokens";
export default function Home() {
  const b = useBeacon();
  const [details, setDetails] = useState(false);
  const [category, setCategory] = useState<Category>("other");
  const [note, setNote] = useState("");
  const [place, setPlace] = useState("");
  const action = useAction();
  const group = b.groups.find((g) => g.id === b.activeGroupId);
  const active = b.requests.find(
    (r) =>
      r.mine &&
      (r.groupId ?? null) === b.activeGroupId &&
      (r.status === "active" || r.status === "accepted"),
  );
  const connected = b.peers.filter((p) => p.state === "connected").length;
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
    <Screen
      network={
        connected
          ? `${connected} ${connected === 1 ? "link" : "links"}`
          : b.relayRunning
            ? "Listening"
            : "Connection"
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sharing with ${group?.name || (b.activeGroupId ? "Private group" : "Nearby")}. Change group`}
        onPress={() => router.push("/groups")}
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          alignSelf: "flex-start",
          maxWidth: "100%",
        }}
      >
        <Text style={[shared.smallTitle, { flexShrink: 1 }]}>
          {group?.name || (b.activeGroupId ? "Private group" : "Nearby")}
        </Text>
        <ChevronDown size={20} color={c.secondary} />
      </Pressable>
      <Heading>{active ? "Your SOS" : "I need help"}</Heading>
      {active ? (
        <RequestCard request={active} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send SOS now"
            accessibilityHint="Immediately saves an assistance request and queues it for nearby participating phones"
            accessibilityState={{ busy: action.busy, disabled: action.busy }}
            onPress={send}
            disabled={action.busy}
            style={({ pressed }) => [
              s.sos,
              pressed && { opacity: 0.8 },
              action.busy && { opacity: 0.55 },
            ]}
          >
            <Radio color={c.onAction} size={30} />
            <Text style={s.sosText}>
              {action.busy ? "Saving…" : "Send SOS"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            onPress={() => setDetails(!details)}
            style={s.detailsToggle}
          >
            <Text style={s.detailsLabel}>
              {details ? "Details · optional" : "Add details · optional"}
            </Text>
            <ChevronDown
              color={c.secondary}
              size={22}
              style={{ transform: [{ rotate: details ? "180deg" : "0deg" }] }}
            />
          </Pressable>
          {details && (
            <View style={{ gap: 16 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(
                  ["other", "injured", "trapped", "stranded"] as Category[]
                ).map((v) => (
                  <Pill
                    key={v}
                    selected={category === v}
                    onPress={() => setCategory(v)}
                  >
                    {v === "other"
                      ? "Need help"
                      : v[0].toUpperCase() + v.slice(1)}
                  </Pill>
                ))}
              </View>
              <Field
                label="Note"
                placeholder="What would help right now?"
                value={note}
                onChangeText={setNote}
                maxLength={140}
                multiline
              />
              <Field
                label="Place"
                placeholder="Building, floor or room"
                value={place}
                onChangeText={setPlace}
                maxLength={120}
              />
            </View>
          )}
        </>
      )}
      <ErrorNotice message={action.error || b.error} />
      {details && !active && (
        <View style={s.location}>
          <MapPin size={19} color={c.secondary} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={shared.smallTitle}>
              {b.location.source === "unavailable"
                ? "Location unavailable"
                : b.location.place || "Phone location"}
            </Text>
            {b.location.source !== "unavailable" && (
              <Text style={shared.caption}>
                {formatReportTime(b.location.capturedAt)}
                {b.location.accuracy != null
                  ? ` · ±${Math.round(b.location.accuracy)} m`
                  : ""}
              </Text>
            )}
          </View>
        </View>
      )}
      {b.relayRunning ? (
        <Text style={shared.caption}>Keep Beacon open while using it.</Text>
      ) : (
        <View style={{ gap: 2 }}>
          <Text style={shared.caption}>
            {b.bluetooth === "unsupported"
              ? "Bluetooth unavailable. SOS saves locally."
              : b.bluetooth === "poweredOff"
                ? "Turn on Bluetooth to share your SOS."
                : "Enable Bluetooth to share your SOS."}
          </Text>
          <TextButton onPress={() => router.push("/network")}>
            Connection
          </TextButton>
        </View>
      )}
      <Text style={s.safety}>
        Community help. Does not call emergency services.
      </Text>
    </Screen>
  );
}
const s = StyleSheet.create({
  sos: {
    backgroundColor: c.red,
    borderRadius: 20,
    padding: 24,
    minHeight: 168,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  sosText: {
    fontFamily: fonts.headline,
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -1,
    color: c.onAction,
  },
  detailsToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    marginTop: -8,
  },
  detailsLabel: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: c.secondary,
    flexShrink: 1,
  },
  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  safety: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 19,
    color: c.muted,
  },
});
