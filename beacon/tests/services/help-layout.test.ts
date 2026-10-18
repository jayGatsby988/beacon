import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import type { PersonView, RequestView } from "../../apps/mobile/src/ui/types.js";

// Render actual Home, inline request cards, and connection controls. Native views/context
// are replaced; these checks establish actions/filtering, not Bluetooth delivery.
function helpScreen(getState: () => any) {
  const presses = new Map<string, () => unknown>();
  const routes: Array<string | { pathname: string; params?: Record<string, string> }> = [];
  const nativeActions: string[] = [];
  const pendingActions: Promise<void>[] = [];
  const alerts: Array<{ title: string; message: string; buttons: Array<{ text: string; style?: string; onPress?: () => unknown }> }> = [];
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
        Alert: { alert: (title: string, message: string, buttons: typeof alerts[number]["buttons"]) => alerts.push({ title, message, buttons }) },
        Keyboard: { dismiss: () => { nativeActions.push("dismissKeyboard"); } },
        Linking: { openSettings: async () => { nativeActions.push("openSettings"); } },
        ActivityIndicator: () => null,
        useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
        View: container,
        ScrollView: container,
        Modal: ({ visible, children }: any) => visible ? container({ children }) : null,
        Text: text,
        Pressable: button,
        StyleSheet: { create: (value: unknown) => value },
      };
    if (name === "expo-router")
      return { router: { push: (path: typeof routes[number]) => routes.push(path), replace: (path: typeof routes[number]) => routes.push(path) } };
    if (name === "react-native-svg") return new Proxy({ __esModule: true }, { get: (_target, key) => key === "__esModule" ? true : () => null });
    if (name === "./ConnectionControl" || name.endsWith("/components/ConnectionControl")) return connection;
    if (name === "./LocationCard" || name.endsWith("/components/LocationCard")) return { LocationCard: () => null };
    if (name === "lucide-react-native")
      return new Proxy({}, { get: () => () => null });
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/services/BeaconContext"))
      return { useBeacon: getState };
    if (name.endsWith("/components/RequestCard")) return cards;
    if (name.endsWith("/components/AudiencePicker")) return audience;
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === "./ui" || name.endsWith("/components/ui"))
      return {
        Screen: ({ children, main, showConnection }: any) => React.createElement("div", null, main ? React.createElement(header.default, { brand: text({ children: "Beacon" }), showConnection }) : null, children),
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
        useAction: () => ({
          busy: false,
          run: (action: () => Promise<void>) => {
            const pending = Promise.resolve().then(action);
            pendingActions.push(pending);
            return pending;
          },
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
  const header = load("../../apps/mobile/src/components/MainHeader.tsx");
  const audience = load("../../apps/mobile/src/components/AudiencePicker.tsx");
  const cards = load("../../apps/mobile/src/components/RequestCard.tsx");
  const Screen = load("../../apps/mobile/app/(tabs)/index.tsx").default;
  const invoke = async (handler: () => unknown) => {
    await handler();
    // Native onPress/Alert callbacks intentionally return void. Drain actions they
    // scheduled, including the separate read receipt after a persisted offer.
    while (pendingActions.length) await Promise.all(pendingActions.splice(0));
  };
  return {
    routes,
    nativeActions,
    alerts,
    render: () => {
      presses.clear();
      return renderToStaticMarkup(React.createElement(Screen));
    },
    press: (label: string) => {
      const handler = presses.get(label);
      assert.ok(handler, `Expected accessible action: ${label}`);
      return invoke(handler);
    },
    pressMatching: (part: string) => {
      const match = [...presses].find(([label]) => label.includes(part));
      assert.ok(match, `Expected accessible action containing: ${part}`);
      return invoke(match[1]);
    },
    hasAction: (label: string) => presses.has(label),
    actionLabels: () => [...presses.keys()],
    chooseAlert: (label: string) => {
      const choice = alerts.at(-1)?.buttons.find((button) => button.text === label);
      assert.ok(choice, `Expected alert choice: ${label}`);
      return invoke(() => choice.onPress?.());
    },
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
    markSeen: async (_requestId: string) => {},
    completeRequest: async (_requestId: string) => {},
    cancelRequest: async (_requestId: string) => {},
    activeGroupId: null as string | null,
    groups: [{ id: "group-a", name: "Test group" }],
    requests,
    relayRunning: true,
    bluetooth: "poweredOn",
    sendSOS: async (_input: unknown) => "new-request",
  };
}

test("Home shows incoming active/accepted requests only for the current audience without detail navigation", () => {
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
  assert.ok(ui.actionLabels().every((label) => !label.includes("Open request")));
  assert.deepEqual(ui.routes, []);
  assert.equal(ui.hasAction("Send SOS to: Everyone nearby. Change audience"), true);
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.match(privateHtml, /private-active request note/);
  assert.match(privateHtml, /private-accepted request note/);
  assert.doesNotMatch(
    privateHtml,
    /public-active|public-accepted|other-group|closed-/,
  );
  assert.ok(ui.actionLabels().every((label) => !label.includes("Open request")));
  assert.deepEqual(ui.routes, []);
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
  assert.equal(ui.hasAction("End SOS"), true);
  assert.deepEqual(ui.routes, []);
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.doesNotMatch(privateHtml, /own-public|incoming-public/);
  assert.match(privateHtml, /incoming-private request note/);
  assert.equal(ui.hasAction("Send SOS now"), true);
});

test("Home sends only after an explicit SOS action and keeps the saved request inline", async () => {
  const b = state([request("incoming", null)]);
  const sent: unknown[] = [];
  b.sendSOS = async (input) => {
    sent.push(input);
    b.requests = [...b.requests, request("created-by-service", null, { mine: true, transport: "waiting", recipientCount: 0 })];
    return "created-by-service";
  };
  const ui = helpScreen(() => b);
  ui.render();
  assert.deepEqual(
    sent,
    [],
    "rendering incoming help must never create an outgoing request",
  );
  await ui.press("Send SOS now");
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ category: "other" }]);
  assert.deepEqual(ui.nativeActions, ["dismissKeyboard"]);
  assert.deepEqual(ui.routes, [], "saving an SOS must stay on Home");
  const saved = ui.render();
  assert.match(saved, /Your SOS/);
  assert.equal(ui.hasAction("Send SOS now"), false);
  assert.equal(ui.hasAction("End SOS"), true);
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
  const seen: string[] = [];
  b.offerHelp = async (id) => { offered.push(id); };
  b.markSeen = async (id) => { seen.push(id); };
  const ui = helpScreen(() => b);
  const html = ui.render();
  assert.equal(ui.hasAction("Offer help to eligible"), true);
  for (const id of ["already-offered", "accepted", "assigned", "private"]) {
    assert.equal(ui.hasAction(`Offer help to ${id}`), false);
  }
  assert.match(html, /Offer saved · awaiting acceptance/);
  assert.deepEqual(seen, [], "merely rendering an incoming row must not confirm it was read");
  await ui.press("Offer help to eligible");
  assert.deepEqual(offered, ["eligible"]);
  assert.deepEqual(seen, ["eligible"]);
  assert.deepEqual(ui.routes, [], "offering help must not require opening request details");
});

test("Help reports absence of received requests without claiming absence of people", () => {
  const ui = helpScreen(() => state([]));
  const html = ui.render();
  assert.match(html, /No requests received yet\./);
  assert.doesNotMatch(html, /No users nearby|No requests in your area/);
});


test("Home accepts the named offer directly without a separate request screen", async () => {
  const offers = ["Alex", "Jordan"].map((name) => ({ id: `offer-${name}`, nodeId: `node-${name}`, name, createdAt: 100, accepted: false, assignmentReceived: false }));
  const r = request("own-request", null, { mine: true, offers, location: { source: "device", latitude: 47.65, longitude: -122.30, capturedAt: 100, place: "North entrance" } });
  const b = state([r]);
  const accepted: string[][] = [];
  b.acceptOffer = async (requestId, offerId) => { accepted.push([requestId, offerId]); };
  const ui = helpScreen(() => b);
  const html = ui.render();
  assert.match(html, /Your SOS/);
  assert.equal(ui.hasAction("Reported location"), true);
  assert.deepEqual(accepted, [], "rendering must not accept the first offer implicitly");
  assert.equal(ui.hasAction("Accept offer"), false, "no detached selection action");
  await ui.press("Accept Jordan");
  assert.deepEqual(accepted, [[r.id, "offer-Jordan"]]);
  assert.deepEqual(ui.routes, []);
  r.acceptedOfferId = "offer-Jordan";
  r.status = "accepted";
  ui.render();
  assert.equal(ui.hasAction("Accept Alex"), false);
  assert.equal(ui.hasAction("Accept Jordan"), false);
});

test("Home never exposes accept actions for another requester or a closed SOS", () => {
  const offer = { id: "offer", nodeId: "helper", name: "Alex", createdAt: 100, accepted: false, assignmentReceived: false };
  const r = request("request", null, { offers: [offer] });
  const b = state([r]);
  const ui = helpScreen(() => b);
  ui.render();
  assert.equal(ui.hasAction("Accept Alex"), false);
  r.mine = true;
  for (const status of ["completed", "canceled", "expired"] as const) {
    r.status = status;
    ui.render();
    assert.equal(ui.hasAction("Accept Alex"), false);
  }
});

test("End SOS keeps completion and cancellation behind an explicit choice on Home", async () => {
  for (const status of ["active", "accepted"] as const) {
    for (const choice of ["I no longer need help", "Cancel request"] as const) {
      const r = request(`own-${status}`, null, { mine: true, status });
      const b = state([r]);
      const changes: string[] = [];
      b.completeRequest = async (id) => { changes.push(`complete:${id}`); };
      b.cancelRequest = async (id) => { changes.push(`cancel:${id}`); };
      const ui = helpScreen(() => b);
      ui.render();
      await ui.press("End SOS");
      assert.equal(ui.alerts.at(-1)?.title, "End this SOS?");
      assert.deepEqual(changes, [], "opening the choices must not end the request");
      await ui.chooseAlert("Keep open");
      assert.deepEqual(changes, []);
      await ui.press("End SOS");
      await ui.chooseAlert(choice);
      assert.deepEqual(changes, [`${choice === "Cancel request" ? "cancel" : "complete"}:${r.id}`]);
      assert.deepEqual(ui.routes, [], "ending an SOS must not open another screen");
    }
  }
});

test("inline SOS distinguishes participant receipt from accepted-helper confirmation", () => {
  const offer = { id: "offer", nodeId: "helper", name: "Alex", createdAt: 100, accepted: true, assignmentReceived: false };
  const r = request("own-request", null, { mine: true, transport: "received", recipientCount: 1 });
  const b = state([r]);
  const ui = helpScreen(() => b);
  const received = ui.render();
  assert.match(received, /Received by a participant/);
  assert.doesNotMatch(received, /Volunteer confirmed|Help is on the way/);
  r.status = "accepted";
  r.acceptedOfferId = offer.id;
  r.offers = [offer];
  const accepted = ui.render();
  assert.match(accepted, /Offer accepted/);
  assert.doesNotMatch(accepted, /Volunteer confirmed/);
  offer.assignmentReceived = true;
  assert.match(ui.render(), /Volunteer confirmed/);
});

test("Home retains the current audience's pending terminal update without stale request actions", () => {
  const own = request("own-ended", null, { mine: true, status: "completed", pendingUpdate: true, updatedAt: 200 });
  const privateClosed = request("private-ended", "group-a", { mine: true, status: "canceled", pendingUpdate: true, updatedAt: 300 });
  const b = state([own, privateClosed]);
  const ui = helpScreen(() => b);
  const html = ui.render();
  assert.match(html, /completed|Completed/);
  assert.match(html, /waiting|pending|connect/);
  assert.doesNotMatch(html, /private-ended|Canceled|canceled/);
  assert.equal(ui.hasAction("Send SOS now"), true, "a closed request must not prevent a new SOS");
  assert.equal(ui.hasAction("End SOS"), false);
  assert.ok(ui.actionLabels().every((label) => !label.startsWith("Accept ")));
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.match(privateHtml, /Canceled|canceled/);
  assert.doesNotMatch(privateHtml, /Completed|completed/);
});

test("accepted requester can message only a known contact in the request's current audience", async () => {
  const offer = { id: "offer", nodeId: "helper", name: "Alex", createdAt: 100, accepted: true, assignmentReceived: true };
  const r = request("accepted-request", null, { mine: true, status: "accepted", offers: [offer], acceptedOfferId: offer.id });
  const b = state([r]);
  const person: PersonView = { nodeId: "helper", publicKey: "helper-key", name: "Alex", scope: "other-group", connected: true, lastSeenAt: 100, unreadCount: 0 };
  b.people = [person];
  const ui = helpScreen(() => b);
  assert.match(ui.render(), /Connect with Alex nearby to message/);
  assert.equal(ui.hasAction("Message Alex"), false, "a contact in another audience cannot make this route valid");
  person.scope = null;
  person.connected = false;
  ui.render();
  assert.equal(ui.hasAction("Message Alex"), true, "known disconnected contacts can queue messages");
  await ui.press("Message Alex");
  assert.deepEqual(ui.routes, ["/chat/helper"]);
  b.activeGroupId = "other-group";
  ui.render();
  assert.equal(ui.hasAction("Message Alex"), false);
  b.activeGroupId = null;
  for (const status of ["active", "completed", "canceled", "expired"] as const) {
    r.status = status;
    ui.render();
    assert.equal(ui.hasAction("Message Alex"), false);
  }
});

test("only the accepted helper receives the requester's direct message action", async () => {
  const offer = { id: "offer", nodeId: "self", name: "You", createdAt: 100, accepted: true, assignmentReceived: true };
  const r = request("accepted-request", null, { name: "Quinn", status: "accepted", offers: [offer], acceptedOfferId: offer.id });
  const b = state([r]);
  b.people = [{ nodeId: r.originNodeId, publicKey: "requester-key", name: "Quinn", scope: null, connected: true, lastSeenAt: 100, unreadCount: 0 }];
  const ui = helpScreen(() => b);
  ui.render();
  await ui.press("Message Quinn");
  assert.deepEqual(ui.routes, [`/chat/${r.originNodeId}`]);
  b.nodeId = "another-helper";
  ui.render();
  assert.equal(ui.hasAction("Message Quinn"), false);
});


test("Home header opens Messages and Profile directly without additional tiles", async () => {
  const ui = helpScreen(() => state([]));
  ui.render();
  await ui.press("Messages");
  await ui.press("Profile and settings");
  assert.deepEqual(ui.routes, ["/messages", "/settings"]);
  assert.equal(ui.hasAction("Open nearby map"), false);
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

test("connection counts and Details respect current scope, connection state, and own identity", async () => {
  const b = state([]);
  const person = (nodeId: string, scope: string | null, connected = true): PersonView => ({ nodeId, scope, connected, name: nodeId, publicKey: nodeId, lastSeenAt: 100, unreadCount: 0 });
  b.people = [person("self", null), person("public-person", null), person("disconnected", null, false), person("private-one", "group-a"), person("private-two", "group-a"), person("other-group", "group-b")];
  const ui = helpScreen(() => b);
  ui.render();
  assert.equal(ui.hasAction("Details: 1 person connected"), true);
  await ui.press("Details: 1 person connected");
  assert.deepEqual(ui.routes, ["/network"]);
  b.activeGroupId = "group-a";
  const privateHtml = ui.render();
  assert.equal(ui.hasAction("Details: 2 people connected"), true);
  assert.match(privateHtml, /2 people connected/);
  assert.equal(ui.hasAction("Details: 1 person connected"), false);
  b.bluetooth = "unsupported";
  ui.render();
  await ui.press("Details: Bluetooth unavailable");
  assert.deepEqual(ui.routes, ["/network", "/network"]);
});
