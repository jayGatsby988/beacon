import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import type { PersonView, RequestView } from "../../apps/mobile/src/ui/types.js";

// Render actual Help, request detail, and connection controls. Native views/context are
// replaced; these checks establish filtering/navigation, not Bluetooth delivery.
function helpScreen(getState: () => any, requestId?: string) {
  const presses = new Map<string, () => unknown>();
  const routes: Array<string | { pathname: string; params?: Record<string, string> }> = [];
  const nativeActions: string[] = [];
  const container = ({ children }: any) =>
    React.createElement("div", null, children);
  const text = ({ children }: any) =>
    React.createElement("span", null, children);
  const button = ({ children, accessibilityLabel, onPress, disabled, busy }: any) => {
    const label = accessibilityLabel ?? React.Children.toArray(children).filter((child) => typeof child === "string" || typeof child === "number").join("");
    if (label && !disabled && !busy) presses.set(label, onPress);
    return React.createElement(
      "button",
      { "aria-label": accessibilityLabel },
      children,
    );
  };
  const require = (name: string): any => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-native")
      return {
        Linking: { openSettings: async () => { nativeActions.push("openSettings"); } },
        ActivityIndicator: () => null,
        Animated: { View: container },
        useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
        View: container,
        ScrollView: container,
        Modal: ({ visible, children }: any) => visible ? container({ children }) : null,
        Text: text,
        TextInput: () => null,
        Pressable: button,
        StyleSheet: { create: (value: unknown) => value },
      };
    if (name === "expo-router")
      return { router: { push: (path: typeof routes[number]) => routes.push(path), replace: (path: typeof routes[number]) => routes.push(path) }, useLocalSearchParams: () => ({ id: requestId }) };
    if (name === "react-native-svg") return new Proxy({ __esModule: true }, { get: (_target, key) => key === "__esModule" ? true : () => null });
    if (name.endsWith("/components/ConnectionControl")) return connection;
    if (name.endsWith("/components/LocationCard")) return { LocationCard: () => null };
    if (name === "lucide-react-native")
      return new Proxy({}, { get: () => () => null });
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/services/BeaconContext"))
      return { useBeacon: getState };
    if (name.endsWith("/components/RequestCard")) return cards;
    if (name.endsWith("/components/AudiencePicker")) return audience;
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === "./Motion" || name.endsWith("/components/Motion")) return { useReducedMotion: () => true, usePressFeedback: () => ({ style: {}, onPressIn: () => {}, onPressOut: () => {} }) };
    if (name === "./ui" || name.endsWith("/components/ui"))
      return {
        Screen: container,
        Heading: text,
        Body: text,
        Button: button,
        TextButton: button,
        StatusLine: text,
        formatTime: () => "10:00 AM",
        formatReportTime: () => "Oct 18, 10:00 AM",
        Field: () => null,
        Pill: button,
        ErrorNotice: ({ message }: any) =>
          message ? text({ children: message }) : null,
        styles: {},
        age: () => "recently",
        useAction: () => ({
          busy: false,
          run: async (action: () => Promise<void>) => action(),
        }),
      };
    throw new Error(`Unexpected Help UI dependency: ${name}`);
  };
  const load = (path: string) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} as any };
    runInNewContext(`(function(exports, require, module) { ${code}\n})`)(
      module.exports,
      require,
      module,
    );
    return module.exports;
  };
  const connection = load("../../apps/mobile/src/components/ConnectionControl.tsx");
  const audience = load("../../apps/mobile/src/components/AudiencePicker.tsx");
  const cards = load("../../apps/mobile/src/components/RequestCard.tsx");
  const Screen = load(requestId ? "../../apps/mobile/app/request/[id].tsx" : "../../apps/mobile/app/(tabs)/index.tsx").default;
  return {
    routes,
    nativeActions,
    render: () => {
      presses.clear();
      return renderToStaticMarkup(React.createElement(Screen));
    },
    press: (label: string) => {
      const handler = presses.get(label);
      assert.ok(handler, `Expected accessible action: ${label}`);
      return handler();
    },
    pressMatching: (part: string) => {
      const match = [...presses].find(([label]) => label.includes(part));
      assert.ok(match, `Expected accessible action containing: ${part}`);
      return match[1]();
    },
    hasAction: (label: string) => presses.has(label),
  };
}
function request(
  id: string,
  groupId: string | null,
  overrides: Partial<RequestView> = {},
): RequestView {
  return {
    id,
    groupId,
    originNodeId: `origin-${id}`,
    name: id,
    mine: false,
    category: "other",
    note: `${id} request note`,
    createdAt: 100,
    updatedAt: 100,
    location: { source: "unavailable" },
    status: "active",
    transport: "received",
    recipientCount: 1,
    forwardedCount: 0,
    seenCount: 0,
    offers: [],
    pendingUpdate: false,
    ...overrides,
  };
}
function state(requests: RequestView[]) {
  return {
    nodeId: "self",
    people: [] as PersonView[],
    findingPeople: false,
    findPeople: async () => {},
    relayEnabled: true,
    requestPermissions: async () => {},
    setRelayEnabled: async (_enabled: boolean) => {},
    acceptOffer: async (_requestId: string, _offerId: string) => {},
    offerHelp: async (_requestId: string) => {},
    activeGroupId: null as string | null,
    groups: [{ id: "group-a", name: "Test group" }],
    requests,
    relayRunning: true,
    bluetooth: "poweredOn",
    sendSOS: async (_input: unknown) => "new-request",
  };
}

test("Help shows incoming active/accepted requests only for the current audience and keeps their detail navigation", () => {
  const b = state([
    request("public-active", null),
    request("public-accepted", null, { status: "accepted" }),
    request("private-active", "group-a"),
    request("private-accepted", "group-a", { status: "accepted" }),
    request("other-group", "group-b"),
    ...(["completed", "canceled", "expired"] as const).map((status) =>
      request(`closed-${status}`, null, { status }),
    ),
  ]);
  const ui = helpScreen(() => b);
  const publicHtml = ui.render();
  assert.match(publicHtml, /public-active request note/);
  assert.match(publicHtml, /public-accepted request note/);
  assert.doesNotMatch(
    publicHtml,
    /private-active|private-accepted|other-group|closed-/,
  );
  ui.pressMatching("public-active");
  assert.deepEqual(ui.routes, ["/request/public-active"]);
  assert.equal(ui.hasAction("Send SOS to: Everyone nearby. Change audience"), true);
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.match(privateHtml, /private-active request note/);
  assert.match(privateHtml, /private-accepted request note/);
  assert.doesNotMatch(
    privateHtml,
    /public-active|public-accepted|other-group|closed-/,
  );
  ui.pressMatching("private-accepted");
  assert.equal(ui.routes.at(-1), "/request/private-accepted");
});

test("an existing own SOS keeps incoming requests accessible and suppresses a duplicate send only in its audience", () => {
  const b = state([
    request("own-public", null, { mine: true }),
    request("incoming-public", null),
    request("incoming-private", "group-a"),
  ]);
  const ui = helpScreen(() => b);
  const html = ui.render();
  assert.match(html, /own-public request note/);
  assert.match(html, /incoming-public request note/);
  assert.equal(ui.hasAction("Send SOS now"), false);
  ui.pressMatching(", You,");
  assert.equal(ui.routes.at(-1), "/request/own-public");
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.doesNotMatch(privateHtml, /own-public|incoming-public/);
  assert.match(privateHtml, /incoming-private request note/);
  assert.equal(ui.hasAction("Send SOS now"), true);
});

test("Help sends in one tap without a details step and waits for the saved request before navigating", async () => {
  const b = state([request("incoming", null)]);
  const sent: unknown[] = [];
  let finishSave!: (id: string) => void;
  const saved = new Promise<string>((resolve) => { finishSave = resolve; });
  b.sendSOS = async (input) => {
    sent.push(input);
    return saved;
  };
  const ui = helpScreen(() => b);
  const html = ui.render();
  assert.doesNotMatch(html, /Add details|Optional details|Continue to SOS/);
  assert.equal(ui.hasAction("Add details"), false);
  assert.deepEqual(
    sent,
    [],
    "rendering incoming help must never create an outgoing request",
  );
  const sending = ui.press("Send SOS now");
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ category: "other" }]);
  assert.deepEqual(ui.routes, [], "do not show a request before it is saved");
  finishSave("created-by-service");
  await sending;
  assert.deepEqual(ui.routes, ["/request/created-by-service"]);
});


test("incoming cards offer help directly only while open and unassigned", async () => {
  const ownOffer = { id: "offer-self", nodeId: "self", name: "You", createdAt: 100, accepted: false, assignmentReceived: false };
  const b = state([
    request("eligible", null),
    request("already-offered", null, { offers: [ownOffer] }),
    request("accepted", null, { status: "accepted" }),
    request("assigned", null, { acceptedOfferId: "someone-else" }),
    request("private", "group-a"),
  ]);
  const offered: string[] = [];
  b.offerHelp = async (id) => { offered.push(id); };
  const ui = helpScreen(() => b);
  const html = ui.render();
  assert.equal(ui.hasAction("Offer help to eligible"), true);
  for (const id of ["already-offered", "accepted", "assigned", "private"]) {
    assert.equal(ui.hasAction(`Offer help to ${id}`), false);
  }
  assert.match(html, /Offer saved · awaiting acceptance/);
  await ui.press("Offer help to eligible");
  assert.deepEqual(offered, ["eligible"]);
  assert.deepEqual(ui.routes, [], "offering help must not require opening request details");
});

test("Help reports absence of received requests without claiming absence of people", () => {
  const ui = helpScreen(() => state([]));
  const html = ui.render();
  assert.match(html, /No requests received yet\./);
  assert.doesNotMatch(html, /No users nearby|No requests in your area/);
});


test("request details accept the named offer directly and show location before actions", async () => {
  const offers = ["Alex", "Jordan"].map((name) => ({ id: `offer-${name}`, nodeId: `node-${name}`, name, createdAt: 100, accepted: false, assignmentReceived: false }));
  const r = request("own-request", null, { mine: true, offers, location: { source: "device", latitude: 47.65, longitude: -122.30, capturedAt: 100, place: "North entrance" } });
  const b = state([r]);
  const accepted: string[][] = [];
  b.acceptOffer = async (requestId, offerId) => { accepted.push([requestId, offerId]); };
  const ui = helpScreen(() => b, r.id);
  const html = ui.render();
  assert.match(html, /North entrance/);
  assert.match(html, /Not live/);
  assert.ok(html.indexOf("North entrance") < html.indexOf("Accept Alex"));
  assert.deepEqual(accepted, [], "rendering must not accept the first offer implicitly");
  assert.equal(ui.hasAction("Accept offer"), false, "no detached selection action");
  await ui.press("Accept Jordan");
  assert.deepEqual(accepted, [[r.id, "offer-Jordan"]]);
  r.acceptedOfferId = "offer-Jordan";
  r.status = "accepted";
  ui.render();
  assert.equal(ui.hasAction("Accept Alex"), false);
  assert.equal(ui.hasAction("Accept Jordan"), false);
});

test("request details never expose accept actions for another requester or a closed SOS", () => {
  const offer = { id: "offer", nodeId: "helper", name: "Alex", createdAt: 100, accepted: false, assignmentReceived: false };
  const r = request("request", null, { offers: [offer] });
  const b = state([r]);
  const ui = helpScreen(() => b, r.id);
  ui.render();
  assert.equal(ui.hasAction("Accept Alex"), false);
  r.mine = true;
  for (const status of ["completed", "canceled", "expired"] as const) {
    r.status = status;
    ui.render();
    assert.equal(ui.hasAction("Accept Alex"), false);
  }
});

test("request location opens the shared map directly with the selected request", async () => {
  const r = request("located-request", null, { location: { source: "device", latitude: 47.65, longitude: -122.30, capturedAt: 100, place: "North entrance" } });
  const ui = helpScreen(() => state([r]), r.id);
  const html = ui.render();
  assert.match(html, /North entrance/);
  assert.match(html, /Not live/);
  assert.deepEqual(ui.routes, [], "viewing request details must not automatically leave the request");
  assert.equal(ui.hasAction("Location map"), false, "no intermediate map disclosure");
  await ui.press("View location on map");
  assert.deepEqual(JSON.parse(JSON.stringify(ui.routes)), [
    { pathname: "/(tabs)/nearby", params: { view: "map", requestId: r.id } },
  ]);
});

test("requests without a fix explain missing location without opening an empty map", () => {
  const r = request("no-location", null, { note: "", location: { source: "unavailable" } });
  const ui = helpScreen(() => state([r]), r.id);
  assert.match(ui.render(), /No location attached/);
  assert.equal(ui.hasAction("View location on map"), false);
  assert.equal(ui.hasAction("Offer help"), true, "missing GPS does not block helping");

  r.location = { source: "manual", place: "Library entrance" };
  const namedPlace = ui.render();
  assert.match(namedPlace, /Library entrance/);
  assert.doesNotMatch(namedPlace, /No location attached/);
  assert.equal(ui.hasAction("View location on map"), false, "a place description alone has no map coordinate");
});

test("closed request titles remain neutral and preserve their actual final status", () => {
  const r = request("history", null, { name: "Maya" });
  const ui = helpScreen(() => state([r]), r.id);
  assert.match(ui.render(), /Maya needs help/);
  for (const status of ["completed", "canceled", "expired"] as const) {
    r.status = status;
    const html = ui.render();
    assert.match(html, /Maya’s request/);
    assert.doesNotMatch(html, /Maya needs help/);
    assert.match(html, new RegExp(status[0].toUpperCase() + status.slice(1)));
    assert.equal(ui.hasAction("Offer help"), false);
  }
  r.mine = true;
  assert.match(ui.render(), /Your request/);
});

test("an incoming request opens the named requester chat only in the matching audience", async () => {
  const r = request("incoming", "group-a", { name: "Maya" });
  const b = state([r]);
  b.activeGroupId = "group-a";
  const maya: PersonView = { nodeId: r.originNodeId, name: "Maya", publicKey: "maya-key", scope: "group-a", connected: false, lastSeenAt: 100, unreadCount: 0 };
  b.people = [maya];
  const ui = helpScreen(() => b, r.id);
  ui.render();
  assert.deepEqual(ui.routes, [], "rendering must not open a conversation");
  await ui.press("Message Maya");
  assert.deepEqual(ui.routes, [`/chat/${r.originNodeId}`]);

  b.people = [{ ...maya, scope: "group-b" }];
  ui.render();
  assert.equal(ui.hasAction("Message Maya"), false, "a person from another audience is not a chat target");

  b.activeGroupId = "group-b";
  ui.render();
  assert.equal(ui.hasAction("Message Maya"), false, "changing audiences must not reinterpret the request's conversation");

  b.activeGroupId = "group-a";
  b.people = [];
  ui.render();
  assert.equal(ui.hasAction("Message Maya"), false, "a relayed SOS without a known person must not open an unusable chat");
});

test("an own request messages only its accepted helper and hides chat after closure", async () => {
  const offers = ["Alex", "Jordan"].map((name) => ({ id: `offer-${name}`, nodeId: `node-${name}`, name, createdAt: 100, accepted: false, assignmentReceived: false }));
  const r = request("own", null, { mine: true, offers });
  const b = state([r]);
  b.people = offers.map((offer) => ({ nodeId: offer.nodeId, name: offer.name, publicKey: offer.nodeId, scope: null, connected: true, lastSeenAt: 100, unreadCount: 0 }));
  const ui = helpScreen(() => b, r.id);
  ui.render();
  assert.equal(ui.hasAction("Message Alex"), false);
  assert.equal(ui.hasAction("Message Jordan"), false);

  r.acceptedOfferId = "offer-Jordan";
  r.status = "accepted";
  ui.render();
  assert.equal(ui.hasAction("Message Alex"), false, "the unaccepted helper must not become the conversation target");
  await ui.press("Message Jordan");
  assert.deepEqual(ui.routes, ["/chat/node-Jordan"]);

  b.people = b.people.filter((person) => person.nodeId !== "node-Jordan");
  ui.render();
  assert.equal(ui.hasAction("Message Jordan"), false, "an accepted offer alone does not establish a direct chat peer");

  b.people.push({ nodeId: "node-Jordan", name: "Jordan", publicKey: "jordan-key", scope: null, connected: false, lastSeenAt: 100, unreadCount: 0 });
  for (const status of ["completed", "canceled", "expired"] as const) {
    r.status = status;
    ui.render();
    assert.equal(ui.hasAction("Message Jordan"), false, `${status} requests do not retain an active-help action`);
  }
});


test("Home shortcuts explicitly choose the People and Map views", () => {
  const ui = helpScreen(() => state([]));
  ui.render();
  ui.press("Find and message nearby people");
  ui.press("Open nearby map");
  assert.deepEqual(JSON.parse(JSON.stringify(ui.routes)), [
    { pathname: "/(tabs)/nearby", params: { view: "people" } },
    { pathname: "/(tabs)/nearby", params: { view: "map" } },
  ]);
});

test("connection recovery resumes sharing and discovers people directly", async () => {
  const b = state([]);
  const resumed: boolean[] = [];
  let discoveries = 0;
  let permissions = 0;
  b.setRelayEnabled = async (enabled) => { resumed.push(enabled); };
  b.findPeople = async () => { discoveries++; };
  b.requestPermissions = async () => { permissions++; };
  b.relayEnabled = false;
  const ui = helpScreen(() => b);
  ui.render();
  await ui.press("Resume: Nearby is paused");
  assert.deepEqual(resumed, [true]);
  assert.equal(discoveries, 0);
  b.relayEnabled = true;
  ui.render();
  await ui.press("Find: No one connected yet");
  assert.equal(discoveries, 1);
  assert.equal(permissions, 0, "connection recovery must not request unrelated location permissions");
  assert.deepEqual(ui.routes, [], "recovery does not require navigating through Profile");
  b.findingPeople = true;
  const findingHtml = ui.render();
  assert.match(findingHtml, /Looking nearby/);
  assert.equal(ui.hasAction("Find: Looking nearby…"), false, "ongoing discovery disables another recovery action");
});

test("connection recovery opens phone settings for Bluetooth OS gates", async () => {
  const b = state([]);
  let discoveries = 0;
  let resumes = 0;
  b.findPeople = async () => { discoveries++; };
  b.setRelayEnabled = async () => { resumes++; };
  const ui = helpScreen(() => b);
  for (const [bluetooth, status] of [["poweredOff", "Bluetooth is off"], ["unauthorized", "Bluetooth access needed"]]) {
    b.bluetooth = bluetooth;
    b.relayEnabled = false;
    ui.render();
    await ui.press(`Settings: ${status}`);
  }
  assert.deepEqual(ui.nativeActions, ["openSettings", "openSettings"]);
  assert.equal(discoveries, 0);
  assert.equal(resumes, 0, "OS gate takes precedence over resuming sharing");
});

test("connection counts and Details respect current scope, connection state, and own identity", () => {
  const b = state([]);
  const person = (nodeId: string, scope: string | null, connected = true): PersonView => ({ nodeId, scope, connected, name: nodeId, publicKey: nodeId, lastSeenAt: 100, unreadCount: 0 });
  b.people = [person("self", null), person("public-person", null), person("disconnected", null, false), person("private-one", "group-a"), person("private-two", "group-a"), person("other-group", "group-b")];
  const ui = helpScreen(() => b);
  ui.render();
  assert.equal(ui.hasAction("Details: 1 person connected"), true);
  ui.press("Details: 1 person connected");
  assert.deepEqual(ui.routes, ["/network"]);
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.equal(ui.hasAction("Details: 2 people connected"), true);
  assert.match(privateHtml, /2 connected/);
  assert.equal(ui.hasAction("Details: 1 person connected"), false);
  b.bluetooth = "unsupported";
  ui.render();
  ui.press("Details: Bluetooth unavailable");
  assert.deepEqual(ui.routes, ["/network", "/network"]);
});
