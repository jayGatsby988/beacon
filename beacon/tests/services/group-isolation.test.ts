import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as protocol from "../../packages/protocol/src/index.js";
import * as policy from "../../apps/mobile/src/services/ServicePolicy.js";
import * as base64 from "base64-js";
import { z } from "zod";
import {
  Repository,
  type Database,
  type SqlValue,
} from "../../apps/mobile/src/storage/Repository.js";
import { SocialRepository } from "../../apps/mobile/src/storage/SocialRepository.js";
import { SocialService } from "../../apps/mobile/src/services/SocialService.js";
import { CallService } from "../../apps/mobile/src/services/CallService.js";
import type { BeaconState } from "../../apps/mobile/src/ui/types.js";

// Actual BeaconService, repositories and protocol; native radio/OS APIs are test doubles.
// Disk databases and simulated SecureStore survive service restart. No hardware claim.
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../../apps/mobile/src/services/BeaconService.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
class Adapter implements Database {
  readonly sql: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
  }
  async execAsync(sql: string) {
    this.sql.exec(sql);
  }
  async runAsync(sql: string, ...params: SqlValue[]) {
    const result = this.sql.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }
  async getAllAsync<T>(sql: string, ...params: SqlValue[]) {
    return this.sql.prepare(sql).all(...params) as T[];
  }
  async getFirstAsync<T>(sql: string, ...params: SqlValue[]) {
    return (this.sql.prepare(sql).get(...params) ?? null) as T | null;
  }
  async closeAsync() {
    if (!this.closed) {
      this.closed = true;
      this.sql.close();
    }
  }
}
interface Service {
  state: BeaconState;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  receiveTail: Promise<unknown>;
  refreshPromise?: Promise<void>;
  router?: protocol.MeshRouter;
  social?: SocialService;
}
interface Phone {
  service: Service;
  databases: Map<string, Adapter>;
  emit(name: string, event: unknown): void;
}
interface Write {
  from: string;
  to: string;
  wire: string;
}
class World {
  constructor(private voice = false, private gps = false) {}
  readonly voiceEvents: { phone: string; action: string; callId?: string }[] = [];
  readonly directory = mkdtempSync(join(tmpdir(), "beacon-group-service-"));
  readonly phones = new Map<string, Phone>();
  readonly secure = new Map<string, Map<string, string>>();
  readonly writes: Write[] = [];
  readonly queue: Write[] = [];
  async open(name: string) {
    mkdirSync(join(this.directory, name), { recursive: true });
    if (!this.secure.has(name)) this.secure.set(name, new Map());
    const saved = this.secure.get(name)!;
    const listeners = new Map<string, (event: unknown) => void>();
    const databases = new Map<string, Adapter>();
    const modules: Record<string, unknown> = {
      "react-native": {
        Platform: { OS: "ios" },
        AppState: { addEventListener: (_: string, callback: (event: unknown) => void) => {
          listeners.set("appState", callback);
          return { remove: () => listeners.delete("appState") };
        } },
      },
      "expo-sqlite": {
        openDatabaseAsync: async (database: string) => {
          const db = new Adapter(join(this.directory, name, database));
          databases.set(database, db);
          return db;
        },
      },
      "expo-secure-store": {
        getItemAsync: async (key: string) => saved.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
          saved.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
          saved.delete(key);
        },
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      },
      "expo-crypto": { getRandomBytes: randomBytes, randomUUID },
      "expo-location": {
        Accuracy: { Balanced: 3 },
        getForegroundPermissionsAsync: async () => ({
          status: this.gps ? "granted" : "denied",
          granted: this.gps,
        }),
        requestForegroundPermissionsAsync: async () => ({ status: this.gps ? "granted" : "denied", granted: this.gps }),
        getCurrentPositionAsync: async () => ({ coords: { latitude: 47.6551, longitude: -122.3035, accuracy: 12 }, timestamp: Date.now() + 0.125 }),
      },
      "expo-network": {
        getNetworkStateAsync: async () => ({ isConnected: false }),
        addNetworkStateListener: () => ({ remove() {} }),
      },
      "expo-sharing": {},
      "expo-file-system/legacy": {},
      "base64-js": base64,
      zod: { z },
      "@beacon/protocol": protocol,
      "../../modules/beacon-ble": {
        ...(this.voice ? {
          getVoiceSupport: async () => ({ supported: true }),
          voicePrepare: async (options: { callId: string; initiator: boolean }) => {
            this.voiceEvents.push({ phone: name, action: "prepare", callId: options.callId });
            return { psm: options.initiator ? 0 : 129 };
          },
          voiceConnect: async () => {},
          voiceStart: async (callId: string) => { this.voiceEvents.push({ phone: name, action: "start", callId }); },
          voiceStop: async (callId: string) => { this.voiceEvents.push({ phone: name, action: "stop", callId }); },
          voiceSetMuted: async () => {},
          voiceSetSpeaker: async () => {},
        } : {}),
        addListener: (event: string, callback: (event: unknown) => void) => {
          listeners.set(event, callback);
          return { remove: () => listeners.delete(event) };
        },
        start: async () => ({
          state: "poweredOn",
          advertising: true,
          scanning: true,
        }),
        stop: async () => {},
        send: async (to: string, data: string) => {
          const item = {
            from: name,
            to,
            wire: new TextDecoder().decode(base64.toByteArray(data)),
          };
          this.writes.push(item);
          this.queue.push(item);
        },
      },
      "../storage/Repository": { Repository },
      "../storage/SocialRepository": { SocialRepository },
      "./SocialService": { SocialService },
      "./CallService": { CallService },
      "./ServicePolicy": policy,
      "./MapService": {
        MapService: class {
          async initialize() {}
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
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
      },
      { filename: "BeaconService.group-integration.cjs" },
    )(
      module.exports,
      (id: string) => {
        if (!(id in modules)) throw new Error(`Unexpected dependency: ${id}`);
        return modules[id];
      },
      module,
    );
    const service = new module.exports.BeaconService();
    const phone = {
      service,
      databases,
      emit: (event: string, data: unknown) => listeners.get(event)?.(data),
    };
    this.phones.set(name, phone);
    await service.initialize();
    assert.equal(service.state.error, undefined, "actual service initializes");
    if (!service.state.setupComplete) await service.state.completeSetup(name);
    return phone;
  }
  connect(a: string, b: string) {
    this.phones.get(a)!.emit("onPeer", { peerId: this.voice ? `c:${b}` : b, state: "connected" });
    this.phones.get(b)!.emit("onPeer", { peerId: this.voice ? `p:${a}` : a, state: "connected" });
  }
  async settle() {
    for (let i = 0; i < 3; i++) {
      await turn();
      for (const { service } of this.phones.values()) {
        await service.receiveTail;
        await service.router?.flush();
        await service.social?.flush();
        await service.refreshPromise;
      }
    }
  }
  async drain() {
    let delivered = 0;
    for (let pass = 0; pass < 30; pass++) {
      await this.settle();
      if (!this.queue.length) return;
      while (this.queue.length) {
        assert.ok(++delivered < 500, "synthetic radio must settle");
        const packet = this.queue.shift()!;
        const receiver = this.phones.get(this.voice ? packet.to.slice(2) : packet.to);
        assert.ok(receiver);
        receiver.emit("onData", {
          peerId: this.voice ? `${packet.to.startsWith("c:") ? "p" : "c"}:${packet.from}` : packet.from,
          base64: base64.fromByteArray(new TextEncoder().encode(packet.wire)),
        });
        await receiver.service.receiveTail;
      }
    }
    assert.fail("service traffic did not settle");
  }
  async restart(name: string) {
    await this.settle();
    const old = this.phones.get(name)!;
    await old.service.dispose();
    for (const db of old.databases.values()) await db.closeAsync();
    this.phones.delete(name);
    return this.open(name);
  }
  async close() {
    await this.settle();
    for (const phone of this.phones.values()) {
      await phone.service.dispose();
      for (const db of phone.databases.values()) await db.closeAsync();
    }
    rmSync(this.directory, { recursive: true, force: true });
  }
}

test(
  "private SOS stays encrypted on native writes; same invite persists offer/accept/receipt flow while wrong group and Nearby cannot read",
  { timeout: 10000 },
  async () => {
    const world = new World();
    try {
      const a = await world.open("a"),
        b = await world.open("b"),
        wrong = await world.open("wrong"),
        nearby = await world.open("nearby");
      await a.service.state.createGroup("Private fixture");
      const group = a.service.state.groups[0];
      await b.service.state.joinGroup("Same invite", group.inviteCode);
      await wrong.service.state.createGroup("Different group");
      const id = await a.service.state.sendSOS({
        note: "private-sos-fixture",
        place: "private-place-fixture",
      });
      world.connect("a", "b");
      world.connect("a", "wrong");
      world.connect("a", "nearby");
      await world.drain();
      const outgoing = world.writes.filter((p) => p.from === "a");
      assert.ok(outgoing.length > 0);
      assert.ok(outgoing.every((p) => JSON.parse(p.wire).type === "group"));
      assert.ok(
        outgoing.every(
          (p) =>
            !p.wire.includes("private-sos-fixture") &&
            !p.wire.includes("private-place-fixture"),
        ),
      );
      assert.ok(
        outgoing.some((p) =>
          protocol.openGroup(group, p.wire)?.includes("private-sos-fixture"),
        ),
      );
      assert.equal(
        b.service.state.requests.find((r) => r.id === id)?.note,
        "private-sos-fixture",
      );
      assert.equal(
        b.service.state.requests.find((r) => r.id === id)?.mine,
        false,
      );
      assert.equal(wrong.service.state.requests.length, 0);
      assert.equal(nearby.service.state.requests.length, 0);
      for (const db of [
        wrong.databases.get(
          `beacon-group-${wrong.service.state.activeGroupId}.db`,
        )!,
        nearby.databases.get("beacon.db")!,
      ]) {
        assert.equal(
          (await db.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM messages",
          ))!.n,
          0,
        );
      }
      assert.ok(
        outgoing.every(
          (p) =>
            protocol.openGroup(wrong.service.state.groups[0], p.wire) === null,
        ),
      );
      await b.service.state.offerHelp(id, "private-offer-fixture");
      await world.drain();
      const offer = a.service.state.requests.find((r) => r.id === id)!
        .offers[0];
      assert.equal(offer.note, "private-offer-fixture");
      await a.service.state.acceptOffer(id, offer.id);
      await world.drain();
      const accepted = a.service.state.requests.find((r) => r.id === id)!;
      assert.equal(accepted.status, "accepted");
      assert.equal(
        accepted.offers.find((o) => o.id === offer.id)?.assignmentReceived,
        true,
      );
      assert.equal(accepted.transport, "received");
      for (const phone of [a, b]) {
        const db = phone.databases.get(`beacon-group-${group.id}.db`)!;
        assert.ok(
          (await db.getFirstAsync<{ n: number }>(
            "SELECT COUNT(*) n FROM messages",
          ))!.n >= 4,
        );
        for (const table of ["events", "outbox"])
          assert.equal(
            (await db.getFirstAsync<{ n: number }>(
              `SELECT COUNT(*) n FROM ${table}`,
            ))!.n,
            0,
          );
        assert.equal(phone.service.state.error, undefined);
      }
      assert.equal(
        world.writes.some((p) => p.wire.includes("private-offer-fixture")),
        false,
      );
      const identity = b.service.state.nodeId;
      const restarted = await world.restart("b");
      assert.equal(restarted.service.state.nodeId, identity);
      assert.equal(restarted.service.state.activeGroupId, group.id);
      assert.equal(
        restarted.service.state.groups[0].inviteCode,
        group.inviteCode,
      );
      assert.equal(
        restarted.service.state.requests.find((r) => r.id === id)?.status,
        "accepted",
      );
    } finally {
      await world.close();
    }
  },
);

test(
  "switching group and Nearby cannot move queued SOS across scopes, including old native packets",
  { timeout: 10000 },
  async () => {
    const world = new World();
    try {
      const a = await world.open("a"),
        b = await world.open("b");
      const publicId = await a.service.state.sendSOS({
        note: "nearby-only-fixture",
      });
      await a.service.state.createGroup("Isolation fixture");
      const group = a.service.state.groups[0];
      await b.service.state.joinGroup("Same", group.inviteCode);
      assert.equal(
        a.service.state.requests.some((r) => r.id === publicId),
        false,
      );
      const privateId = await a.service.state.sendSOS({
        note: "private-only-fixture",
      });
      world.connect("a", "b");
      await world.settle();
      assert.ok(
        world.writes
          .filter((p) => p.from === "a")
          .every((p) => {
            const opened = protocol.openGroup(group, p.wire);
            return opened !== null && !opened.includes("nearby-only-fixture");
          }),
        "old Nearby SOS is not encrypted into the private group",
      );
      // Change scope with encrypted writes still queued in the synthetic native transport.
      await a.service.state.selectGroup(null);
      await b.service.state.selectGroup(null);
      const switchIndex = world.writes.length;
      await world.drain();
      assert.equal(
        b.service.state.requests.some((r) => r.id === privateId),
        false,
      );
      assert.equal(
        b.service.state.requests.some((r) => r.id === publicId),
        true,
      );
      assert.equal(
        a.service.state.requests.some((r) => r.id === privateId),
        false,
      );
      assert.equal(
        world.writes
          .slice(switchIndex)
          .some((p) => p.wire.includes("private-only-fixture")),
        false,
      );
      const publicRows = await b.databases
        .get("beacon.db")!
        .getAllAsync<{ request_id: string }>("SELECT request_id FROM messages");
      assert.equal(
        publicRows.some((r) => r.request_id === privateId),
        false,
      );
      await a.service.state.selectGroup(group.id);
      await b.service.state.selectGroup(group.id);
      await world.drain();
      assert.equal(
        b.service.state.requests.some((r) => r.id === privateId),
        true,
      );
      assert.equal(
        b.service.state.requests.some((r) => r.id === publicId),
        false,
      );
      for (const phone of [a, b]) {
        const rows = await phone.databases
          .get(`beacon-group-${group.id}.db`)!
          .getAllAsync<{
            request_id: string;
          }>("SELECT request_id FROM messages");
        assert.equal(
          rows.some((r) => r.request_id === publicId),
          false,
        );
        assert.equal(phone.service.state.error, undefined);
      }
    } finally {
      await world.close();
    }
  },
);

for (const endBy of ["group", "pause", "background", "disconnect", "dispose"] as const) {
  test(`Bluetooth call integration: accepted native audio stops on ${endBy} and call controls never enter SQLite`, { timeout: 10000 }, async () => {
    const world = new World(true);
    try {
      const a = await world.open("a");
      const b = await world.open("b");
      world.connect("a", "b");
      await world.drain();
      assert.equal(a.service.state.callSupported, true);
      assert.equal(a.service.state.people.find((p) => p.nodeId === b.service.state.nodeId)?.connected, true);
      await a.service.state.startCall(b.service.state.nodeId);
      await world.drain();
      assert.equal(b.service.state.call?.status, "ringing");
      assert.equal(world.voiceEvents.filter((e) => e.action === "start").length, 0, "ringing never opens a microphone");
      const callId = a.service.state.call!.id;
      await b.service.state.acceptCall(b.service.state.call!.id);
      await world.drain();
      assert.equal(world.voiceEvents.filter((e) => e.action === "start").length, 0, "accept still awaits authenticated native streams");
      a.emit("onVoice", { callId, state: "ready" });
      b.emit("onVoice", { callId, state: "ready" });
      await world.settle();
      assert.equal(a.service.state.call?.status, "active");
      assert.equal(b.service.state.call?.status, "active");
      assert.equal(world.voiceEvents.filter((e) => e.action === "start").length, 2);
      a.emit("appState", "inactive");
      await world.settle();
      assert.equal(a.service.state.call?.status, "active", "an OS permission prompt is not backgrounding");
      a.emit("appState", "active");
      await world.settle();
      for (const phone of [a, b]) {
        const repository = new Repository(phone.databases.get("beacon.db")!, phone.service.state.nodeId);
        assert.equal((await repository.listMessages()).length, 0, "call control is not SOS history");
        const social = new SocialRepository(phone.databases.get("beacon-social.db")!);
        assert.equal((await social.packets()).length, 0, "call keys are not saved as chat messages");
      }
      if (endBy === "group") await a.service.state.createGroup("Switch while calling");
      if (endBy === "pause") await a.service.state.setRelayEnabled(false);
      if (endBy === "background") a.emit("appState", "background");
      if (endBy === "disconnect") a.emit("onPeer", { peerId: "c:b", state: "disconnected" });
      if (endBy === "dispose") {
        await a.service.dispose();
        world.phones.delete("a");
        world.queue.length = 0;
      } else await world.settle();
      assert.ok(world.voiceEvents.some((e) => e.phone === "a" && e.action === "stop" && e.callId === callId), "native microphone shutdown requested");
      if (endBy !== "dispose") assert.notEqual(a.service.state.call?.status, "active");
    } finally { await world.close(); }
  });
}

test("map location is opt-in, encrypted in a group, ephemeral, and withdrawn on background", { timeout: 10000 }, async () => {
  const world = new World(false, true);
  try {
    const a = await world.open("a"), b = await world.open("b"), outsider = await world.open("outsider");
    await a.service.state.createGroup("Map test group");
    const group = a.service.state.groups[0];
    await b.service.state.joinGroup("Map test group", group.inviteCode);
    world.connect("a", "b");
    world.connect("a", "outsider");
    await world.drain();
    assert.equal(a.service.state.locationSharing, false);
    assert.equal(b.service.state.people.find((p) => p.nodeId === a.service.state.nodeId)?.location, undefined);
    const before = world.writes.length;
    await a.service.state.setLocationSharing(true);
    await world.drain();
    assert.equal(a.service.state.locationSharing, true);
    const received = b.service.state.people.find((p) => p.nodeId === a.service.state.nodeId)?.location;
    assert.equal(received?.latitude, 47.6551);
    assert.equal(received?.longitude, -122.3035);
    assert.equal(Number.isSafeInteger(received?.capturedAt), true, "native fractional timestamp normalized");
    assert.ok(outsider.service.state.people.every((p) => !p.location), "public outsider gets no private map fixes");
    const shared = world.writes.slice(before).filter((p) => p.from === "a");
    assert.ok(shared.some((p) => protocol.openGroup(group, p.wire)?.includes('"type":"location"')));
    assert.ok(shared.every((p) => !p.wire.includes("47.6551") && JSON.parse(p.wire).type === "group"));
    for (const phone of [a, b]) {
      for (const db of phone.databases.values()) {
        for (const row of db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) {
          const table = row.name.replaceAll('"', '""');
          const serialized = JSON.stringify(db.sql.prepare(`SELECT * FROM "${table}"`).all());
          assert.ok(!serialized.includes("47.6551"), "live map coordinates never persist in any app table");
        }
      }
    }
    a.emit("appState", "background");
    await world.drain();
    assert.equal(a.service.state.locationSharing, false);
    assert.equal(b.service.state.people.find((p) => p.nodeId === a.service.state.nodeId)?.location, undefined);
    a.emit("appState", "active");
    await world.drain();
    assert.equal(a.service.state.locationSharing, false, "foregrounding does not restore sharing silently");
    const restarted = await world.restart("a");
    assert.equal(restarted.service.state.locationSharing, false, "sharing is not a persisted preference");
  } finally { await world.close(); }
});

test("changing map audience stops location sharing before public presence", { timeout: 10000 }, async () => {
  const world = new World(false, true);
  try {
    const a = await world.open("a"), b = await world.open("b");
    await a.service.state.createGroup("Private map");
    await b.service.state.joinGroup("Private map", a.service.state.groups[0].inviteCode);
    world.connect("a", "b"); await world.drain();
    await a.service.state.setLocationSharing(true); await world.drain();
    assert.ok(b.service.state.people.find((p) => p.nodeId === a.service.state.nodeId)?.location);
    const start = world.writes.length;
    await a.service.state.selectGroup(null); await world.drain();
    assert.equal(a.service.state.locationSharing, false);
    assert.equal(b.service.state.people.find((p) => p.nodeId === a.service.state.nodeId)?.location, undefined);
    assert.ok(world.writes.slice(start).every((p) => JSON.parse(p.wire).type !== "location"), "private fix never broadcast in public");
  } finally { await world.close(); }
});

test("denied location permission leaves messaging usable and sharing off", { timeout: 10000 }, async () => {
  const world = new World();
  try {
    const a = await world.open("a");
    await assert.rejects(a.service.state.setLocationSharing(true), /Allow location/);
    assert.equal(a.service.state.locationSharing, false);
    assert.equal(a.service.state.relayRunning, true);
    const request = await a.service.state.sendSOS();
    assert.ok(a.service.state.requests.some((r) => r.id === request));
  } finally { await world.close(); }
});
