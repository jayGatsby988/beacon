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
import type { LocationReport, MapState, PersonView, RequestView } from "../ui/types";
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
  kind: "you" | "person" | "request";
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
  hasLocations: boolean;
  markers: MapMarker[];
  onLoading: () => void;
  onReady: () => void;
  onFailed: () => void;
  onRegionChange: (region: { geometry: { coordinates: number[] } }) => void;
  onSelect: (kind: MapMarker["kind"], id: string) => void;
};

// Keep timer ticks, download progress and preview text out of MapLibre's native
// subtree. Only marker appearance/coordinates, selection or map configuration
// should update it; capturedAt and accuracy belong to the surrounding UI.
const MapSurface = memo(function MapSurface({
  mapKey, mapStyle, bundled, camera, longitude, latitude, hasLocations,
  markers, onLoading, onReady, onFailed, onRegionChange, onSelect,
}: MapSurfaceProps) {
  const defaultSettings = useMemo(() => ({
    centerCoordinate: [longitude, latitude],
    zoomLevel: hasLocations ? 16 : 14.7,
  }), [longitude, latitude, hasLocations]);
  return (
    <MapLibre.MapView
      key={mapKey}
      style={s.map}
      mapStyle={mapStyle}
      onWillStartLoadingMap={onLoading}
      onDidFinishLoadingMap={onReady}
      onRegionDidChange={onRegionChange}
      onDidFailLoadingMap={onFailed}
      logoEnabled={false}
      attributionEnabled={!bundled}
      attributionPosition={ATTRIBUTION_POSITION}
      compassEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
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
            <View collapsable={false} style={marker.kind === "request"
              ? [s.sosMarker, marker.selected && s.selectedSosMarker]
              : [s.personMarker, marker.selected && s.selectedMarker]}>
              <Text maxFontSizeMultiplier={1.4} style={marker.kind === "request" ? s.sosText : s.initial}>{marker.label}</Text>
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
  pins,
  requests = [],
  nodeId,
  activeGroupId = null,
  people = [],
  internet,
  map,
  onLocate,
  onSaveArea,
  onCancelSave,
  onOfferHelp,
  now,
  height,
}: {
  ownLocation: LocationReport;
  focusRevision: number;
  pins: NearbyPin[];
  requests?: RequestView[];
  nodeId?: string;
  activeGroupId?: string | null;
  people?: PersonView[];
  connectedCount: number;
  internet: boolean | null;
  map: MapState;
  onLocate: () => Promise<LocationReport>;
  onSaveArea?: () => Promise<void>;
  onCancelSave?: () => Promise<void>;
  onOfferHelp?: (requestId: string) => Promise<void>;
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
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const [offering, setOffering] = useState(false);
  const [offerError, setOfferError] = useState<{ requestId: string; message: string }>();
  const offerPending = useRef(false);
  const [showMapOptions, setShowMapOptions] = useState(false);
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
  // SOS coordinates are the location attached to a request, never a live peer fix.
  const requestPins = requests.filter((request) =>
    (request.groupId ?? null) === activeGroupId &&
    (request.status === "active" || request.status === "accepted") &&
    request.location.source !== "unavailable" &&
    Number.isFinite(request.location.latitude) &&
    Number.isFinite(request.location.longitude) &&
    Math.abs(request.location.latitude!) <= 90 &&
    Math.abs(request.location.longitude!) <= 180,
  );
  const selectedRequest = requestPins.find((request) => request.id === selectedRequestId);
  const myOffer = selectedRequest?.offers.find((offer) => offer.nodeId === nodeId);
  const acceptedOffer = selectedRequest?.offers.find((offer) => offer.id === selectedRequest.acceptedOfferId);
  const canOffer = !!onOfferHelp && !!nodeId && !!selectedRequest &&
    !selectedRequest.mine && selectedRequest.status === "active" &&
    !selectedRequest.acceptedOfferId && !myOffer;
  const chatNodeId = selectedRequest?.status === "accepted" && acceptedOffer
    ? selectedRequest.mine
      ? acceptedOffer.nodeId
      : acceptedOffer.nodeId === nodeId
        ? selectedRequest.originNodeId
        : undefined
    : undefined;
  const chatPerson = chatNodeId && chatNodeId !== nodeId
    ? people.find((person) => person.nodeId === chatNodeId && person.scope === activeGroupId)
    : undefined;
  const offerHelp = async () => {
    if (!canOffer || !selectedRequest || !onOfferHelp || offerPending.current) return;
    const requestId = selectedRequest.id;
    offerPending.current = true;
    setOffering(true);
    setOfferError(undefined);
    try {
      await onOfferHelp(requestId);
    } catch (error) {
      setOfferError({ requestId, message: error instanceof Error ? error.message : "Could not offer help. Try again." });
    } finally {
      offerPending.current = false;
      setOffering(false);
    }
  };
  const coordinates = [
    ...(own ? [[own.longitude, own.latitude]] : []),
    ...validPins.map((pin) => [pin.location.longitude, pin.location.latitude]),
    ...requestPins.map((request) => [request.location.longitude!, request.location.latitude!]),
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
  const onRegionChange = useCallback((region: { geometry: { coordinates: number[] } }) => {
    const next = region.geometry.coordinates;
    setViewCenter((previous) => previous[0] === next[0] && previous[1] === next[1] ? previous : next);
  }, []);
  const onSelect = useCallback((kind: MapMarker["kind"], id: string) => {
    setSelectedId(kind === "person" ? id.slice("person-".length) : undefined);
    setSelectedRequestId(kind === "request" ? id.slice("request-".length) : undefined);
  }, []);
  const markers: MapMarker[] = [
    ...(own ? [{ id: "your-location", title: "Your reported location", label: "You", kind: "you" as const, longitude: own.longitude, latitude: own.latitude, selected: false }] : []),
    ...validPins.map((pin) => ({ id: `person-${pin.nodeId}`, title: pin.name, label: pin.name.trim().slice(0, 2).toUpperCase() || "?", kind: "person" as const, longitude: pin.location.longitude, latitude: pin.location.latitude, selected: pin.nodeId === selectedId })),
    ...requestPins.map((request) => ({ id: `request-${request.id}`, title: `${request.name} · SOS reported location`, label: "SOS", kind: "request" as const, longitude: request.location.longitude!, latitude: request.location.latitude!, selected: request.id === selectedRequestId })),
  ];
  const initialCenter = coordinates[0] ?? areaCenter;
  return (
    <View style={s.frame}>
      <View style={{ height }}>
        {offlineFailed && !online ? (
          <View style={s.unavailable}>
            <MapPin size={30} color={c.secondary} />
            <Text style={s.name}>Map unavailable</Text>
            <Text style={s.caption}>Your conversations are in People.</Text>
          </View>
        ) : (
          <MapSurface
            mapKey={online ? "online" : saved ? `saved-${map.styleUrl}-${map.updatedAt ?? 0}` : "bundled"}
            mapStyle={mapStyle}
            bundled={bundled}
            camera={camera}
            longitude={initialCenter[0]}
            latitude={initialCenter[1]}
            hasLocations={coordinates.length > 0}
            markers={markers}
            onLoading={onLoading}
            onReady={onReady}
            onFailed={onFailed}
            onRegionChange={onRegionChange}
            onSelect={onSelect}
          />
        )}
        {!online && outsideCoverage && (
          <View pointerEvents="none" style={s.mapTag}>
            <Text style={s.tagText}>No offline streets here</Text>
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
        )}
        {!showMapOptions && <Pressable
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
        </Pressable>}
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
        {(requestPins.length > 0 || validPins.length > 0) && <View style={s.legend}>
          {requestPins.length > 0 && <View style={s.legendItem}><View style={s.legendSos} /><Text style={s.caption}>{requestPins.length} SOS</Text></View>}
          {validPins.length > 0 && <View style={s.legendItem}><View style={s.legendPerson} /><Text style={s.caption}>{validPins.length} sharing location</Text></View>}
        </View>}
        <Text style={s.caption}>
          {online
            ? "Online map"
            : outsideCoverage
              ? saved
                ? "Outside saved area"
                : "Outside UW area"
              : saved
                ? "Offline · saved area"
                : "Offline · UW area"}
        </Text>
        {own && <Text style={s.caption}>Your location · {locationLabel(own, now)}</Text>}
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
      {selectedRequest && (
        <View style={s.selection}>
          <View style={s.selectionTop}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.requestEyebrow}>ACTIVE SOS · REPORTED LOCATION</Text>
              <Text style={s.name}>{selectedRequest.name}</Text>
              <Text style={s.caption}>
                {Number.isFinite(selectedRequest.location.capturedAt)
                  ? `Location captured ${locationLabel({ ...selectedRequest.location, latitude: selectedRequest.location.latitude!, longitude: selectedRequest.location.longitude!, capturedAt: selectedRequest.location.capturedAt! }, now)}`
                  : "Location capture time unavailable"}
              </Text>
              <Text style={s.caption}>{selectedRequest.location.latitude!.toFixed(5)}, {selectedRequest.location.longitude!.toFixed(5)}</Text>
              {selectedRequest.note ? <Text numberOfLines={2} style={s.caption}>{selectedRequest.note}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close request preview" onPress={() => setSelectedRequestId(undefined)} style={s.close}>
              <X color={c.secondary} size={20} />
            </Pressable>
          </View>
          {canOffer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Offer help to ${selectedRequest.name}`}
              accessibilityState={{ busy: offering, disabled: offering }}
              disabled={offering}
              onPress={() => void offerHelp()}
              style={({ pressed }) => [s.message, offering && s.disabled, pressed && s.pressed]}
            >
              {offering && <ActivityIndicator color={c.background} />}
              <Text style={s.messageText}>{offering ? "Sending offer…" : "Offer help"}</Text>
            </Pressable>
          ) : chatPerson ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Message ${chatPerson.name}`} onPress={() => router.push(`/chat/${chatPerson.nodeId}`)} style={({ pressed }) => [s.message, pressed && s.pressed]}>
              <MessageCircle color={c.background} size={19} />
              <Text style={s.messageText}>Message</Text>
            </Pressable>
          ) : selectedRequest.mine ? (
            <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)")} style={({ pressed }) => [s.message, pressed && s.pressed]}>
              <Text style={s.messageText}>View on Help</Text>
            </Pressable>
          ) : (
            <Text style={s.caption}>
              {chatNodeId
                ? "Reconnect with the requester to message."
                : selectedRequest.status === "accepted"
                  ? "Help accepted"
                  : myOffer
                    ? "Offer saved · awaiting acceptance"
                    : "View this request on Help."}
            </Text>
          )}
          {offerError?.requestId === selectedRequest.id && <Text accessibilityLiveRegion="polite" style={s.caption}>{offerError.message}</Text>}
        </View>
      )}
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
    borderRadius: 16,
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
    maxWidth: "70%",
    backgroundColor: c.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
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
    borderRadius: 16,
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
    backgroundColor: "#267A58",
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
    backgroundColor: "#2374A4",
  },
  youText: { fontFamily: fonts.medium, fontSize: 11, color: c.text },
  mapFooter: {
    padding: 16,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  mapOptions: { position: "absolute", top: 14, right: 14, width: 48, height: 48, borderRadius: 16, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  mapActions: { position: "absolute", top: 70, right: 14, borderRadius: 16, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, padding: 6 },
  mapAction: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSos: { width: 7, height: 7, borderRadius: 2, backgroundColor: c.redLabel },
  legendPerson: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#267A58" },
  sosMarker: { minWidth: 46, height: 42, borderRadius: 12, backgroundColor: c.red, borderWidth: 2, borderColor: c.background, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  selectedSosMarker: { borderColor: c.text, borderWidth: 3 },
  sosText: { fontFamily: fonts.medium, fontSize: 12, color: c.onAction },
  requestEyebrow: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: c.redLabel },
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
