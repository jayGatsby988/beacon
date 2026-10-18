import { z } from "zod";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";

export const LIMITS = Object.freeze({
  wireBytes: 16_384,
  noteChars: 280,
  inventory: 64,
  hopLimit: 8,
  ttlMs: 6 * 60 * 60_000,
  maxTtlMs: 7 * 24 * 60 * 60_000,
  futureSkewMs: 5 * 60_000,
  messages: 2_000,
  peers: 16,
  sendsPerFlush: 64,
  receivesPerMinute: 240,
  sendsPerMinute: 240,
  receivesInFlight: 8,
  controlHistory: 2_048,
  controlTtlMs: 60_000,
});
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const LocationSchema = z
  .object({
    source: z.enum([
      "device",
      "manual_pin",
      "manual_description",
      "unavailable",
    ]),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    accuracyM: z.number().finite().nonnegative().max(100_000).optional(),
    capturedAt: timestamp,
    description: z.string().max(160).optional(),
    building: z.string().max(80).optional(),
    floor: z.string().max(32).optional(),
    room: z.string().max(32).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.latitude === undefined) !== (v.longitude === undefined))
      ctx.addIssue({
        code: "custom",
        message: "Both coordinates are required",
      });
    if (
      (v.source === "device" || v.source === "manual_pin") &&
      v.latitude === undefined
    )
      ctx.addIssue({
        code: "custom",
        message: "Coordinate source requires coordinates",
      });
    if (
      v.source === "unavailable" &&
      (v.latitude !== undefined || v.accuracyM !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unavailable location cannot assert coordinates or accuracy",
      });
    if (v.source === "manual_description" && !v.description?.trim())
      ctx.addIssue({
        code: "custom",
        message: "Manual place description is required",
      });
  });
export type LocationReport = z.infer<typeof LocationSchema>;
const base = z.object({
  version: z.literal(1),
  id: hex32,
  origin: hex32,
  publicKey: hex32,
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  destination: z.union([hex32, z.literal("community")]),
  createdAt: timestamp,
  expiresAt: timestamp,
  hopLimit: z.number().int().min(1).max(LIMITS.hopLimit),
  requestId: hex32,
  revision: z.number().int().min(0).max(1_000_000),
});
const receipt = z.object({ messageId: hex32 }).strict();
export const BodySchema = z.discriminatedUnion("type", [
  base
    .extend({
      type: z.literal("sos"),
      payload: z
        .object({
          category: z.enum(["trapped", "injured", "stranded", "other"]),
          note: z.string().max(LIMITS.noteChars),
          displayName: z
            .string()
            .min(1)
            .max(48)
            .refine((v) => v.trim().length > 0, "Display name cannot be blank"),
          location: LocationSchema,
        })
        .strict(),
    })
    .strict(),
  base.extend({ type: z.literal("receipt"), payload: receipt }).strict(),
  base.extend({ type: z.literal("seen"), payload: receipt }).strict(),
  base
    .extend({
      type: z.literal("offer"),
      payload: z
        .object({
          note: z.string().max(LIMITS.noteChars),
          displayName: z
            .string()
            .min(1)
            .max(48)
            .refine((v) => v.trim().length > 0, "Display name cannot be blank"),
        })
        .strict(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("accept"),
      payload: z
        .object({ offerId: hex32, helperId: hex32, assignmentId: hex32 })
        .strict(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("assignment_receipt"),
      payload: z.object({ messageId: hex32, assignmentId: hex32 }).strict(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("cancel"),
      payload: z.object({ reason: z.string().max(LIMITS.noteChars) }).strict(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("complete"),
      payload: z.object({ note: z.string().max(LIMITS.noteChars) }).strict(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("inventory"),
      payload: z.object({ ids: z.array(hex32).max(LIMITS.inventory) }).strict(),
    })
    .strict(),
  base
    .extend({
      type: z.literal("missing"),
      payload: z.object({ ids: z.array(hex32).max(LIMITS.inventory) }).strict(),
    })
    .strict(),
]);
export type Body = z.infer<typeof BodySchema>;
export type MessageType = Body["type"];
export type Envelope = Body & { signature: string };
const SignedBodySchema = z
  .object({ body: BodySchema, signature: z.string().regex(/^[0-9a-f]{128}$/) })
  .strict();
export interface Packet {
  envelope: Envelope;
  hops: number;
}
export interface Identity {
  nodeId: string;
  publicKey: string;
  privateKey: string;
}
export type RandomBytes = (size: number) => Uint8Array;
export const bytesToHex = (v: Uint8Array): string =>
  Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
export function hexToBytes(v: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(v)) throw new Error("Invalid hex");
  return Uint8Array.from(v.match(/../g) ?? [], (b) => parseInt(b, 16));
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}
const utf8 = (v: string) => new TextEncoder().encode(v);
export const hash = (v: string) => bytesToHex(sha256(utf8(v)));
export function createIdentity(randomBytes: RandomBytes): Identity {
  const secret = randomBytes(32);
  if (secret.length !== 32)
    throw new Error("Random source returned wrong length");
  const pub = ed25519.getPublicKey(secret);
  return {
    privateKey: bytesToHex(secret),
    publicKey: bytesToHex(pub),
    nodeId: bytesToHex(sha256(pub)),
  };
}
export function createRequestId(
  identity: Pick<Identity, "nodeId">,
  randomBytes: RandomBytes,
): string {
  const nonce = randomBytes(16);
  if (nonce.length !== 16)
    throw new Error("Random source returned wrong length");
  return identity.nodeId.slice(0, 32) + bytesToHex(nonce);
}
type InputFor<T extends Body> = T extends Body
  ? Pick<T, "type" | "requestId" | "destination" | "payload"> & {
      revision?: number;
      ttlMs?: number;
      hopLimit?: number;
    }
  : never;
export type MessageInput = InputFor<Body>;
export function createEnvelope(
  identity: Identity,
  input: MessageInput,
  now: number,
  randomBytes: RandomBytes,
): Envelope {
  const nonce = randomBytes(16);
  if (nonce.length !== 16)
    throw new Error("Random source returned wrong length");
  const { ttlMs = LIMITS.ttlMs, hopLimit = LIMITS.hopLimit, ...rest } = input;
  const unsigned = {
    ...rest,
    revision: input.revision ?? 0,
    version: 1 as const,
    origin: identity.nodeId,
    publicKey: identity.publicKey,
    nonce: bytesToHex(nonce),
    createdAt: now,
    expiresAt: now + ttlMs,
    hopLimit,
  };
  const body = BodySchema.parse({ ...unsigned, id: hash(canonical(unsigned)) });
  const envelope = {
    ...body,
    signature: bytesToHex(
      ed25519.sign(utf8(canonical(body)), hexToBytes(identity.privateKey)),
    ),
  };
  if (!verifyEnvelope(envelope))
    throw new Error("Invalid signing identity or envelope");
  return envelope;
}
export function verifyEnvelope(value: unknown): value is Envelope {
  try {
    if (!value || typeof value !== "object") return false;
    const { signature, ...body } = value as Envelope;
    const parsed = SignedBodySchema.parse({ body, signature });
    const { id, ...unsigned } = parsed.body;
    return (
      parsed.body.expiresAt > parsed.body.createdAt &&
      parsed.body.expiresAt - parsed.body.createdAt <= LIMITS.maxTtlMs &&
      parsed.body.origin ===
        bytesToHex(sha256(hexToBytes(parsed.body.publicKey))) &&
      id === hash(canonical(unsigned)) &&
      ed25519.verify(
        hexToBytes(parsed.signature),
        utf8(canonical(parsed.body)),
        hexToBytes(parsed.body.publicKey),
        { zip215: false },
      )
    );
  } catch {
    return false;
  }
}
export const EnvelopeSchema = z
  .unknown()
  .refine(verifyEnvelope, "Invalid authenticated envelope")
  .transform((value) => value as Envelope);
export function encodePacket(packet: Packet): string {
  if (
    !verifyEnvelope(packet.envelope) ||
    !Number.isInteger(packet.hops) ||
    packet.hops < 0 ||
    packet.hops > packet.envelope.hopLimit
  )
    throw new Error("Invalid packet");
  const wire = JSON.stringify(packet);
  if (utf8(wire).length > LIMITS.wireBytes) throw new Error("Oversized packet");
  return wire;
}
export function decodePacket(wire: string, now: number): Packet {
  if (wire.length > LIMITS.wireBytes || utf8(wire).length > LIMITS.wireBytes)
    throw new Error("Oversized packet");
  const packet = z
    .object({
      envelope: z.unknown(),
      hops: z.number().int().nonnegative().max(LIMITS.hopLimit),
    })
    .strict()
    .parse(JSON.parse(wire));
  if (!verifyEnvelope(packet.envelope))
    throw new Error("Invalid signature or envelope");
  if (
    packet.hops > packet.envelope.hopLimit ||
    packet.envelope.expiresAt <= now ||
    packet.envelope.createdAt > now + LIMITS.futureSkewMs
  )
    throw new Error("Expired, future, or exhausted packet");
  return packet as Packet;
}

export interface OfferState {
  id: string;
  helperId: string;
  displayName: string;
  note: string;
  createdAt: number;
}
export interface RequestState {
  id: string;
  requesterId: string;
  messageId: string;
  createdAt: number;
  expiresAt: number;
  revision: number;
  category: "trapped" | "injured" | "stranded" | "other";
  note: string;
  displayName: string;
  location: LocationReport;
  status: "open" | "accepted" | "canceled" | "completed";
  offers: OfferState[];
  assignment?: {
    id: string;
    helperId: string;
    offerId: string;
    messageId: string;
    revision: number;
    received: boolean;
  };
  receipts: { nodeId: string; at: number; messageId: string }[];
  seenBy: string[];
  lastEventAt: number;
}
/** Recompute from durable history: late arrival cannot roll back an authoritative revision. */
export function deriveRequests(messages: readonly Envelope[]): RequestState[] {
  const valid = messages.filter(verifyEnvelope);
  const byId = new Map(valid.map((m) => [m.id, m]));
  const roots = valid
    .filter(
      (m) =>
        m.type === "sos" &&
        m.revision === 0 &&
        m.destination === "community" &&
        m.requestId.startsWith(m.origin.slice(0, 32)),
    )
    .sort(order);
  const states: RequestState[] = [];
  for (const sos of roots) {
    if (sos.type !== "sos" || states.some((s) => s.id === sos.requestId))
      continue;
    const related = valid.filter((m) => m.requestId === sos.requestId);
    const state: RequestState = {
      id: sos.requestId,
      requesterId: sos.origin,
      messageId: sos.id,
      createdAt: sos.createdAt,
      expiresAt: sos.expiresAt,
      revision: 0,
      ...sos.payload,
      status: "open",
      offers: [],
      receipts: [],
      seenBy: [],
      lastEventAt: sos.createdAt,
    };
    for (const offer of related.filter((m) => m.type === "offer").sort(order)) {
      if (
        offer.type === "offer" &&
        offer.origin !== sos.origin &&
        offer.destination === sos.origin
      )
        state.offers.push({
          id: offer.id,
          helperId: offer.origin,
          ...offer.payload,
          createdAt: offer.createdAt,
        });
    }
    const authority = related
      .filter(
        (m) =>
          m.origin === sos.origin &&
          ["accept", "cancel", "complete"].includes(m.type) &&
          m.revision > 0,
      )
      .sort((a, b) => a.revision - b.revision || order(a, b));
    for (const event of authority) {
      if (
        event.revision <= state.revision ||
        state.status === "canceled" ||
        state.status === "completed"
      )
        continue;
      if (event.type === "accept") {
        const offer = byId.get(event.payload.offerId);
        if (
          !offer ||
          offer.type !== "offer" ||
          offer.requestId !== sos.requestId ||
          offer.origin !== event.payload.helperId ||
          offer.destination !== sos.origin ||
          event.destination !== event.payload.helperId
        )
          continue;
        state.status = "accepted";
        state.assignment = {
          id: event.payload.assignmentId,
          helperId: event.payload.helperId,
          offerId: offer.id,
          messageId: event.id,
          revision: event.revision,
          received: false,
        };
      } else if (event.type === "cancel") {
        if (event.destination !== "community") continue;
        state.status = "canceled";
      } else if (event.type === "complete") {
        if (event.destination !== "community") continue;
        state.status = "completed";
      }
      state.revision = event.revision;
      state.lastEventAt = event.createdAt;
    }
    for (const event of related) {
      if (event.type === "receipt" || event.type === "seen") {
        const target = byId.get(event.payload.messageId);
        if (
          !target ||
          target.requestId !== sos.requestId ||
          target.origin !== sos.origin ||
          event.destination !== sos.origin ||
          event.origin === sos.origin ||
          ["receipt", "assignment_receipt", "inventory", "missing"].includes(
            target.type,
          )
        )
          continue;
        if (
          target.destination !== "community" &&
          target.destination !== event.origin
        )
          continue;
        if (
          event.type === "receipt" &&
          target.type === "sos" &&
          !state.receipts.some((r) => r.nodeId === event.origin)
        )
          state.receipts.push({
            nodeId: event.origin,
            at: event.createdAt,
            messageId: event.id,
          });
        if (event.type === "seen" && !state.seenBy.includes(event.origin))
          state.seenBy.push(event.origin);
      }
      if (
        event.type === "assignment_receipt" &&
        state.assignment &&
        event.origin === state.assignment.helperId &&
        event.destination === sos.origin &&
        event.payload.messageId === state.assignment.messageId &&
        event.payload.assignmentId === state.assignment.id &&
        event.revision === state.assignment.revision
      )
        state.assignment.received = true;
    }
    states.push(state);
  }
  return states.sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
}
function order(a: Envelope, b: Envelope): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export interface StoredMessage {
  envelope: Envelope;
  hops: number;
  receivedAt: number;
}
/** saveMessage must atomically deduplicate + save message/event/outbox. Enforce LIMITS.messages inside transaction. */
export interface MessageRepository {
  listMessages(): Promise<StoredMessage[]>;
  getMessage(id: string): Promise<StoredMessage | undefined>;
  saveMessage(
    envelope: Envelope,
    hops: number,
    receivedAt: number,
  ): Promise<boolean>;
  listForwarded(peerId: string): Promise<string[]>;
  markForwarded(peerId: string, messageId: string): Promise<void>;
}
export interface RouterOptions {
  identity: Identity;
  repository: MessageRepository;
  transport: { send(peerId: string, wire: string): Promise<void> };
  clock: () => number;
  randomBytes: RandomBytes;
  awaitForwarding?: boolean;
  onChange?: () => void;
  onError?: (error: Error) => void;
}
const control = (m: Envelope) => m.type === "inventory" || m.type === "missing";
const priority = (m: Envelope) =>
  ["receipt", "assignment_receipt", "accept", "cancel", "complete"].includes(
    m.type,
  )
    ? 0
    : m.type === "sos"
      ? 1
      : 2;
export class MeshRouter {
  private peers = new Map<
    string,
    {
      nodeId?: string;
      sent: Set<string>;
      controls: Map<string, number>;
      requested: Map<string, number>;
      rateStart: number;
      received: number;
      sends: number;
      inFlight: number;
      sending: Set<string>;
    }
  >();
  private acknowledgments = new Map<string, Promise<Envelope>>();
  private assignmentReconciliation: Promise<void> | undefined;
  private reconcileAgain = false;
  private flushPromise: Promise<void> | undefined;
  private flushAgain = false;
  constructor(private readonly options: RouterOptions) {}
  async publish(input: MessageInput): Promise<Envelope> {
    if (input.type === "inventory" || input.type === "missing")
      throw new Error("Control messages are internal");
    const m = createEnvelope(
      this.options.identity,
      input,
      this.options.clock(),
      this.options.randomBytes,
    );
    await this.options.repository.saveMessage(m, 0, this.options.clock());
    this.options.onChange?.();
    await this.forwardAfterPersistence();
    return m;
  }
  async connect(peerId: string): Promise<void> {
    if (!this.peers.has(peerId) && this.peers.size >= LIMITS.peers)
      throw new Error("Peer limit");
    if (this.peers.has(peerId)) return;
    this.peers.set(peerId, {
      sent: new Set(),
      controls: new Map(),
      requested: new Map(),
      rateStart: this.options.clock(),
      received: 0,
      sends: 0,
      inFlight: 0,
      sending: new Set(),
    });
    const records = await this.liveMessages();
    // First signed inventory announces a versioned application identity; BLE sessions remain untrusted.
    await this.sendControl(
      peerId,
      "inventory",
      records.slice(0, LIMITS.inventory).map((m) => m.envelope.id),
    );
    await this.flushPeer(peerId);
  }
  disconnect(peerId: string): void {
    this.peers.delete(peerId);
  }
  async receive(peerId: string, wire: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error("Unknown peer session");
    if (peer.inFlight >= LIMITS.receivesInFlight)
      throw new Error("Receive concurrency limit");
    peer.inFlight++;
    try {
      await this.receivePacket(peerId, wire);
    } finally {
      peer.inFlight--;
    }
  }
  private async receivePacket(peerId: string, wire: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error("Unknown peer session");
    const now = this.options.clock();
    if (now - peer.rateStart >= 60_000) {
      peer.rateStart = now;
      peer.received = 0;
      peer.sends = 0;
    }
    if (++peer.received > LIMITS.receivesPerMinute)
      throw new Error("Receive rate limit");
    const { envelope: m, hops } = decodePacket(wire, now);
    if (control(m)) {
      if (
        hops !== 0 ||
        m.requestId !== "0".repeat(64) ||
        m.revision !== 0 ||
        m.expiresAt - m.createdAt > LIMITS.controlTtlMs ||
        (m.destination !== "community" &&
          m.destination !== this.options.identity.nodeId)
      )
        throw new Error("Invalid control scope");
      if (m.origin === this.options.identity.nodeId)
        throw new Error("Self-contact is not a remote peer");
      if (peer.nodeId && peer.nodeId !== m.origin)
        throw new Error("Peer identity changed");
      peer.nodeId = m.origin;
      for (const [id, expiry] of peer.controls)
        if (expiry <= now) peer.controls.delete(id);
      if (peer.controls.has(m.id)) return;
      if (peer.controls.size >= LIMITS.controlHistory)
        throw new Error("Control replay history full");
      peer.controls.set(m.id, m.expiresAt);
      if (m.type === "inventory") {
        const missing: string[] = [];
        for (const id of new Set(m.payload.ids)) {
          if (await this.options.repository.getMessage(id))
            this.rememberSent(peer.sent, id);
          else missing.push(id);
        }
        if (missing.length) await this.sendControl(peerId, "missing", missing);
      } else if (m.type === "missing") {
        for (const [id, at] of peer.requested)
          if (now - at >= LIMITS.controlTtlMs) peer.requested.delete(id);
        for (const id of new Set(m.payload.ids)) {
          if (peer.requested.has(id)) continue;
          const stored = await this.options.repository.getMessage(id);
          if (!stored || peer.requested.has(id)) continue;
          if (peer.requested.size >= LIMITS.messages) break;
          peer.requested.set(id, now);
          try {
            if (!(await this.sendStored(peerId, stored, true)))
              peer.requested.delete(id);
          } catch (error) {
            peer.requested.delete(id);
            throw error;
          }
        }
      }
      return;
    }
    const added = await this.options.repository.saveMessage(m, hops, now);
    this.rememberSent(peer.sent, m.id);
    if (added) {
      this.options.onChange?.();
      await this.reconcileAssignments();
      await this.forwardAfterPersistence();
    }
  }
  /** Called only when this phone intentionally becomes an SOS endpoint, never on relay persistence. */
  acknowledge(messageId: string): Promise<Envelope> {
    const pending = this.acknowledgments.get(messageId);
    if (pending) return pending;
    if (this.acknowledgments.size >= LIMITS.messages)
      return Promise.reject(new Error("Acknowledgment capacity"));
    const operation = this.acknowledgeOnce(messageId).finally(() =>
      this.acknowledgments.delete(messageId),
    );
    this.acknowledgments.set(messageId, operation);
    return operation;
  }
  private async acknowledgeOnce(messageId: string): Promise<Envelope> {
    const stored = await this.options.repository.getMessage(messageId);
    if (
      !stored ||
      stored.envelope.type !== "sos" ||
      stored.envelope.origin === this.options.identity.nodeId
    )
      throw new Error("Unknown remote SOS");
    const previous = (await this.options.repository.listMessages()).find(
      (r) =>
        r.envelope.type === "receipt" &&
        r.envelope.origin === this.options.identity.nodeId &&
        r.envelope.payload.messageId === messageId,
    );
    if (previous) return previous.envelope;
    return this.publish({
      type: "receipt",
      requestId: stored.envelope.requestId,
      destination: stored.envelope.origin,
      payload: { messageId },
      ttlMs: LIMITS.maxTtlMs,
    });
  }
  private async forwardAfterPersistence(): Promise<void> {
    if (this.options.awaitForwarding === false && this.options.onError) {
      void this.flush().catch((error) =>
        this.options.onError!(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    } else await this.flush();
  }
  flush(): Promise<void> {
    if (this.flushPromise) {
      this.flushAgain = true;
      return this.flushPromise;
    }
    const operation = (async () => {
      do {
        this.flushAgain = false;
        await Promise.all(
          [...this.peers.keys()].map((id) => this.flushPeer(id)),
        );
      } while (this.flushAgain);
    })().finally(() => {
      this.flushPromise = undefined;
    });
    this.flushPromise = operation;
    return operation;
  }
  private async liveMessages(): Promise<StoredMessage[]> {
    return (await this.options.repository.listMessages())
      .filter(
        (r) =>
          !control(r.envelope) &&
          r.envelope.expiresAt > this.options.clock() &&
          r.hops < r.envelope.hopLimit,
      )
      .sort(
        (a, b) =>
          priority(a.envelope) - priority(b.envelope) ||
          order(a.envelope, b.envelope),
      );
  }
  private async flushPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const pending = (await this.liveMessages()).filter(
      (m) => !peer.sent.has(m.envelope.id),
    );
    const oldest = [...pending].sort((a, b) => order(a.envelope, b.envelope));
    const chosen = new Set<string>();
    for (let slot = 0; slot < LIMITS.sendsPerFlush; slot++) {
      // One quarter of slots serve oldest traffic across all priorities to avoid starvation.
      const record = (slot % 4 === 3 ? oldest : pending).find(
        (r) => !chosen.has(r.envelope.id),
      );
      if (!record) break;
      chosen.add(record.envelope.id);
      await this.sendStored(peerId, record);
    }
  }
  private rememberSent(set: Set<string>, id: string): void {
    if (set.size >= LIMITS.messages && !set.has(id))
      set.delete(set.values().next().value!);
    set.add(id);
  }
  private async sendStored(
    peerId: string,
    record: StoredMessage,
    force = false,
  ): Promise<boolean> {
    const now = this.options.clock();
    const peer = this.peers.get(peerId);
    if (
      !peer ||
      (!force && peer.sent.has(record.envelope.id)) ||
      record.hops >= record.envelope.hopLimit ||
      record.envelope.expiresAt <= now
    )
      return false;
    if (now - peer.rateStart >= 60_000) {
      peer.rateStart = now;
      peer.received = 0;
      peer.sends = 0;
    }
    if (
      peer.sends >= LIMITS.sendsPerMinute ||
      peer.sending.size >= LIMITS.receivesInFlight ||
      peer.sending.has(record.envelope.id)
    )
      return false;
    peer.sends++;
    peer.sending.add(record.envelope.id);
    // Reserve in memory before async native operation so simultaneous flushes do not flood duplicates.
    this.rememberSent(peer.sent, record.envelope.id);
    try {
      await this.options.transport.send(
        peerId,
        encodePacket({ envelope: record.envelope, hops: record.hops + 1 }),
      );
      await this.options.repository.markForwarded(peerId, record.envelope.id);
      this.options.onChange?.();
      return true;
    } catch (error) {
      peer.sent.delete(record.envelope.id);
      const failure = error instanceof Error ? error : new Error(String(error));
      if (this.options.onError) this.options.onError(failure);
      else throw failure;
      return false;
    } finally {
      peer.sending.delete(record.envelope.id);
    }
  }
  private async sendControl(
    peerId: string,
    type: "inventory" | "missing",
    ids: string[],
  ): Promise<void> {
    const envelope = createEnvelope(
      this.options.identity,
      {
        type,
        requestId: "0".repeat(64),
        destination: this.peers.get(peerId)?.nodeId ?? "community",
        payload: { ids },
        ttlMs: LIMITS.controlTtlMs,
      },
      this.options.clock(),
      this.options.randomBytes,
    );
    await this.options.transport.send(
      peerId,
      encodePacket({ envelope, hops: 0 }),
    );
  }
  private reconcileAssignments(): Promise<void> {
    if (this.assignmentReconciliation) {
      this.reconcileAgain = true;
      return this.assignmentReconciliation;
    }
    const operation = (async () => {
      do {
        this.reconcileAgain = false;
        await this.reconcileAssignmentsOnce();
      } while (this.reconcileAgain);
    })().finally(() => {
      this.assignmentReconciliation = undefined;
    });
    this.assignmentReconciliation = operation;
    return operation;
  }
  private async reconcileAssignmentsOnce(): Promise<void> {
    const records = await this.options.repository.listMessages();
    const states = deriveRequests(records.map((r) => r.envelope));
    for (const state of states) {
      const assignment = state.assignment;
      if (
        state.status !== "accepted" ||
        !assignment ||
        assignment.helperId !== this.options.identity.nodeId ||
        assignment.received
      )
        continue;
      const acceptance = records.find(
        (r) => r.envelope.id === assignment.messageId,
      )?.envelope;
      if (!acceptance || acceptance.expiresAt <= this.options.clock()) continue;
      await this.publish({
        type: "assignment_receipt",
        requestId: state.id,
        destination: state.requesterId,
        revision: assignment.revision,
        payload: {
          messageId: assignment.messageId,
          assignmentId: assignment.id,
        },
      });
    }
  }
}

export * from "./social.ts";
