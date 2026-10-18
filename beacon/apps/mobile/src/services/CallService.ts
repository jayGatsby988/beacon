import {
  createCallSignal,
  encodeCallSignal,
  decodeCallSignal,
  openCallSignal,
  CALL_LIMITS,
  type Identity,
  type CallContent,
} from "@beacon/protocol";
import { bytesToHex } from "@noble/hashes/utils";
import { fromByteArray } from "base64-js";

export interface CallPerson {
  nodeId: string;
  publicKey: string;
  name: string;
  scope: string | null;
}
export interface CallView {
  callId: string;
  nodeId: string;
  name: string;
  direction: "incoming" | "outgoing";
  state: "ringing" | "connecting" | "active" | "ended";
  reason?: string;
  muted: boolean;
  speaker: boolean;
  startedAt?: number;
}
export interface VoiceEvent {
  callId: string;
  state: "ready" | "active" | "ended" | "failed";
  reason?: string;
  stats?: unknown;
}
export interface CallNativeAdapter {
  getVoiceSupport(): Promise<{ supported: boolean; reason?: string }>;
  voicePrepare(options: {
    callId: string;
    peerId: string;
    keyBase64: string;
    initiator: boolean;
  }): Promise<{ psm: number }>;
  voiceConnect(options: {
    callId: string;
    peerId: string;
    psm: number;
  }): Promise<void>;
  voiceStart(callId: string): Promise<void>;
  voiceStop(callId: string): Promise<void>;
  voiceSetMuted(muted: boolean): Promise<void>;
  voiceSetSpeaker(speaker: boolean): Promise<void>;
}
export interface CallServiceOptions {
  identity: Identity;
  scope(): string | null;
  people(): readonly CallPerson[];
  getPeer(nodeId: string): string | undefined;
  peerNodeId(peerId: string): string | undefined;
  send(peerId: string, wire: string, scope: string | null): Promise<void>;
  native: CallNativeAdapter;
  random(n: number): Uint8Array;
  onChange(view: CallView | null): void;
  onError(error: unknown): void;
  clock?: () => number;
}
interface Active {
  view: CallView;
  person: CallPerson;
  peerId: string;
  scope: string | null;
  deadline: number;
  keyBase64?: string;
  remotePsm?: number;
  initiator: boolean;
  accepted: boolean;
  ready: boolean;
  starting: boolean;
}

const VOICE_REASONS: Record<string, string> = {
  microphone_unavailable: "Allow microphone access in Settings to talk.",
  background: "Call ended when Beacon left the foreground.",
  audio_interrupted: "Call interrupted by another audio session.",
  audio_route_lost: "Audio device disconnected.",
  bluetooth_disconnected: "Bluetooth connection lost.",
  bluetooth_stopped: "Bluetooth stopped.",
  local_ended: "Call ended",
  remote_ended: "Call ended",
  voice_timeout: "Bluetooth connection timed out.",
  voice_backpressure: "Bluetooth connection could not keep up with audio.",
  voice_authentication_failed: "Could not verify the voice connection.",
  voice_encryption_failed: "Could not secure the voice connection.",
  channel_open_failed: "Could not open the Bluetooth voice connection.",
  channel_publish_failed: "Could not prepare the Bluetooth voice connection.",
  invalid_voice_frame: "Voice connection failed.",
  stream_frame_limit: "Voice connection failed.",
  stream_closed: "Bluetooth voice connection closed.",
  stream_read_failed: "Bluetooth voice connection failed.",
  stream_write_failed: "Bluetooth voice connection failed.",
  audio_start_failed: "Could not start the microphone and audio output.",
  audio_codec_failed: "Could not process call audio.",
};
function callReason(
  error: unknown,
  fallback = "Could not connect the call. Try again.",
): string {
  const value =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  for (const [code, reason] of Object.entries(VOICE_REASONS))
    if (value.includes(code)) return reason;
  if (
    /microphone.*(permission|denied)|(permission|denied).*microphone/i.test(
      value,
    )
  )
    return VOICE_REASONS.microphone_unavailable;
  // Native platform messages may contain internal details; only expose app-owned sentences.
  if (
    ["Bluetooth calls are unavailable.", "Invalid voice channel"].includes(
      value,
    )
  )
    return value === "Invalid voice channel"
      ? "Could not prepare the Bluetooth voice connection."
      : value;
  return fallback;
}

/** Ephemeral one-to-one signaling only. No call key or audio ever reaches a repository. */
export class CallService {
  private active?: Active;
  private view: CallView | null = null;
  private disposed = false;
  private pending = new Set<Promise<void>>();
  private packets = new Map<string, number>();
  private calls = new Map<string, number>();
  private rates = new Map<string, { at: number; count: number }>();
  private now: () => number;
  constructor(private options: CallServiceOptions) {
    this.now = options.clock ?? Date.now;
  }
  get snapshot(): CallView | null {
    return this.view ? { ...this.view } : null;
  }
  private emit(view: CallView | null) {
    this.view = view ? { ...view } : null;
    if (!this.disposed) this.options.onChange(this.snapshot);
  }
  private current(call: Active) {
    return (
      !this.disposed &&
      this.active === call &&
      call.scope === this.options.scope()
    );
  }
  private run(work: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const task = work()
      .catch((error: unknown) => {
        if (!this.disposed) this.options.onError(error);
      })
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
    return task;
  }
  private random(count: number) {
    const result = this.options.random(count);
    if (!(result instanceof Uint8Array) || result.length !== count)
      throw new Error("Invalid random source");
    return result;
  }
  private prune() {
    for (const map of [this.packets, this.calls])
      for (const [id, expiry] of map) if (expiry <= this.now()) map.delete(id);
    for (const [id, rate] of this.rates)
      if (rate.at + 60_000 <= this.now()) this.rates.delete(id);
  }
  private remember(map: Map<string, number>, id: string, expiry: number) {
    if (map.size >= CALL_LIMITS.replayEntries) return false; // Do not evict live replay defenses.
    map.set(id, expiry);
    return true;
  }
  private async signal(call: Active, content: CallContent) {
    if (!this.current(call)) return;
    const wire = encodeCallSignal(
      createCallSignal(
        this.options.identity,
        call.person.publicKey,
        content,
        call.scope,
        this.now(),
        this.options.random,
      ),
    );
    await this.options.send(call.peerId, wire, call.scope);
  }
  private async stopNative(callId: string) {
    try {
      await this.options.native.voiceStop(callId);
    } catch (error) {
      if (!this.disposed) this.options.onError(error);
    }
  }
  private async finish(
    call: Active,
    reason: string,
    notify: false | "end" | "decline" = false,
  ) {
    if (this.active !== call) return;
    // Invalidate before awaiting any send/native operation, including a pending prepare.
    this.active = undefined;
    call.keyBase64 = undefined;
    this.emit({ ...call.view, state: "ended", reason });
    let wire: string | undefined;
    if (notify && call.scope === this.options.scope() && !this.disposed) {
      try {
        wire = encodeCallSignal(
          createCallSignal(
            this.options.identity,
            call.person.publicKey,
            { version: 1, callId: call.view.callId, kind: notify },
            call.scope,
            this.now(),
            this.options.random,
          ),
        );
      } catch (error) {
        this.options.onError(error);
      }
    }
    await Promise.all([
      this.stopNative(call.view.callId),
      wire
        ? this.options
            .send(call.peerId, wire, call.scope)
            .catch((error: unknown) => {
              if (!this.disposed) this.options.onError(error);
            })
        : Promise.resolve(),
    ]);
  }
  private async fail(call: Active, error: unknown) {
    if (!this.current(call)) return;
    this.options.onError(error);
    await this.finish(call, callReason(error), "end");
  }
  private async prepare(
    call: Active,
    keyBase64: string,
  ): Promise<number | undefined> {
    const prepared = await this.options.native.voicePrepare({
      callId: call.view.callId,
      peerId: call.peerId,
      keyBase64,
      initiator: call.initiator,
    });
    if (!this.current(call)) {
      await this.stopNative(call.view.callId);
      return;
    }
    if (call.deadline <= this.now()) {
      await this.finish(call, "Connection timed out", "end");
      return;
    }
    if (
      !Number.isInteger(prepared.psm) ||
      (call.initiator
        ? prepared.psm !== 0
        : prepared.psm < 1 || prepared.psm > 65535)
    )
      throw new Error("Invalid voice channel");
    return prepared.psm;
  }
  start(nodeId: string): Promise<void> {
    return this.run(async () => {
      if (this.active) throw new Error("A call is already in progress.");
      const scope = this.options.scope();
      const person = this.options
        .people()
        .find((p) => p.nodeId === nodeId && p.scope === scope);
      const peerId = this.options.getPeer(nodeId);
      if (!person || !peerId || nodeId === this.options.identity.nodeId)
        throw new Error("This person is not connected.");
      this.prune();
      const callId = bytesToHex(this.random(32));
      if (!this.remember(this.calls, callId, this.now() + 60_000))
        throw new Error("Please wait before calling again.");
      const call: Active = {
        view: {
          callId,
          nodeId,
          name: person.name,
          direction: "outgoing",
          state: "connecting",
          muted: false,
          speaker: false,
        },
        person: { ...person },
        peerId,
        scope,
        deadline: this.now() + CALL_LIMITS.ttlMs,
        initiator: peerId.startsWith("c:"),
        accepted: false,
        ready: false,
        starting: false,
      };
      this.active = call;
      this.emit(call.view);
      try {
        const support = await this.options.native.getVoiceSupport();
        if (!this.current(call)) return;
        if (!support.supported)
          throw new Error(support.reason ?? "Bluetooth calls are unavailable.");
        const key = this.random(32),
          keyBase64 = fromByteArray(key);
        key.fill(0);
        const psm = await this.prepare(call, keyBase64);
        if (psm === undefined || !this.current(call)) return;
        await this.signal(call, {
          callId,
          version: 1,
          kind: "invite",
          keyBase64,
          initiator: call.initiator,
          psm,
        });
        if (!this.current(call)) return;
        if (!call.accepted) {
          call.view.state = "ringing";
          this.emit(call.view);
        }
      } catch (error) {
        await this.fail(call, error);
      }
    });
  }
  accept(expectedCallId?: string): Promise<void> {
    return this.run(async () => {
      const call = this.active;
      if (expectedCallId && expectedCallId !== call?.view.callId) return;
      if (
        !call ||
        !this.current(call) ||
        call.view.direction !== "incoming" ||
        call.view.state !== "ringing" ||
        !call.keyBase64
      )
        return;
      if (call.deadline <= this.now()) {
        await this.finish(call, "No answer", "end");
        return;
      }
      call.view.state = "connecting";
      this.emit(call.view);
      const key = call.keyBase64;
      call.keyBase64 = undefined;
      try {
        const support = await this.options.native.getVoiceSupport();
        if (!this.current(call)) return;
        if (!support.supported)
          throw new Error(support.reason ?? "Bluetooth calls are unavailable.");
        const psm = await this.prepare(call, key);
        if (psm === undefined || !this.current(call)) return;
        await this.signal(call, {
          callId: call.view.callId,
          version: 1,
          kind: "accept",
          psm,
        });
        if (!this.current(call)) return;
        call.accepted = true;
        call.deadline = this.now() + CALL_LIMITS.ttlMs;
        if (call.initiator)
          await this.options.native.voiceConnect({
            callId: call.view.callId,
            peerId: call.peerId,
            psm: call.remotePsm!,
          });
        await this.maybeStart(call);
      } catch (error) {
        await this.fail(call, error);
      }
    });
  }
  decline(expectedCallId?: string): Promise<void> {
    return this.run(async () => {
      const call = this.active;
      if (expectedCallId && expectedCallId !== call?.view.callId) return;
      if (!call || call.view.direction !== "incoming") return;
      await this.finish(call, "Declined", "decline");
    });
  }
  hangup(reason = "Call ended", expectedCallId?: string): Promise<void> {
    return this.run(async () => {
      if (
        this.active &&
        (!expectedCallId || expectedCallId === this.active.view.callId)
      )
        await this.finish(this.active, reason, "end");
    });
  }
  private async maybeStart(call: Active) {
    if (
      !this.current(call) ||
      !call.accepted ||
      !call.ready ||
      call.starting ||
      call.view.state === "active"
    )
      return;
    if (call.deadline <= this.now()) {
      await this.finish(call, "Connection timed out", "end");
      return;
    }
    call.starting = true;
    try {
      await this.options.native.voiceStart(call.view.callId);
      if (!this.current(call)) {
        await this.stopNative(call.view.callId);
        return;
      }
      call.view.state = "active";
      call.view.startedAt = this.now();
      this.emit(call.view);
    } catch (error) {
      await this.fail(call, error);
    }
  }
  onVoice(event: VoiceEvent): Promise<void> {
    return this.run(async () => {
      const call = this.active;
      if (!call || !this.current(call) || event.callId !== call.view.callId)
        return;
      if (event.state === "failed" || event.state === "ended") {
        await this.finish(call, callReason(event.reason, "Call ended"), "end");
        return;
      }
      if (event.state === "ready") {
        call.ready = true;
        await this.maybeStart(call);
      }
    });
  }
  receive(peerId: string, wire: string): Promise<void> {
    return this.run(async () => {
      this.prune();
      const packet = decodeCallSignal(wire, this.now());
      if (
        !packet ||
        this.options.peerNodeId(peerId) !== packet.origin ||
        packet.scope !== this.options.scope() ||
        packet.destination !== this.options.identity.nodeId ||
        this.packets.has(packet.id)
      )
        return;
      const person = this.options
        .people()
        .find(
          (p) =>
            p.nodeId === packet.origin &&
            p.publicKey === packet.publicKey &&
            p.scope === packet.scope,
        );
      if (!person || !this.options.getPeer(person.nodeId)) return;
      const rate = this.rates.get(person.nodeId) ?? {
        at: this.now(),
        count: 0,
      };
      if (
        ++rate.count > 60 ||
        (this.rates.size >= 200 && !this.rates.has(person.nodeId))
      )
        return;
      this.rates.set(person.nodeId, rate);
      const content = openCallSignal(this.options.identity, packet, this.now());
      if (!content || !this.remember(this.packets, packet.id, packet.expiresAt))
        return;
      if (content.kind === "invite") {
        if (
          this.calls.has(content.callId) ||
          content.initiator === peerId.startsWith("c:")
        )
          return;
        if (!this.remember(this.calls, content.callId, this.now() + 60_000))
          return;
        const call: Active = {
          view: {
            callId: content.callId,
            nodeId: person.nodeId,
            name: person.name,
            direction: "incoming",
            state: "ringing",
            muted: false,
            speaker: false,
          },
          person: { ...person },
          peerId,
          scope: packet.scope,
          deadline: Math.min(packet.expiresAt, this.now() + CALL_LIMITS.ttlMs),
          keyBase64: content.keyBase64,
          remotePsm: content.psm,
          initiator: !content.initiator,
          accepted: false,
          ready: false,
          starting: false,
        };
        const previous = this.active;
        if (previous) {
          const yieldGlare =
            previous.view.direction === "outgoing" &&
            !previous.accepted &&
            previous.person.nodeId === person.nodeId &&
            this.options.identity.nodeId > person.nodeId;
          if (!yieldGlare) {
            await this.options.send(
              peerId,
              encodeCallSignal(
                createCallSignal(
                  this.options.identity,
                  person.publicKey,
                  { kind: "busy", version: 1, callId: content.callId },
                  packet.scope,
                  this.now(),
                  this.options.random,
                ),
              ),
              packet.scope,
            );
            return;
          }
          await this.finish(previous, "Incoming call");
          if (
            this.disposed ||
            this.options.scope() !== packet.scope ||
            this.active
          )
            return;
        }
        this.active = call;
        this.emit(call.view);
        return;
      }
      if (content.kind !== "accept")
        this.remember(this.calls, content.callId, this.now() + 60_000);
      const call = this.active;
      if (
        !call ||
        !this.current(call) ||
        call.view.callId !== content.callId ||
        call.person.nodeId !== packet.origin
      )
        return;
      if (content.kind === "accept") {
        if (
          call.view.direction !== "outgoing" ||
          call.accepted ||
          (call.initiator ? content.psm === 0 : content.psm !== 0)
        )
          return;
        if (call.deadline <= this.now()) {
          await this.finish(call, "No answer", "end");
          return;
        }
        call.accepted = true;
        call.view.state = "connecting";
        call.deadline = this.now() + CALL_LIMITS.ttlMs;
        this.emit(call.view);
        try {
          if (call.initiator)
            await this.options.native.voiceConnect({
              callId: call.view.callId,
              peerId: call.peerId,
              psm: content.psm,
            });
          await this.maybeStart(call);
        } catch (error) {
          await this.fail(call, error);
        }
      } else
        await this.finish(
          call,
          content.kind === "busy"
            ? "Busy"
            : content.kind === "decline"
              ? "Declined"
              : "Call ended",
        );
    });
  }
  setMuted(muted: boolean, expectedCallId?: string): Promise<void> {
    return this.run(async () => {
      const call = this.active;
      if (expectedCallId && expectedCallId !== call?.view.callId) return;
      if (!call || !this.current(call) || call.view.state !== "active") return;
      try {
        await this.options.native.voiceSetMuted(muted);
        if (this.current(call)) {
          call.view.muted = muted;
          call.view.reason = undefined;
          this.emit(call.view);
        }
      } catch (error) {
        if (this.current(call)) {
          call.view.reason = "Could not change the microphone. Try again.";
          this.emit(call.view);
          this.options.onError(error);
        }
      }
    });
  }
  setSpeaker(speaker: boolean, expectedCallId?: string): Promise<void> {
    return this.run(async () => {
      const call = this.active;
      if (expectedCallId && expectedCallId !== call?.view.callId) return;
      if (!call || !this.current(call) || call.view.state !== "active") return;
      try {
        await this.options.native.voiceSetSpeaker(speaker);
        if (this.current(call)) {
          call.view.speaker = speaker;
          call.view.reason = undefined;
          this.emit(call.view);
        }
      } catch (error) {
        if (this.current(call)) {
          call.view.reason = "Could not change the audio output. Try again.";
          this.emit(call.view);
          this.options.onError(error);
        }
      }
    });
  }
  peerDisconnected(peerId: string): Promise<void> {
    return this.run(async () => {
      if (this.active?.peerId === peerId)
        await this.finish(this.active, "Disconnected");
    });
  }
  tick(): Promise<void> {
    return this.run(async () => {
      this.prune();
      const call = this.active;
      if (!call) return;
      if (call.scope !== this.options.scope())
        await this.finish(call, "Group changed");
      else if (call.view.state !== "active" && call.deadline <= this.now())
        await this.finish(
          call,
          call.accepted ? "Connection timed out" : "No answer",
          "end",
        );
    });
  }
  dismiss(expectedCallId?: string): void {
    if (
      !this.active &&
      !this.disposed &&
      (!expectedCallId || expectedCallId === this.view?.callId)
    )
      this.emit(null);
  }
  reset(reason = "Group changed"): Promise<void> {
    return this.run(async () => {
      if (this.active) await this.finish(this.active, reason);
      if (!this.active) this.emit(null);
    });
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.active) await this.finish(this.active, "Call ended");
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.packets.clear();
    this.calls.clear();
    this.rates.clear();
    this.view = null;
  }
}
