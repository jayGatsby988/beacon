import type { BeaconState } from "../ui/types";
import type { RequestState } from "@beacon/protocol";

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
