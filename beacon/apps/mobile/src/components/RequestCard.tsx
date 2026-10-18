import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, HeartHandshake, MapPin, Radio } from "lucide-react-native";
import { router } from "expo-router";
import type { RequestView } from "../ui/types";
import { age, ErrorNotice, styles, useAction } from "./ui";
import { useBeacon } from "../services/BeaconContext";
import { colors as c, fonts } from "../theme/tokens";

export const categoryNames = {
  other: "Need help",
  injured: "Injured",
  trapped: "Trapped",
  stranded: "Stranded",
};
export const statusNames = {
  active: "Open request",
  accepted: "Help accepted",
  completed: "Completed",
  canceled: "Canceled",
  expired: "Expired",
};
export function requestStatus(request: RequestView): string {
  if (request.status === "accepted") {
    const accepted = request.offers.find(
      (offer) => offer.id === request.acceptedOfferId,
    );
    return accepted?.assignmentReceived
      ? "Volunteer confirmed"
      : "Offer accepted";
  }
  if (!request.mine || request.status !== "active")
    return statusNames[request.status];
  return request.transport === "received"
    ? "Received by a participant"
    : request.transport === "forwarded"
      ? "Passed to a relay"
      : "Waiting for a connection";
}
export function RequestCard({ request, showOffer = false }: { request: RequestView; showOffer?: boolean }) {
  const b = useBeacon();
  const action = useAction();
  const myOffer = request.offers.find((offer) => offer.nodeId === b.nodeId);
  const canOffer = showOffer && !request.mine && request.status === "active" && !request.acceptedOfferId && !myOffer;
  const status = myOffer && request.status === "active" ? "Offer saved · awaiting acceptance" : requestStatus(request);
  const name = request.mine ? "You" : request.name || "Participant";
  const completed = request.status === "completed";
  return (
    <View style={[s.card, completed && s.completed]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${categoryNames[request.category]}, ${name}, ${status}. Open request.`}
        onPress={() => router.push(`/request/${request.id}`)}
        style={({ pressed }) => [s.content, pressed && { opacity: 0.7 }]}
      >
        <View style={s.topRow}>
          <View style={[s.symbol, completed && { backgroundColor: "#DCE1E4" }, request.mine && !completed && s.sosSymbol]}>
            {request.mine ? <Radio color={completed ? c.background : c.redLabel} size={20} /> : <HeartHandshake color={completed ? c.background : c.secondary} size={20} />}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[s.title, completed && s.darkText]}>{categoryNames[request.category]}</Text>
            <Text style={[styles.caption, completed && s.darkText]}>{name} · {age(request.updatedAt)}</Text>
          </View>
          <ChevronRight color={completed ? c.background : c.muted} size={19} />
        </View>
        {!!request.note && <Text numberOfLines={2} style={[s.note, completed && s.darkText]}>{request.note}</Text>}
        <Text style={[s.status, request.mine && !completed && { color: c.redLabel }, completed && s.darkText]} accessibilityLiveRegion="polite">{status}</Text>
        {request.mine && request.status === "active" && (
          <View style={s.progress}>
            <Text style={styles.caption}>Saved on this phone</Text>
            <Text style={s.offerCount}>{request.offers.length ? `${request.offers.length} ${request.offers.length === 1 ? "offer" : "offers"} · review` : "No offers yet"}</Text>
          </View>
        )}
        {(!!request.location.place || request.location.latitude != null) && (
          <View style={s.location}>
            <MapPin color={completed ? c.background : c.muted} size={14} />
            <Text numberOfLines={2} style={[styles.caption, { flex: 1 }, completed && s.darkText]}>{request.location.place || "Shared coordinates"}</Text>
          </View>
        )}
        {request.pendingUpdate && <Text style={[styles.caption, completed && s.darkText]}>Update waiting to be shared.</Text>}
        {request.mine && !completed && <Text style={s.openLabel}>View SOS & offers</Text>}
      </Pressable>
      {canOffer && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Offer help to ${name}`}
          accessibilityState={{ disabled: action.busy, busy: action.busy }}
          disabled={action.busy}
          onPress={() => action.run(() => b.offerHelp(request.id))}
          style={({ pressed }) => [s.offerButton, (pressed || action.busy) && { opacity: 0.6 }]}
        >
          <HeartHandshake size={18} color={c.text} />
          <Text style={s.offerLabel}>{action.busy ? "Saving offer…" : "Offer help"}</Text>
        </Pressable>
      )}
      {action.error && <View style={{ padding: 16, paddingTop: 0 }}><ErrorNotice message={action.error} /></View>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: "hidden" },
  completed: { backgroundColor: c.text, borderColor: c.text },
  content: { padding: 16, gap: 12, minHeight: 48 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  symbol: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: c.raised },
  sosSymbol: { backgroundColor: "#342027" },
  title: { fontFamily: fonts.medium, color: c.text, fontSize: 17, lineHeight: 24 },
  note: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.secondary },
  status: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: c.secondary },
  darkText: { color: c.background },
  progress: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 5 },
  offerCount: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: c.text },
  location: { flexDirection: "row", alignItems: "center", gap: 6 },
  openLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: c.text },
  offerButton: { minHeight: 48, marginHorizontal: 16, marginBottom: 16, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.raised, padding: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  offerLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: c.text },
});
