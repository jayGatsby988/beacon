import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  CallService,
  type CallNativeAdapter,
  type CallView,
} from "../../apps/mobile/src/services/CallService.js";
import {
  createIdentity,
  createCallSignal,
  encodeCallSignal,
  decodeCallSignal,
  openCallSignal,
  type CallContent,
  type Identity,
} from "../../packages/protocol/src/index.js";
const NOW = 1_800_000_000_000;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
class Native implements CallNativeAdapter {
  prepared: {
    callId: string;
    peerId: string;
    keyBase64: string;
    initiator: boolean;
  }[] = [];
  connected: { callId: string; peerId: string; psm: number }[] = [];
  started: string[] = [];
  stopped: string[] = [];
  muted: boolean[] = [];
  speaker: boolean[] = [];
  gate?: Promise<void>;
  error?: Error;
  supported = true;
  async getVoiceSupport() {
    return { supported: this.supported };
  }
  async voicePrepare(options: {
    callId: string;
    peerId: string;
    keyBase64: string;
    initiator: boolean;
  }) {
    this.prepared.push(options);
    await this.gate;
    if (this.error) throw this.error;
    return { psm: options.initiator ? 0 : 133 };
  }
  async voiceConnect(options: { callId: string; peerId: string; psm: number }) {
    this.connected.push(options);
  }
  async voiceStart(id: string) {
    this.started.push(id);
  }
  async voiceStop(id: string) {
    this.stopped.push(id);
  }
  async voiceSetMuted(value: boolean) {
    this.muted.push(value);
  }
  async voiceSetSpeaker(value: boolean) {
    this.speaker.push(value);
  }
}
function fixture(
  local = createIdentity(randomBytes),
  remote = createIdentity(randomBytes),
) {
  let now = NOW,
    scope: string | null = null,
    connected = true,
    known = true,
    bound = true,
    peer = "c:remote";
  const native = new Native(),
    changes: (CallView | null)[] = [],
    errors: unknown[] = [],
    sent: { peer: string; wire: string; scope: string | null }[] = [];
  let sendGate: Promise<void> | undefined,
    failSend = false;
  const service = new CallService({
    identity: local,
    scope: () => scope,
    people: () => (known ? [{ ...remote, name: "Remote", scope }] : []),
    getPeer: () => (connected ? peer : undefined),
    peerNodeId: () => (bound ? remote.nodeId : undefined),
    send: async (peer, wire, scope) => {
      if (failSend) throw new Error("Disconnected while sending");
      sent.push({ peer, wire, scope });
      await sendGate;
    },
    native,
    random: randomBytes,
    clock: () => now,
    onChange: (value) => changes.push(value),
    onError: (error) => errors.push(error),
  });
  const wire = (
    content: CallContent,
    author: Identity = remote,
    packetScope = scope,
  ) =>
    encodeCallSignal(
      createCallSignal(
        author,
        local.publicKey,
        content,
        packetScope,
        now,
        randomBytes,
      ),
    );
  const content = (index = sent.length - 1) =>
    openCallSignal(remote, decodeCallSignal(sent[index].wire, now)!, now)!;
  return {
    setSendGate: (value: Promise<void> | undefined) => {
      sendGate = value;
    },
    setFailSend: (value: boolean) => {
      failSend = value;
    },
    service,
    native,
    local,
    remote,
    sent,
    changes,
    errors,
    wire,
    content,
    setNow: (value: number) => {
      now = value;
    },
    setScope: (value: string | null) => {
      scope = value;
    },
    setConnected: (value: boolean) => {
      connected = value;
    },
    setKnown: (value: boolean) => {
      known = value;
    },
    setBound: (value: boolean) => {
      bound = value;
    },
    setPeer: (value: string) => {
      peer = value;
    },
  };
}
const invite = (
  callId = randomBytes(32).toString("hex"),
  initiator = true,
): CallContent => ({
  kind: "invite",
  version: 1,
  callId,
  keyBase64: randomBytes(32).toString("base64"),
  initiator,
  psm: initiator ? 0 : 133,
});
test("outgoing central starts audio only after acceptance AND authenticated ready", async () => {
  const f = fixture();
  await f.service.start(f.remote.nodeId);
  const outgoing = f.content();
  assert.equal(outgoing.kind, "invite");
  assert.equal(f.service.snapshot?.state, "ringing");
  await f.service.onVoice({ callId: outgoing.callId, state: "ready" });
  assert.equal(f.native.started.length, 0);
  await f.service.receive(
    "c:remote",
    f.wire({ kind: "accept", version: 1, callId: outgoing.callId, psm: 133 }),
  );
  assert.equal(f.native.connected[0].psm, 133);
  assert.deepEqual(f.native.started, [outgoing.callId]);
  assert.equal(f.service.snapshot?.state, "active");
  await f.service.setMuted(true);
  await f.service.setSpeaker(true);
  assert.equal(f.service.snapshot?.muted, true);
  assert.equal(f.service.snapshot?.speaker, true);
  await f.service.hangup();
  assert.equal(f.service.snapshot?.state, "ended");
  assert.equal(f.content().kind, "end");
});
test("incoming invitation stays silent until accepted; listener advertises PSM and waits for ready", async () => {
  const f = fixture(),
    incoming = invite();
  await f.service.receive("p:remote", f.wire(incoming));
  assert.equal(f.service.snapshot?.direction, "incoming");
  assert.equal(f.native.prepared.length, 0);
  assert.ok(!JSON.stringify(f.service.snapshot).includes("keyBase64"));
  await f.service.accept();
  assert.deepEqual(f.content(), {
    kind: "accept",
    version: 1,
    callId: incoming.callId,
    psm: 133,
  });
  assert.equal(f.native.started.length, 0);
  await f.service.onVoice({ callId: incoming.callId, state: "ready" });
  await f.service.onVoice({ callId: incoming.callId, state: "ready" });
  assert.equal(f.native.started.length, 1);
});
test("peripheral caller publishes listener; central callee accepts then connects to invited PSM", async () => {
  const f = fixture();
  f.setPeer("p:remote");
  await f.service.start(f.remote.nodeId);
  const outgoing = f.content();
  assert.equal(outgoing.kind, "invite");
  if (outgoing.kind !== "invite") return;
  assert.equal(outgoing.initiator, false);
  assert.equal(outgoing.psm, 133);
  await f.service.receive(
    "p:remote",
    f.wire({ kind: "accept", version: 1, callId: outgoing.callId, psm: 0 }),
  );
  assert.equal(f.native.connected.length, 0);
  const g = fixture(),
    incoming = invite(undefined, false);
  await g.service.receive("c:remote", g.wire(incoming));
  await g.service.accept();
  assert.equal(g.native.prepared[0].initiator, true);
  assert.equal(g.native.connected[0].psm, 133);
  assert.deepEqual(g.content(), {
    kind: "accept",
    version: 1,
    callId: incoming.callId,
    psm: 0,
  });
});
test("unknown identity, wrong scope, unbound/relayed session, malformed signals and mismatched role never ring", async () => {
  const f = fixture(),
    incoming = invite();
  await f.service.receive("p:remote", "{broken");
  await f.service.receive(
    "p:remote",
    f.wire(incoming, createIdentity(randomBytes)),
  );
  await f.service.receive(
    "p:remote",
    f.wire(incoming, f.remote, "a".repeat(64)),
  );
  await f.service.receive("c:remote", f.wire(incoming));
  f.setBound(false);
  await f.service.receive("p:remote", f.wire(invite()));
  f.setBound(true);
  f.setKnown(false);
  await f.service.receive("p:remote", f.wire(invite()));
  assert.equal(f.service.snapshot, null);
  assert.equal(f.errors.length, 0);
  assert.equal(f.sent.length, 0);
});
test("decline and duplicate/re-signed invitation do not re-ring", async () => {
  const f = fixture(),
    incoming = invite(),
    wire = f.wire(incoming);
  await f.service.receive("p:remote", wire);
  await f.service.decline();
  assert.equal(f.content().kind, "decline");
  const count = f.changes.length;
  await f.service.receive("p:remote", wire);
  await f.service.receive("p:remote", f.wire(incoming));
  assert.equal(f.changes.length, count);
  assert.equal(f.native.prepared.length, 0);
});
test("crossing invitations choose lower node ID deterministically; abandoned busy is harmless", async () => {
  const a = createIdentity(randomBytes),
    b = createIdentity(randomBytes),
    low = a.nodeId < b.nodeId ? a : b,
    high = low === a ? b : a;
  const l = fixture(low, high),
    h = fixture(high, low);
  await Promise.all([
    l.service.start(high.nodeId),
    h.service.start(low.nodeId),
  ]);
  const lInvite = l.sent[0].wire,
    hInvite = h.sent[0].wire;
  await l.service.receive("p:remote", hInvite);
  await h.service.receive("p:remote", lInvite);
  assert.equal(l.service.snapshot?.direction, "outgoing");
  assert.equal(h.service.snapshot?.direction, "incoming");
  assert.equal(l.service.snapshot?.callId, h.service.snapshot?.callId);
  assert.equal(l.content().kind, "busy");
  await h.service.receive("p:remote", l.sent[1].wire);
  assert.equal(h.service.snapshot?.state, "ringing");
});
test("hangup during pending prepare never sends invitation or starts audio and stops late setup", async () => {
  const f = fixture(),
    gate = deferred();
  f.native.gate = gate.promise;
  const starting = f.service.start(f.remote.nodeId);
  await turn();
  const id = f.service.snapshot!.callId;
  await f.service.hangup();
  gate.resolve();
  await starting;
  assert.equal(f.service.snapshot?.state, "ended");
  assert.equal(f.native.started.length, 0);
  assert.ok(f.sent.every((_, index) => f.content(index).kind !== "invite"));
  assert.equal(f.native.stopped.filter((value) => value === id).length, 2);
});
test("decline during pending acceptance prevents microphone startup", async () => {
  const f = fixture(),
    incoming = invite(),
    gate = deferred();
  await f.service.receive("p:remote", f.wire(incoming));
  f.native.gate = gate.promise;
  const accepting = f.service.accept();
  await turn();
  await f.service.decline();
  gate.resolve();
  await accepting;
  await f.service.onVoice({ callId: incoming.callId, state: "ready" });
  assert.equal(f.native.started.length, 0);
  assert.equal(f.service.snapshot?.reason, "Declined");
  assert.equal(f.content().kind, "decline");
});
test("microphone denial and unsupported transport end cleanly without invitation or audio", async () => {
  for (const unsupported of [false, true]) {
    const f = fixture();
    if (unsupported) f.native.supported = false;
    else f.native.error = new Error("Microphone permission denied");
    await f.service.start(f.remote.nodeId);
    assert.equal(f.service.snapshot?.state, "ended");
    assert.equal(f.errors.length, 1);
    assert.equal(f.native.started.length, 0);
    assert.ok(f.sent.every((_, index) => f.content(index).kind !== "invite"));
  }
});
test("timeout, disconnect, native failure, scope reset and disposal terminate calls", async () => {
  for (const reason of [
    "timeout",
    "disconnect",
    "native",
    "scope",
    "reset",
    "dispose",
  ]) {
    const f = fixture();
    await f.service.start(f.remote.nodeId);
    const id = f.service.snapshot!.callId;
    if (reason === "timeout") {
      f.setNow(NOW + 30_000);
      await f.service.tick();
    }
    if (reason === "disconnect") await f.service.peerDisconnected("c:remote");
    if (reason === "native")
      await f.service.onVoice({
        callId: id,
        state: "failed",
        reason: "Handshake failed",
      });
    if (reason === "scope") {
      f.setScope("b".repeat(64));
      await f.service.tick();
    }
    if (reason === "reset") await f.service.reset();
    if (reason === "dispose") await f.service.dispose();
    assert.ok(!f.service.snapshot || f.service.snapshot.state === "ended");
    assert.ok(f.native.stopped.includes(id));
    const count = f.changes.length;
    await f.service.onVoice({ callId: id, state: "ready" });
    assert.equal(f.changes.length, count);
    assert.equal(f.native.started.length, 0);
  }
});
test("reset/disposal during prepare prevent late invitation and UI updates; disposal drains work", async () => {
  for (const dispose of [false, true]) {
    const f = fixture(),
      gate = deferred();
    f.native.gate = gate.promise;
    const starting = f.service.start(f.remote.nodeId);
    await turn();
    let drained = false;
    const shutdown = dispose
      ? f.service.dispose().then(() => {
          drained = true;
        })
      : f.service.reset();
    await turn();
    if (dispose) assert.equal(drained, false);
    const changes = f.changes.length;
    f.setScope("c".repeat(64));
    gate.resolve();
    await Promise.all([shutdown, starting]);
    assert.equal(f.changes.length, changes);
    assert.equal(f.sent.length, 0);
    assert.equal(f.service.snapshot, null);
  }
});
test("end arriving before invitation suppresses a reordered stale ring", async () => {
  const f = fixture(),
    incoming = invite();
  await f.service.receive(
    "p:remote",
    f.wire({ kind: "end", version: 1, callId: incoming.callId }),
  );
  await f.service.receive("p:remote", f.wire(incoming));
  assert.equal(f.service.snapshot, null);
});

test("acceptance arriving before invitation send resolves never regresses active status to ringing", async () => {
  const f = fixture(),
    gate = deferred();
  f.setSendGate(gate.promise);
  const starting = f.service.start(f.remote.nodeId);
  await turn();
  const outgoing = f.content();
  await f.service.onVoice({ callId: outgoing.callId, state: "ready" });
  await f.service.receive(
    "c:remote",
    f.wire({ kind: "accept", version: 1, callId: outgoing.callId, psm: 133 }),
  );
  assert.equal(f.service.snapshot?.state, "active");
  gate.resolve();
  await starting;
  assert.equal(f.service.snapshot?.state, "active");
});
test("late fresh acceptance or delayed native readiness cannot revive a timed-out call", async () => {
  for (const stage of ["accept", "ready", "prepare"]) {
    const f = fixture(),
      gate = deferred();
    if (stage === "prepare") f.native.gate = gate.promise;
    const starting = f.service.start(f.remote.nodeId);
    await turn();
    const id = f.service.snapshot!.callId;
    if (stage === "ready")
      await f.service.receive(
        "c:remote",
        f.wire({ kind: "accept", version: 1, callId: id, psm: 133 }),
      );
    f.setNow(NOW + 31_000);
    if (stage === "accept")
      await f.service.receive(
        "c:remote",
        f.wire({ kind: "accept", version: 1, callId: id, psm: 133 }),
      );
    if (stage === "ready")
      await f.service.onVoice({ callId: id, state: "ready" });
    gate.resolve();
    await starting;
    assert.equal(f.service.snapshot?.state, "ended");
    assert.equal(f.native.started.length, 0);
  }
});
test("native send failure stops prepared session and dismiss cannot hide an ongoing call", async () => {
  const f = fixture();
  await f.service.start(f.remote.nodeId);
  f.service.dismiss();
  assert.equal(f.service.snapshot?.state, "ringing");
  await f.service.hangup();
  f.service.dismiss();
  assert.equal(f.service.snapshot, null);
  f.setFailSend(true);
  await f.service.start(f.remote.nodeId);
  assert.equal(f.service.snapshot?.state, "ended");
  assert.ok(f.errors.length);
  assert.ok(f.native.stopped.includes(f.service.snapshot!.callId));
});

test("stale A controls cannot accept, decline, end, dismiss or change a newer B call", async () => {
  const f = fixture(),
    a = invite(),
    b = invite();
  await f.service.receive("p:remote", f.wire(a));
  await f.service.decline(a.callId);
  await f.service.receive("p:remote", f.wire(b));
  await f.service.accept(a.callId);
  await f.service.decline(a.callId);
  await f.service.hangup("Call ended", a.callId);
  f.service.dismiss(a.callId);
  assert.equal(f.service.snapshot?.callId, b.callId);
  assert.equal(f.service.snapshot?.state, "ringing");
  assert.equal(f.native.prepared.length, 0);
  await f.service.accept(b.callId);
  await f.service.onVoice({ callId: b.callId, state: "ready" });
  await f.service.setMuted(true, a.callId);
  await f.service.setSpeaker(true, a.callId);
  assert.equal(f.native.muted.length, 0);
  assert.equal(f.native.speaker.length, 0);
  await f.service.hangup("Call ended", b.callId);
  f.service.dismiss(a.callId);
  assert.equal(f.service.snapshot?.callId, b.callId);
  f.service.dismiss(b.callId);
  assert.equal(f.service.snapshot, null);
});
test("native failures use readable messages and toggle failures stay visible without ending audio", async () => {
  const f = fixture();
  await f.service.start(f.remote.nodeId);
  const id = f.service.snapshot!.callId;
  await f.service.receive(
    "c:remote",
    f.wire({ kind: "accept", version: 1, callId: id, psm: 133 }),
  );
  await f.service.onVoice({ callId: id, state: "ready" });
  f.native.voiceSetMuted = async () => {
    throw new Error("native_audio_failure");
  };
  await f.service.setMuted(true, id);
  assert.equal(f.service.snapshot?.state, "active");
  assert.match(f.service.snapshot!.reason!, /Could not change the microphone/);
  assert.equal(f.service.snapshot?.muted, false);
  f.native.voiceSetMuted = async () => {};
  await f.service.setMuted(true, id);
  assert.equal(f.service.snapshot?.reason, undefined);
  await f.service.onVoice({
    callId: id,
    state: "failed",
    reason: "voice_authentication_failed",
  });
  assert.equal(
    f.service.snapshot?.reason,
    "Could not verify the voice connection.",
  );
  const g = fixture();
  g.native.error = new Error("microphone_unavailable");
  await g.service.start(g.remote.nodeId);
  assert.equal(
    g.service.snapshot?.reason,
    "Allow microphone access in Settings to talk.",
  );
});
