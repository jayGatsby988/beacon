import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { LOCATION_LIMITS } from "../../packages/protocol/src/index.js";
import { CAMPUS_BOUNDS, campusStyle } from "../../apps/mobile/src/components/campusMapStyle.js";

// Execute the real components with persistent hook state and inspect the native
// boundary props. This checks JS reconciliation/camera inputs, not device FPS.
function harness() {
  type Slot = { value?: any; dependencies?: unknown[]; cleanup?: () => void };
  const slots: Slot[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
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
    if (name === "expo-router") return { router: { push: () => {} } };
    if (name === "@beacon/protocol") return { LOCATION_LIMITS };
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/campusMapStyle")) return { CAMPUS_BOUNDS, campusStyle };
    throw new Error(`Unexpected map dependency: ${name}`);
  };
  return {
    load: (relative: string) => {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
      const module = { exports: {} as any };
      runInNewContext(`(function(exports, require, module) { ${code}\n})`, {
        Date,
        setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: (timer: number) => { timers.delete(timer); },
      })(module.exports, require, module);
      return module.exports;
    },
    fireTimeouts: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
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

test("stalled saved map falls back to bundled streets, then offers a working reload if the native map still cannot load", () => {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const initial = { ...props(), map: { status: "ready", progress: 1, bundled: false, styleUrl: "file:///saved-area.json" } };
  assert.match(surface(h.render(NearbyMap, initial)).props.mapKey, /^saved-/);
  h.fireTimeouts();
  const fallback = h.render(NearbyMap, initial);
  assert.equal(surface(fallback).props.mapKey, "bundled");
  h.fireTimeouts();
  const failed = h.render(NearbyMap, initial);
  assert.equal(surface(failed), undefined);
  const reload = find(failed, (node) => node.type === "Pressable" && find(node, (child) => child.type === "Text" && child.props.children === "Reload map"));
  assert.ok(reload, "loading failures must offer recovery instead of a permanent blank map");
  reload.props.onPress();
  assert.match(surface(h.render(NearbyMap, initial)).props.mapKey, /^saved-/);
});

test("manual map pan blocks later discovery and focus refresh from snapping the camera", () => {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const initial = { ...props(), pins: [] };
  const first = surface(h.render(NearbyMap, initial));
  let updates = 0;
  first.props.camera.current = { setCamera: () => updates++, fitBounds: () => updates++ };
  first.props.onReady();
  h.render(NearbyMap, initial);
  assert.equal(updates, 1);
  first.props.onRegionWillChange({ properties: { isUserInteraction: true } });
  first.props.onRegionChange({ geometry: { coordinates: [-122.31, 47.66] }, properties: { isUserInteraction: true, zoomLevel: 17.5 } });
  h.render(NearbyMap, { ...props(), focusRevision: 3 });
  assert.equal(updates, 1, "discovery and returning GPS reports must not fight a manual pan");
  first.props.onFailed();
  h.render(NearbyMap, initial);
});

test("explicit historical request is neutral, focused once, and never confuses a missing location with another person's position", () => {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const request = { id: "old-request", name: "Alex", status: "completed", location: { ...location, longitude: -122.308, capturedAt: at - 600_000 } };
  const initial = { ...props(), requests: [request], focusRequestId: request.id, requestFocusRevision: 1 };
  const first = surface(h.render(NearbyMap, initial));
  const updates: any[] = [];
  first.props.camera.current = { setCamera: (value: any) => updates.push(value), fitBounds: (...value: any[]) => updates.push(value) };
  first.props.onReady();
  h.render(NearbyMap, initial);
  const focused = surface(h.render(NearbyMap, initial));
  const marker = focused.props.markers.find((item: any) => item.id === "request-old-request");
  assert.equal(marker.kind, "history");
  assert.equal(marker.label, "Past");
  assert.equal(marker.selected, true);
  assert.deepEqual(Array.from(updates[0].centerCoordinate), [-122.308, 47.655]);
  focused.props.onRegionWillChange({ properties: { isUserInteraction: true } });
  h.render(NearbyMap, { ...initial, now: at + 30_000, focusRevision: 2 });
  assert.equal(updates.length, 1, "an explicit target centers once; unrelated refreshes preserve panning");
  const unavailable = { ...initial, focusRequestId: "missing", requestFocusRevision: 2 };
  h.render(NearbyMap, unavailable);
  const result = h.render(NearbyMap, unavailable);
  assert.equal(updates.length, 1, "missing target does not fit a different pin");
  assert.ok(find(result, (node) => node.type === "Text" && node.props.children === "This request has no available location in this audience."));
  const cleared = surface(h.render(NearbyMap, { ...initial, focusRequestId: undefined }));
  assert.ok(!cleared.props.markers.some((item: any) => item.id === "request-old-request"), "history pins stay out of the generic map");
});

test("a saved distant area does not hide bundled UW streets at the current location", () => {
  const h = harness();
  const NearbyMap = h.load("../../apps/mobile/src/components/NearbyMap.tsx").default;
  const initial = { ...props(), map: { status: "ready", progress: 1, bundled: false, styleUrl: "file:///elsewhere.json", bounds: [-74.02, 40.7, -73.9, 40.8] } };
  assert.equal(surface(h.render(NearbyMap, initial)).props.mapKey, "bundled");
});
