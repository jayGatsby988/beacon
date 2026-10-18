import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { router } from "expo-router";
import type { RequestView } from "../ui/types";
import { age, styles } from "./ui";
import { colors as c } from "../theme/tokens";

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
export function RequestCard({ request }: { request: RequestView }) {
  const status = requestStatus(request);
  const name = request.mine ? "You" : request.name || "Participant";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${categoryNames[request.category]}, ${name}, ${status}. Open request.`}
      onPress={() => router.push(`/request/${request.id}`)}
      style={({ pressed }) => [
        styles.card,
        { minHeight: 48, padding: 16, gap: 6 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={[styles.smallTitle, { flex: 1 }]}>
          {categoryNames[request.category]}
        </Text>
        <ChevronRight color={c.secondary} size={20} />
      </View>
      <Text style={styles.caption}>
        {name} · {age(request.createdAt)}
      </Text>
      <Text style={styles.body}>{status}</Text>
      {!!request.note && (
        <Text numberOfLines={2} style={styles.caption}>
          {request.note}
        </Text>
      )}
      {!!request.location.place && (
        <Text numberOfLines={1} style={styles.caption}>
          {request.location.place}
        </Text>
      )}
      {request.pendingUpdate && (
        <Text style={styles.caption}>Update waiting to be shared.</Text>
      )}
    </Pressable>
  );
}
