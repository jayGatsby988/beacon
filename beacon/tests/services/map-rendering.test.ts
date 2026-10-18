import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { LOCATION_LIMITS } from "../../packages/protocol/src/index.js";
import { CAMPUS_BOUNDS, campusStyle } from "../../apps/mobile/src/components/campusMapStyle.js";
import type { HelpOffer, PersonView, RequestView } from "../../apps/mobile/src/ui/types.js";

// Execute the real components with persistent hook state and inspect the native
// boundary props. This checks JS reconciliation/camera inputs, not device FPS.
function harness() {
  type Slot = { value?: any; dependencies?: unknown[]; cleanup?: () => void };
  const slots: Slot[] = [];
  const routes: string[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  const unchanged = (before?: unknown[], after?: unknown[]) => !!before && !!after && before.length === after.length && before.every((item, index) => Object.is(item, after[index]));
  const hooks = {
    ...React,
    useState: (initial: any) => {
      const cell = slot();
      if (!("value" in cell)) cell.value = typeof initial === "function" ? initial() : initial;
      return [cell.value, (next: any) => { cell.value = typeof next === "function" ? next(cell.value) : next; }];
    },
    useRef: (initial: any) => {
      const cell = slot();
      return cell.value ??= { current: initial };
    },
    useMemo: (make: () => any, dependencies: unknown[]) => {
      const cell = slot();
      if (!unchanged(cell.dependencies, dependencies)) {
        cell.value = make();
        cell.dependencies = dependencies;
      }
      return cell.value;
    },
    useCallback: (callback: (...args: any[]) => any, dependencies: unknown[]) => hooks.useMemo(() => callback, dependencies),
    useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
      const cell = slot();
      if (!unchanged(cell.dependencies, dependencies)) {
        cell.dependencies = dependencies;
        effects.push(() => { cell.cleanup?.(); cell.cleanup = effect() || undefined; });
      }
    },
  };
  const require = (name: string): any => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-native") return {
      View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", Linking: {},
      StyleSheet: { create: (value: unknown) => value },
    };
    if (name === "@maplibre/maplibre-react-native") return { __esModule: true, default: { MapView: "MapView", Camera: "Camera", PointAnnotation: "PointAnnotation", ShapeSource: "ShapeSource", CircleLayer: "CircleLayer" } };
    if (name === "lucide-react-native") return new Proxy({}, { get: (_target, key) => String(key) });
    if (name === "expo-router") return { router: { push: (route: string) => { routes.push(route); } } };
    if (name === "@beacon/protocol") return { LOCATION_LIMITS };
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/campusMapStyle")) return { CAMPUS_BOUNDS, campusStyle };
    throw new Error(`Unexpected map dependency: ${name}`);
  };
  return {
    routes,
    load: (relative: string) => {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
      const module = { exports: {} as any };
      runInNewContext(`(function(exports, require, module) { ${code}\n})`, { Date, setTimeout, clearTimeout })(module.exports, require, module);
      return module.exports;
    },
    render: (component: (props: any) => any, props: any) => {
      cursor = 0;
      effects = [];
      const tree = component(props);
      for (const effect of effects) effect();
      return tree;
    },
  };
}
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const surface = (tree: any) => find(tree, (node) => node.type?.type?.name === "MapSurface");
const at = 1_000_000;
const location = { source: "device", latitude: 47.655, longitude: -122.306, capturedAt: at, accuracy: 5 };
const props = () => ({
  ownLocation: location, focusRevision: 0,
  pins: [{ nodeId: "peer", name: "Peer", location: { ...location } }],
  requests: [], connectedCount: 1, internet: false,
  map: { status: "ready", progress: 1, bundled: true },
  onLocate: async () => location, now: at, height: 220,
});
const offer = (overrides: Partial<HelpOffer> = {}): HelpOffer => ({
  id: "offer", nodeId: "helper", name: "Helper", createdAt: at,
  accepted: false, assignmentReceived: false, ...overrides,
});
const request = (overrides: Partial<RequestView> = {}): RequestView => ({
  id: "sos", originNodeId: "requester", name: "Requester", mine: false,
  groupId: "group", category: "other", createdAt: at, updatedAt: at,
  location: { ...location, source: "device" }, status: "active", transport: "received",
  recipientCount: 1, forwardedCount: 0, seenCount: 0, offers: [], pendingUpdate: false,
  ...overrides,
});
const person = (nodeId: string, scope = "group"): PersonView => ({
  nodeId, scope, publicKey: `key-${nodeId}`, name: nodeId,
  connected: true, lastSeenAt: at, unreadCount: 0,
});
function content(tree: any): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.Children.toArray(tree?.props?.children).map(content).join("");
}
const button = (tree: any, label: string) => find(tree, (node) =>
  node.type === "Pressable" && (node.props.accessibilityLabel === label || content(node) === label),
);
function requestPreview(requests: RequestView[], options: Record<string, unknown> = {}) {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const input = { ...props(), requests, nodeId: "self", activeGroupId: "group", ...options };
  const render = () => h.render(NearbyMap, input);
  surface(render()).props.onSelect("request", `request-${requests[0].id}`);
  return { ...h, render };
}

test("map age ticks, unchanged GPS reports, download progress and pans do not redraw the native map surface", () => {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const initial = props();
  const first = surface(h.render(NearbyMap, initial));
  const nextTree = h.render(NearbyMap, {
    ...initial, now: at + 30_000,
    ownLocation: { ...location, capturedAt: at + 30_000, accuracy: 10 },
    pins: [{ ...initial.pins[0], location: { ...location, capturedAt: at + 30_000 } }],
    map: { ...initial.map, status: "downloading", progress: 0.5 },
  });
  const next = surface(nextTree);
  const ownCaption = find(nextTree, (node) => node.type === "Text" && React.Children.toArray(node.props.children).join("").startsWith("Your location"));
  assert.match(React.Children.toArray(ownCaption.props.children).join(""), /±10 m/, "own GPS uncertainty remains visible without redrawing native markers");
  assert.equal(first.type.compare(first.props, next.props), true);
  next.props.onRegionChange({ geometry: { coordinates: [-122.31, 47.66] } });
  const panned = surface(h.render(NearbyMap, initial));
  assert.equal(first.type.compare(first.props, panned.props), true);
});

test("pin moves, renames, selections and expiry still update the native map surface", () => {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const initial = props();
  const first = surface(h.render(NearbyMap, initial));
  for (const pin of [
    { ...initial.pins[0], name: "New name" },
    { ...initial.pins[0], location: { ...location, longitude: -122.307 } },
  ]) {
    const changed = surface(h.render(NearbyMap, { ...initial, pins: [pin] }));
    assert.equal(first.type.compare(first.props, changed.props), false);
  }
  first.props.onSelect("person", "person-peer");
  const selected = surface(h.render(NearbyMap, initial));
  assert.equal(first.type.compare(first.props, selected.props), false);
  assert.equal(selected.props.markers.find((marker: any) => marker.id === "person-peer").selected, true);
  const expired = surface(h.render(NearbyMap, { ...initial, now: at + LOCATION_LIMITS.ttlMs }));
  assert.equal(first.type.compare(first.props, expired.props), false);
  assert.equal(expired.props.markers.length, 0);
});

test("map clocks retain exact expiry without second-by-second work and only focus revisions refit a ready camera", () => {
  const h = harness();
  const module = h.load("../../apps/mobile/src/components/NearbyMap.tsx");
  assert.equal(module.locationRefreshDelay([location], at), 30_000);
  assert.equal(module.locationRefreshDelay([location], at + LOCATION_LIMITS.ttlMs - 7), 7);
  assert.equal(module.locationRefreshDelay([location], at + LOCATION_LIMITS.ttlMs), 30_000);
  const future = { ...location, capturedAt: at + LOCATION_LIMITS.futureSkewMs + 9 };
  assert.equal(module.locationRefreshDelay([future], at), 9);
  const initial = props();
  const first = surface(h.render(module.default, initial));
  let cameraUpdates = 0;
  first.props.camera.current = { setCamera: () => cameraUpdates++, fitBounds: () => cameraUpdates++ };
  first.props.onReady();
  h.render(module.default, initial);
  assert.equal(cameraUpdates, 1);
  h.render(module.default, { ...initial, now: at + 30_000 });
  h.render(module.default, { ...initial, now: at + 60_000 });
  assert.equal(cameraUpdates, 1, "age ticks preserve a user's map pan");
  h.render(module.default, { ...initial, focusRevision: 1 });
  assert.equal(cameraUpdates, 2, "a new focused fix still recenters once");
});

test("request camera and point source stay stable across unrelated map/request updates", () => {
  const h = harness();
  const RequestMap = h.load("../../apps/mobile/src/services/RequestMap.tsx").default.type;
  const first = h.render(RequestMap, { location, map: props().map });
  const next = h.render(RequestMap, { location: { ...location, capturedAt: at + 1000 }, map: { ...props().map, progress: 0.5 } });
  const camera = (tree: any) => find(tree, (node) => node.type === "Camera").props.centerCoordinate;
  const shape = (tree: any) => find(tree, (node) => node.type === "ShapeSource").props.shape;
  assert.equal(camera(first), camera(next), "stable coordinates avoid the SDK's nativeStop effect");
  assert.equal(shape(first), shape(next));
  const moved = h.render(RequestMap, { location: { ...location, longitude: -122.307 }, map: props().map });
  assert.notEqual(camera(first), camera(moved));
  assert.notEqual(shape(first), shape(moved));
});

test("map offers help inline only for an eligible incoming request in the active audience", async () => {
  const offered: string[] = [];
  const onOfferHelp = async (requestId: string) => { offered.push(requestId); };
  const h = requestPreview([request()], { onOfferHelp });
  const action = button(h.render(), "Offer help to Requester");
  assert.ok(action, "an active incoming request can be answered from its map pin");
  action.props.onPress();
  await Promise.resolve();
  assert.deepEqual(offered, ["sos"]);
  assert.deepEqual(h.routes, [], "offering does not leave the map");

  const ineligible: [string, RequestView][] = [
    ["own request", request({ mine: true, originNodeId: "self" })],
    ["existing offer", request({ offers: [offer({ nodeId: "self" })] })],
    ["accepted assignment", request({ acceptedOfferId: "offer", offers: [offer()] })],
    ["accepted request", request({ status: "accepted" })],
    ["closed request", request({ status: "completed" })],
    ["other private audience", request({ groupId: "other-group" })],
    ["public request while a group is selected", request({ groupId: null })],
  ];
  for (const [reason, item] of ineligible) {
    const blocked = requestPreview([item], { onOfferHelp });
    const tree = blocked.render();
    assert.equal(button(tree, "Offer help to Requester"), undefined, reason);
    if (item.groupId !== "group" || item.status === "completed") {
      assert.equal(surface(tree).props.markers.some((marker: any) => marker.kind === "request"), false, `${reason} must not expose a map pin`);
    }
  }
  assert.deepEqual(offered, ["sos"]);
});

test("map blocks repeated offer taps while saving and releases the action after failure", async () => {
  let rejectOffer!: (error: Error) => void;
  let calls = 0;
  const pending = new Promise<void>((_resolve, reject) => { rejectOffer = reject; });
  const h = requestPreview([request()], { onOfferHelp: () => { calls++; return pending; } });
  const action = button(h.render(), "Offer help to Requester");
  action.props.onPress();
  action.props.onPress();
  assert.equal(calls, 1, "the ref guard also blocks a tap before React renders the busy state");
  const busy = button(h.render(), "Offer help to Requester");
  assert.equal(busy.props.disabled, true);
  assert.equal(busy.props.accessibilityState.busy, true);
  rejectOffer(new Error("Disconnected"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const failed = h.render();
  assert.equal(button(failed, "Offer help to Requester").props.disabled, false);
  assert.ok(find(failed, (node) => node.props?.accessibilityLiveRegion === "polite" && /Could not offer help|Disconnected/.test(content(node))), "a failed offer is visible and can be retried");
  assert.deepEqual(h.routes, []);
});

test("map messages only the accepted participant with a known contact in the request audience", () => {
  const cases = [
    { label: "requester", mine: true, helper: "helper", contact: "helper" },
    { label: "accepted helper", mine: false, helper: "self", contact: "requester" },
  ];
  for (const item of cases) {
    const accepted = request({ mine: item.mine, status: "accepted", acceptedOfferId: "offer", offers: [offer({ nodeId: item.helper, accepted: true })] });
    const h = requestPreview([accepted], { people: [person(item.contact)] });
    const message = button(h.render(), `Message ${item.contact}`);
    assert.ok(message, `${item.label} can message the other accepted participant`);
    message.props.onPress();
    assert.deepEqual(h.routes, [`/chat/${item.contact}`]);

    for (const people of [[], [person(item.contact, "other-group")]]) {
      const blocked = requestPreview([accepted], { people });
      assert.equal(button(blocked.render(), `Message ${item.contact}`), undefined, "missing or differently scoped contacts cannot be opened");
      assert.deepEqual(blocked.routes, []);
    }
  }
  const bystander = requestPreview([request({ status: "accepted", acceptedOfferId: "offer", offers: [offer({ accepted: true })] })], { people: [person("requester"), person("helper")] });
  assert.equal(button(bystander.render(), "Message"), undefined, "another volunteer cannot use an accepted participant's action");
  assert.deepEqual(bystander.routes, []);
});

test("an own SOS map preview opens the Help tab without a separate details route", () => {
  const h = requestPreview([request({ mine: true, originNodeId: "self" })]);
  const action = button(h.render(), "View on Help");
  assert.ok(action);
  action.props.onPress();
  assert.deepEqual(h.routes, ["/(tabs)"]);
});
