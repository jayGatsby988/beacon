import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapLibre, { type CameraRef } from "@maplibre/maplibre-react-native";
import { LocateFixed, MapPin, MessageCircle, X } from "lucide-react-native";
import { router } from "expo-router";
import { LOCATION_LIMITS } from "@beacon/protocol";
import type { LocationReport, MapState } from "../ui/types";
import { colors as c, fonts } from "../theme/tokens";
import { CAMPUS_BOUNDS, campusStyle } from "./campusMapStyle";

const ONLINE_STYLE = "https://tiles.openfreemap.org/styles/positron";
const CAMPUS_CENTER = [-122.306, 47.655];
const OFFLINE_STYLE = JSON.stringify(campusStyle);
export type NearbyLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: number;
};
export type NearbyPin = {
  nodeId: string;
  name: string;
  location: NearbyLocation;
};

export function freshLocation(
  location: LocationReport | NearbyLocation | undefined,
  now: number,
): location is NearbyLocation {
  return (
    !!location &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    location.latitude! >= -90 &&
    location.latitude! <= 90 &&
    location.longitude! >= -180 &&
    location.longitude! <= 180 &&
    Number.isFinite(location.capturedAt) &&
    location.capturedAt! <= now + LOCATION_LIMITS.futureSkewMs &&
    now - location.capturedAt! < LOCATION_LIMITS.ttlMs
  );
}
export function locationLabel(location: NearbyLocation, now: number) {
  const seconds = Math.max(0, Math.floor((now - location.capturedAt) / 1000));
  const age =
    seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  return `${age}${location.accuracy != null && Number.isFinite(location.accuracy) ? ` · ±${Math.round(location.accuracy)} m` : ""}`;
}

function fitLocations(
  camera: CameraRef | null,
  coordinates: number[][],
  fallback: number[],
) {
  if (!coordinates.length) {
    camera?.setCamera({
      centerCoordinate: fallback,
      zoomLevel: 14.7,
      animationDuration: 400,
    });
    return;
  }
  const longitudes = coordinates.map((point) => point[0]);
  const latitudes = coordinates.map((point) => point[1]);
  const west = Math.min(...longitudes),
    east = Math.max(...longitudes);
  const south = Math.min(...latitudes),
    north = Math.max(...latitudes);
  if (east - west < 0.0005 && north - south < 0.0005) {
    camera?.setCamera({
      centerCoordinate: coordinates[0],
      zoomLevel: 16,
      animationDuration: 400,
    });
  } else {
    camera?.fitBounds([east, north], [west, south], [65, 55, 65, 55], 400);
  }
}

export default function NearbyMap({
  ownLocation,
  focusRevision,
  pins,
  connectedCount,
  internet,
  map,
  onLocate,
  onSaveArea,
  onCancelSave,
  now,
  height,
}: {
  ownLocation: LocationReport;
  focusRevision: number;
  pins: NearbyPin[];
  connectedCount: number;
  internet: boolean | null;
  map: MapState;
  onLocate: () => Promise<LocationReport>;
  onSaveArea?: () => Promise<void>;
  onCancelSave?: () => Promise<void>;
  now: number;
  height: number;
}) {
  const camera = useRef<CameraRef>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFailed, setSavedFailed] = useState(false);
  const [onlineFailed, setOnlineFailed] = useState(false);
  const [offlineFailed, setOfflineFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [viewCenter, setViewCenter] = useState<number[]>(CAMPUS_CENTER);
  const [selectedId, setSelectedId] = useState<string>();
  const centered = useRef(false);
  const fittedPeers = useRef(false);
  const fittedFocusRevision = useRef(-1);
  const online = showOnline && internet === true && !onlineFailed;
  const saved =
    (map.status === "ready" || map.savedAvailable === true) &&
    !map.bundled &&
    !!map.styleUrl &&
    !savedFailed;
  const bundled = !online && !saved;
  const bounds = saved && map.bounds ? map.bounds : CAMPUS_BOUNDS;
  const inCoverage = (coordinate: number[]) =>
    coordinate[0] >= bounds[0] &&
    coordinate[0] <= bounds[2] &&
    coordinate[1] >= bounds[1] &&
    coordinate[1] <= bounds[3];
  const areaCenter = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const mapStyle = online
    ? ONLINE_STYLE
    : saved
      ? map.styleUrl!
      : OFFLINE_STYLE;
  const downloading = saving || map.status === "downloading";
  const own =
    ownLocation.source === "device" && freshLocation(ownLocation, now)
      ? ownLocation
      : undefined;
  const validPins = pins.filter((pin) => freshLocation(pin.location, now));
  const selected = validPins.find((pin) => pin.nodeId === selectedId);
  const coordinates = [
    ...(own ? [[own.longitude, own.latitude]] : []),
    ...validPins.map((pin) => [pin.location.longitude, pin.location.latitude]),
  ];
  const outsideCoverage =
    !inCoverage(viewCenter) ||
    coordinates.some((coordinate) => !inCoverage(coordinate));
  useEffect(() => {
    setSavedFailed(false);
    setOfflineFailed(false);
  }, [map.styleUrl, map.updatedAt]);
  useEffect(() => {
    setOnlineFailed(false);
    setOfflineFailed(false);
  }, [internet]);
  useEffect(() => {
    if (!online || ready) return;
    const timeout = setTimeout(() => setOnlineFailed(true), 12_000);
    return () => clearTimeout(timeout);
  }, [online, ready]);
  useEffect(() => {
    if (!ready || !coordinates.length) return;
    const focusNeedsFit = fittedFocusRevision.current !== focusRevision;
    if (
      !focusNeedsFit &&
      centered.current &&
      (fittedPeers.current || !validPins.length)
    )
      return;
    fitLocations(camera.current, coordinates, areaCenter);
    centered.current = true;
    fittedFocusRevision.current = focusRevision;
    if (validPins.length) fittedPeers.current = true;
  }, [ready, coordinates, areaCenter, validPins.length, focusRevision]);
  const recenter = async () => {
    setLocating(true);
    setActionError(undefined);
    try {
      const report = await onLocate();
      const currentTime = Date.now();
      const points = pins
        .filter((pin) => freshLocation(pin.location, currentTime))
        .map((pin) => [pin.location.longitude, pin.location.latitude]);
      if (report.source === "device" && freshLocation(report, currentTime)) {
        points.unshift([report.longitude, report.latitude]);
      } else {
        setActionError("Your location is unavailable. Try again.");
      }
      fitLocations(camera.current, points, areaCenter);
      centered.current = true;
      if (points.length > 1) fittedPeers.current = true;
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not find your location.",
      );
    } finally {
      setLocating(false);
    }
  };
  return (
    <View style={s.frame}>
      <View style={{ height }}>
        {offlineFailed && !online ? (
          <View style={s.unavailable}>
            <MapPin size={30} color={c.secondary} />
            <Text style={s.name}>Map unavailable</Text>
            <Text style={s.caption}>
              People and messages are still available below.
            </Text>
          </View>
        ) : (
          <MapLibre.MapView
            key={
              online
                ? "online"
                : saved
                  ? `saved-${map.styleUrl}-${map.updatedAt ?? 0}`
                  : "bundled"
            }
            style={s.map}
            mapStyle={mapStyle}
            onWillStartLoadingMap={() => {
              setReady(false);
              centered.current = false;
              fittedPeers.current = false;
            }}
            onDidFinishLoadingMap={() => setReady(true)}
            onRegionDidChange={(region) =>
              setViewCenter(region.geometry.coordinates)
            }
            onDidFailLoadingMap={() => {
              setReady(false);
              if (online) setOnlineFailed(true);
              else if (saved) setSavedFailed(true);
              else setOfflineFailed(true);
            }}
            logoEnabled={false}
            attributionEnabled={!bundled}
            attributionPosition={{ bottom: 10, left: 10 }}
            compassEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
          >
            <MapLibre.Camera
              ref={camera}
              defaultSettings={{
                centerCoordinate: coordinates[0] ?? areaCenter,
                zoomLevel: coordinates.length ? 16 : 14.7,
              }}
            />
            {own && (
              <MapLibre.PointAnnotation
                id="your-location"
                title="Your reported location"
                coordinate={[own.longitude, own.latitude]}
              >
                <View collapsable={false} style={s.youMarker}>
                  <View style={s.youDot} />
                  <Text style={s.youText}>You</Text>
                </View>
              </MapLibre.PointAnnotation>
            )}
            {validPins.map((pin) => (
              <MapLibre.PointAnnotation
                key={pin.nodeId}
                id={`person-${pin.nodeId}`}
                title={pin.name}
                coordinate={[pin.location.longitude, pin.location.latitude]}
                selected={selectedId === pin.nodeId}
                onSelected={() => setSelectedId(pin.nodeId)}
              >
                <View
                  collapsable={false}
                  style={[
                    s.personMarker,
                    selectedId === pin.nodeId && s.selectedMarker,
                  ]}
                >
                  <Text style={s.initial}>
                    {pin.name.trim().slice(0, 2).toUpperCase() || "?"}
                  </Text>
                </View>
              </MapLibre.PointAnnotation>
            ))}
          </MapLibre.MapView>
        )}
        <View pointerEvents="none" style={s.mapTag}>
          <View style={s.tagDot} />
          <Text style={s.tagText}>
            {!online && outsideCoverage
              ? "Map not saved here"
              : validPins.length
                ? `${validPins.length} on the map`
                : connectedCount
                  ? `${connectedCount} connected · no positions`
                  : "No one connected yet"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find my location and show nearby people"
          accessibilityState={{ busy: locating, disabled: !ready || locating }}
          disabled={!ready || locating}
          onPress={() => void recenter()}
          style={({ pressed }) => [s.recenter, pressed && s.pressed]}
        >
          {locating ? (
            <ActivityIndicator color={c.text} />
          ) : (
            <LocateFixed color={c.text} size={22} />
          )}
        </Pressable>
        {bundled && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="OpenStreetMap attribution and license"
            onPress={() =>
              void Linking.openURL("https://www.openstreetmap.org/copyright")
            }
            style={s.attribution}
          >
            <Text style={s.attributionText}>
              © OpenStreetMap contributors · ODbL
            </Text>
          </Pressable>
        )}
      </View>
      <View style={s.mapFooter}>
        <Text style={s.caption}>
          {online
            ? "Online map"
            : outsideCoverage
              ? saved
                ? "Outside saved area · positions still shown"
                : "Outside UW campus · positions still shown"
              : saved
                ? "Saved area · offline map"
                : "UW campus · offline map"}
          {!coordinates.length ? " · area overview" : ""}
        </Text>
        {own && <Text style={s.caption}>You · {locationLabel(own, now)}</Text>}
        <View style={s.mapActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showOnline ? "Use offline map" : "View online map"
            }
            disabled={!showOnline && internet !== true}
            onPress={() => {
              setShowOnline(!showOnline);
              setOnlineFailed(false);
              setReady(false);
            }}
            style={[
              s.mapAction,
              !showOnline && internet !== true && s.disabled,
            ]}
          >
            <Text style={s.actionText}>
              {showOnline ? "Use offline map" : "View online"}
            </Text>
          </Pressable>
          {(onSaveArea || downloading) && (
            <Pressable
              accessibilityRole="button"
              disabled={
                downloading ? !onCancelSave : internet !== true || !onSaveArea
              }
              onPress={() => {
                setActionError(undefined);
                if (downloading) {
                  void onCancelSave?.().catch((error: unknown) =>
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : "Could not cancel map download.",
                    ),
                  );
                } else {
                  setSaving(true);
                  void onSaveArea?.()
                    .then(() => setShowOnline(false))
                    .catch((error: unknown) =>
                      setActionError(
                        error instanceof Error
                          ? error.message
                          : "Could not save area.",
                      ),
                    )
                    .finally(() => setSaving(false));
                }
              }}
              style={[
                s.mapAction,
                !downloading && internet !== true && s.disabled,
              ]}
            >
              <Text style={s.actionText}>
                {downloading ? "Cancel save" : "Save my area"}
              </Text>
            </Pressable>
          )}
        </View>
        {(actionError || map.error) && (
          <Text accessibilityLiveRegion="polite" style={s.caption}>
            {actionError || map.error}
          </Text>
        )}
        {onlineFailed && showOnline && (
          <Text style={s.caption}>
            Online map unavailable. Showing offline map.
          </Text>
        )}
      </View>
      {selected && (
        <View style={s.selection}>
          <View style={s.selectionTop}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.name}>{selected.name}</Text>
              <Text style={s.caption}>
                Reported {locationLabel(selected.location, now)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close location details"
              onPress={() => setSelectedId(undefined)}
              style={s.close}
            >
              <X color={c.secondary} size={20} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Message ${selected.name}`}
            onPress={() => router.push(`/chat/${selected.nodeId}`)}
            style={({ pressed }) => [s.message, pressed && s.pressed]}
          >
            <MessageCircle color={c.background} size={19} />
            <Text style={s.messageText}>Message</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  frame: {
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  map: { flex: 1 },
  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
  },
  mapTag: {
    position: "absolute",
    top: 16,
    left: 16,
    maxWidth: "76%",
    backgroundColor: c.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.text },
  tagText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: c.text,
    flexShrink: 1,
  },
  recenter: {
    position: "absolute",
    bottom: 42,
    right: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  personMarker: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.text,
    borderWidth: 3,
    borderColor: c.background,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedMarker: { borderWidth: 5, borderColor: c.secondary },
  initial: { fontFamily: fonts.medium, fontSize: 14, color: c.background },
  youMarker: {
    backgroundColor: c.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.secondary,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  youDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: c.secondary,
  },
  youText: { fontFamily: fonts.medium, fontSize: 11, color: c.text },
  mapFooter: {
    padding: 14,
    gap: 3,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  mapActions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  mapAction: { minHeight: 48, justifyContent: "center", paddingHorizontal: 4 },
  actionText: { fontFamily: fonts.medium, fontSize: 13, color: c.text },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: c.secondary,
  },
  attribution: {
    position: "absolute",
    bottom: 0,
    left: 0,
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: "center",
    backgroundColor: c.background,
  },
  attributionText: { fontFamily: fonts.body, color: c.secondary, fontSize: 10 },
  selection: {
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  selectionTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: {
    fontFamily: fonts.medium,
    fontSize: 19,
    lineHeight: 25,
    color: c.text,
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    minHeight: 48,
    backgroundColor: c.text,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    padding: 12,
  },
  messageText: { fontFamily: fonts.medium, fontSize: 15, color: c.background },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
