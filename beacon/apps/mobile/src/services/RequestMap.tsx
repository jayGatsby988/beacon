import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Linking, Pressable } from "react-native";
import MapLibre from "@maplibre/maplibre-react-native";
import type { LocationReport, MapState } from "../ui/types";
import campus from "../../assets/maps/uw-campus.json";
import { colors as c, fonts } from "../theme/tokens";
const campusStyle = {
  version: 8,
  sources: {
    campus: {
      type: "geojson",
      data: campus,
      attribution: "© OpenStreetMap contributors · ODbL",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#111317" },
    },
    {
      id: "buildings",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "building"],
      paint: { "fill-color": "#30353D", "fill-outline-color": "#424953" },
    },
    {
      id: "parks",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "park"],
      paint: { "fill-color": "#20262B" },
    },
    {
      id: "water",
      type: "fill",
      source: "campus",
      filter: ["all", ["==", "kind", "water"], ["==", "$type", "Polygon"]],
      paint: { "fill-color": "#191C22" },
    },
    {
      id: "roads",
      type: "line",
      source: "campus",
      filter: ["==", "kind", "road"],
      paint: { "line-color": "#646B75", "line-width": 2 },
    },
  ],
};
export default function RequestMap({
  location,
  map,
}: {
  location: LocationReport;
  map: MapState;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [map.styleUrl, map.bundled, map.updatedAt]);
  const longitude = location.longitude,
    latitude = location.latitude;
  const within =
    longitude != null &&
    latitude != null &&
    (!map.bounds ||
      (longitude >= map.bounds[0] &&
        longitude <= map.bounds[2] &&
        latitude >= map.bounds[1] &&
        latitude <= map.bounds[3]));
  if (map.status !== "ready" || !within || failed)
    return (
      <View style={s.empty}>
        <Text style={s.title}>
          {!within
            ? "Outside your saved map"
            : failed
              ? "Map could not open"
              : "Map unavailable offline"}
        </Text>
        <Text style={s.body}>
          Use the reported coordinates and place description below. A map never
          replaces the location’s accuracy report.
        </Text>
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <MapLibre.MapView
        style={{ flex: 1 }}
        mapStyle={map.bundled ? JSON.stringify(campusStyle) : map.styleUrl}
        onDidFailLoadingMap={() => setFailed(true)}
        logoEnabled={false}
        attributionEnabled={!map.bundled}
        compassEnabled
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <MapLibre.Camera
          centerCoordinate={[longitude!, latitude!]}
          zoomLevel={16}
        />
        <MapLibre.ShapeSource
          id="reported-location"
          shape={{
            type: "Feature",
            geometry: { type: "Point", coordinates: [longitude!, latitude!] },
            properties: {},
          }}
        >
          <MapLibre.CircleLayer
            id="reported-location-dot"
            style={{
              circleRadius: 8,
              circleColor: c.text,
              circleStrokeColor: c.background,
              circleStrokeWidth: 4,
            }}
          />
        </MapLibre.ShapeSource>
      </MapLibre.MapView>
      <View style={s.tag}>
        <Text style={s.tagText}>REPORTED LOCATION · STATIC MAP</Text>
      </View>
      {map.bundled && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="OpenStreetMap attribution and license"
          onPress={() =>
            void Linking.openURL("https://www.openstreetmap.org/copyright")
          }
          style={s.attribution}
        >
          <Text style={s.attrText}>© OpenStreetMap contributors · ODbL</Text>
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  empty: {
    flex: 1,
    backgroundColor: c.background,
    padding: 24,
    justifyContent: "center",
    gap: 10,
  },
  title: { fontFamily: fonts.medium, color: c.text, fontSize: 18 },
  body: {
    fontFamily: fonts.body,
    color: c.secondary,
    fontSize: 14,
    lineHeight: 21,
  },
  tag: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: c.background,
    borderRadius: 8,
    padding: 9,
  },
  tagText: {
    fontFamily: fonts.medium,
    color: c.text,
    fontSize: 9,
    letterSpacing: 1,
  },
  attribution: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: c.background,
    padding: 8,
    minHeight: 32,
  },
  attrText: { fontFamily: fonts.body, color: c.secondary, fontSize: 10 },
});
