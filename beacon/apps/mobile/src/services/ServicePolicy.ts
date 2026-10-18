import type { BeaconState, LocationReport } from "../ui/types";
import {
  LocationSchema,
  type RequestState,
  type LocationReport as ProtocolLocation,
} from "@beacon/protocol";

/** Native timestamps may contain fractional milliseconds. Optional location must never block SOS. */
export function locationForSOS(
  location: LocationReport,
  place?: string,
  now = Date.now(),
): ProtocolLocation {
  if (place?.trim()) {
    return {
      source: "manual_description",
      description: place.trim().slice(0, 160),
      capturedAt: now,
    };
  }
  const accuracy = location.accuracy;
  const candidate = LocationSchema.safeParse({
    source: "device",
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyM:
      accuracy != null &&
      Number.isFinite(accuracy) &&
      accuracy >= 0 &&
      accuracy <= 100_000
        ? accuracy
        : undefined,
    capturedAt:
      location.capturedAt == null ? undefined : Math.floor(location.capturedAt),
  });
  return location.source === "device" && candidate.success
    ? candidate.data
    : { source: "unavailable", capturedAt: now };
}

/** Assignment receipts acknowledge one acceptance only; they never acknowledge a later closure. */
export function hasPendingUpdate(
  request: RequestState,
  localNodeId: string,
): boolean {
  if (request.requesterId !== localNodeId || request.revision === 0)
    return false;
  if (request.status === "canceled" || request.status === "completed")
    return true;
  return !request.assignment?.received;
}

export function validatedCloudUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTPS server URL without credentials or query parameters.",
    );
  }
  return value.replace(/\/$/, "");
}

/** A connection switch invalidates cloud provenance while preserving the durable local upload count. */
export function resetCloudSnapshot(
  sync: BeaconState["sync"],
  enabled: boolean,
): BeaconState["sync"] {
  return {
    status: enabled ? "idle" : "disabled",
    pendingCount: sync.pendingCount,
  };
}
