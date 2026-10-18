import { Pressable, Text, View } from "react-native";
import { ArrowUpRight, MapPin } from "lucide-react-native";
import { router } from "expo-router";
import { RequestView } from "../ui/types";
import { age, Body, Label, styles } from "./ui";
import { colors as c, fonts } from "../theme/tokens";
export const categoryNames = {
  other: "Assistance needed",
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
export function RequestCard({ request: r }: { request: RequestView }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${categoryNames[r.category]}, ${r.name}, ${statusNames[r.status]}. Open request.`}
      onPress={() => router.push(`/request/${r.id}`)}
      style={({ pressed }) => [
        styles.card,
        { gap: 18 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Label>
          {r.mine && r.status === "active"
            ? r.transport === "received"
              ? "Received by a participant"
              : r.transport === "forwarded"
                ? "Passed to a relay"
                : "Waiting for a connection"
            : statusNames[r.status]}
        </Label>
        <Text style={styles.caption}>{age(r.createdAt)}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
        <Text
          style={{
            fontFamily: fonts.headline,
            fontSize: 28,
            lineHeight: 31,
            color: c.text,
            flex: 1,
            letterSpacing: -0.7,
          }}
        >
          {categoryNames[r.category]}
        </Text>
        <ArrowUpRight color={c.text} size={24} />
      </View>
      <View style={{ gap: 8 }}>
        <Body muted>{r.mine ? "Your request" : r.name || "A participant"}</Body>
        {!!r.note && (
          <Text numberOfLines={2} style={styles.body}>
            {r.note}
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <MapPin color={c.muted} size={15} />
          <Text style={[styles.caption, { flex: 1 }]}>
            {r.location.place ||
              (r.location.latitude != null
                ? "Reported coordinates"
                : "Location not shared")}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
