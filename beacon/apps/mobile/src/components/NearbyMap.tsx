import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapLibre, { type CameraRef } from "@maplibre/maplibre-react-native";
import { Layers, LocateFixed, MapPin, MessageCircle, X } from "lucide-react-native";
import { router } from "expo-router";
import { LOCATION_LIMITS } from "@beacon/protocol";
import type { LocationReport, MapState, RequestView } from "../ui/types";
import { colors as c, fonts } from "../theme/tokens";
import { CAMPUS_BOUNDS, campusStyle } from "./campusMapStyle";

const ONLINE_STYLE = "https://tiles.openfreemap.org/styles/positron";
const CAMPUS_CENTER = [-122.306, 47.655];
const OFFLINE_STYLE = JSON.stringify(campusStyle);
const EMPTY_REQUESTS: RequestView[] = [];
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

// Captions do not need a second-by-second clock. Wake at an exact freshness
// boundary when it comes sooner so an expired peer position never lingers.
export function locationRefreshDelay(
  locations: (LocationReport | NearbyLocation | undefined)[],
  now: number,
) {
  let delay = 30_000;
  for (const location of locations) {
    if (!Number.isFinite(location?.capturedAt)) continue;
    for (const boundary of [
      location!.capturedAt! - LOCATION_LIMITS.futureSkewMs,
      location!.capturedAt! + LOCATION_LIMITS.ttlMs,
    ]) {
      if (boundary > now) delay = Math.min(delay, boundary - now);
    }
  }
  return Math.max(1, delay);
}

type MapMarker = {
  id: string;
  title: string;
  label: string;
  kind: "you" | "person" | "request" | "history";
  longitude: number;
  latitude: number;
  selected: boolean;
};
type MapSurfaceProps = {
  mapKey: string;
  mapStyle: string;
  bundled: boolean;
  camera: RefObject<CameraRef | null>;
  longitude: number;
  latitude: number;
  zoomLevel: number;
  markers: MapMarker[];
  onLoading: () => void;
  onReady: () => void;
  onFailed: () => void;
  onRegionChange: (region: { geometry: { coordinates: number[] } }) => void;
  onRegionWillChange: (region: { properties?: { isUserInteraction?: boolean } }) => void;
  onSelect: (kind: MapMarker["kind"], id: string) => void;
};

// Keep timer ticks, download progress and preview text out of MapLibre's native
// subtree. Only marker appearance/coordinates, selection or map configuration
// should update it; capturedAt and accuracy belong to the surrounding UI.
const MapSurface = memo(function MapSurface({
  mapKey, mapStyle, bundled, camera, longitude, latitude, zoomLevel,
  markers, onLoading, onReady, onFailed, onRegionChange, onRegionWillChange, onSelect,
}: MapSurfaceProps) {
  const defaultSettings = useMemo(() => ({
    centerCoordinate: [longitude, latitude],
    zoomLevel,
  }), [longitude, latitude, zoomLevel]);
  return (
    <MapLibre.MapView
      key={mapKey}
      style={s.map}
      mapStyle={mapStyle}
      onWillStartLoadingMap={onLoading}
      onDidFinishLoadingMap={onReady}
      onRegionDidChange={onRegionChange}
      onRegionWillChange={onRegionWillChange}
      onDidFailLoadingMap={onFailed}
      logoEnabled={false}
      attributionEnabled={!bundled}
      attributionPosition={ATTRIBUTION_POSITION}
      compassEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
      scrollEnabled
      zoomEnabled
    >
      <MapLibre.Camera ref={camera} defaultSettings={defaultSettings} />
      {markers.map((marker) => (
        <MapLibre.PointAnnotation
          key={marker.id}
          id={marker.id}
          title={marker.title}
          coordinate={[marker.longitude, marker.latitude]}
          selected={marker.selected}
          onSelected={marker.kind === "you" ? undefined : () => onSelect(marker.kind, marker.id)}
        >
          {marker.kind === "you" ? (
            <View collapsable={false} style={s.youMarker}><View style={s.youDot} /><Text style={s.youText}>You</Text></View>
          ) : (
            <View collapsable={false} style={marker.kind === "request" || marker.kind === "history"
              ? [s.sosMarker, marker.kind === "history" && s.historyMarker, marker.selected && s.selectedSosMarker]
              : [s.personMarker, marker.selected && s.selectedMarker]}>
              <Text maxFontSizeMultiplier={1.4} style={marker.kind === "request" || marker.kind === "history" ? s.sosText : s.initial}>{marker.label}</Text>
            </View>
          )}
        </MapLibre.PointAnnotation>
      ))}
    </MapLibre.MapView>
  );
}, (previous, next) => {
  for (const key of Object.keys(next) as (keyof MapSurfaceProps)[]) {
    if (key !== "markers" && previous[key] !== next[key]) return false;
  }
  return previous.markers.length === next.markers.length &&
    previous.markers.every((marker, index) => {
      const other = next.markers[index];
      return marker.id === other.id && marker.title === other.title &&
        marker.label === other.label && marker.kind === other.kind &&
        marker.longitude === other.longitude && marker.latitude === other.latitude &&
        marker.selected === other.selected;
    });
});
const ATTRIBUTION_POSITION = { bottom: 10, left: 10 };

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
  focusRequestId,
  requestFocusRevision = 0,
  pins,
  requests = EMPTY_REQUESTS,
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
  focusRequestId?: string;
  requestFocusRevision?: number;
  pins: NearbyPin[];
  requests?: RequestView[];
  connectedCount: number;
  internet: boolean | null;
  map: MapState;
  onLocate: () => Promise<LocationReport>;
  onSaveArea?: () => Promise<void>;
  onCancelSave?: () => Promise<void>;
  now: number;
  height?: number;
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
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const [showMapOptions, setShowMapOptions] = useState(false);
  const centered = useRef(false);
  const fittedPeers = useRef(false);
  const fittedFocusRevision = useRef(-1);
  const userMoved = useRef(false);
  const viewport = useRef<{ longitude: number; latitude: number; zoomLevel: number } | undefined>(undefined);
  const handledRequestFocus = useRef<string | undefined>(undefined);
  const online = showOnline && internet === true && !onlineFailed;
  const savedAvailable =
    (map.status === "ready" || map.savedAvailable === true) &&
    !map.bundled &&
    !!map.styleUrl &&
    !savedFailed;
  const targetLocation = requests.find((request) => request.id === focusRequestId)?.location ?? ownLocation;
  const inside = (point: LocationReport, area: readonly number[]) =>
    Number.isFinite(point.longitude) && Number.isFinite(point.latitude) &&
    point.longitude! >= area[0] && point.longitude! <= area[2] &&
    point.latitude! >= area[1] && point.latitude! <= area[3];
  // A saved trip elsewhere must not hide the streets bundled for UW.
  const saved = savedAvailable && !(map.bounds && inside(targetLocation, CAMPUS_BOUNDS) && !inside(targetLocation, map.bounds));
  const bundled = !online && !saved;
  const bounds = saved && map.bounds ? map.bounds : CAMPUS_BOUNDS;
  const inCoverage = (coordinate: number[]) =>
    coordinate[0] >= bounds[0] &&
    coordinate[0] <= bounds[2] &&
    coordinate[1] >= bounds[1] &&
    coordinate[1] <= bounds[3];
  const areaCenter = useMemo(() => [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2], [bounds]);
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
  const validPins = useMemo(() => pins.filter((pin) => freshLocation(pin.location, now)), [pins, now]);
  const selected = validPins.find((pin) => pin.nodeId === selectedId);
  // SOS coordinates are the location attached to a request, never a live peer fix.
  const requestPins = useMemo(() => requests.filter((request) =>
    (request.status === "active" || request.status === "accepted" || request.id === focusRequestId) &&
    request.location.source !== "unavailable" &&
    Number.isFinite(request.location.latitude) &&
    Number.isFinite(request.location.longitude) &&
    Math.abs(request.location.latitude!) <= 90 &&
    Math.abs(request.location.longitude!) <= 180,
  ), [requests, focusRequestId]);
  const selectedRequest = requestPins.find((request) => request.id === selectedRequestId);
  const activeRequestCount = requestPins.filter((request) => request.status === "active" || request.status === "accepted").length;
  const coordinates = [
    ...(own ? [[own.longitude, own.latitude]] : []),
    ...validPins.map((pin) => [pin.location.longitude, pin.location.latitude]),
    ...requestPins.map((request) => [request.location.longitude!, request.location.latitude!]),
  ];
  // The coverage label describes the visible area, not offscreen reports.
  const outsideCoverage = !inCoverage(viewCenter);
  useEffect(() => {
    setActionError(undefined);
    if (!focusRequestId) {
      handledRequestFocus.current = undefined;
      setSelectedRequestId(undefined);
    }
  }, [focusRequestId, requestFocusRevision]);
  useEffect(() => {
    setSavedFailed(false);
    setOfflineFailed(false);
  }, [map.styleUrl, map.updatedAt]);
  useEffect(() => {
    setOnlineFailed(false);
    setOfflineFailed(false);
  }, [internet]);
  useEffect(() => {
    if (ready || (offlineFailed && !online && !saved)) return;
    const timeout = setTimeout(() => {
      if (online) setOnlineFailed(true);
      else if (saved) setSavedFailed(true);
      else setOfflineFailed(true);
    }, 12_000);
    return () => clearTimeout(timeout);
  }, [online, saved, ready, offlineFailed]);
  useEffect(() => {
    if (!ready || !coordinates.length || userMoved.current || focusRequestId) return;
    const focusNeedsFit = fittedFocusRevision.current !== focusRevision;
    if (
      !focusNeedsFit &&
      centered.current &&
      (fittedPeers.current || !validPins.length)
    )
      return;
    // Finding yourself must not zoom out to a distant SOS or peer report.
    fitLocations(camera.current, own ? [[own.longitude, own.latitude]] : coordinates, areaCenter);
    centered.current = true;
    fittedFocusRevision.current = focusRevision;
    if (validPins.length) fittedPeers.current = true;
  }, [ready, coordinates, areaCenter, validPins.length, focusRevision, focusRequestId]);
  useEffect(() => {
    if (!ready || !focusRequestId) return;
    const intent = `${focusRequestId}:${requestFocusRevision}`;
    if (handledRequestFocus.current === intent) return;
    handledRequestFocus.current = intent;
    const request = requestPins.find((item) => item.id === focusRequestId);
    if (!request) {
      setSelectedId(undefined);
      setSelectedRequestId(undefined);
      setActionError("This request has no available location in this audience.");
      return;
    }
    setSelectedId(undefined);
    setSelectedRequestId(request.id);
    setActionError(undefined);
    userMoved.current = true;
    fitLocations(camera.current, [[request.location.longitude!, request.location.latitude!]], areaCenter);
  }, [ready, focusRequestId, requestFocusRevision, requestPins, areaCenter]);
  const recenter = async () => {
    setLocating(true);
    setActionError(undefined);
    try {
      const report = await onLocate();
      const currentTime = Date.now();
      if (report.source !== "device" || !freshLocation(report, currentTime)) {
        setActionError("Your location is unavailable. Try again.");
        return;
      }
      fitLocations(camera.current, [[report.longitude, report.latitude]], areaCenter);
      centered.current = true;
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
  const onLoading = useCallback(() => {
    setReady(false);
    centered.current = false;
    fittedPeers.current = false;
  }, []);
  const onReady = useCallback(() => setReady(true), []);
  const onFailed = useCallback(() => {
    setReady(false);
    if (online) setOnlineFailed(true);
    else if (saved) setSavedFailed(true);
    else setOfflineFailed(true);
  }, [online, saved]);
  const onRegionWillChange = useCallback((region: { properties?: { isUserInteraction?: boolean } }) => {
    if (region.properties?.isUserInteraction) {
      userMoved.current = true;
      setShowMapOptions(false);
    }
  }, []);
  const onRegionChange = useCallback((region: { geometry: { coordinates: number[] }; properties?: { isUserInteraction?: boolean; zoomLevel?: number } }) => {
    if (region.properties?.isUserInteraction) userMoved.current = true;
    const next = region.geometry.coordinates;
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return;
    viewport.current = { longitude: next[0], latitude: next[1], zoomLevel: region.properties?.zoomLevel ?? viewport.current?.zoomLevel ?? 16 };
    setViewCenter((previous) => previous[0] === next[0] && previous[1] === next[1] ? previous : next);
  }, []);
  const onSelect = useCallback((kind: MapMarker["kind"], id: string) => {
    setSelectedId(kind === "person" ? id.slice("person-".length) : undefined);
    setSelectedRequestId(kind === "request" || kind === "history" ? id.slice("request-".length) : undefined);
  }, []);
  const markers: MapMarker[] = [
    ...(own ? [{ id: "your-location", title: "Your reported location", label: "You", kind: "you" as const, longitude: own.longitude, latitude: own.latitude, selected: false }] : []),
    ...validPins.map((pin) => ({ id: `person-${pin.nodeId}`, title: pin.name, label: pin.name.trim().slice(0, 2).toUpperCase() || "?", kind: "person" as const, longitude: pin.location.longitude, latitude: pin.location.latitude, selected: pin.nodeId === selectedId })),
    ...requestPins.map((request) => ({ id: `request-${request.id}`, title: `${request.name} · ${request.status === "active" || request.status === "accepted" ? "SOS" : request.status} reported location`, label: request.status === "active" || request.status === "accepted" ? "SOS" : "Past", kind: request.status === "active" || request.status === "accepted" ? "request" as const : "history" as const, longitude: request.location.longitude!, latitude: request.location.latitude!, selected: request.id === selectedRequestId })),
  ];
  const mapKey = online ? "online" : saved ? `saved-${map.styleUrl}-${map.updatedAt ?? 0}` : "bundled";
  const initialCenter = coordinates[0] ?? areaCenter;
  // Map sources may remount during a fallback. Preserve the last camera then;
  // routine pan/GPS updates never send a fresh initial camera to native.
  const mapStart = useRef({ key: mapKey, longitude: initialCenter[0], latitude: initialCenter[1], zoomLevel: coordinates.length ? 16 : 14.7 });
  if (mapStart.current.key !== mapKey) {
    mapStart.current = { ...mapStart.current, ...viewport.current, key: mapKey };
  }
  return (
    <View style={[s.frame, height == null && s.fill]}>
      <View style={height == null ? s.viewport : { height }}>
        {offlineFailed && !online ? (
          <View style={s.unavailable}>
            <MapPin size={30} color={c.secondary} />
            <Text style={s.name}>Map unavailable</Text>
            <Pressable accessibilityRole="button" onPress={() => { setOfflineFailed(false); setSavedFailed(false); setOnlineFailed(false); }} style={s.retry}>
              <Text style={s.messageText}>Reload map</Text>
            </Pressable>
          </View>
        ) : (
          <MapSurface
            mapKey={mapKey}
            mapStyle={mapStyle}
            bundled={bundled}
            camera={camera}
            longitude={mapStart.current.longitude}
            latitude={mapStart.current.latitude}
            zoomLevel={mapStart.current.zoomLevel}
            markers={markers}
            onLoading={onLoading}
            onReady={onReady}
            onFailed={onFailed}
            onRegionChange={onRegionChange}
            onRegionWillChange={onRegionWillChange}
            onSelect={onSelect}
          />
        )}
        {!offlineFailed && (
          <View pointerEvents="none" style={s.mapTag}>
            {!ready && <ActivityIndicator size="small" color={c.text} />}
            <Text style={s.tagText}>
              {!ready ? "Loading map" : !online && outsideCoverage ? "Streets not saved here" : online ? "Online map" : saved ? "Offline · saved area" : "Offline · UW"}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Map options"
          accessibilityState={{ expanded: showMapOptions }}
          onPress={() => setShowMapOptions((shown) => !shown)}
          style={({ pressed }) => [s.mapOptions, pressed && s.pressed]}
        >
          <Layers size={21} color={c.text} />
        </Pressable>
        {showMapOptions && (
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
              setOfflineFailed(false);
              setReady(false);
              setShowMapOptions(false);
            }}
            style={[
              s.mapAction,
              !showOnline && internet !== true && s.disabled,
            ]}
          >
            <Text style={s.actionText}>
              {showOnline ? "Use offline map" : "Load streets online"}
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
                  setShowMapOptions(false);
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
                {downloading ? `Saving ${Math.round(map.progress * 100)}% · Cancel` : "Save near me"}
              </Text>
            </Pressable>
          )}
        </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find my location"
          accessibilityHint="Centers the map on your current GPS location. Pinch the map to see nearby people."
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
      {selectedRequest ? (
        <View style={s.selection}>
          <View style={s.selectionCopy}>
            <Text numberOfLines={1} style={s.name}>{selectedRequest.name}</Text>
            <Text numberOfLines={2} style={s.caption}>
              {selectedRequest.status !== "active" && selectedRequest.status !== "accepted" ? `${selectedRequest.status.charAt(0).toUpperCase()}${selectedRequest.status.slice(1)} · ` : ""}
              {Number.isFinite(selectedRequest.location.capturedAt)
                ? `Reported ${locationLabel({ ...selectedRequest.location, latitude: selectedRequest.location.latitude!, longitude: selectedRequest.location.longitude!, capturedAt: selectedRequest.location.capturedAt! }, now)}`
                : "Reported location · time unknown"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open SOS from ${selectedRequest.name}`} onPress={() => router.push(`/request/${selectedRequest.id}`)} style={({ pressed }) => [s.message, pressed && s.pressed]}>
            <Text style={s.messageText}>View SOS</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close request preview" onPress={() => setSelectedRequestId(undefined)} style={s.close}>
            <X color={c.secondary} size={20} />
          </Pressable>
        </View>
      ) : selected ? (
        <View style={s.selection}>
          <View style={s.selectionCopy}>
            <Text numberOfLines={1} style={s.name}>{selected.name}</Text>
            <Text numberOfLines={2} style={s.caption}>Reported {locationLabel(selected.location, now)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Message ${selected.name}`} onPress={() => router.push(`/chat/${selected.nodeId}`)} style={({ pressed }) => [s.message, pressed && s.pressed]}>
            <MessageCircle color={c.background} size={17} />
            <Text style={s.messageText}>Message</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close location details" onPress={() => setSelectedId(undefined)} style={s.close}>
            <X color={c.secondary} size={20} />
          </Pressable>
        </View>
      ) : (
        <View style={s.mapFooter}>
          <Text style={s.footerTitle}>
            {validPins.length ? `${validPins.length} ${validPins.length === 1 ? "person" : "people"} on the map`
              : connectedCount ? "Connected · no shared locations" : "No nearby locations yet"}
            {activeRequestCount ? ` · ${activeRequestCount} SOS` : ""}
          </Text>
          {own && <Text style={s.caption}>Your location · {locationLabel(own, now)}</Text>}
          {!own && <Text style={s.caption}>
            {ownLocation.source === "device" && Number.isFinite(ownLocation.capturedAt)
              ? "Your GPS fix is not current. Locate again to update your position."
              : "Your GPS location is unavailable. Use locate to find yourself."}
            {!coordinates.length ? " Showing map area only." : ""}
          </Text>}
        </View>
      )}
      {(actionError || map.error || (onlineFailed && showOnline)) && (
        <Text accessibilityLiveRegion="polite" numberOfLines={3} style={s.mapError}>
          {actionError || map.error || "Online map unavailable. Showing offline map."}
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  frame: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  fill: { flex: 1, minHeight: 0 },
  viewport: { flex: 1, minHeight: 160, overflow: "hidden" },
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
    maxWidth: "65%",
    backgroundColor: c.background,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
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
    borderRadius: 12,
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
  selectedMarker: { borderWidth: 5, borderColor: "#729DAE" },
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
    backgroundColor: "#729DAE",
  },
  youText: { fontFamily: fonts.medium, fontSize: 11, color: c.text },
  mapFooter: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  mapOptions: { position: "absolute", top: 14, right: 14, width: 48, height: 48, borderRadius: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  mapActions: { position: "absolute", top: 70, right: 14, borderRadius: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, padding: 6 },
  mapAction: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14 },
  footerTitle: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: c.text },
  sosMarker: { minWidth: 46, height: 42, borderRadius: 12, backgroundColor: c.red, borderWidth: 2, borderColor: c.background, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  selectedSosMarker: { borderColor: c.text, borderWidth: 3 },
  historyMarker: { backgroundColor: c.raised, borderColor: c.secondary },
  sosText: { fontFamily: fonts.medium, fontSize: 12, color: c.onAction },
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  selectionCopy: { flex: 1, minWidth: 0, gap: 3 },
  name: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    color: c.text,
  },
  close: {
    minWidth: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    minHeight: 48,
    backgroundColor: c.text,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: 10,
  },
  messageText: { fontFamily: fonts.medium, fontSize: 13, color: c.background },
  retry: { minHeight: 48, paddingHorizontal: 24, paddingVertical: 14, backgroundColor: c.text, borderRadius: 10 },
  mapError: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: c.secondary, paddingHorizontal: 14, paddingBottom: 10 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
