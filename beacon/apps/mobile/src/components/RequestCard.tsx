import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
  const { width, fontScale } = useWindowDimensions();
  const incoming = showOffer && !request.mine;
  const stacked = width < 350 || fontScale >= 1.3;
  const myOffer = request.offers.find((offer) => offer.nodeId === b.nodeId);
  const canOffer = showOffer && !request.mine && request.status === "active" && !request.acceptedOfferId && !myOffer;
  const status = myOffer && request.status === "active" ? "Offer saved · awaiting acceptance" : requestStatus(request);
  const name = request.mine ? "You" : request.name || "Participant";
  const openDetails = () => router.push(`/request/${request.id}`);
  return (
    <View style={s.card}>
      <View style={[s.cardLayout, incoming && !stacked && s.incomingRow]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${categoryNames[request.category]}, ${name}, ${status}. Open request.`}
        onPress={openDetails}
        style={({ pressed }) => [s.content, incoming && !stacked && s.incomingContent, pressed && { opacity: 0.7 }]}
      >
        <View style={s.topRow}>
          {!incoming && <View style={s.symbol}>
            {request.mine ? <Radio color={c.red} size={21} /> : <HeartHandshake color={c.text} size={21} />}
          </View>}
          <View style={s.details}>
            <Text style={s.title}>{request.mine ? categoryNames[request.category] : `${name} needs help`}</Text>
            <Text style={styles.caption}>{request.mine ? "You" : categoryNames[request.category]} · {age(request.updatedAt)}</Text>
            {!!request.note && <Text style={s.note}>{request.note}</Text>}
            {(!!request.location.place || request.location.latitude != null) && (
              <View style={s.location}>
                <MapPin color={c.secondary} size={14} />
                <Text style={[styles.caption, s.flexText]}>{request.location.place || "Shared coordinates"}</Text>
              </View>
            )}
            {(request.mine || myOffer || request.status !== "active") && (
              <Text style={s.status} accessibilityLiveRegion="polite">{status}</Text>
            )}
            {request.mine && request.status === "active" && (
              <Text style={styles.caption}>{request.offers.length ? `${request.offers.length} ${request.offers.length === 1 ? "offer" : "offers"} to review` : "No offers yet"}</Text>
            )}
            {request.pendingUpdate && <Text style={styles.caption}>Update waiting to be shared.</Text>}
            {request.mine && <Text style={s.openLabel}>View SOS & offers</Text>}
          </View>
          {!incoming && <ChevronRight color={c.secondary} size={19} />}
        </View>
      </Pressable>
      {canOffer && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Offer help to ${name}`}
          accessibilityState={{ disabled: action.busy, busy: action.busy }}
          disabled={action.busy}
          onPress={() => action.run(() => b.offerHelp(request.id))}
          style={({ pressed }) => [s.offerButton, !stacked && s.offerButtonSide, (pressed || action.busy) && { opacity: 0.6 }]}
        >
          <Text style={s.offerLabel}>{action.busy ? "Saving offer…" : "Offer help"}</Text>
        </Pressable>
      )}
      </View>
      {action.error && <ErrorNotice message={action.error} />}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderBottomWidth: 1, borderColor: c.border, paddingVertical: 16 },
  cardLayout: { gap: 8 },
  incomingRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  incomingContent: { flex: 1 },
  content: { minHeight: 48 },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  symbol: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: c.raised },
  details: { flex: 1, gap: 5 },
  flexText: { flex: 1 },
  title: { fontFamily: fonts.medium, color: c.text, fontSize: 17, lineHeight: 24 },
  note: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.secondary },
  status: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: c.secondary },
  location: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  openLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: c.text },
  offerButton: { minHeight: 44, alignSelf: "flex-start", paddingVertical: 8, justifyContent: "center" },
  offerButtonSide: { alignSelf: "center", maxWidth: "38%" },
  offerLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: c.text, flexShrink: 1 },
});
