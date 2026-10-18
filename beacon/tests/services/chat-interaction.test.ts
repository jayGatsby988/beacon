import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

// Exercise the actual list handlers: a receipt/new message must not pull someone
// away from older messages they are reading. These do not emulate Bluetooth.
function renderChat(scope: string | null = null, connected = true, callSupported = true, activeCall = false) {
  let listProps: any;
  let scrolls = 0;
  let calls = 0;
  let discoveries = 0;
  const buttons = new Map<string, { onPress: () => unknown; disabled: boolean }>();
  const container = ({ children }: any) => React.createElement("div", null, children);
  const button = ({ children, accessibilityLabel, onPress, disabled }: any) => {
    buttons.set(accessibilityLabel, { onPress, disabled });
    return container({ children });
  };
  const state = {
    activeGroupId: scope,
    people: [{ nodeId: "alex", scope: null, name: "Alex", connected, unreadCount: 0 }],
    messages: [
      { id: "later", peerId: "alex", text: "Second", createdAt: 20, mine: true, status: "queued" },
      { id: "foreign", peerId: "other", text: "Private", createdAt: 1, mine: false, status: "received" },
      { id: "earlier", peerId: "alex", text: "First", createdAt: 10, mine: false, status: "received" },
    ],
    callSupported,
    call: activeCall ? { id: "existing" } : undefined,
    findingPeople: false,
    findPeople: async () => { discoveries++; },
    startCall: async () => { calls++; },
  };
  const require = (name: string): any => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react-native") return {
      FlatList: (props: any) => {
        listProps = props;
        props.ref.current = { scrollToEnd: () => { scrolls++; } };
        return null;
      },
      KeyboardAvoidingView: container, View: container, Text: container,
      Pressable: button, TextInput: () => null, Platform: { OS: "ios" },
      StyleSheet: { create: (v: unknown) => v },
    };
    if (name === "react-native-safe-area-context") return { SafeAreaView: container, useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === "expo-router") return { useLocalSearchParams: () => ({ id: "alex" }), useFocusEffect: () => {} };
    if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
    if (name.endsWith("/services/BeaconContext")) return { useBeacon: () => state };
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/ui/inbox")) return { initials: () => "A", deliveryLabel: (value: string) => value };
    if (name.endsWith("/components/ui")) return {
      ErrorNotice: () => null, TopBar: () => null, styles: {}, formatTime: () => "time",
      useAction: () => ({ busy: false, run: (action: () => unknown) => action() }),
    };
    throw new Error(`Unexpected chat dependency ${name}`);
  };
  const source = readFileSync(new URL("../../apps/mobile/app/chat/[id].tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  runInNewContext(`(function(exports, require, module) { ${code}\n})`)(module.exports, require, module);
  renderToStaticMarkup(React.createElement(module.exports.default));
  return { listProps, buttons, scrolls: () => scrolls, calls: () => calls, discoveries: () => discoveries };
}

test("chat follows the latest messages initially, preserves reading position, and resumes following near the bottom", () => {
  const ui = renderChat();
  ui.listProps.onLayout();
  assert.equal(ui.scrolls(), 1);
  ui.listProps.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 500 } } });
  ui.listProps.onContentSizeChange();
  ui.listProps.onLayout();
  assert.equal(ui.scrolls(), 1, "new content and keyboard layout must not jump away from older messages");
  ui.listProps.onScroll({ nativeEvent: { contentOffset: { y: 1480 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 500 } } });
  ui.listProps.onContentSizeChange();
  assert.equal(ui.scrolls(), 2);
});

test("chat displays only the chosen peer's ordered messages in the current audience", () => {
  const ui = renderChat();
  assert.deepEqual(Array.from(ui.listProps.data, (m: any) => m.id), ["earlier", "later"]);
  const wrongAudience = renderChat("private");
  assert.equal(wrongAudience.listProps.data.length, 0);
  assert.equal(wrongAudience.buttons.get("Send message")?.disabled, true);
  assert.equal(ui.calls(), 0, "opening a chat must not initiate a voice call");
});


test("a disconnected conversation offers discovery directly without sending a message or starting a call", async () => {
  const ui = renderChat(null, false);
  const recovery = ui.buttons.get("Find people to reconnect");
  assert.ok(recovery);
  assert.equal(recovery.disabled, false);
  await recovery.onPress();
  assert.equal(ui.discoveries(), 1);
  assert.equal(ui.calls(), 0);
  assert.equal(renderChat("different-group", false).buttons.has("Find people to reconnect"), false);
});

test("the visible Call action starts a connected peer call and blocks unavailable or wrong-audience calls", async () => {
  const ui = renderChat();
  const call = ui.buttons.get("Call Alex");
  assert.ok(call);
  assert.equal(call.disabled, false);
  assert.equal(ui.calls(), 0);
  await call.onPress();
  assert.equal(ui.calls(), 1);
  for (const blocked of [renderChat(null, false), renderChat(null, true, false), renderChat(null, true, true, true), renderChat("other-group")]) {
    const action = Array.from(blocked.buttons).find(([label]) => label.startsWith("Call "))?.[1];
    assert.ok(action);
    assert.equal(action.disabled, true);
    await action.onPress();
    assert.equal(blocked.calls(), 0);
  }
});
