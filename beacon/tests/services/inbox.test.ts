import test from "node:test";
import assert from "node:assert/strict";
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
