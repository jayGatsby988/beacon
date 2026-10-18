import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as protocol from "../../packages/protocol/src/index.js";
import { SocialService } from "../../apps/mobile/src/services/SocialService.js";
import { SocialRepository } from "../../apps/mobile/src/storage/SocialRepository.js";
import type { Database, SqlValue } from "../../apps/mobile/src/storage/Repository.js";
import type { PersonView } from "../../apps/mobile/src/ui/types.js";
import { CAMPUS_BOUNDS, campusStyle } from "../../apps/mobile/src/components/campusMapStyle.js";

// Actual signed protocol, SocialService, SQLite repository, Nearby screen and
// NearbyMap render. Only native views/hooks are replaced; no runtime fixtures,
// Bluetooth/GPS hardware, native map rendering or camera movement are simulated.
function repository() {
  const sql = new DatabaseSync(":memory:");
  const db: Database = {
    execAsync: async (query: string) => { sql.exec(query); },
    runAsync: async (query: string, ...params: SqlValue[]) => sql.prepare(query).run(...params),
    getAllAsync: async <T>(query: string, ...params: SqlValue[]) => sql.prepare(query).all(...params) as T[],
    getFirstAsync: async <T>(query: string, ...params: SqlValue[]) => (sql.prepare(query).get(...params) ?? null) as T | null,
  };
  return { repo: new SocialRepository(db), close: () => sql.close() };
}

function screen(getState: () => any, now: () => number, route?: { view?: string; requestId?: string }) {
  let screenEffects: (() => void)[] = [];
  let requestFocus: any;
  let firstUndefined = true;
  let mode: "people" | "map" = "people";
  const container = ({ children }: any) => React.createElement("div", null, children);
  const text = ({ children }: any) => React.createElement("span", null, children);
  const button = ({ children, accessibilityLabel }: any) => React.createElement("button", { "aria-label": accessibilityLabel }, children);
  const native = {
    View: container, Text: text, Pressable: button, Switch: () => null,
    ActivityIndicator: () => null, Linking: {},
    useWindowDimensions: () => ({ height: 900, width: 420 }),
    StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
  };
  const mapNative = {
    MapView: container, Camera: () => null,
    PointAnnotation: ({ id, coordinate, title, children }: any) => React.createElement("span", {
      "data-point": id, "data-coordinate": JSON.stringify(coordinate), "data-title": title,
    }, children),
  };
  const require = (name: string): any => {
    if (name === "react") return {
      ...React,
      // Select each real view without simulating native button dispatch.
      useState: (initial: any) => {
        if (route && initial === "people") return [mode, (value: "people" | "map") => { mode = value; }];
        if (route && initial === undefined && firstUndefined) {
          firstUndefined = false;
          return [requestFocus, (value: any) => { requestFocus = typeof value === "function" ? value(requestFocus) : value; }];
        }
        return React.useState(initial === "people" ? mode : initial);
      },
      useEffect: (effect: () => void, dependencies: unknown[]) => {
        if (route && screenEffects.length < 2) screenEffects.push(effect);
        else React.useEffect(effect, dependencies);
      },
    };
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-native") return native;
    if (name === "expo-router") return {
      router: { push: () => {}, setParams: (params: { view?: string }) => { if (route) Object.assign(route, params); } },
      useFocusEffect: () => {}, useLocalSearchParams: () => route ?? {},
    };
    if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
    if (name === "@maplibre/maplibre-react-native") return { __esModule: true, default: mapNative };
    if (name === "@beacon/protocol") return protocol;
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name === "./campusMapStyle") return { CAMPUS_BOUNDS, campusStyle };
    if (name.endsWith("/services/BeaconContext")) return { useBeacon: getState };
    if (name.endsWith("/components/NearbyMap")) return mapModule;
    if (name.endsWith("/components/AudiencePicker")) return { __esModule: true, default: () => null };
    if (name.endsWith("/components/RequestCard")) return { RequestCard: () => null };
    if (name.endsWith("/components/ui")) return {
      Screen: ({ children, scroll }: any) => React.createElement("div", { "data-screen-scroll": String(scroll ?? true) }, children), Heading: text, ErrorNotice: () => null, styles: {}, age: () => "recently",
      useAction: () => ({ busy: false, run: async (action: () => Promise<void>) => action() }),
    };
    throw new Error(`Unexpected UI dependency: ${name}`);
  };
  const load = (relative: string) => {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const module = { exports: {} as any };
    runInNewContext(`(function(exports, require, module) { ${code}\n})`, { Date: { now } })(module.exports, require, module);
    return module.exports;
  };
  const mapModule = load("../../apps/mobile/src/components/NearbyMap.tsx");
  const Nearby = load("../../apps/mobile/app/(tabs)/nearby.tsx").default;
  return (selected: "people" | "map" = "people") => {
    mode = selected;
    screenEffects = [];
    firstUndefined = true;
    const html = renderToStaticMarkup(React.createElement(Nearby));
    if (!route) return html;
    // Flush the screen's route-intent effect; native map effects stay outside this test.
    for (const effect of screenEffects) effect();
    firstUndefined = true;
    return renderToStaticMarkup(React.createElement(Nearby));
  };
}

for (const scope of [null, "a".repeat(64)]) {
  test(`received ${scope ? "private" : "public"} people and pins reach actual Nearby UI; withdrawals and reconnects stay honest`, async () => {
    let now = Date.now();
    const queue: { receiver: number; peer: string; wire: string }[] = [];
    const errors: unknown[] = [];
    const peers = ["c:other", "p:other"];
    const phones = [0, 1].map((index) => {
      const storage = repository();
      const identity = protocol.createIdentity(randomBytes);
      const phone = { ...storage, identity, scope, people: [] as PersonView[], location: null as protocol.SharedLocation | null, service: null as unknown as SocialService };
      phone.service = new SocialService({
        identity, repository: storage.repo, name: () => `Test person ${index}`, scope: () => phone.scope,
        location: () => phone.location, clock: () => now, random: randomBytes,
        send: async (_peer, wire) => { queue.push({ receiver: 1 - index, peer: peers[1 - index], wire }); },
        getRead: async () => 0, setRead: async () => {},
        onChange: (people) => { phone.people = people; }, onError: (error) => { errors.push(error); },
      });
      return phone;
    });
    const drain = async () => {
      let count = 0;
      while (queue.length) {
        assert.ok(++count < 100, "control traffic must settle");
        const packet = queue.shift()!;
        await phones[packet.receiver].service.receive(packet.peer, packet.wire);
      }
    };
    const [a, b] = phones;
    const render = screen(() => ({
      nodeId: b.identity.nodeId, activeGroupId: b.scope,
      groups: scope ? [{ id: scope, name: "Test group" }] : [], people: b.people,
      requests: [], location: { source: "unavailable" }, locationPermission: "denied",
      locationSharing: false, relayEnabled: true, relayRunning: true, bluetooth: "poweredOn",
      map: { status: "ready", progress: 1, bundled: true }, internet: false,
    }), () => now);
    const marker = `data-point="person-${a.identity.nodeId}"`;
    try {
      await Promise.all(phones.map((phone) => phone.repo.initialize()));
      await Promise.all(phones.map((phone, index) => phone.service.connect(peers[index])));
      await drain();
      assert.equal(b.people.find((person) => person.nodeId === a.identity.nodeId)?.connected, true);
      assert.match(render(), /Message Test person 0\. Connected/);
      assert.ok(!render("map").includes(marker), "identity alone must not invent a map coordinate");
      a.location = { latitude: 47.655, longitude: -122.306, capturedAt: now };
      await a.service.announceLocation(); await drain();
      assert.ok(!render().includes(marker), "People remains a focused conversation list without a second map");
      assert.ok(render("map").includes(marker), "signed received location must reach the actual PointAnnotation");
      assert.ok(render("map").includes('data-coordinate="[-122.306,47.655]"'));
      a.location = null;
      now++;
      await a.service.announceLocation(); await drain();
      assert.ok(!render("map").includes(marker), "withdrawal removes pin");
      assert.match(render(), /Message Test person 0\. Connected/);
      a.location = { latitude: 47.655, longitude: -122.306, capturedAt: ++now };
      await a.service.announceLocation(); await drain();
      for (let index = 0; index < phones.length; index++) phones[index].service.disconnect(peers[index]);
      await Promise.all(phones.map((phone) => phone.service.refresh()));
      assert.ok(!render("map").includes(marker), "disconnect removes pin immediately");
      assert.match(render(), /Message Test person 0\. Last seen/);
      now++;
      peers[0] = "c:new"; peers[1] = "p:new";
      await Promise.all(phones.map((phone, index) => phone.service.connect(peers[index])));
      await drain();
      assert.ok(render("map").includes(marker), "fresh signed presence/location on new native session restores pin");
      b.scope = scope ? null : "b".repeat(64);
      b.service.reset(); await b.service.refresh();
      assert.ok(!render("map").includes(marker));
      assert.ok(!render().includes("Message Test person 0"), "other-audience people stay hidden");
      assert.deepEqual(errors, []);
    } finally {
      await Promise.all(phones.map((phone) => phone.service.settle()));
      for (const phone of phones) phone.close();
    }
  });
}


test("Nearby map shows only selected-scope active SOS coordinates and keeps historical reports distinct from peer positions", () => {
  const now = Date.now();
  const base = {
    id: "historical", name: "Requester", originNodeId: "requester", mine: false,
    category: "injured", createdAt: now - 600_000, updatedAt: now,
    status: "active", transport: "received", recipientCount: 0, forwardedCount: 0,
    seenCount: 0, offers: [], pendingUpdate: false,
    location: { source: "device", latitude: 47.65, longitude: -122.30, capturedAt: now - 600_000 },
  };
  const state = {
    nodeId: "me", activeGroupId: null, groups: [], people: [
      { nodeId: "fresh-peer", name: "Fresh peer", scope: null, connected: true, lastSeenAt: now, unreadCount: 0, location: { latitude: 47.65, longitude: -122.30, capturedAt: now } },
      { nodeId: "stale-peer", name: "Stale peer", scope: null, connected: true, lastSeenAt: now, unreadCount: 0, location: { latitude: 47.65, longitude: -122.30, capturedAt: now - 600_000 } },
    ],
    requests: [
      base,
      { ...base, id: "private", groupId: "private-group" },
      { ...base, id: "completed", status: "completed" },
      { ...base, id: "canceled", status: "canceled" },
      { ...base, id: "expired", status: "expired" },
      { ...base, id: "invalid", location: { source: "device", latitude: 91, longitude: 0 } },
      { ...base, id: "no-location", location: { source: "unavailable" } },
    ],
    location: { source: "unavailable" }, locationPermission: "denied", locationSharing: false,
    relayEnabled: true, relayRunning: true, bluetooth: "poweredOn",
    map: { status: "ready", progress: 1, bundled: true }, internet: false,
  };
  const render = screen(() => state, () => now);
  const map = render("map");
  assert.match(map, /data-point="request-historical"/);
  assert.match(map, /SOS reported location/);
  assert.match(map, /data-point="person-fresh-peer"/);
  assert.ok(!map.includes('data-point="person-stale-peer"'), "old SOS reports may persist, but stale peer positions must expire");
  for (const id of ["private", "completed", "canceled", "expired", "invalid", "no-location"]) {
    assert.ok(!map.includes(`data-point="request-${id}"`), `${id} must not create a map marker`);
  }
  assert.ok(!render().includes('data-point="request-historical"'), "People stays the default list");
});


test("explicit map navigation opens Map once and clears its intent without changing the People default", () => {
  const now = Date.now();
  const state = {
    nodeId: "me", activeGroupId: null, groups: [], people: [], requests: [],
    location: { source: "unavailable" }, locationPermission: "denied", locationSharing: false,
    relayEnabled: true, relayRunning: true, bluetooth: "poweredOn",
    map: { status: "ready", progress: 1, bundled: true }, internet: false,
  };
  const route: { view?: string } = { view: "map" };
  const render = screen(() => state, () => now, route);
  assert.match(render(), /Map options/, "Settings intent must open the real map view");
  assert.equal(route.view, undefined, "consumed intent must not keep forcing Map");
  assert.ok(!render("people").includes("Map options"), "choosing People after consumption must stick");
  route.view = "unsupported";
  assert.ok(!render().includes("Map options"), "unrecognized views must not change the default");
});


test("explicit People navigation leaves a selected Map and does not override later manual Map selection", () => {
  const now = Date.now();
  const state = {
    nodeId: "me", activeGroupId: null, groups: [], people: [], requests: [],
    location: { source: "unavailable" }, locationPermission: "denied", locationSharing: false,
    relayEnabled: true, relayRunning: true, bluetooth: "poweredOn",
    map: { status: "ready", progress: 1, bundled: true }, internet: false,
  };
  const route: { view?: string } = {};
  const render = screen(() => state, () => now, route);
  assert.match(render("map"), /Map options/, "start with Map already selected");
  route.view = "people";
  const people = render("map");
  assert.ok(!people.includes("Map options"), "People link must replace the previously selected Map");
  assert.match(people, /Find people/, "People link must render the actual discovery action");
  assert.equal(route.view, undefined, "People intent must be consumed");
  assert.match(render("map"), /Map options/, "manual Map selection must remain after the People intent is consumed");
});

test("Map owns a fixed viewport, People remains scrollable, and explicit history focus clears on generic navigation or audience change", () => {
  const now = Date.now();
  const request = { id: "old", name: "Alex", status: "completed", groupId: null, location: { source: "device", latitude: 47.65, longitude: -122.30, capturedAt: now - 600_000 } };
  const state = {
    nodeId: "me", activeGroupId: null as string | null, groups: [], people: [], requests: [request],
    location: { source: "unavailable" }, locationPermission: "denied", locationSharing: false,
    relayEnabled: true, relayRunning: true, bluetooth: "poweredOn",
    map: { status: "ready", progress: 1, bundled: true }, internet: false,
  };
  const route: { view?: string; requestId?: string } = { view: "map", requestId: "old" };
  const render = screen(() => state, () => now, route);
  const target = render();
  assert.match(target, /data-screen-scroll="false"/);
  assert.match(target, /data-point="request-old"/);
  assert.match(target, /completed reported location/);
  assert.equal(route.requestId, undefined);
  route.view = "map";
  assert.ok(!render("map").includes('data-point="request-old"'), "explicit generic navigation clears history focus");
  route.view = "map"; route.requestId = "old";
  assert.match(render(), /data-point="request-old"/);
  state.activeGroupId = "private";
  assert.ok(!render("map").includes('data-point="request-old"'), "another audience never shows a public historical request");
  state.activeGroupId = null;
  assert.ok(!render("map").includes('data-point="request-old"'), "changing back does not resurrect an old route intent");
  assert.match(render("people"), /data-screen-scroll="true"/);
});
