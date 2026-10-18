import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as policy from "../../apps/mobile/src/services/ServicePolicy.js";

// Actual screens with native views and hooks replaced. This checks actions and
// credential presentation; persistence/isolation is exercised by the service suite.
function fixture(page = "incident") {
  const values: unknown[] = [];
  let hook = 0;
  const fields = new Map<string, any>();
  const buttons = new Map<string, any>();
  const routes: string[] = [];
  const saves: any[] = [];
  let alert: { message: string; actions: any[] } | undefined;
  let pending: Promise<void> | undefined;
  let syncs = 0;
  const b = {
    loading: false, displayName: "Synthetic", nodeId: "a".repeat(64),
    cloudConnection: { url: "", incidentId: "" },
    sync: { status: "disabled", pendingCount: 3 }, events: [],
    syncNow: async () => { syncs++; },
    saveSettings: async (input: any) => {
      saves.push(input);
      b.cloudConnection = { url: input.cloudUrl, incidentId: input.incidentId };
      b.sync.status = input.cloudUrl ? "idle" : "disabled";
    },
  };
  const text = ({ children }: any) => React.createElement("span", null, children);
  const container = ({ children }: any) => React.createElement("div", null, children);
  const button = (props: any) => {
    const label = props.accessibilityLabel ?? props.children;
    buttons.set(label, props);
    return React.createElement("button", null, props.children);
  };
  const require = (name: string): any => {
    if (name === "react") return { ...React, useState: (initial: unknown) => {
      const index = hook++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (value: unknown) => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
    } };
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-native") return { Text: text, View: container, Pressable: button,
      Alert: { alert: (_title: string, message: string, actions: any[]) => { alert = { message, actions }; } } };
    if (name === "expo-router") return { router: { push: (route: string) => routes.push(route) } };
    if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/services/BeaconContext")) return { useBeacon: () => b };
    if (name.endsWith("/services/ServicePolicy")) return policy;
    if (name.endsWith("/components/ui")) return {
      Screen: container, Card: container, Body: text, Label: text, Heading: text,
      Divider: () => null, Button: button, Pill: button, ErrorNotice: () => null, styles: {},
      Field: (props: any) => { fields.set(props.label, props); return React.createElement("input", { "aria-label": props.label }); },
      useAction: () => ({ busy: false, run: (action: () => Promise<void>) => { pending = action(); return pending; } }),
    };
    throw new Error(`Unexpected incident UI dependency: ${name}`);
  };
  const code = ts.transpileModule(readFileSync(new URL(`../../apps/mobile/app/${page}.tsx`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  runInNewContext(`(function(exports, require, module) { ${code}\n})`)(module.exports, require, module);
  return {
    b, fields, saves, routes,
    get alert() { return alert; }, get syncs() { return syncs; },
    render: () => { hook = 0; fields.clear(); buttons.clear(); return renderToStaticMarkup(React.createElement(module.exports.default)); },
    enter: (label: string, value: string) => { const field = fields.get(label); assert.ok(field); field.onChangeText(value); },
    press: (label: string) => { const action = buttons.get(label); assert.ok(action, `Expected ${label}`); assert.ok(!action.disabled && !action.busy); return action.onPress(); },
    settle: () => pending,
  };
}

test("History opens the incident form; setup validates before saving and never starts sync", async () => {
  const history = fixture("history");
  history.render(); history.press("Connect an incident");
  assert.deepEqual(history.routes, ["/incident"]);
  const ui = fixture();
  assert.match(ui.render(), new RegExp(ui.b.nodeId));
  assert.equal(ui.fields.get("Access token").secureTextEntry, true);
  ui.enter("HTTPS server URL", "http://insecure.example.org");
  ui.enter("Incident ID", "drill");
  ui.enter("Access token", "t".repeat(43));
  ui.render();
  await assert.rejects(ui.press("Save connection"), /HTTPS/);
  assert.equal(ui.saves.length, 0);
  ui.enter("HTTPS server URL", " https://beacon.example.org/ "); ui.render();
  await ui.press("Save connection");
  assert.deepEqual(JSON.parse(JSON.stringify(ui.saves)), [{ displayName: "Synthetic", cloudUrl: "https://beacon.example.org", incidentId: "drill", accessToken: "t".repeat(43) }]);
  assert.equal(ui.syncs, 0);
  ui.render();
  assert.equal(ui.fields.get("New access token").value, "");
});

test("existing connections never reveal the token and explicit disconnect preserves the pending count", async () => {
  const ui = fixture();
  ui.b.cloudConnection = { url: "https://beacon.example.org", incidentId: "drill" };
  ui.b.sync.status = "idle";
  ui.render();
  assert.equal(ui.fields.get("New access token").value, "");
  assert.equal(ui.fields.get("New access token").secureTextEntry, true);
  assert.equal(ui.saves.length, 0);
  ui.press("Disconnect incident");
  assert.match(ui.alert!.message, /3 pending uploads stay saved/);
  assert.equal(ui.saves.length, 0, "disconnect waits for the explicit confirmation");
  ui.alert!.actions.find((action) => action.text === "Disconnect").onPress();
  await ui.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.saves)), [{ displayName: "Synthetic", cloudUrl: "", incidentId: "", accessToken: "" }]);
  assert.equal(ui.b.sync.pendingCount, 3);
  assert.equal(ui.syncs, 0);
});
