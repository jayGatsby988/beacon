import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { router } from "expo-router";
import type { RequestView } from "../ui/types";
import { age, styles } from "./ui";
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
export function RequestCard({ request }: { request: RequestView }) {
  const status =
    request.mine && request.status === "active"
      ? request.transport === "received"
        ? "Receipt confirmed"
        : request.transport === "forwarded"
          ? "Forwarded · awaiting receipt"
          : "Waiting for connection"
      : statusNames[request.status];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${categoryNames[request.category]}, ${request.mine ? "your request" : request.name}, ${status}. Open request.`}
      onPress={() => router.push(`/request/${request.id}`)}
      style={({ pressed }) => [
        styles.card,
        { minHeight: 48, padding: 16, gap: 7 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 21,
            lineHeight: 27,
            color: c.text,
            flex: 1,
          }}
        >
          {categoryNames[request.category]}
        </Text>
        <ChevronRight color={c.secondary} size={22} />
      </View>
      <Text style={styles.caption}>
        {request.mine ? "You" : request.name || "Participant"} ·{" "}
        {age(request.createdAt)} · {status}
      </Text>
      {!!request.note && (
        <Text numberOfLines={2} style={styles.body}>
          {request.note}
        </Text>
      )}
      <Text style={styles.caption}>
        {request.location.place ||
          (request.location.latitude != null
            ? "Reported coordinates"
            : "Location not shared")}
      </Text>
      {request.pendingUpdate && (
        <Text style={styles.caption}>Latest update waiting to be shared.</Text>
      )}
    </Pressable>
  );
}
