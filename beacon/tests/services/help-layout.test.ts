import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import type { RequestView } from "../../apps/mobile/src/ui/types.js";

// Render the actual Help screen and request cards. Only native views/context are
// replaced; these checks establish filtering/navigation, not Bluetooth delivery.
function helpScreen(getState: () => any) {
  const presses = new Map<string, () => unknown>();
  const routes: string[] = [];
  const container = ({ children }: any) =>
    React.createElement("div", null, children);
  const text = ({ children }: any) =>
    React.createElement("span", null, children);
  const button = ({ children, accessibilityLabel, onPress }: any) => {
    if (accessibilityLabel) presses.set(accessibilityLabel, onPress);
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
        View: container,
        Text: text,
        Pressable: button,
        StyleSheet: { create: (value: unknown) => value },
      };
    if (name === "expo-router")
      return { router: { push: (path: string) => routes.push(path) } };
    if (name === "lucide-react-native")
      return new Proxy({}, { get: () => () => null });
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/services/BeaconContext"))
      return { useBeacon: getState };
    if (name.endsWith("/components/RequestCard")) return cards;
    if (name === "./ui" || name.endsWith("/components/ui"))
      return {
        Screen: container,
        Heading: text,
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
  const cards = load("../../apps/mobile/src/components/RequestCard.tsx");
  const Home = load("../../apps/mobile/app/(tabs)/index.tsx").default;
  return {
    routes,
    render: () => {
      presses.clear();
      return renderToStaticMarkup(React.createElement(Home));
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
  ui.pressMatching("Change group");
  assert.equal(ui.routes.at(-1), "/groups");
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

test("Help sends only after an explicit SOS action and navigates to the service-created request", async () => {
  const b = state([request("incoming", null)]);
  const sent: unknown[] = [];
  b.sendSOS = async (input) => {
    sent.push(input);
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
  assert.deepEqual(ui.routes, ["/request/created-by-service"]);
});
