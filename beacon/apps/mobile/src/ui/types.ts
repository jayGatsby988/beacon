export type Category = "other" | "injured" | "trapped" | "stranded";
export interface LocationReport {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: number;
  source: "device" | "manual" | "unavailable";
  place?: string;
}
export interface HelpOffer {
  id: string;
  nodeId: string;
  name: string;
  note?: string;
  createdAt: number;
  accepted: boolean;
  assignmentReceived: boolean;
}
export interface RequestView {
  id: string;
  originNodeId: string;
  name: string;
  mine: boolean;
  category: Category;
  note?: string;
  createdAt: number;
  updatedAt: number;
  location: LocationReport;
  status: "active" | "accepted" | "completed" | "canceled" | "expired";
  transport: "saved" | "waiting" | "forwarded" | "received";
  recipientCount: number;
  forwardedCount: number;
  seenCount: number;
  offers: HelpOffer[];
  acceptedOfferId?: string;
  pendingUpdate: boolean;
}
export interface PeerView {
  id: string;
  name?: string;
  state: "discovered" | "connected" | "disconnected";
  lastSeenAt: number;
  rssi?: number;
}
export interface EventView {
  id: string;
  requestId?: string;
  type: string;
  title: string;
  detail?: string;
  createdAt: number;
  uploaded: boolean;
  fromNodeId?: string;
  toNodeId?: string;
}
export interface MapState {
  styleUrl?: string;
  bundled?: boolean;
  bounds?: [number, number, number, number];
  status: "missing" | "downloading" | "ready" | "error";
  progress: number;
  name?: string;
  bytes?: number;
  error?: string;
  updatedAt?: number;
}
export interface IncidentSummary {
  incidentId: string;
  updatedAt: number;
  incomplete: true;
  requestCount: number;
  requestsWithRecipientReceipt: number;
  completedRequests: number;
  requestStatisticsTruncated: boolean;
  activityBuckets: { bucket: string; kind: string; event_count: number }[];
  activityBucketsLimit: number;
  aggregateRefreshPending: boolean;
  localReceiptRoundTripMs: {
    sampleCount: number;
    p50: number | null;
    p95: number | null;
  };
}
export interface BeaconState {
  loading: boolean;
  setupComplete: boolean;
  displayName: string;
  nodeId: string;
  requests: RequestView[];
  peers: PeerView[];
  events: EventView[];
  bluetooth:
    | "poweredOn"
    | "poweredOff"
    | "unauthorized"
    | "unsupported"
    | "unknown";
  relayEnabled: boolean;
  relayRunning: boolean;
  queueCount: number;
  internet: boolean | null;
  locationPermission: "granted" | "denied" | "undetermined";
  location: LocationReport;
  map: MapState;
  sync: {
    status: "idle" | "syncing" | "error" | "disabled";
    pendingCount: number;
    lastSyncedAt?: number;
    error?: string;
    combinedEvents?: EventView[];
    summary?: IncidentSummary;
  };
  error?: string;
  completeSetup(name: string): Promise<void>;
  requestPermissions(): Promise<void>;
  refreshLocation(): Promise<void>;
  sendSOS(input?: {
    category?: Category;
    note?: string;
    place?: string;
  }): Promise<string>;
  offerHelp(requestId: string, note?: string): Promise<void>;
  markSeen(requestId: string): Promise<void>;
  acceptOffer(requestId: string, offerId: string): Promise<void>;
  cancelRequest(requestId: string): Promise<void>;
  completeRequest(requestId: string): Promise<void>;
  setRelayEnabled(enabled: boolean): Promise<void>;
  saveSettings(input: {
    displayName: string;
    cloudUrl?: string;
    incidentId?: string;
    accessToken?: string;
    mapStyleUrl?: string;
  }): Promise<void>;
  downloadMap(): Promise<void>;
  removeMap(): Promise<void>;
  syncNow(): Promise<void>;
  exportDiagnostics(): Promise<void>;
  clearHistory(): Promise<void>;
}
