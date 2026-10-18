import { Text, View } from "react-native";
import RequestMap from "../services/RequestMap";
import type { LocationReport, MapState } from "../ui/types";
import { Body, Card, formatReportTime, Label, styles } from "./ui";

export function LocationCard({
  location,
  map,
}: {
  location: LocationReport;
  map: MapState;
}) {
  const hasCoordinates =
    location.latitude != null && location.longitude != null;
  const coordinates = hasCoordinates
    ? `${location.latitude!.toFixed(5)}, ${location.longitude!.toFixed(5)}`
    : undefined;
  const source =
    location.source === "device"
      ? "Device report"
      : location.source === "manual"
        ? "Manual report"
        : "Location unavailable";
  return (
    <Card style={{ padding: 0, overflow: "hidden", gap: 0 }}>
      <View style={{ padding: 16, gap: 6 }}>
        <Label>Reported location</Label>
        {location.place ? (
          <Body>{location.place}</Body>
        ) : !hasCoordinates ? (
          <Body muted>No location shared.</Body>
        ) : null}
        {coordinates && (
          <Text
            selectable
            style={[styles.body, { fontVariant: ["tabular-nums"] }]}
          >
            {coordinates}
          </Text>
        )}
        {location.source !== "unavailable" && (
          <Text style={styles.caption}>
            {source} · {formatReportTime(location.capturedAt)} · Not live
            {location.accuracy != null
              ? ` · ±${Math.round(location.accuracy)} m`
              : ""}
          </Text>
        )}
      </View>
      {hasCoordinates && (
        <View style={{ height: 200 }}>
          <RequestMap location={location} map={map} />
        </View>
      )}
    </Card>
  );
}
