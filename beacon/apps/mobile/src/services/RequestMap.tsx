import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Linking, Pressable } from "react-native";
import MapLibre from "@maplibre/maplibre-react-native";
import type { LocationReport, MapState } from "../ui/types";
import { CAMPUS_BOUNDS, campusStyle } from "../components/campusMapStyle";
import { colors as c, fonts } from "../theme/tokens";
const OFFLINE_STYLE = JSON.stringify(campusStyle);

export default function RequestMap({
  location,
  map,
}: {
  location: LocationReport;
  map: MapState;
}) {
  const [failed, setFailed] = useState(false);
  const [savedFailed, setSavedFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setSavedFailed(false);
  }, [map.styleUrl, map.bundled, map.updatedAt]);
  const longitude = location.longitude,
    latitude = location.latitude;
  const inside = (area: readonly number[]) =>
    Number.isFinite(longitude) && Number.isFinite(latitude) &&
    longitude! >= area[0] && longitude! <= area[2] &&
    latitude! >= area[1] && latitude! <= area[3];
  const saved =
    (map.status === "ready" || map.savedAvailable === true) &&
    !map.bundled &&
    !!map.styleUrl &&
    !savedFailed &&
    !(map.bounds && inside(CAMPUS_BOUNDS) && !inside(map.bounds));
  const bounds = saved && map.bounds ? map.bounds : CAMPUS_BOUNDS;
  const within = inside(bounds);
  const center = useMemo(() => [longitude!, latitude!], [longitude, latitude]);
  if (
    longitude == null ||
    latitude == null ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90 ||
    failed
  )
    return (
      <View style={s.empty}>
        <Text style={s.title}>
          {failed ? "Map could not open" : "No reported location"}
        </Text>
        <Text style={s.body}>
          Use the place description and reported coordinates below.
        </Text>
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <MapLibre.MapView
        style={{ flex: 1 }}
        key={saved ? `${map.styleUrl}-${map.updatedAt ?? 0}` : "bundled"}
        mapStyle={saved ? map.styleUrl : OFFLINE_STYLE}
        onDidFailLoadingMap={() =>
          saved ? setSavedFailed(true) : setFailed(true)
        }
        logoEnabled={false}
        attributionEnabled={saved}
        compassEnabled
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <MapLibre.Camera
          centerCoordinate={center}
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
        <Text style={s.tagText}>
          {within
            ? "REPORTED LOCATION · OFFLINE MAP"
            : saved
              ? "OUTSIDE SAVED AREA · REPORTED POSITION"
              : "OUTSIDE UW CAMPUS · REPORTED POSITION"}
        </Text>
      </View>
      {!saved && (
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
