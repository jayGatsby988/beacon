import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import RequestMap from "../services/RequestMap";
import type { LocationReport, MapState } from "../ui/types";
import { Body, Card, formatReportTime, styles } from "./ui";
import { colors as c } from "../theme/tokens";

export function LocationCard({
  location,
  map,
}: {
  location: LocationReport;
  map: MapState;
}) {
  const [showCoordinates, setShowCoordinates] = useState(false);
  const hasCoordinates =
    location.latitude != null && location.longitude != null;
  return (
    <Card style={{ padding: 0, overflow: "hidden", gap: 0 }}>
      <View style={{ padding: 16, gap: 6 }}>
        <Text style={styles.smallTitle}>Location</Text>
        {location.place ? (
          <Body>{location.place}</Body>
        ) : !hasCoordinates ? (
          <Body muted>Not shared.</Body>
        ) : null}
        {location.source !== "unavailable" && (
          <Text style={styles.caption}>
            {formatReportTime(location.capturedAt)} · Not live
            {location.accuracy != null
              ? ` · ±${Math.round(location.accuracy)} m`
              : ""}
          </Text>
        )}
      </View>
      {hasCoordinates && (
        <>
          <View style={{ height: 200 }}>
            <RequestMap location={location} map={map} />
          </View>
          <View style={{ paddingHorizontal: 16 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showCoordinates }}
              onPress={() => setShowCoordinates((shown) => !shown)}
              style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Text style={styles.textButtonText}>Coordinates</Text>
              {showCoordinates ? (
                <ChevronUp color={c.secondary} size={20} />
              ) : (
                <ChevronDown color={c.secondary} size={20} />
              )}
            </Pressable>
            {showCoordinates && (
              <Text
                selectable
                style={[
                  styles.body,
                  { fontVariant: ["tabular-nums"], paddingBottom: 16 },
                ]}
              >
                {location.latitude!.toFixed(5)},{" "}
                {location.longitude!.toFixed(5)}
              </Text>
            )}
          </View>
        </>
      )}
    </Card>
  );
}
