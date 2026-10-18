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
  LOCATION_LIMITS,
  MeshRouter,
  createEnvelope,
  createSocialGroup,
  joinSocialGroup,
  sealGroup,
  openGroup,
  type SocialGroup,
  type Identity,
  type LocationReport as ProtocolLocation,
  type MessageInput,
} from "@beacon/protocol";
import BeaconBle, { type BlePeer } from "../../modules/beacon-ble";
import { Repository, type EventRow } from "../storage/Repository";
import type { BeaconState, EventView, LocationReport, RequestView } from "../ui/types";
import { MapService } from "./MapService";
import { SocialRepository } from "../storage/SocialRepository";
import { SocialService } from "./SocialService";
import { CallService, type CallView } from "./CallService";
import {
  hasPendingUpdate,
  validatedCloudUrl,
  resetCloudSnapshot,
  locationForSOS,
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
  private socialDatabase?: SQLite.SQLiteDatabase;
  private social?: SocialService;
  private calls?: CallService;
  private pausingCalls = false;
  private scopes = new Map<
    string,
    {
      database: SQLite.SQLiteDatabase;
      repository: Repository;
      router: MeshRouter;
    }
  >();
  private scopeChanging = false;
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
  private locationShareGeneration = 0;
  private lastSharedLocationRefresh = 0;
  private findPeoplePromise?: Promise<void>;
  private networkProbe?: Promise<void>;
  private actions = Promise.resolve();
  private appActive = true;
  private deviceSubscriptions: { remove(): void }[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private callTimer?: ReturnType<typeof setInterval>;
  state: BeaconState;
  constructor() {
    this.state = {
      loading: true,
      setupComplete: false,
      displayName: "Participant",
      nodeId: "",
      groups: [],
      activeGroupId: null,
      people: [],
      messages: [],
      callSupported: false,
      callSupportReason: "Bluetooth calls require a current iPhone build.",
      call: null,
      startCall: this.startCall,
      acceptCall: this.acceptCall,
      declineCall: this.declineCall,
      endCall: this.endCall,
      setCallMuted: this.setCallMuted,
      setCallSpeaker: this.setCallSpeaker,
      dismissCall: this.dismissCall,
      createGroup: this.createGroup,
      joinGroup: this.joinGroup,
      selectGroup: this.selectGroup,
      sendText: this.sendText,
      markChatRead: this.markChatRead,
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
      locationSharing: false,
      findingPeople: false,
      locateOnMap: this.locateOnMap,
      setLocationSharing: this.setLocationSharing,
      findPeople: this.findPeople,
      map: { status: "missing", progress: 0 },
      cloudConnection: { url: "", incidentId: "" },
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
      downloadMap: () => this.mapsRequired().download(async () => {
        const current = await Location.getForegroundPermissionsAsync();
        if (this.disposed) return;
        const permission = current.status === "undetermined"
          ? await Location.requestForegroundPermissionsAsync() : current;
        if (this.disposed) return;
        this.update({ locationPermission: permission.status });
        if (!permission.granted)
          throw new Error("Allow location in phone Settings to save your area.");
        await this.refreshLocation();
      }),
      cancelMapDownload: () => this.mapsRequired().cancel(),
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
  private scopeRepo() {
    return this.state.activeGroupId
      ? this.scopes.get(this.state.activeGroupId)!.repository
      : this.repo();
  }
  private socialRequired() {
    if (!this.social) throw new Error("Nearby messaging is still opening.");
    return this.social;
  }
  private callsRequired() {
    if (!this.calls || !this.state.callSupported)
      throw new Error(this.state.callSupportReason ?? "Bluetooth calls are unavailable.");
    return this.calls;
  }
  private updateCall = (call: CallView | null) => {
    this.update({
      call: call ? {
        id: call.callId, peerId: call.nodeId, peerName: call.name,
        direction: call.direction, status: call.state,
        muted: call.muted, speaker: call.speaker,
        startedAt: call.startedAt, reason: call.reason,
      } : null,
    });
  };
  startCall = async (nodeId: string) => {
    if (this.disposed || this.scopeChanging || this.pausingCalls || !this.appActive || !this.state.relayEnabled)
      throw new Error("Keep Beacon open with Bluetooth enabled to call.");
    await this.callsRequired().start(nodeId);
  };
  acceptCall = async (callId: string) => {
    if (this.disposed || this.scopeChanging || this.pausingCalls || !this.appActive || !this.state.relayEnabled) return;
    await this.callsRequired().accept(callId);
  };
  declineCall = async (callId: string) => { await this.calls?.decline(callId); };
  endCall = async (callId: string) => { await this.calls?.hangup("Call ended", callId); };
  setCallMuted = async (callId: string, muted: boolean) => { await this.calls?.setMuted(muted, callId); };
  setCallSpeaker = async (callId: string, speaker: boolean) => { await this.calls?.setSpeaker(speaker, callId); };
  dismissCall = async (callId: string) => {
    if (this.state.call?.status === "ended" || this.state.call?.status === "failed")
      await this.calls?.dismiss(callId);
  };
  private async sendWire(peerId: string, wire: string, scope: string | null) {
    if (
      this.disposed ||
      scope !== this.state.activeGroupId ||
      !this.state.relayEnabled
    )
      throw new Error("Connection changed; message remains saved.");
    const group = scope
      ? this.state.groups.find((g) => g.id === scope)
      : undefined;
    if (scope && !group) throw new Error("Group unavailable.");
    const packet = group ? sealGroup(group, wire, random) : wire;
    await BeaconBle.send(
      peerId,
      fromByteArray(new TextEncoder().encode(packet)),
    );
  }
  private makeRouter(repository: Repository, scope: string | null) {
    return new MeshRouter({
      identity: this.identity!,
      repository,
      randomBytes: random,
      clock: Date.now,
      awaitForwarding: false,
      transport: { send: (peerId, wire) => this.sendWire(peerId, wire, scope) },
      onChange: () => {
        void this.refresh().catch(this.error);
      },
      onError: this.error,
    });
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
    if (this.callTimer) clearInterval(this.callTimer);
    for (const subscription of this.deviceSubscriptions) subscription.remove();
    this.deviceSubscriptions = [];
    for (const peer of this.state.peers) this.router?.disconnect(peer.id);
    this.social?.reset();
    try {
      await this.calls?.dispose();
      await BeaconBle.stop();
      await this.router?.flush();
      await this.receiveTail;
      await this.actions;
      await this.social?.settle();
      await this.socialDatabase?.closeAsync();
      for (const scope of this.scopes.values())
        await scope.database.closeAsync();
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
      const storedGroups = await SecureStore.getItemAsync("beacon.groups.v1");
      const groupInputs = storedGroups
        ? z
            .array(z.object({ name: z.string(), inviteCode: z.string() }))
            .max(8)
            .parse(JSON.parse(storedGroups))
        : [];
      const groups = groupInputs.map((g) =>
        joinSocialGroup(g.name, g.inviteCode),
      );
      const selected = await this.repo().getSetting<string | null>(
        "activeGroupId",
        null,
      );
      const activeGroupId = groups.some((g) => g.id === selected)
        ? selected
        : null;
      this.update({ groups, activeGroupId, displayName, relayEnabled });
      this.router = activeGroupId
        ? await this.groupRouter(activeGroupId)
        : this.makeRouter(this.repository, null);
      this.socialDatabase = await SQLite.openDatabaseAsync("beacon-social.db");
      const socialRepository = new SocialRepository(this.socialDatabase);
      await socialRepository.initialize();
      this.social = new SocialService({
        identity: this.identity,
        repository: socialRepository,
        scope: () => this.state.activeGroupId,
        name: () => this.state.displayName,
        location: () => this.sharedLocation(),
        random,
        send: (peer, wire, scope) => this.sendWire(peer, wire, scope),
        getRead: (key) => this.repo().getSetting(key, 0),
        setRead: (key, time) => this.repo().setSetting(key, time),
        onChange: (people, messages) => this.update({ people, messages }),
        onError: this.error,
      });
      await this.social.refresh();
      // Older installed builds and Android retain SOS/messaging without voice methods.
      if (Platform.OS === "ios" && typeof BeaconBle.getVoiceSupport === "function") {
        this.calls = new CallService({
          identity: this.identity,
          scope: () => this.state.activeGroupId,
          people: () => this.state.people,
          getPeer: (nodeId) => this.social?.getPeer(nodeId),
          peerNodeId: (peerId) => this.social?.peerNodeId(peerId),
          send: (peerId, wire, scope) => this.sendWire(peerId, wire, scope),
          native: {
            getVoiceSupport: () => BeaconBle.getVoiceSupport(),
            voicePrepare: (options) => BeaconBle.voicePrepare(options),
            voiceConnect: (options) => BeaconBle.voiceConnect(options),
            voiceStart: (callId) => BeaconBle.voiceStart(callId),
            voiceStop: (callId) => BeaconBle.voiceStop(callId),
            voiceSetMuted: (muted) => BeaconBle.voiceSetMuted(muted),
            voiceSetSpeaker: (speaker) => BeaconBle.voiceSetSpeaker(speaker),
          },
          random,
          onChange: this.updateCall,
          onError: this.error,
        });
        this.deviceSubscriptions.push(BeaconBle.addListener("onVoice", (event) => {
          void this.calls?.onVoice(event).catch(this.error);
        }));
        // Capability detection is optional and cannot delay the emergency transport.
        void BeaconBle.getVoiceSupport().then((support) => this.update({
          callSupported: support.supported,
          callSupportReason: support.reason,
        })).catch(() => this.update({ callSupported: false, callSupportReason: "Bluetooth calls are unavailable on this phone." }));
      }
      this.maps = new MapService(
        this.repository,
        () => this.state.location,
        (map) => this.update({ map }),
      );
      // Optional offline-map metadata must never prevent the radio from starting.
      void this.maps.initialize().catch((error) => {
        this.update({
          map: { ...this.state.map, status: "error", error: safeError(error) },
        });
      });
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
          // Permission dialogs use inactive; only actual backgrounding ends a call.
          if (state === "background") {
            void this.setLocationSharing(false).catch(this.error);
            void this.calls?.hangup("Keep Beacon open to stay on a call.").catch(this.error);
          }
        }),
      );
      this.deviceSubscriptions.push(
        Network.addNetworkStateListener((s) =>
          this.update({
            internet: s.isInternetReachable ?? s.isConnected ?? null,
          }),
        ),
      );
      await this.resume();
      if (this.disposed) return;
      this.timer = setInterval(() => {
        if (this.appActive) {
          void this.mesh()
            .flush()
            .then(() => this.refresh())
            .catch(this.error);
          void this.social?.tick().catch(this.error);
          if (this.state.locationSharing && Date.now() - this.lastSharedLocationRefresh >= 25_000)
            void this.refreshSharedLocation().catch(this.error);
        }
      }, 15_000);
      this.callTimer = setInterval(() => {
        if (this.appActive) void this.calls?.tick().catch(this.error);
      }, 1000);
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
    // Connectivity inspection is presentation-only. A stalled OS query cannot gate offline BLE.
    if (!this.networkProbe) {
      this.networkProbe = Network.getNetworkStateAsync()
        .then((network) => {
          this.update({
            internet:
              network.isInternetReachable ?? network.isConnected ?? null,
          });
        })
        .catch(() => {
          // Unknown reachability is distinct from offline; mesh remains independently usable.
          this.update({ internet: null });
        })
        .finally(() => {
          this.networkProbe = undefined;
        });
    }
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
        this.social?.connect(e.peerId),
        this.recordPeerEvent("peer_connected", e.peerId),
      ]);
    } else if (e.state === "disconnected") {
      void this.calls?.peerDisconnected(e.peerId).catch(this.error);
      this.mesh().disconnect(e.peerId);
      this.social?.disconnect(e.peerId);
      if (old?.state === "connected")
        await this.recordPeerEvent("peer_disconnected", e.peerId);
    }
  }
  private async recordPeerEvent(kind: string, peerId: string) {
    if (this.pendingPeerEvents >= 32) return;
    this.pendingPeerEvents++;
    try {
      await this.scopeRepo().recordEvent(
        hash(Crypto.randomUUID()),
        kind,
        peerId,
      );
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
        if (this.scopeChanging) return;
        const scope = this.state.activeGroupId;
        const wire = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const group = scope
          ? this.state.groups.find((g) => g.id === scope)
          : undefined;
        const decoded = group ? openGroup(group, wire) : wire;
        if (!decoded) return;
        // Public mode never interprets sealed private traffic as ordinary SOS.
        if (!group && (JSON.parse(wire) as { type?: string }).type === "group")
          return;
        if ((JSON.parse(decoded) as { type?: string }).type === "call") {
          // Call control is ephemeral and never enters SOS persistence or relaying.
          if (this.appActive && !this.pausingCalls && this.state.relayEnabled)
            await this.calls?.receive(peerId, decoded);
          return;
        }
        if (await this.social?.receive(peerId, decoded)) return;
        if (scope !== this.state.activeGroupId) return;
        await this.mesh().receive(peerId, decoded);
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
        const scope = this.state.activeGroupId;
        const repository = this.scopeRepo();
        const records = await repository.listMessages();
        const counts = await repository.forwardingCounts();
        const requests = deriveRequests(records.map((r) => r.envelope));
        const views: RequestView[] = requests.map((r) => {
          const mine = r.requesterId === this.state.nodeId;
          const terminal = r.status === "canceled" || r.status === "completed";
          const pending = hasPendingUpdate(r, this.state.nodeId);
          return {
            id: r.id,
            groupId: scope,
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
        const events = (await repository.events()).map((r) =>
          this.eventView(r),
        );
        const [url, incidentId] = await Promise.all([
          this.repo().getSetting("cloudUrl", ""),
          this.repo().getSetting("incidentId", ""),
        ]);
        const pendingCount = await this.repo().pendingCount();
        const forwarded = new Set(
          (
            await Promise.all(
              this.state.peers
                .filter((p) => p.state === "connected")
                .map((p) => repository.listForwarded(p.id)),
            )
          ).flat(),
        );
        if (scope !== this.state.activeGroupId) {
          this.refreshAgain = true;
          continue;
        }
        this.update({
          requests: views,
          events,
          cloudConnection: { url, incidentId },
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
  locateOnMap = async (): Promise<LocationReport> => {
    if (this.disposed || !this.appActive) throw new Error("Open Beacon to find your location.");
    const current = await Location.getForegroundPermissionsAsync();
    if (this.disposed || !this.appActive) throw new Error("Open Beacon to find your location.");
    const permission = current.status === "undetermined"
      ? await Location.requestForegroundPermissionsAsync() : current;
    if (this.disposed || !this.appActive) throw new Error("Open Beacon to find your location.");
    this.update({ locationPermission: permission.status });
    if (!permission.granted) throw new Error("Allow location in phone Settings to find yourself on the map.");
    await this.refreshLocation();
    if (this.disposed || !this.appActive) throw new Error("Open Beacon to find your location.");
    const fix = this.state.location;
    if (fix.source !== "device" || fix.capturedAt == null ||
        Date.now() - fix.capturedAt >= LOCATION_LIMITS.ttlMs || fix.capturedAt > Date.now() + LOCATION_LIMITS.futureSkewMs)
      throw new Error("GPS is unavailable. Move near a window or outdoors and try again.");
    return { ...fix };
  };
  private sharedLocation() {
    const fix = this.state.location;
    if (!this.state.locationSharing || !this.appActive || !this.state.relayEnabled || this.disposed ||
      fix.source !== "device" || fix.latitude == null || fix.longitude == null || fix.capturedAt == null ||
      Date.now() - fix.capturedAt >= LOCATION_LIMITS.ttlMs || fix.capturedAt > Date.now() + LOCATION_LIMITS.futureSkewMs) return null;
    return { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, capturedAt: fix.capturedAt };
  }
  setLocationSharing = async (enabled: boolean) => {
    if (this.disposed) return;
    const generation = ++this.locationShareGeneration;
    const scope = this.state.activeGroupId;
    if (!enabled) {
      this.update({ locationSharing: false });
      await this.social?.announceLocation();
      return;
    }
    if (this.disposed || this.scopeChanging || !this.appActive)
      throw new Error("Open Beacon to share your location.");
    const current = () => !this.disposed && this.appActive && generation === this.locationShareGeneration && scope === this.state.activeGroupId;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!current()) return;
    this.update({ locationPermission: permission.status });
    if (!permission.granted) throw new Error("Allow location in phone Settings to appear on the map.");
    // GPS is optional and never enters the serialized SOS/action queue.
    await this.refreshLocation();
    if (!current()) return;
    const fix = this.state.location;
    if (fix.source !== "device" || fix.capturedAt == null || Date.now() - fix.capturedAt >= LOCATION_LIMITS.ttlMs || fix.capturedAt > Date.now() + LOCATION_LIMITS.futureSkewMs)
      throw new Error("Your location is unavailable. Try again in a moment.");
    if (!this.state.relayEnabled) await this.setRelayEnabled(true);
    if (!current()) return;
    this.lastSharedLocationRefresh = Date.now();
    this.update({ locationSharing: true });
    await this.social?.announceLocation();
  };
  private async refreshSharedLocation() {
    this.lastSharedLocationRefresh = Date.now();
    const generation = this.locationShareGeneration;
    await this.refreshLocation();
    if (this.disposed || generation !== this.locationShareGeneration || !this.state.locationSharing) return;
    if (this.state.locationPermission !== "granted") {
      await this.setLocationSharing(false);
      return;
    }
    await this.social?.announceLocation();
  }
  findPeople = (): Promise<void> => {
    return (this.findPeoplePromise ??= this.findPeopleOnce().finally(() => { this.findPeoplePromise = undefined; }));
  };
  private async findPeopleOnce() {
    if (this.disposed || !this.identity || !this.state.setupComplete || this.scopeChanging || !this.appActive)
      throw new Error("Finish setup and keep Beacon open to find people.");
    if (this.state.call && !["ended", "failed"].includes(this.state.call.status))
      throw new Error("Finish the call before searching again.");
    this.update({ findingPeople: true, error: undefined });
    this.pausingCalls = true;
    const scope = this.state.activeGroupId;
    const current = () => !this.disposed && this.appActive && !this.scopeChanging && scope === this.state.activeGroupId;
    try {
      if (Platform.OS === "android") {
        const permissions = Number(Platform.Version) >= 31
          ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE]
          : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
        await PermissionsAndroid.requestMultiple(permissions);
      }
      if (!current()) return;
      // Preserve working links. With no authenticated people, a fresh radio lifecycle
      // clears stuck discovery/cooldown while durable SOS and messages stay saved.
      if (typeof BeaconBle.refreshDiscovery !== "function" && !this.state.people.some((p) => p.connected && p.scope === this.state.activeGroupId)) {
        await BeaconBle.stop();
        if (!current()) return;
        for (const peer of this.state.peers) this.mesh().disconnect(peer.id);
        this.social?.reset();
        await this.social?.refresh();
        if (!current()) return;
        this.update({ peers: [], relayRunning: false });
      }
      await this.repo().setSetting("relayEnabled", true);
      if (!current()) return;
      this.update({ relayEnabled: true });
      await this.resume();
      if (!current()) return;
      if (typeof BeaconBle.refreshDiscovery === "function") {
        const ble = await BeaconBle.refreshDiscovery();
        this.update({ bluetooth: ble.state, relayRunning: ble.advertising || ble.scanning });
      }
      if (this.state.bluetooth === "unauthorized") throw new Error("Allow Bluetooth in phone Settings.");
      if (this.state.bluetooth === "poweredOff") throw new Error("Turn on Bluetooth in phone Settings.");
      if (this.state.bluetooth === "unsupported") throw new Error("Nearby needs a phone with Bluetooth support.");
    } finally {
      this.pausingCalls = false;
      this.update({ findingPeople: false });
    }
  }
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
        // Optional location must not turn an otherwise usable SOS screen into an error state.
        this.update({ location: { source: "unavailable" } });
        return;
      }
      const report = locationForSOS({
        source: "device",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? undefined,
        capturedAt: position.timestamp,
      });
      this.update({
        location:
          report.source === "device"
            ? {
                source: "device",
                latitude: report.latitude,
                longitude: report.longitude,
                accuracy: report.accuracyM,
                capturedAt: report.capturedAt,
              }
            : { source: "unavailable" },
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private currentLocation(place?: string): ProtocolLocation {
    return locationForSOS(this.state.location, place);
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
  private async groupRouter(id: string) {
    const existing = this.scopes.get(id);
    if (existing) return existing.router;
    if (!this.identity || !this.state.groups.some((g) => g.id === id))
      throw new Error("Group unavailable.");
    const database = await SQLite.openDatabaseAsync(`beacon-group-${id}.db`);
    try {
      const repository = new Repository(
        database,
        this.identity.nodeId,
        Date.now,
        { privateMode: true },
      );
      await repository.initialize();
      const router = this.makeRouter(repository, id);
      this.scopes.set(id, { database, repository, router });
      return router;
    } catch (error) {
      await database.closeAsync();
      throw error;
    }
  }
  private async saveGroup(group: SocialGroup) {
    const groups = [
      ...this.state.groups.filter((g) => g.id !== group.id),
      group,
    ];
    if (groups.length > 8)
      throw new Error("You can join up to 8 groups on this phone.");
    await SecureStore.setItemAsync("beacon.groups.v1", JSON.stringify(groups), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    this.update({ groups });
    await this.changeGroup(group.id);
  }
  createGroup = (name: string) =>
    this.serialize(async () => {
      await this.saveGroup(createSocialGroup(name.trim(), random));
    });
  joinGroup = (name: string, inviteCode: string) =>
    this.serialize(async () => {
      await this.saveGroup(joinSocialGroup(name.trim(), inviteCode.trim()));
    });
  selectGroup = (id: string | null) =>
    this.serialize(() => this.changeGroup(id));
  private async changeGroup(id: string | null) {
    if (id === this.state.activeGroupId) return;
    if (id !== null && !this.state.groups.some((g) => g.id === id))
      throw new Error("Join this group first.");
    // Bind every saved request to its original scope. Switching never rebroadcasts private packets publicly.
    this.scopeChanging = true;
    try {
      await this.setLocationSharing(false);
      await this.calls?.hangup("Group changed");
      await this.calls?.reset();
      await this.receiveTail;
      const next = id
        ? await this.groupRouter(id)
        : this.makeRouter(this.repo(), null);
      await this.repo().setSetting("activeGroupId", id);
      for (const peer of this.state.peers) this.mesh().disconnect(peer.id);
      this.social?.reset();
      this.router = next;
      this.update({
        activeGroupId: id,
        requests: [],
        people: [],
        messages: [],
        events: [],
        error: undefined,
      });
    } finally {
      this.scopeChanging = false;
    }
    const connected = this.state.peers.filter((p) => p.state === "connected");
    await Promise.all(
      connected.flatMap((p) => [
        this.mesh().connect(p.id),
        this.socialRequired().connect(p.id),
      ]),
    );
    await this.refresh();
    await this.socialRequired().refresh();
  }
  sendText = (peerId: string, text: string) =>
    this.serialize(() => this.socialRequired().sendText(peerId, text));
  markChatRead = (peerId: string) => this.socialRequired().markChatRead(peerId);
  private async publish(input: MessageInput) {
    await this.mesh().publish(input);
    this.update({ error: undefined });
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
      (await this.scopeRepo().listMessages()).map((m) => m.envelope),
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
    if (this.pausingCalls) return;
    this.pausingCalls = !enabled;
    try {
      if (!enabled) {
        await this.setLocationSharing(false);
        await this.calls?.hangup("Bluetooth paused");
      }
      await this.repo().setSetting("relayEnabled", enabled);
      this.update({ relayEnabled: enabled });
      if (enabled) await this.resume();
      else {
        await BeaconBle.stop();
        for (const peer of this.state.peers) this.mesh().disconnect(peer.id);
        this.social?.reset();
        await this.social?.refresh();
        this.update({
          relayRunning: false,
          peers: this.state.peers.map((p) => ({ ...p, state: "disconnected" })),
        });
      }
    } finally { this.pausingCalls = false; }
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
    const nextIncident = input.incidentId ?? oldIncident;
    if (nextUrl && (nextUrl !== oldUrl || nextIncident !== oldIncident) && !input.accessToken?.trim())
      throw new Error("Enter a new access token when changing the incident connection.");
    const changed =
      nextUrl !== oldUrl ||
      nextIncident !== oldIncident ||
      (input.accessToken ?? oldToken ?? "") !== (oldToken ?? "");
    // Keep an old in-flight incident response from repopulating a newly configured snapshot.
    if (this.cloudConfigChanging)
      throw new Error("Settings are already being saved. Try again shortly.");
    if (changed && this.syncBusy)
      throw new Error(
        "Let the current sync finish before changing the incident connection.",
      );
    this.cloudConfigChanging = true;
    let oldTokenRemoved = false;
    try {
      // Remove the old credential before any endpoint change. A partial metadata
      // write must never send a previous incident's token to a different server.
      if (changed) {
        await SecureStore.deleteItemAsync("beacon.cloudToken");
        oldTokenRemoved = true;
      }
      await this.repo().setSetting("displayName", name);
      for (const key of ["cloudUrl", "incidentId", "mapStyleUrl"] as const)
        if (input[key] !== undefined)
          await this.repo().setSetting(key, input[key]);
      const nextToken = input.accessToken ?? oldToken;
      // Only restore a credential once all connection metadata is durable.
      if (changed && nextToken)
        await SecureStore.setItemAsync("beacon.cloudToken", nextToken);
      this.update({
        displayName: name,
        ...(changed
          ? { sync: resetCloudSnapshot(this.state.sync, Boolean(nextUrl)) }
          : {}),
      });
    } catch (error) {
      // Fail closed after partial writes; retain local records and clear old replay.
      if (oldTokenRemoved) {
        await SecureStore.deleteItemAsync("beacon.cloudToken").catch(() => {});
        await this.repo().setSetting("cloudUrl", "").catch(() => {});
      }
      if (changed)
        this.update({
          sync: {
            ...resetCloudSnapshot(this.state.sync, false),
            error: "Incident connection could not be saved. Check its settings before syncing.",
          },
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
    await this.scopeRepo().clearEligibleHistory();
    await this.refresh();
  };
}
