import test from "node:test";
import assert from "node:assert/strict";
import { HelpAlertCoordinator, helpAlerts, parseHelpAlertData, type AlertPermission, type HelpAlert } from "../../apps/mobile/src/services/NotificationPolicy.js";
import type { HelpOffer, RequestView } from "../../apps/mobile/src/ui/types.js";

const requester = "a".repeat(64), volunteer = "b".repeat(64), group = "c".repeat(64);
const offer: HelpOffer = { id: "offer", nodeId: volunteer, name: "Private name", note: "Private medical note", createdAt: 5, accepted: false, assignmentReceived: false };
const request = (patch: Partial<RequestView> = {}): RequestView => ({
  id: "d".repeat(64), groupId: null, originNodeId: requester, name: "Private requester", mine: false,
  category: "injured", note: "Private medical note", createdAt: 1, updatedAt: 2,
  location: { source: "device", latitude: 47.65, longitude: -122.3 }, status: "active",
  transport: "received", recipientCount: 1, forwardedCount: 0, seenCount: 0, offers: [], pendingUpdate: false, ...patch,
});
function harness(store = new Map<string, string>()) {
  let permission: AlertPermission = "granted", now = 1_800_000_000_000, failures = 0;
  const sent: HelpAlert[] = [], prompts: boolean[] = [];
  const storage = { getItem: async (key: string) => store.get(key) ?? null, setItem: async (key: string, value: string) => { store.set(key, value); } };
  const port = {
    permission: async (ask: boolean) => { prompts.push(ask); return permission; },
    present: async (alert: HelpAlert) => { if (failures-- > 0) throw new Error("Native failure"); sent.push(alert); },
  };
  const service = new HelpAlertCoordinator(storage, port, () => now);
  return { service, sent, prompts, store, storage, port, setPermission: (p: AlertPermission) => { permission = p; }, failOnce: () => { failures = 1; }, advance: (ms: number) => { now += ms; } };
}

test("SOS and offers alert the correct participant, with generic lock-screen copy", () => {
  assert.deepEqual(helpAlerts([request()], volunteer, null).map(a => a.kind), ["sos"]);
  assert.deepEqual(helpAlerts([request({ mine: true })], requester, null), []);
  const alerts = helpAlerts([request({ mine: true, offers: [offer] })], requester, null);
  assert.deepEqual(alerts.map(a => a.kind), ["offer"]);
  assert.doesNotMatch(JSON.stringify(alerts), /Private|47\.65|-122\.3|injured/);
});

test("acceptance alerts only the assigned volunteer; requester confirmation needs the assignment receipt", () => {
  const accepted = request({ status: "accepted", acceptedOfferId: offer.id, offers: [offer] });
  assert.deepEqual(helpAlerts([accepted], volunteer, null).map(a => a.kind), ["accepted"]);
  assert.deepEqual(helpAlerts([accepted], "someone-else", null), []);
  assert.deepEqual(helpAlerts([{ ...accepted, mine: true }], requester, null), []);
  assert.deepEqual(helpAlerts([{ ...accepted, mine: true, offers: [{ ...offer, assignmentReceived: true }] }], requester, null).map(a => a.kind), ["confirmed"]);
});

test("closed requests, transport receipts, and inactive audiences do not generate help notifications", () => {
  for (const status of ["completed", "canceled", "expired"] as const) {
    assert.deepEqual(helpAlerts([request({ status, offers: [offer] })], volunteer, null), []);
  }
  assert.deepEqual(helpAlerts([request({ mine: true, transport: "received", recipientCount: 100 })], requester, null), []);
  assert.deepEqual(helpAlerts([request({ groupId: group })], volunteer, null), []);
  assert.deepEqual(helpAlerts([request()], volunteer, group), []);
});

test("opening never requests permission; enabling requires an explicit grant", async () => {
  const h = harness(); h.setPermission("denied");
  await h.service.initialize(); assert.equal(h.service.enabled, false); assert.deepEqual(h.prompts, [false]);
  await h.service.setEnabled(true); assert.equal(h.service.enabled, false); assert.equal(h.prompts.at(-1), true);
  h.setPermission("granted"); await h.service.setEnabled(true); assert.equal(h.service.enabled, true);
});

test("new arrivals notify once despite concurrent refreshes, relay duplicates and restart", async () => {
  const h = harness(); await h.service.setEnabled(true); await h.service.observe([], volunteer, null);
  await Promise.all(Array.from({ length: 12 }, () => h.service.observe([request()], volunteer, null)));
  assert.equal(h.sent.length, 1);
  h.service.dispose();
  const restarted = harness(h.store); await restarted.service.observe([request()], volunteer, null);
  await restarted.service.observe([request()], volunteer, null);
  assert.equal(restarted.sent.length, 0);
  await restarted.service.observe([request(), request({ id: "e".repeat(64) })], volunteer, null);
  assert.equal(restarted.sent.length, 1);
});

test("restored history is baselined, but new offers on restored requests still notify", async () => {
  const h = harness(); await h.service.setEnabled(true);
  await h.service.observe([request({ mine: true })], requester, null);
  await h.service.observe([request({ mine: true, offers: [offer] })], requester, null);
  assert.deepEqual(h.sent.map(a => a.kind), ["offer"]);
});

test("disabled and revoked-permission periods do not replay old alerts on enable", async () => {
  const h = harness(); await h.service.observe([], volunteer, null);
  await h.service.observe([request()], volunteer, null);
  await h.service.setEnabled(true); await h.service.observe([request()], volunteer, null);
  assert.equal(h.sent.length, 0);
  h.setPermission("denied"); await h.service.observe([request({ id: "e".repeat(64) })], volunteer, null);
  h.setPermission("granted"); await h.service.observe([request({ id: "e".repeat(64) })], volunteer, null);
  assert.equal(h.sent.length, 0);
});

test("switching audiences baselines their history and only alerts for later messages there", async () => {
  const h = harness(); await h.service.setEnabled(true); await h.service.observe([], volunteer, null);
  await h.service.observe([request({ groupId: group })], volunteer, group);
  assert.equal(h.sent.length, 0);
  await h.service.observe([request({ groupId: group, id: "e".repeat(64) })], volunteer, group);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].groupId, group);
});

test("stale scope work and disposed providers cannot emit alerts", async () => {
  const h = harness(); await h.service.setEnabled(true); await h.service.observe([], volunteer, null);
  await h.service.observe([request()], volunteer, null, () => false);
  h.service.dispose(); await h.service.observe([request()], volunteer, null);
  assert.equal(h.sent.length, 0);
});

test("transient native presentation failure retries on a later refresh without breaking the serial queue", async () => {
  const h = harness(); await h.service.setEnabled(true); await h.service.observe([], volunteer, null); h.failOnce();
  await assert.rejects(h.service.observe([request()], volunteer, null), /Native failure/);
  await h.service.observe([request()], volunteer, null);
  assert.equal(h.sent.length, 1);
});

test("bursts are limited to six alerts per minute without replaying the overflow", async () => {
  const h = harness(); await h.service.setEnabled(true); await h.service.observe([], volunteer, null);
  const many = Array.from({ length: 10 }, (_, i) => request({ id: String(i).padStart(64, "0") }));
  await h.service.observe(many, volunteer, null); assert.equal(h.sent.length, 6);
  h.advance(61_000); await h.service.observe(many, volunteer, null); assert.equal(h.sent.length, 6);
  await h.service.observe([...many, request()], volunteer, null); assert.equal(h.sent.length, 7);
});

test("malformed saved dedupe data recovers without flooding restored history", async () => {
  const h = harness(new Map([[`beacon.help-alerts.seen.v1:${volunteer}:public`, "not-json"]]));
  await h.service.setEnabled(true); await h.service.observe([request()], volunteer, null);
  await h.service.observe([request()], volunteer, null); assert.equal(h.sent.length, 0);
});

test("notification taps accept only app-owned exact request IDs and explicit audience", () => {
  const valid = { beaconAlert: 1, requestId: request().id, groupId: null };
  assert.deepEqual(parseHelpAlertData(valid), { requestId: request().id, groupId: null });
  assert.deepEqual(parseHelpAlertData({ ...valid, groupId: group }), { requestId: request().id, groupId: group });
  for (const bad of [null, {}, { ...valid, beaconAlert: 0 }, { ...valid, requestId: "https://evil.test" }, { ...valid, groupId: undefined }, { ...valid, groupId: "../settings" }, { ...valid, requestId: "a".repeat(65) }]) assert.equal(parseHelpAlertData(bad), null);
});
