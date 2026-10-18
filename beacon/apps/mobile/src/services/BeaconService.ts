import { AppState, PermissionsAndroid, Platform } from "react-native";
import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as Network from "expo-network";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { fromByteArray, toByteArray } from "base64-js";
import { z } from "zod";
import {
  createIdentity,
  createRequestId,
  deriveRequests,
  hash,
  LIMITS,
  MeshRouter,
  createEnvelope,
  type Identity,
  type LocationReport as ProtocolLocation,
  type MessageInput,
} from "@beacon/protocol";
import BeaconBle, { type BlePeer } from "../../modules/beacon-ble";
import { Repository, type EventRow } from "../storage/Repository";
import type { BeaconState, EventView, RequestView } from "../ui/types";
import { MapService } from "./MapService";
import {
  hasPendingUpdate,
  validatedCloudUrl,
  resetCloudSnapshot,
} from "./ServicePolicy";

const titles: Record<string, string> = {
  sos: "SOS saved",
  receipt: "Recipient receipt",
  seen: "Seen by a participant",
  offer: "Help offered",
  accept: "Offer accepted",
  assignment_receipt: "Volunteer confirmed",
  cancel: "Request canceled",
  complete: "Request completed",
  forwarded: "Passed to a relay",
  peer_connected: "Connection opened",
  peer_disconnected: "Connection interrupted",
};
const safeError = (e: unknown) =>
  e instanceof Error ? e.message : "The action could not be completed.";
const random = (n: number) => Crypto.getRandomBytes(n);
const identitySchema = z.object({
  nodeId: z.string().regex(/^[a-f0-9]{64}$/),
  publicKey: z.string().regex(/^[a-f0-9]{64}$/),
  privateKey: z.string().regex(/^[a-f0-9]{64}$/),
});

export class BeaconService {
  private listeners = new Set<() => void>();
  private repository?: Repository;
  private database?: SQLite.SQLiteDatabase;
  private pendingPeerEvents = 0;
  private identity?: Identity;
  private router?: MeshRouter;
  private maps?: MapService;
  private startPromise?: Promise<void>;
  private refreshPromise?: Promise<void>;
  private refreshAgain = false;
  private receiveTail: Promise<unknown> = Promise.resolve();
  private pendingReceives = 0;
  private syncBusy = false;
  private cloudConfigChanging = false;
  private disposed = false;
  private disposalTimer?: ReturnType<typeof setTimeout>;
  private actionCount = 0;
  private resumePromise?: Promise<void>;
  private locationPromise?: Promise<void>;
  private actions = Promise.resolve();
  private appActive = true;
  private deviceSubscriptions: { remove(): void }[] = [];
  private timer?: ReturnType<typeof setInterval>;
  state: BeaconState;
  constructor() {
    this.state = {
      loading: true,
      setupComplete: false,
      displayName: "Participant",
      nodeId: "",
      requests: [],
      peers: [],
      events: [],
      bluetooth: "unknown",
      relayEnabled: true,
      relayRunning: false,
      queueCount: 0,
      internet: null,
      locationPermission: "undetermined",
      location: { source: "unavailable" },
      map: { status: "missing", progress: 0 },
      sync: { status: "disabled", pendingCount: 0 },
      completeSetup: this.completeSetup,
      requestPermissions: this.requestPermissions,
      refreshLocation: this.refreshLocation,
      sendSOS: this.sendSOS,
      offerHelp: this.offerHelp,
      markSeen: this.markSeen,
      acceptOffer: this.acceptOffer,
      cancelRequest: this.cancelRequest,
      completeRequest: this.completeRequest,
      setRelayEnabled: this.setRelayEnabled,
      saveSettings: this.saveSettings,
      downloadMap: () => this.mapsRequired().download(),
      removeMap: () => this.mapsRequired().remove(),
      syncNow: this.syncNow,
      exportDiagnostics: this.exportDiagnostics,
      clearHistory: this.clearHistory,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<BeaconState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private error = (e: unknown) => this.update({ error: safeError(e) });
  private repo() {
    if (!this.repository)
      throw new Error("Beacon is still opening its local storage.");
    return this.repository;
  }
  private mesh() {
    if (!this.router) throw new Error("Beacon is still preparing.");
    return this.router;
  }
  private mapsRequired() {
    if (!this.maps) throw new Error("Maps are still preparing.");
    return this.maps;
  }
  initialize() {
    if (this.disposalTimer) {
      clearTimeout(this.disposalTimer);
      this.disposalTimer = undefined;
    }
    if (this.disposed)
      return Promise.reject(new Error("Beacon service was closed."));
    return (this.startPromise ??= this.start());
  }
  /** Deferral permits React development effect replay to reacquire this same service. */
  scheduleDispose() {
    this.disposalTimer = setTimeout(() => {
      void this.dispose();
    }, 0);
  }
  private async dispose() {
    this.disposed = true;
    this.maps?.dispose();
    if (this.timer) clearInterval(this.timer);
    for (const subscription of this.deviceSubscriptions) subscription.remove();
    this.deviceSubscriptions = [];
    for (const peer of this.state.peers) this.router?.disconnect(peer.id);
    try {
      await BeaconBle.stop();
      await this.router?.flush();
      await this.receiveTail;
      await this.actions;
      await this.database?.closeAsync();
    } catch {
      /* Unmount has no presentation surface. */
    }
    this.listeners.clear();
  }
  private async start() {
    try {
      const stored = await SecureStore.getItemAsync("beacon.identity.v1");
      this.identity = stored
        ? identitySchema.parse(JSON.parse(stored))
        : createIdentity(random);
      // Verify all three key fields are mutually consistent before using restored credentials.
      createEnvelope(
        this.identity,
        {
          type: "inventory",
          requestId: "0".repeat(64),
          destination: "community",
          payload: { ids: [] },
          ttlMs: LIMITS.controlTtlMs,
        },
        Date.now(),
        random,
      );
      if (!stored)
        await SecureStore.setItemAsync(
          "beacon.identity.v1",
          JSON.stringify(this.identity),
          { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
      const db = await SQLite.openDatabaseAsync("beacon.db");
      if (this.disposed) {
        await db.closeAsync();
        return;
      }
      this.database = db;
      this.repository = new Repository(db, this.identity.nodeId);
      await this.repository.initialize();
      const displayName = await this.repo().getSetting(
        "displayName",
        "Participant",
      );
      const setupComplete = await this.repo().getSetting(
        "setupComplete",
        false,
      );
      const relayEnabled = await this.repo().getSetting("relayEnabled", true);
      this.router = new MeshRouter({
        identity: this.identity,
        repository: this.repository,
        randomBytes: random,
        clock: Date.now,
        awaitForwarding: false,
        transport: {
          send: async (peerId, wire) => {
            await BeaconBle.send(
              peerId,
              fromByteArray(new TextEncoder().encode(wire)),
            );
          },
        },
        onChange: () => {
          void this.refresh().catch(this.error);
        },
        onError: this.error,
      });
      this.maps = new MapService(
        this.repository,
        () => this.state.location,
        (map) => this.update({ map }),
      );
      await this.maps.initialize();
      if (this.disposed) return;
      this.update({
        nodeId: this.identity.nodeId,
        displayName,
        setupComplete,
        relayEnabled,
      });
      this.deviceSubscriptions.push(
        BeaconBle.addListener("onState", (e) =>
          this.update({
            bluetooth: e.state,
            relayRunning: e.advertising || e.scanning,
          }),
        ),
        BeaconBle.addListener("onPeer", (e) => {
          void this.onPeer(e).catch(this.error);
        }),
        BeaconBle.addListener("onError", (e) =>
          this.error(new Error(e.message)),
        ),
        BeaconBle.addListener("onData", (e) => this.onData(e.peerId, e.base64)),
      );
      this.deviceSubscriptions.push(
        AppState.addEventListener("change", (state) => {
          this.appActive = state === "active";
          if (this.appActive) void this.resume().catch(this.error);
        }),
      );
      this.deviceSubscriptions.push(
        Network.addNetworkStateListener((s) =>
          this.update({
            internet: s.isInternetReachable ?? s.isConnected ?? null,
          }),
        ),
      );
      const permission = await Location.getForegroundPermissionsAsync();
      this.update({ locationPermission: permission.status });
      await this.resume();
      if (this.disposed) return;
      this.timer = setInterval(() => {
        if (this.appActive) {
          void this.mesh()
            .flush()
            .then(() => this.refresh())
            .catch(this.error);
        }
      }, 15_000);
      this.update({ loading: false });
    } catch (error) {
      this.update({
        loading: false,
        error: `Could not start Beacon: ${safeError(error)}`,
      });
    }
  }
  private resume(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.resumePromise) return this.resumePromise;
    return (this.resumePromise = this.resumeOnce().finally(() => {
      this.resumePromise = undefined;
    }));
  }
  private async resumeOnce() {
    // Refresh optional coordinates after permission/settings changes without blocking SOS.
    void this.refreshLocation().catch(this.error);
    const network = await Network.getNetworkStateAsync();
    this.update({
      internet: network.isInternetReachable ?? network.isConnected ?? null,
    });
    if (
      !this.disposed &&
      this.state.setupComplete &&
      this.state.relayEnabled &&
      this.identity
    ) {
      const ble = await BeaconBle.start({ nodeId: this.identity.nodeId });
      this.update({
        bluetooth: ble.state,
        relayRunning: ble.advertising || ble.scanning,
      });
    }
    await this.refresh();
  }
  private async onPeer(e: BlePeer) {
    if (
      this.disposed ||
      !e.peerId ||
      e.peerId.length > 128 ||
      !["discovered", "connected", "disconnected"].includes(e.state)
    )
      return;
    const old = this.state.peers.find((p) => p.id === e.peerId);
    const peer = {
      id: e.peerId,
      state: e.state,
      lastSeenAt: Date.now(),
      ...(Number.isFinite(e.rssi) ? { rssi: e.rssi } : {}),
    };
    this.update({
      peers: [peer, ...this.state.peers.filter((p) => p.id !== e.peerId)].slice(
        0,
        32,
      ),
    });
    if (e.state === "connected" && old?.state !== "connected") {
      // connect registers the session synchronously before its first await; onData can follow immediately.
      const connection = this.mesh().connect(e.peerId);
      await Promise.all([
        connection,
        this.recordPeerEvent("peer_connected", e.peerId),
      ]);
    } else if (e.state === "disconnected") {
      this.mesh().disconnect(e.peerId);
      if (old?.state === "connected")
        await this.recordPeerEvent("peer_disconnected", e.peerId);
    }
  }
  private async recordPeerEvent(kind: string, peerId: string) {
    if (this.pendingPeerEvents >= 32) return;
    this.pendingPeerEvents++;
    try {
      await this.repo().recordEvent(hash(Crypto.randomUUID()), kind, peerId);
    } finally {
      this.pendingPeerEvents--;
    }
  }
  private onData(peerId: string, base64: string) {
    if (this.disposed) return;
    if (
      typeof peerId !== "string" ||
      peerId.length > 128 ||
      typeof base64 !== "string" ||
      base64.length > 22_000 ||
      this.pendingReceives >= 32
    ) {
      this.error(
        new Error("Incoming traffic limit reached; excess packet rejected."),
      );
      return;
    }
    this.pendingReceives++;
    this.receiveTail = this.receiveTail
      .then(async () => {
        if (this.disposed) return;
        const bytes = toByteArray(base64);
        if (bytes.length > LIMITS.wireBytes)
          throw new Error("Oversized Bluetooth message.");
        await this.mesh().receive(
          peerId,
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      })
      .catch(this.error)
      .finally(() => {
        this.pendingReceives--;
      });
  }
  private async refresh() {
    if (this.disposed) return;
    if (this.refreshPromise) {
      this.refreshAgain = true;
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      do {
        this.refreshAgain = false;
        const records = await this.repo().listMessages();
        const counts = await this.repo().forwardingCounts();
        const requests = deriveRequests(records.map((r) => r.envelope));
        const views: RequestView[] = requests.map((r) => {
          const mine = r.requesterId === this.state.nodeId;
          const terminal = r.status === "canceled" || r.status === "completed";
          const pending = hasPendingUpdate(r, this.state.nodeId);
          return {
            id: r.id,
            originNodeId: r.requesterId,
            name: r.displayName,
            mine,
            category: r.category,
            note: r.note,
            createdAt: r.createdAt,
            updatedAt: r.lastEventAt,
            location: {
              source:
                r.location.source === "device"
                  ? "device"
                  : r.location.source === "unavailable"
                    ? "unavailable"
                    : "manual",
              latitude: r.location.latitude,
              longitude: r.location.longitude,
              accuracy: r.location.accuracyM,
              capturedAt: r.location.capturedAt,
              place: r.location.description,
            },
            status: terminal
              ? (r.status as "canceled" | "completed")
              : r.expiresAt < Date.now()
                ? "expired"
                : r.status === "accepted"
                  ? "accepted"
                  : "active",
            transport: r.receipts.length
              ? "received"
              : (counts[r.id] ?? 0) > 0
                ? "forwarded"
                : "waiting",
            recipientCount: new Set(r.receipts.map((x) => x.nodeId)).size,
            forwardedCount: counts[r.id] ?? 0,
            seenCount: r.seenBy.length,
            offers: r.offers.map((o) => ({
              id: o.id,
              nodeId: o.helperId,
              name: o.displayName,
              note: o.note,
              createdAt: o.createdAt,
              accepted: r.assignment?.offerId === o.id,
              assignmentReceived:
                r.assignment?.offerId === o.id && r.assignment.received,
            })),
            acceptedOfferId: r.assignment?.offerId,
            pendingUpdate: pending,
          };
        });
        const events = (await this.repo().events()).map((r) =>
          this.eventView(r),
        );
        const url = await this.repo().getSetting("cloudUrl", "");
        const pendingCount = await this.repo().pendingCount();
        const forwarded = new Set(
          (
            await Promise.all(
              this.state.peers
                .filter((p) => p.state === "connected")
                .map((p) => this.repo().listForwarded(p.id)),
            )
          ).flat(),
        );
        this.update({
          requests: views,
          events,
          queueCount: records.filter(
            (r) =>
              r.envelope.expiresAt > Date.now() &&
              !forwarded.has(r.envelope.id),
          ).length,
          sync: {
            ...this.state.sync,
            status: this.syncBusy
              ? "syncing"
              : url
                ? this.state.sync.status === "disabled"
                  ? "idle"
                  : this.state.sync.status
                : "disabled",
            pendingCount,
          },
        });
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }
  private eventView(r: EventRow): EventView {
    return {
      id: r.id,
      requestId: r.request_id ?? undefined,
      type: r.kind,
      title: titles[r.kind] ?? r.kind,
      createdAt: r.recorded_at,
      uploaded: r.uploaded === 1,
    };
  }
  completeSetup = async (name: string) => {
    const displayName = name.trim().slice(0, 40) || "Participant";
    await this.repo().setSetting("displayName", displayName);
    await this.repo().setSetting("setupComplete", true);
    this.update({ displayName, setupComplete: true });
    await this.resume();
  };
  requestPermissions = async () => {
    if (Platform.OS === "android") {
      const permissions =
        Number(Platform.Version) >= 31
          ? [
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
            ]
          : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      await PermissionsAndroid.requestMultiple(permissions);
    }
    if (this.identity && this.state.relayEnabled) {
      const b = await BeaconBle.start({ nodeId: this.identity.nodeId });
      this.update({
        bluetooth: b.state,
        relayRunning: b.advertising || b.scanning,
      });
    }
    const p = await Location.requestForegroundPermissionsAsync();
    this.update({ locationPermission: p.status });
    if (p.granted) await this.refreshLocation();
  };
  refreshLocation = (): Promise<void> => {
    return (this.locationPromise ??= this.refreshLocationOnce().finally(() => {
      this.locationPromise = undefined;
    }));
  };
  private async refreshLocationOnce() {
    const p = await Location.getForegroundPermissionsAsync();
    this.update({ locationPermission: p.status });
    if (!p.granted) {
      this.update({ location: { source: "unavailable" } });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 6000);
        }),
      ]);
      if (!position) {
        this.update({
          error:
            "Location is taking longer than expected. You can send SOS without it.",
        });
        return;
      }
      this.update({
        location: {
          source: "device",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? undefined,
          capturedAt: position.timestamp,
        },
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private currentLocation(place?: string): ProtocolLocation {
    if (place?.trim())
      return {
        source: "manual_description",
        description: place.trim().slice(0, 160),
        capturedAt: Date.now(),
      };
    const l = this.state.location;
    if (l.latitude != null && l.longitude != null && l.capturedAt)
      return {
        source: "device",
        latitude: l.latitude,
        longitude: l.longitude,
        accuracyM: l.accuracy,
        capturedAt: l.capturedAt,
      };
    return { source: "unavailable", capturedAt: Date.now() };
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    if (this.disposed || this.actionCount >= 16)
      return Promise.reject(
        new Error("Please wait for the pending action to finish."),
      );
    this.actionCount++;
    const run = this.actions.then(fn, fn).finally(() => {
      this.actionCount--;
    });
    this.actions = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  private async publish(input: MessageInput) {
    await this.mesh().publish(input);
    await this.refresh();
  }
  sendSOS = async (input: Parameters<BeaconState["sendSOS"]>[0] = {}) =>
    this.serialize(async () => {
      if (!this.identity) throw new Error("Device identity unavailable.");
      const existing = this.state.requests.find(
        (r) =>
          r.mine && !["completed", "canceled", "expired"].includes(r.status),
      );
      if (existing) return existing.id;
      const id = createRequestId(this.identity, random);
      await this.publish({
        type: "sos",
        requestId: id,
        destination: "community",
        payload: {
          category: input?.category ?? "other",
          note: input?.note?.trim().slice(0, 280) ?? "",
          displayName: this.state.displayName,
          location: this.currentLocation(input?.place),
        },
      });
      return id;
    });
  private async request(id: string) {
    const r = deriveRequests(
      (await this.repo().listMessages()).map((m) => m.envelope),
    ).find((r) => r.id === id);
    if (!r) throw new Error("Request not available on this phone.");
    if (
      r.status === "canceled" ||
      r.status === "completed" ||
      r.expiresAt <= Date.now()
    )
      throw new Error("This request is closed or expired.");
    return r;
  }
  markSeen = async (id: string) =>
    this.serialize(async () => {
      const r = await this.request(id);
      if (r.requesterId === this.state.nodeId) return;
      await this.mesh().acknowledge(r.messageId);
      if (!r.seenBy.includes(this.state.nodeId))
        await this.publish({
          type: "seen",
          requestId: id,
          destination: r.requesterId,
          payload: { messageId: r.messageId },
        });
      await this.refresh();
    });
  offerHelp = async (id: string, note?: string) =>
    this.serialize(async () => {
      const r = await this.request(id);
      if (r.requesterId === this.state.nodeId)
        throw new Error("You cannot offer help to your own request.");
      if (r.offers.some((o) => o.helperId === this.state.nodeId)) return;
      await this.mesh().acknowledge(r.messageId);
      await this.publish({
        type: "offer",
        requestId: id,
        destination: r.requesterId,
        payload: {
          note: note?.trim().slice(0, 280) ?? "",
          displayName: this.state.displayName,
        },
      });
    });
  acceptOffer = async (id: string, offerId: string) =>
    this.serialize(async () => {
      const r = await this.request(id);
      if (r.requesterId !== this.state.nodeId)
        throw new Error("Only the requester can accept an offer.");
      const offer = r.offers.find((o) => o.id === offerId);
      if (!offer) throw new Error("Offer no longer available.");
      await this.publish({
        type: "accept",
        requestId: id,
        destination: offer.helperId,
        revision: r.revision + 1,
        payload: {
          offerId,
          helperId: offer.helperId,
          assignmentId: hash(Crypto.randomUUID()),
        },
        ttlMs: LIMITS.maxTtlMs,
      });
    });
  cancelRequest = async (id: string) => this.closeRequest(id, "cancel");
  completeRequest = async (id: string) => this.closeRequest(id, "complete");
  private closeRequest(id: string, type: "cancel" | "complete") {
    return this.serialize(async () => {
      const r = await this.request(id);
      if (r.requesterId !== this.state.nodeId)
        throw new Error("Only the requester can close this request.");
      await this.publish(
        type === "cancel"
          ? {
              type,
              requestId: id,
              destination: "community",
              revision: r.revision + 1,
              payload: { reason: "" },
              ttlMs: LIMITS.maxTtlMs,
            }
          : {
              type,
              requestId: id,
              destination: "community",
              revision: r.revision + 1,
              payload: { note: "" },
              ttlMs: LIMITS.maxTtlMs,
            },
      );
    });
  }
  setRelayEnabled = async (enabled: boolean) => {
    await this.repo().setSetting("relayEnabled", enabled);
    this.update({ relayEnabled: enabled });
    if (enabled) await this.resume();
    else {
      await BeaconBle.stop();
      for (const peer of this.state.peers) this.mesh().disconnect(peer.id);
      this.update({
        relayRunning: false,
        peers: this.state.peers.map((p) => ({ ...p, state: "disconnected" })),
      });
    }
  };
  saveSettings = async (input: Parameters<BeaconState["saveSettings"]>[0]) => {
    const name = input.displayName.trim().slice(0, 40) || "Participant";
    if (input.cloudUrl) validatedCloudUrl(input.cloudUrl);
    if (input.mapStyleUrl) {
      const u = new URL(input.mapStyleUrl);
      if (u.protocol !== "https:") throw new Error("Map style must use HTTPS.");
    }
    if (this.cloudConfigChanging)
      throw new Error("Settings are already being saved. Try again shortly.");
    const [oldUrl, oldIncident, oldToken] = await Promise.all([
      this.repo().getSetting("cloudUrl", ""),
      this.repo().getSetting("incidentId", ""),
      SecureStore.getItemAsync("beacon.cloudToken"),
    ]);
    const nextUrl = input.cloudUrl ?? oldUrl;
    const changed =
      nextUrl !== oldUrl ||
      (input.incidentId ?? oldIncident) !== oldIncident ||
      (input.accessToken ?? oldToken ?? "") !== (oldToken ?? "");
    // Keep an old in-flight incident response from repopulating a newly configured snapshot.
    if (this.cloudConfigChanging)
      throw new Error("Settings are already being saved. Try again shortly.");
    if (changed && this.syncBusy)
      throw new Error(
        "Let the current sync finish before changing the incident connection.",
      );
    this.cloudConfigChanging = true;
    try {
      await this.repo().setSetting("displayName", name);
      for (const key of ["cloudUrl", "incidentId", "mapStyleUrl"] as const)
        if (input[key] !== undefined)
          await this.repo().setSetting(key, input[key]);
      if (input.accessToken !== undefined) {
        if (input.accessToken)
          await SecureStore.setItemAsync(
            "beacon.cloudToken",
            input.accessToken,
          );
        else await SecureStore.deleteItemAsync("beacon.cloudToken");
      }
      this.update({
        displayName: name,
        ...(changed
          ? { sync: resetCloudSnapshot(this.state.sync, Boolean(nextUrl)) }
          : {}),
      });
    } catch (error) {
      // A failed settings write may have changed only part of the connection; never retain its old report.
      if (changed)
        this.update({
          sync: resetCloudSnapshot(this.state.sync, Boolean(nextUrl)),
        });
      throw error;
    } finally {
      this.cloudConfigChanging = false;
      await this.refresh();
    }
  };
  syncNow = async () => {
    if (this.cloudConfigChanging)
      throw new Error(
        "The incident connection is being saved. Try syncing again shortly.",
      );
    if (this.syncBusy || this.disposed) return;
    this.syncBusy = true;
    let url: string, incidentId: string, token: string | null;
    try {
      url = validatedCloudUrl(await this.repo().getSetting("cloudUrl", ""));
      incidentId = await this.repo().getSetting("incidentId", "");
      token = await SecureStore.getItemAsync("beacon.cloudToken");
      if (!incidentId || !token)
        throw new Error("Connect an incident in Settings before syncing.");
    } catch (error) {
      this.syncBusy = false;
      throw error;
    }
    this.update({
      sync: {
        ...this.state.sync,
        status: "syncing",
        error: undefined,
        summary: undefined,
      },
    });
    const fetchJson = async (path: string, options: RequestInit = {}) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url.replace(/\/$/, "") + path, {
          ...options,
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok)
          throw new Error(
            `Incident server returned ${response.status}. Your queue is still saved.`,
          );
        if (Number(response.headers.get("Content-Length")) > 5_000_000)
          throw new Error("Server response exceeds the size limit.");
        const raw = await response.text();
        if (raw.length > 5_000_000)
          throw new Error("Server response exceeds the size limit.");
        return JSON.parse(raw) as unknown;
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      for (let page = 0; page < 40; page++) {
        const batch = await this.repo().uploadBatch(page === 0);
        if (!batch.length) break;
        try {
          const result = z
            .object({
              accepted: z.array(z.string()).max(50),
              duplicates: z.array(z.string()).max(50),
              rejected: z
                .array(z.object({ id: z.string(), reason: z.string() }))
                .max(50),
            })
            .parse(
              await fetchJson("/v1/events/batch", {
                method: "POST",
                body: JSON.stringify({ incidentId, events: batch }),
              }),
            );
          const sent = new Set(batch.map((e) => e.id));
          const accepted = [...result.accepted, ...result.duplicates];
          if (accepted.some((id) => !sent.has(id)))
            throw new Error(
              "Server acknowledgment does not match this upload.",
            );
          await this.repo().confirmUpload(accepted);
          const failed = batch
            .map((e) => e.id)
            .filter((id) => !accepted.includes(id));
          if (failed.length)
            throw new Error(
              `${failed.length} events were not accepted. They remain saved for review/retry.`,
            );
        } catch (e) {
          await this.repo().failUpload(
            batch.map((e) => e.id),
            "Upload interrupted or rejected",
          );
          throw e;
        }
      }
      const combined: EventView[] = [];
      let cursor: string | undefined;
      const eventSchema = z.object({
        id: z.string(),
        kind: z.string(),
        recordedAt: z.number(),
        requestId: z.string().optional(),
        deviceId: z.string(),
      });
      for (let page = 0; page < 10; page++) {
        const data = z
          .object({
            events: z.array(eventSchema).max(2000),
            nextCursor: z.string().optional().nullable(),
          })
          .parse(
            await fetchJson(
              `/v1/incidents/${encodeURIComponent(incidentId)}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
            ),
          );
        combined.push(
          ...data.events.map((e) => ({
            id: e.id,
            type: e.kind,
            title: titles[e.kind] ?? e.kind,
            createdAt: e.recordedAt,
            requestId: e.requestId,
            uploaded: true,
            fromNodeId: e.deviceId,
          })),
        );
        cursor = data.nextCursor ?? undefined;
        if (!cursor) break;
      }
      // Keep retrieved history available even if the independent summary request fails.
      this.update({
        sync: {
          ...this.state.sync,
          combinedEvents: combined,
          lastSyncedAt: Date.now(),
        },
      });
      const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
      const summary = z
        .object({
          updatedAt: count,
          incomplete: z.literal(true),
          requestCount: count,
          requestsWithRecipientReceipt: count,
          completedRequests: count,
          requestStatisticsTruncated: z.boolean(),
          activityBuckets: z
            .array(
              z.object({
                bucket: z.string().datetime({ offset: true }),
                kind: z.string().max(64),
                event_count: count,
              }),
            )
            .max(1000),
          activityBucketsLimit: count,
          aggregateRefreshPending: z.boolean(),
        })
        .refine(
          (value) =>
            value.requestsWithRecipientReceipt <= value.requestCount &&
            value.completedRequests <= value.requestCount,
          "Invalid request counts",
        )
        .parse(
          await fetchJson(
            `/v1/incidents/${encodeURIComponent(incidentId)}/summary`,
          ),
        );
      // The API's signed timestamp differences cross device clocks and are NOT round trips.
      // Instead, pair SOS persistence and validated receipt persistence observed on this requester phone.
      const localMessages = await this.repo().listMessages();
      const localById = new Map(
        localMessages.map((record) => [record.envelope.id, record]),
      );
      const durations = deriveRequests(
        localMessages.map((record) => record.envelope),
      )
        .filter((request) => request.requesterId === this.state.nodeId)
        .flatMap((request) => {
          const sent = localById.get(request.messageId);
          if (!sent) return [];
          const received = request.receipts.flatMap((receipt) => {
            const record = localById.get(receipt.messageId);
            if (!record) return [];
            const elapsed = record.receivedAt - sent.receivedAt;
            return elapsed >= 0 ? [elapsed] : [];
          });
          return received.length ? [Math.min(...received)] : [];
        })
        .sort((a, b) => a - b);
      const percentile = (fraction: number) =>
        durations.length
          ? durations[Math.max(0, Math.ceil(durations.length * fraction) - 1)]
          : null;
      this.update({
        sync: {
          ...this.state.sync,
          status: "idle",
          summary: {
            ...summary,
            incidentId,
            localReceiptRoundTripMs: {
              sampleCount: durations.length,
              p50: percentile(0.5),
              p95: percentile(0.95),
            },
          },
          error: cursor
            ? "Showing the first 10 replay pages. More events remain on the server."
            : undefined,
        },
      });
    } catch (e) {
      this.update({
        sync: { ...this.state.sync, status: "error", error: safeError(e) },
      });
      throw e;
    } finally {
      this.syncBusy = false;
      await this.refresh();
    }
  };
  exportDiagnostics = async () => {
    const report = {
      app: "Beacon",
      version: 1,
      generatedAt: new Date().toISOString(),
      platform: Platform.OS,
      bluetooth: this.state.bluetooth,
      relayEnabled: this.state.relayEnabled,
      queueCount: this.state.queueCount,
      requestCounts: {
        total: this.state.requests.length,
        active: this.state.requests.filter((r) => r.status === "active").length,
      },
      peerLinks: this.state.peers.map((p) => ({
        state: p.state,
        lastSeenAt: p.lastSeenAt,
      })),
      eventCounts: this.state.events.reduce<Record<string, number>>(
        (a, e) => ({ ...a, [e.type]: (a[e.type] ?? 0) + 1 }),
        {},
      ),
      redacted: [
        "identities",
        "precise locations",
        "notes",
        "access tokens",
        "raw packets",
      ],
    };
    if (!FileSystem.cacheDirectory)
      throw new Error("Export storage unavailable.");
    const path = FileSystem.cacheDirectory + "beacon-diagnostics.json";
    await FileSystem.writeAsStringAsync(path, JSON.stringify(report, null, 2));
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("Sharing is unavailable on this device.");
    await Sharing.shareAsync(path, { mimeType: "application/json" });
  };
  clearHistory = async () => {
    await this.repo().clearEligibleHistory();
    await this.refresh();
  };
}
