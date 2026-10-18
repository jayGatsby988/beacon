import type { DirectMessageView, PersonView } from "./types";

export interface ConversationRow {
  person: PersonView;
  latest: DirectMessageView;
}

/** Messages are already scope-filtered by SocialService; identities must match too. */
export function inboxRows(
  people: PersonView[],
  messages: DirectMessageView[],
  scope: string | null,
) {
  const currentPeople = people.filter((person) => person.scope === scope);
  const allowed = new Set(currentPeople.map((person) => person.nodeId));
  const latest = new Map<string, DirectMessageView>();
  for (const message of messages) {
    if (!allowed.has(message.peerId)) continue;
    const previous = latest.get(message.peerId);
    if (!previous || message.createdAt > previous.createdAt ||
      (message.createdAt === previous.createdAt && message.id.localeCompare(previous.id) > 0)) {
      latest.set(message.peerId, message);
    }
  }
  const conversations: ConversationRow[] = [];
  const connected: PersonView[] = [];
  for (const person of currentPeople) {
    const message = latest.get(person.nodeId);
    if (message) conversations.push({ person, latest: message });
    else if (person.connected) connected.push(person);
  }
  conversations.sort((a, b) => b.latest.createdAt - a.latest.createdAt || a.person.nodeId.localeCompare(b.person.nodeId));
  connected.sort((a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId));
  return { conversations, connected };
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";
}

export function deliveryLabel(status: DirectMessageView["status"]) {
  return status === "received" ? "Received" : status === "expired" ? "Expired" : "Queued";
}

export function inboxTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
