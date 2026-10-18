import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomBytes, randomUUID } from "node:crypto";
import ts from "typescript";
import * as protocol from "../../packages/protocol/src/index.js";
import * as policy from "../../apps/mobile/src/services/ServicePolicy.js";
import * as base64 from "base64-js";
import { z } from "zod";
import type { BeaconState } from "../../apps/mobile/src/ui/types.js";
import { SocialService } from "../../apps/mobile/src/services/SocialService.js";
import { CallService } from "../../apps/mobile/src/services/CallService.js";
import type { StoredPerson } from "../../apps/mobile/src/storage/SocialRepository.js";

// Execute actual service + protocol. Native APIs are explicit test doubles, not hardware evidence.
const source = readFileSync(
  new URL("../../apps/mobile/src/services/BeaconService.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const never = () => new Promise<never>(() => {});
interface Service {
  state: BeaconState;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  sendSOS(): Promise<string>;
}
function fixture(
  options: {
    map?: () => Promise<void>;
    network?: () => Promise<unknown>;
    location?: () => Promise<unknown>;
    position?: () => Promise<unknown>;
    requestPermission?: () => Promise<unknown>;
    fastLocationTimeout?: boolean;
    beforeSave?: () => Promise<void>;
    receiveCall?: (peerId: string, wire: string) => Promise<void>;
  } = {},
) {
  const listeners = new Map<string, (event: any) => void>();
  const writes: { peerId: string; wire: string }[] = [];
  const calls: string[] = [];
  const records = new Map<string, protocol.StoredMessage>();
  const people = new Map<string, StoredPerson>();
  const forwarded = new Map<string, Set<string>>();
  class Repository {
    async initialize() {}
    async getSetting(key: string, fallback: unknown) {
      return key === "setupComplete" ? true : fallback;
    }
    async setSetting() {}
    async listMessages() {
      return [...records.values()];
    }
    async getMessage(id: string) {
      return records.get(id);
    }
    async saveMessage(
      envelope: protocol.Envelope,
      hops: number,
      receivedAt: number,
    ) {
      await options.beforeSave?.();
      if (records.has(envelope.id)) return false;
      records.set(envelope.id, { envelope, hops, receivedAt });
      return true;
    }
    async markForwarded(peerId: string, id: string) {
      if (!forwarded.has(peerId)) forwarded.set(peerId, new Set());
      forwarded.get(peerId)!.add(id);
    }
    async listForwarded(peerId: string) {
      return [...(forwarded.get(peerId) ?? [])];
    }
    async forwardingCounts() {
      return {};
    }
    async events() {
      return [];
    }
    async pendingCount() {
      return 0;
    }
    async recordEvent() {}
  }
  const bluetooth = {
    ...(options.receiveCall ? { getVoiceSupport: async () => ({ supported: true }) } : {}),
    addListener: (name: string, callback: (event: any) => void) => {
      calls.push(`listen:${name}`);
      listeners.set(name, callback);
      return { remove: () => listeners.delete(name) };
    },
    start: async () => {
      calls.push("start");
      return { state: "poweredOn", advertising: true, scanning: true };
    },
    stop: async () => {
      calls.push("stop");
    },
    refreshDiscovery: async () => {
      calls.push("refreshDiscovery");
      return { state: "poweredOn", advertising: true, scanning: true };
    },
    send: async (peerId: string, data: string) => {
      writes.push({
        peerId,
        wire: new TextDecoder().decode(base64.toByteArray(data)),
      });
    },
  };
  const modules: Record<string, unknown> = {
    "react-native": {
      Platform: { OS: "ios" },
      AppState: { addEventListener: () => ({ remove() {} }) },
    },
    "expo-sqlite": {
      openDatabaseAsync: async () => ({
        closeAsync: async () => {
          calls.push("close");
        },
      }),
    },
    "expo-secure-store": {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    },
    "expo-crypto": { getRandomBytes: randomBytes, randomUUID },
    "expo-location": {
      Accuracy: { Balanced: 3 },
      getCurrentPositionAsync: options.position ?? never,
      requestForegroundPermissionsAsync: options.requestPermission ?? (async () => ({ status: "denied", granted: false })),
      getForegroundPermissionsAsync:
        options.location ??
        (async () => ({ status: "denied", granted: false })),
    },
    "expo-network": {
      getNetworkStateAsync:
        options.network ?? (async () => ({ isConnected: false })),
      addNetworkStateListener: () => ({ remove() {} }),
    },
    "expo-sharing": {},
    "expo-file-system/legacy": {},
    "base64-js": base64,
    zod: { z },
    "@beacon/protocol": protocol,
    "../../modules/beacon-ble": bluetooth,
    "../storage/Repository": { Repository },
    "../storage/SocialRepository": {
      SocialRepository: class {
        async initialize() {}
        async people() {
          return [...people.values()];
        }
        async packets() {
          return [];
        }
        async deliveredIds() {
          return [];
        }
        async savePerson(person: StoredPerson) { people.set(`${person.nodeId}:${person.scope ?? "public"}`, person); }
      },
    },
    "./SocialService": { SocialService },
    "./CallService": { CallService: options.receiveCall ? class extends CallService {
      // Routing probe only: authenticated signaling is exercised by call-service tests.
      receive(peerId: string, wire: string) { return options.receiveCall!(peerId, wire); }
    } : CallService },
    "./ServicePolicy": policy,
    "./MapService": {
      MapService: class {
        initialize = options.map ?? (async () => {});
        dispose() {}
      },
    },
  };
  const module = { exports: {} as { BeaconService: new () => Service } };
  runInNewContext(
    `(function(exports, require, module) { ${compiled}\n})`,
    {
      Date,
      Error,
      TextEncoder,
      TextDecoder,
      URL,
      setTimeout: (callback: () => void, ms: number) =>
        setTimeout(
          callback,
          options.fastLocationTimeout && ms === 6000 ? 0 : ms,
        ),
      clearTimeout,
      setInterval: () => 1,
      clearInterval: () => {},
    },
    { filename: "BeaconService.transpiled.test.cjs" },
  )(
    module.exports,
    (id: string) => {
      if (!(id in modules))
        throw new Error(`Unexpected service dependency: ${id}`);
      return modules[id];
    },
    module,
  );
  const service = new module.exports.BeaconService();
  return {
    service,
    calls,
    writes,
    records,
    emit: (name: string, event: unknown) => listeners.get(name)?.(event),
  };
}

test(
  "unresolved map, location, and network probes cannot block offline BLE startup or queued SOS forwarding",
  { timeout: 3000 },
  async (t) => {
    const h = fixture({ map: never, network: never, location: never });
    t.after(() => h.service.dispose());
    await h.service.initialize();
    assert.equal(h.service.state.loading, false);
    assert.equal(h.service.state.relayRunning, true);
    assert.ok(h.calls.indexOf("listen:onData") < h.calls.indexOf("start"));
    const requestId = await h.service.sendSOS();
    h.emit("onPeer", {
      peerId: "actual-session-shaped-test",
      state: "connected",
    });
    for (let i = 0; i < 8; i++) await turn();
    assert.ok(
      h.writes.some(
        (p) =>
          JSON.parse(p.wire).envelope &&
          protocol.decodePacket(p.wire, Date.now()).envelope.requestId ===
            requestId,
      ),
    );
    assert.equal(h.service.state.error, undefined);
  },
);

test(
  "optional map errors stay in map state and rejected network inspection does not disable relay",
  { timeout: 3000 },
  async (t) => {
    const h = fixture({
      map: async () => {
        throw new Error("Map pack unavailable");
      },
      network: async () => {
        throw new Error("Network inspection unavailable");
      },
    });
    t.after(() => h.service.dispose());
    await h.service.initialize();
    await turn();
    assert.equal(h.service.state.relayRunning, true);
    assert.equal(h.service.state.internet, null);
    assert.equal(h.service.state.map.status, "error");
    assert.equal(h.service.state.map.error, "Map pack unavailable");
    assert.equal(h.service.state.error, undefined);
  },
);

test(
  "native onData UTF-8/base64 bridge persists foreign SOS and refreshes receiver view",
  { timeout: 3000 },
  async (t) => {
    const h = fixture();
    t.after(() => h.service.dispose());
    await h.service.initialize();
    const sender = protocol.createIdentity(randomBytes);
    const envelope = protocol.createEnvelope(
      sender,
      {
        type: "sos",
        requestId: protocol.createRequestId(sender, randomBytes),
        destination: "community",
        payload: {
          category: "other",
          note: "Synthetic café assistance",
          displayName: "Synthetic sender",
          location: { source: "unavailable", capturedAt: Date.now() },
        },
      },
      Date.now(),
      randomBytes,
    );
    h.emit("onPeer", { peerId: "remote-test", state: "connected" });
    h.emit("onData", {
      peerId: "remote-test",
      base64: base64.fromByteArray(
        new TextEncoder().encode(protocol.encodePacket({ envelope, hops: 1 })),
      ),
    });
    for (let i = 0; i < 8; i++) await turn();
    assert.ok(h.records.has(envelope.id));
    const view = h.service.state.requests.find(
      (r) => r.id === envelope.requestId,
    );
    assert.equal(view?.mine, false);
    assert.equal(view?.note, "Synthetic café assistance");
    assert.equal(h.service.state.error, undefined);
  },
);

test(
  "a slow optional GPS lookup leaves SOS usable without a global action error",
  { timeout: 3000 },
  async (t) => {
    const h = fixture({
      location: async () => ({ status: "granted", granted: true }),
      fastLocationTimeout: true,
    });
    t.after(() => h.service.dispose());
    await h.service.initialize();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(h.service.state.location.source, "unavailable");
    assert.equal(h.service.state.error, undefined);
    const id = await h.service.sendSOS();
    assert.ok(h.service.state.requests.some((r) => r.id === id));
  },
);

test(
  "late optional results cannot publish state after service disposal",
  { timeout: 3000 },
  async () => {
    let resolve!: (value: unknown) => void;
    let rejectMap!: (error: Error) => void;
    const h = fixture({
      network: () =>
        new Promise((yes) => {
          resolve = yes;
        }),
      map: () =>
        new Promise((_yes, no) => {
          rejectMap = no;
        }),
    });
    await h.service.initialize();
    await h.service.dispose();
    const snapshot = h.service.state;
    resolve({ isConnected: true });
    rejectMap(new Error("Late map error"));
    await turn();
    assert.equal(h.service.state, snapshot);
  },
);

test("Find people refreshes discovery without stopping Bluetooth or losing saved SOS", async (t) => {
  const h = fixture();
  t.after(() => h.service.dispose());
  await h.service.initialize();
  const requestId = await h.service.sendSOS();
  const before = h.calls.length;
  await h.service.state.findPeople();
  assert.ok(h.calls.slice(before).includes("refreshDiscovery"));
  assert.ok(!h.calls.slice(before).includes("stop"), "discovery retry preserves current radio sessions");
  assert.equal(h.service.state.findingPeople, false);
  assert.ok([...h.records.values()].some((r) => r.envelope.requestId === requestId));
  h.emit("onPeer", { peerId: "newly-found-peer", state: "connected" });
  for (let i = 0; i < 8; i++) await turn();
  assert.ok(h.writes.some((p) => JSON.parse(p.wire).envelope?.requestId === requestId), "saved SOS still forwards after retry");
});

test("turning location sharing off cancels an outstanding permission prompt", async (t) => {
  let grant!: (value: unknown) => void;
  const h = fixture({ requestPermission: () => new Promise((resolve) => { grant = resolve; }) });
  t.after(() => h.service.dispose());
  await h.service.initialize();
  const enabling = h.service.state.setLocationSharing(true);
  await h.service.state.setLocationSharing(false);
  grant({ status: "granted", granted: true });
  await enabling;
  assert.equal(h.service.state.locationSharing, false);
  assert.ok(h.writes.every((p) => JSON.parse(p.wire).type !== "location"));
});

test("a rejected optional GPS lookup cannot leave a global action error or block SOS", async (t) => {
  const h = fixture({
    location: async () => ({ status: "granted", granted: true }),
    position: async () => { throw new Error("kCLErrorDomain error 0"); },
  });
  t.after(() => h.service.dispose());
  await h.service.initialize();
  await turn();
  assert.equal(h.service.state.location.source, "unavailable");
  assert.equal(h.service.state.error, undefined);
  const requestId = await h.service.sendSOS();
  assert.ok(h.service.state.requests.some((request) => request.id === requestId));
  await assert.rejects(h.service.state.locateOnMap(), /GPS is unavailable/, "an explicit location action still explains the missing fix");
  assert.equal(h.service.state.error, undefined);
});

test("optional location permission inspection failures leave offline SOS available", async (t) => {
  const h = fixture({ location: async () => { throw new Error("Permission inspection unavailable"); } });
  t.after(() => h.service.dispose());
  await h.service.initialize();
  await turn();
  assert.equal(h.service.state.location.source, "unavailable");
  assert.equal(h.service.state.error, undefined);
  assert.equal(h.service.state.relayRunning, true);
  const requestId = await h.service.sendSOS();
  assert.ok(h.service.state.requests.some((request) => request.id === requestId));
});

test("transient GPS failure preserves a recent fix without making its timestamp fresh; stale or revoked fixes disappear", async (t) => {
  const capturedAt = Date.now();
  let sensorAvailable = true;
  let permissionGranted = true;
  const h = fixture({
    location: async () => ({ status: permissionGranted ? "granted" : "denied", granted: permissionGranted }),
    position: async () => {
      if (!sensorAvailable) throw new Error("Location temporarily unavailable");
      return { coords: { latitude: 47.65, longitude: -122.3, accuracy: 25 }, timestamp: capturedAt };
    },
  });
  t.after(() => h.service.dispose());
  await h.service.initialize();
  await turn();
  assert.equal(h.service.state.location.capturedAt, capturedAt);
  sensorAvailable = false;
  await h.service.state.refreshLocation();
  assert.equal(h.service.state.location.latitude, 47.65);
  assert.equal(h.service.state.location.capturedAt, capturedAt);
  t.mock.method(Date, "now", () => capturedAt + protocol.LOCATION_LIMITS.ttlMs);
  await h.service.state.refreshLocation();
  assert.equal(h.service.state.location.source, "unavailable", "expired fixes cannot survive a failed refresh");
  t.mock.method(Date, "now", () => capturedAt);
  sensorAvailable = true;
  await h.service.state.refreshLocation();
  assert.equal(h.service.state.location.source, "device");
  permissionGranted = false;
  await h.service.state.refreshLocation();
  assert.equal(h.service.state.location.source, "unavailable", "permission revocation removes even a recent fix");
  assert.equal(h.service.state.error, undefined);
});

async function authenticate(h: ReturnType<typeof fixture>, peerId: string) {
  const identity = protocol.createIdentity(randomBytes);
  h.emit("onPeer", { peerId, state: "connected" });
  h.emit("onData", {
    peerId,
    base64: base64.fromByteArray(new TextEncoder().encode(protocol.createPresence(identity, "Nearby participant", null, Date.now(), randomBytes))),
  });
  for (let index = 0; index < 8; index++) await turn();
}

test("retrying Bluetooth errors show a useful summary and clear only after an authenticated reconnect", async (t) => {
  const h = fixture();
  t.after(() => h.service.dispose());
  await h.service.initialize();
  h.emit("onError", { code: "SERVICE_MISSING", message: "SERVICE_MISSING: BLE session failed; reconnecting", peerId: "c:old" });
  assert.equal(h.service.state.error, "A nearby connection was interrupted. Reconnecting…");
  h.emit("onPeer", { peerId: "c:new", state: "connected" });
  for (let index = 0; index < 3; index++) await turn();
  assert.ok(h.service.state.error, "a raw native session is not an authenticated connection");
  await authenticate(h, "c:new");
  assert.ok(h.service.state.people.some((person) => person.connected));
  assert.equal(h.service.state.error, undefined);
  h.emit("onError", { code: "SERVICE_MISSING", message: "SERVICE_MISSING: BLE session failed; reconnecting", peerId: "c:other" });
  assert.equal(h.service.state.error, undefined, "a separate failing discovery link must not contradict the working connection");
});

test("Bluetooth recovery never hides unrelated service failures", async (t) => {
  const h = fixture();
  t.after(() => h.service.dispose());
  await h.service.initialize();
  h.emit("onError", { code: "SERVICE_MISSING", message: "SERVICE_MISSING", peerId: "c:old" });
  h.emit("onError", { code: "INVALID_FRAME", message: "Malformed or excessive Bluetooth frame", peerId: "c:old" });
  h.emit("onError", { code: "CONNECT_FAILED", message: "CONNECT_FAILED", peerId: "c:old" });
  assert.equal(h.service.state.error, "Malformed or excessive Bluetooth frame");
  await authenticate(h, "c:new");
  assert.equal(h.service.state.error, "Malformed or excessive Bluetooth frame", "successful discovery only clears the tagged retrying-connection error");
});

test("call control bypasses a full durable receive backlog without losing the saved SOS", { timeout: 3000 }, async (t) => {
  let release!: () => void;
  const stalled = new Promise<void>((resolve) => { release = resolve; });
  const receivedCalls: string[] = [];
  const h = fixture({ beforeSave: () => stalled, receiveCall: async (_peer, wire) => { receivedCalls.push(wire); } });
  t.after(async () => { release(); await h.service.dispose(); });
  await h.service.initialize();
  const identity = protocol.createIdentity(randomBytes);
  const envelope = protocol.createEnvelope(identity, {
    type: "sos", requestId: protocol.createRequestId(identity, randomBytes), destination: "community",
    payload: { category: "other", displayName: "Synthetic sender", note: "Synthetic queued SOS", location: { source: "unavailable", capturedAt: Date.now() } },
  }, Date.now(), randomBytes);
  const wire = protocol.encodePacket({ envelope, hops: 1 });
  const emit = (value: string) => h.emit("onData", {
    peerId: "remote-routing-probe", base64: base64.fromByteArray(new TextEncoder().encode(value)),
  });
  h.emit("onPeer", { peerId: "remote-routing-probe", state: "connected" });
  for (let index = 0; index < 32; index++) emit(wire);
  await turn();
  assert.equal(h.records.size, 0, "persistent processing is deliberately stalled");
  const control = JSON.stringify({ type: "call", routingProbe: "end" });
  emit(control);
  await turn();
  assert.deepEqual(receivedCalls, [control], "call authentication/handling must start despite 32 pending durable packets");
  release();
  for (let index = 0; index < 12; index++) await turn();
  assert.ok(h.records.has(envelope.id), "priority signaling must not discard the queued SOS");
});

test("independent call handlers stay bounded and ignore traffic after disposal", { timeout: 3000 }, async () => {
  const release: (() => void)[] = [];
  const h = fixture({ receiveCall: () => new Promise<void>((resolve) => { release.push(resolve); }) });
  await h.service.initialize();
  const emit = () => h.emit("onData", {
    peerId: "remote-routing-probe",
    base64: base64.fromByteArray(new TextEncoder().encode(JSON.stringify({ type: "call", routingProbe: true }))),
  });
  try {
    for (let index = 0; index < 40; index++) emit();
    await turn();
    assert.equal(release.length, 8, "new fast path cannot create an unbounded promise backlog");
    release[0]();
    await turn();
    emit();
    await turn();
    assert.equal(release.length, 9, "capacity becomes available when a handler settles");
    await h.service.dispose();
    emit();
    await turn();
    assert.equal(release.length, 9, "disposed service cannot handle new signals");
  } finally {
    for (const finish of release) finish();
    await h.service.dispose();
  }
});
