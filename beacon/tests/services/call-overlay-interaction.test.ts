import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

// Exercise real overlay handlers with a pending best-effort Bluetooth hangup.
// A terminal call must remain dismissible even if its old send has not settled.
function renderCall(status: "active" | "ended", ending = false) {
  const buttons = new Map<string, { disabled: boolean; onPress: () => unknown }>();
  const actions: string[] = [];
  let actionIndex = 0;
  const container = ({ children }: any) => React.createElement("div", null, children);
  const state = {
    call: { id: "call-A", peerName: "Alex", direction: "outgoing", status, muted: false, speaker: false },
    dismissCall: async (id: string) => { actions.push(`dismiss:${id}`); },
    endCall: async (id: string) => { actions.push(`end:${id}`); },
    declineCall: async (id: string) => { actions.push(`decline:${id}`); },
    acceptCall: async (id: string) => { actions.push(`accept:${id}`); },
    setCallMuted: async () => {},
    setCallSpeaker: async () => {},
  };
  const require = (name: string): any => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-native") return {
      Modal: container, ScrollView: container, Text: container, View: container,
      Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) => {
        buttons.set(accessibilityLabel, { onPress, disabled });
        return container({ children });
      },
      StyleSheet: { create: (value: unknown) => value },
    };
    if (name === "react-native-safe-area-context") return { SafeAreaView: container };
    if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
    if (name === "../services/BeaconContext") return { useBeacon: () => state };
    if (name === "../theme/tokens") return { colors: {}, fonts: {} };
    if (name === "./ui") return {
      Body: container, Heading: container, ErrorNotice: () => null,
      useAction: () => {
        const busy = actionIndex++ === 2 && ending;
        return { busy, run: (action: () => unknown) => busy ? undefined : action() };
      },
    };
    throw new Error(`Unexpected call overlay dependency ${name}`);
  };
  const source = readFileSync(new URL("../../apps/mobile/src/components/CallOverlay.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  runInNewContext(`(function(exports, require, module) { ${code}\n})`)(module.exports, require, module);
  renderToStaticMarkup(React.createElement(module.exports.default));
  return { buttons, actions };
}

test("Done dismisses the ended call while a prior hangup notification is still pending", async () => {
  const ui = renderCall("ended", true);
  const done = ui.buttons.get("Dismiss call");
  assert.ok(done);
  assert.equal(done.disabled, false);
  await done.onPress();
  assert.deepEqual(ui.actions, ["dismiss:call-A"]);
});

test("a live call still uses guarded End call rather than terminal dismissal", async () => {
  const ui = renderCall("active");
  assert.equal(ui.buttons.has("Dismiss call"), false);
  await ui.buttons.get("End Bluetooth call")!.onPress();
  assert.deepEqual(ui.actions, ["end:call-A"]);
  assert.equal(renderCall("active", true).buttons.get("End Bluetooth call")?.disabled, true);
});
