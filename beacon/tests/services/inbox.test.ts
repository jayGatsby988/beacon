import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as inbox from "../../apps/mobile/src/ui/inbox.js";
import { inboxRows, deliveryLabel } from "../../apps/mobile/src/ui/inbox.js";
import type { DirectMessageView, PersonView } from "../../apps/mobile/src/ui/types.js";

const person = (nodeId: string, scope: string | null, connected = false): PersonView => ({
  nodeId, publicKey: nodeId, name: nodeId, scope, connected, unreadCount: 0, lastSeenAt: 10,
});
const message = (id: string, peerId: string, createdAt: number): DirectMessageView => ({
  id, peerId, createdAt, mine: false, text: id, status: "received",
});

test("inbox only joins messages to identities in the active scope", () => {
  const publicPerson = person("public", null, true);
  const privatePerson = { ...person("private", "group", true), unreadCount: 3 };
  const messages = [message("public text", "public", 20), message("private text", "private", 30), message("unknown text", "unknown", 40)];
  const publicRows = inboxRows([privatePerson, publicPerson], messages, null);
  assert.deepEqual(publicRows.conversations.map((row) => row.person.nodeId), ["public"]);
  assert.deepEqual(publicRows.connected, []);
  const privateRows = inboxRows([privatePerson, publicPerson], messages, "group");
  assert.deepEqual(privateRows.conversations.map((row) => [row.person.nodeId, row.latest.text, row.person.unreadCount]), [["private", "private text", 3]]);
  assert.deepEqual(inboxRows([privatePerson, publicPerson], messages, "other"), { conversations: [], connected: [] });
});

test("inbox uses the latest real message and sorts conversations by recent activity without mutating source arrays", () => {
  const people = [person("a", null), person("b", null), person("c", null)];
  const messages = [message("old", "a", 5), message("b-latest", "b", 30), message("a-latest", "a", 40), message("c-first", "c", 10), message("c-last", "c", 10)];
  const before = structuredClone({ people, messages });
  const rows = inboxRows(people, messages, null);
  assert.deepEqual(rows.conversations.map((row) => [row.person.nodeId, row.latest.id]), [["a", "a-latest"], ["b", "b-latest"], ["c", "c-last"]]);
  assert.deepEqual({ people, messages }, before);
});

test("new conversation contacts are connected, current-scope people without an existing conversation", () => {
  const people = [person("Zoe", null, true), person("Amy", null, true), person("Offline", null), person("Private", "group", true), person("Existing", null, true)];
  const rows = inboxRows(people, [message("hello", "Existing", 20)], null);
  assert.deepEqual(rows.connected.map((item) => item.name), ["Amy", "Zoe"]);
  assert.deepEqual(rows.conversations.map((item) => item.person.name), ["Existing"]);
  assert.equal(deliveryLabel("queued"), "Queued");
  assert.equal(deliveryLabel("received"), "Received");
  assert.equal(deliveryLabel("expired"), "Expired");
});

// Render the actual inbox; only native components and the context/router are stubbed.
function renderInbox(people: PersonView[], messages: DirectMessageView[] = []) {
  const presses: (() => void)[] = [];
  const routes: unknown[] = [];
  const container = ({ children }: any) => React.createElement("div", null, children);
  const require = (name: string): any => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "expo-router") return { router: { push: (route: unknown) => routes.push(route) } };
    if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
    if (name === "react-native") return {
      Text: container, View: container,
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
      Pressable: ({ children, onPress }: any) => { presses.push(onPress); return React.createElement("button", null, children); },
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    };
    if (name.endsWith("/components/ui")) return { Screen: container };
    if (name.endsWith("/services/BeaconContext")) return { useBeacon: () => ({ people, messages, activeGroupId: null, groups: [], loading: false }) };
    if (name.endsWith("/theme/tokens")) return { colors: {}, fonts: {} };
    if (name.endsWith("/ui/inbox")) return inbox;
    throw new Error(`Unexpected dependency: ${name}`);
  };
  const source = readFileSync(new URL("../../apps/mobile/app/messages.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} as any };
  runInNewContext(`(function(exports, require, module) { ${code}\n})`)(module.exports, require, module);
  return { html: renderToStaticMarkup(React.createElement(module.exports.default)), presses, routes };
}

test("inbox with connected contacts offers the conversation immediately without a discovery detour", () => {
  const result = renderInbox([person("Alex", null, true), person("Hidden", "private", true)]);
  assert.match(result.html, /Start a conversation/);
  assert.match(result.html, /Alex/);
  assert.doesNotMatch(result.html, /Hidden|Find people|No conversations/);
  result.presses[0]();
  assert.equal(result.routes[0], "/chat/Alex");
});

test("an empty current audience links directly to Nearby People", () => {
  const result = renderInbox([person("Hidden", "private", true)]);
  assert.match(result.html, /Find someone nearby/);
  assert.match(result.html, /Find people/);
  assert.doesNotMatch(result.html, /Hidden|Start a conversation/);
  result.presses[0]();
  assert.equal(JSON.stringify(result.routes[0]), JSON.stringify({ pathname: "/(tabs)/nearby", params: { view: "people" } }));
});
