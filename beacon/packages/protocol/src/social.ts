import { z } from "zod";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  concatBytes,
} from "@noble/hashes/utils";
import { fromByteArray, toByteArray } from "base64-js";
import type { Identity, RandomBytes } from "./index.js";

/** Inject a CSPRNG. Static identity ECDH has no forward secrecy; invites are shared secrets. */
export const SOCIAL_LIMITS = Object.freeze({
  wireBytes: 16_384,
  nameChars: 48,
  messageChars: 1_024,
  presenceTtlMs: 60_000,
  presenceFutureSkewMs: 30_000,
  directTtlMs: 24 * 60 * 60_000,
  directFutureSkewMs: 5 * 60_000,
});
export interface SocialGroup {
  id: string;
  name: string;
  inviteCode: string;
}
export interface Presence {
  nodeId: string;
  publicKey: string;
  name: string;
  scope: string | null;
  createdAt: number;
}
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const nonce24 = z.string().regex(/^[0-9a-f]{48}$/);
const signature = z.string().regex(/^[0-9a-f]{128}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scopeSchema = hex32.nullable();
const nameSchema = z
  .string()
  .min(1)
  .max(SOCIAL_LIMITS.nameChars)
  .refine((v) => v === v.trim(), "Name must be trimmed");
const base64Schema = z
  .string()
  .min(24)
  .max(SOCIAL_LIMITS.wireBytes)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const presenceBodySchema = z
  .object({
    version: z.literal(1),
    type: z.literal("presence"),
    nodeId: hex32,
    publicKey: hex32,
    name: nameSchema,
    scope: scopeSchema,
    createdAt: timestamp,
    expiresAt: timestamp,
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
const presenceSchema = presenceBodySchema.extend({ signature }).strict();
const directHeaderSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("direct"),
    origin: hex32,
    publicKey: hex32,
    recipientPublicKey: hex32,
    destination: hex32,
    scope: scopeSchema,
    createdAt: timestamp,
    expiresAt: timestamp,
    nonce: nonce24,
  })
  .strict();
const directSchema = directHeaderSchema
  .extend({ id: hex32, ciphertext: base64Schema, signature })
  .strict();
export type DirectPacket = Readonly<z.infer<typeof directSchema>>;
const directContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      text: z
        .string()
        .min(1)
        .max(SOCIAL_LIMITS.messageChars)
        .refine((v) => v.trim().length > 0, "Empty message"),
    })
    .strict(),
  z.object({ kind: z.literal("receipt"), messageId: hex32 }).strict(),
]);
export type DirectContent = z.infer<typeof directContentSchema>;
const groupHeaderSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("group"),
    groupId: hex32,
    nonce: nonce24,
  })
  .strict();
const groupSchema = groupHeaderSchema
  .extend({ ciphertext: base64Schema })
  .strict();

// Same recursively sorted JSON rules as mesh envelopes, independently domain-separated below.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}
function bytes(value: unknown): Uint8Array {
  return utf8ToBytes(canonical(value));
}
function nodeId(publicKey: string): string {
  return bytesToHex(sha256(hexToBytes(publicKey)));
}
function checkedRandom(random: RandomBytes, count: number): Uint8Array {
  const value = random(count);
  if (!(value instanceof Uint8Array) || value.length !== count)
    throw new Error("Random source returned wrong length");
  return value;
}
function checkedWire(wire: string): string {
  if (
    typeof wire !== "string" ||
    wire.length > SOCIAL_LIMITS.wireBytes ||
    utf8ToBytes(wire).length > SOCIAL_LIMITS.wireBytes
  )
    throw new Error("Social packet exceeds 16 KiB");
  return wire;
}
function encode(value: unknown): string {
  return checkedWire(JSON.stringify(value));
}
function parse(wire: string): unknown {
  return JSON.parse(checkedWire(wire));
}
function cipherBytes(ciphertext: string): Uint8Array {
  const value = toByteArray(ciphertext);
  if (fromByteArray(value) !== ciphertext)
    throw new Error("Noncanonical ciphertext");
  return value;
}
function checkIdentity(identity: Identity): void {
  hex32.parse(identity.privateKey);
  hex32.parse(identity.publicKey);
  hex32.parse(identity.nodeId);
  if (
    bytesToHex(ed25519.getPublicKey(hexToBytes(identity.privateKey))) !==
      identity.publicKey ||
    nodeId(identity.publicKey) !== identity.nodeId
  )
    throw new Error("Inconsistent signing identity");
}
const signingBytes = (body: unknown) =>
  concatBytes(utf8ToBytes("beacon/social/signature/v1\0"), bytes(body));
function sign(identity: Identity, body: unknown): string {
  checkIdentity(identity);
  return bytesToHex(
    ed25519.sign(signingBytes(body), hexToBytes(identity.privateKey)),
  );
}
function validSignature(
  publicKey: string,
  signed: unknown,
  proof: string,
): boolean {
  return ed25519.verify(
    hexToBytes(proof),
    signingBytes(signed),
    hexToBytes(publicKey),
    { zip215: false },
  );
}
function live(
  createdAt: number,
  expiresAt: number,
  ttl: number,
  now: number,
  skew: number,
): boolean {
  return (
    Number.isSafeInteger(now) &&
    now >= 0 &&
    expiresAt - createdAt === ttl &&
    expiresAt > now &&
    createdAt <= now + skew
  );
}

/** The invite is a 256-bit capability. Never advertise, log, or include it in packet metadata. */
export function createSocialGroup(
  name: string,
  random: RandomBytes,
): SocialGroup {
  return joinSocialGroup(
    name,
    `beacon1-${bytesToHex(checkedRandom(random, 32))}`,
  );
}
export function joinSocialGroup(name: string, inviteCode: string): SocialGroup {
  const normalized = z.string().max(128).parse(inviteCode).trim().toLowerCase();
  if (!/^beacon1-[0-9a-f]{64}$/.test(normalized))
    throw new Error("Invalid Beacon group invite");
  const secret = hexToBytes(normalized.slice(8));
  const id = bytesToHex(
    sha256(concatBytes(utf8ToBytes("beacon/group/id/v1\0"), secret)),
  );
  secret.fill(0);
  return { id, name: nameSchema.parse(name.trim()), inviteCode: normalized };
}
function groupKey(group: SocialGroup): Uint8Array {
  const verified = joinSocialGroup(group.name, group.inviteCode);
  if (verified.id !== group.id)
    throw new Error("Group ID does not match invite");
  const secret = hexToBytes(verified.inviteCode.slice(8));
  try {
    return hkdf(
      sha256,
      secret,
      undefined,
      utf8ToBytes("beacon/group/encryption/v1"),
      32,
    );
  } finally {
    secret.fill(0);
  }
}
export function sealGroup(
  group: SocialGroup,
  wire: string,
  random: RandomBytes,
): string {
  checkedWire(wire);
  const key = groupKey(group);
  try {
    const header = groupHeaderSchema.parse({
      version: 1,
      type: "group",
      groupId: group.id,
      nonce: bytesToHex(checkedRandom(random, 24)),
    });
    const ciphertext = xchacha20poly1305(
      key,
      hexToBytes(header.nonce),
      bytes(header),
    ).encrypt(utf8ToBytes(wire));
    return encode({ ...header, ciphertext: fromByteArray(ciphertext) });
  } finally {
    key.fill(0);
  }
}
/** Authentication failure, other group, malformed input, and invalid UTF-8 all fail closed. */
export function openGroup(group: SocialGroup, wire: string): string | null {
  let key: Uint8Array | undefined;
  try {
    const { ciphertext, ...header } = groupSchema.parse(parse(wire));
    if (header.groupId !== group.id) return null;
    key = groupKey(group);
    const plaintext = xchacha20poly1305(
      key,
      hexToBytes(header.nonce),
      bytes(header),
    ).decrypt(cipherBytes(ciphertext));
    try {
      return checkedWire(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
    } finally {
      plaintext.fill(0);
    }
  } catch {
    return null;
  } finally {
    key?.fill(0);
  }
}

/** Send only on the current native connection; do not persist, flood, or replay presence. */
export function createPresence(
  identity: Identity,
  name: string,
  scope: string | null,
  now: number,
  random: RandomBytes,
): string {
  const body = presenceBodySchema.parse({
    version: 1,
    type: "presence",
    nodeId: identity.nodeId,
    publicKey: identity.publicKey,
    name: name.trim(),
    scope,
    createdAt: now,
    expiresAt: now + SOCIAL_LIMITS.presenceTtlMs,
    nonce: bytesToHex(checkedRandom(random, 16)),
  });
  return encode({ ...body, signature: sign(identity, body) });
}
export function verifyPresence(wire: string, now: number): Presence | null {
  try {
    const { signature: proof, ...body } = presenceSchema.parse(parse(wire));
    if (
      body.nodeId !== nodeId(body.publicKey) ||
      !live(
        body.createdAt,
        body.expiresAt,
        SOCIAL_LIMITS.presenceTtlMs,
        now,
        SOCIAL_LIMITS.presenceFutureSkewMs,
      ) ||
      !validSignature(body.publicKey, body, proof)
    )
      return null;
    return {
      nodeId: body.nodeId,
      publicKey: body.publicKey,
      name: body.name,
      scope: body.scope,
      createdAt: body.createdAt,
    };
  } catch {
    return null;
  }
}

type DirectHeader = z.infer<typeof directHeaderSchema>;
function directKey(
  identity: Identity,
  otherPublicKey: string,
  header: DirectHeader,
): Uint8Array {
  const secret = ed25519.utils.toMontgomerySecret(
    hexToBytes(identity.privateKey),
  );
  let shared: Uint8Array | undefined;
  try {
    shared = x25519.getSharedSecret(
      secret,
      ed25519.utils.toMontgomery(hexToBytes(otherPublicKey)),
    );
    return hkdf(
      sha256,
      shared,
      hexToBytes(header.nonce),
      concatBytes(utf8ToBytes("beacon/direct/key/v1\0"), bytes(header)),
      32,
    );
  } finally {
    secret.fill(0);
    shared?.fill(0);
  }
}
function packetId(unsigned: unknown): string {
  return bytesToHex(
    sha256(concatBytes(utf8ToBytes("beacon/direct/id/v1\0"), bytes(unsigned))),
  );
}
function createDirect(
  identity: Identity,
  recipientPublicKey: string,
  content: DirectContent,
  scope: string | null,
  now: number,
  random: RandomBytes,
): DirectPacket {
  checkIdentity(identity);
  hex32.parse(recipientPublicKey);
  const header = directHeaderSchema.parse({
    version: 1,
    type: "direct",
    origin: identity.nodeId,
    publicKey: identity.publicKey,
    recipientPublicKey,
    destination: nodeId(recipientPublicKey),
    scope,
    createdAt: now,
    expiresAt: now + SOCIAL_LIMITS.directTtlMs,
    nonce: bytesToHex(checkedRandom(random, 24)),
  });
  const key = directKey(identity, recipientPublicKey, header);
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = bytes(directContentSchema.parse(content));
    const unsigned = {
      ...header,
      ciphertext: fromByteArray(
        xchacha20poly1305(key, hexToBytes(header.nonce), bytes(header)).encrypt(
          plaintext,
        ),
      ),
    };
    const body = { ...unsigned, id: packetId(unsigned) };
    const packet = Object.freeze({ ...body, signature: sign(identity, body) });
    encode(packet);
    return packet;
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}
export function createDirectMessage(
  identity: Identity,
  recipientPublicKey: string,
  text: string,
  scope: string | null,
  now: number,
  random: RandomBytes,
): DirectPacket {
  return createDirect(
    identity,
    recipientPublicKey,
    { kind: "message", text },
    scope,
    now,
    random,
  );
}
export function createDirectReceipt(
  identity: Identity,
  recipientPublicKey: string,
  messageId: string,
  scope: string | null,
  now: number,
  random: RandomBytes,
): DirectPacket {
  return createDirect(
    identity,
    recipientPublicKey,
    { kind: "receipt", messageId },
    scope,
    now,
    random,
  );
}
function verifiedDirect(value: unknown): DirectPacket {
  const packet = directSchema.parse(value);
  encode(packet);
  const { signature: proof, ...body } = packet;
  const { id, ...unsigned } = body;
  if (
    packet.origin !== nodeId(packet.publicKey) ||
    packet.destination !== nodeId(packet.recipientPublicKey) ||
    packet.expiresAt - packet.createdAt !== SOCIAL_LIMITS.directTtlMs ||
    id !== packetId(unsigned) ||
    !validSignature(packet.publicKey, body, proof)
  )
    throw new Error("Invalid direct message authentication");
  // Validate canonical base64 even before it reaches a recipient.
  cipherBytes(packet.ciphertext);
  return Object.freeze(packet);
}
export function encodeDirect(packet: DirectPacket): string {
  return encode(verifiedDirect(packet));
}
export function decodeDirect(wire: string, now: number): DirectPacket | null {
  try {
    const packet = verifiedDirect(parse(wire));
    return live(
      packet.createdAt,
      packet.expiresAt,
      SOCIAL_LIMITS.directTtlMs,
      now,
      SOCIAL_LIMITS.directFutureSkewMs,
    )
      ? packet
      : null;
  } catch {
    return null;
  }
}
/** Also opens sender history. For incoming traffic call decodeDirect(wire, now) first; history may be expired. */
export function openDirect(
  identity: Identity,
  packet: DirectPacket,
): DirectContent | null {
  let key: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    checkIdentity(identity);
    const verified = verifiedDirect(packet);
    const { id: _id, ciphertext, signature: _signature, ...header } = verified;
    let otherKey: string;
    if (
      identity.nodeId === verified.destination &&
      identity.publicKey === verified.recipientPublicKey
    )
      otherKey = verified.publicKey;
    else if (
      identity.nodeId === verified.origin &&
      identity.publicKey === verified.publicKey
    )
      otherKey = verified.recipientPublicKey;
    else return null;
    key = directKey(identity, otherKey, header);
    plaintext = xchacha20poly1305(
      key,
      hexToBytes(header.nonce),
      bytes(header),
    ).decrypt(cipherBytes(ciphertext));
    return directContentSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch {
    return null;
  } finally {
    key?.fill(0);
    plaintext?.fill(0);
  }
}

export const LOCATION_LIMITS = Object.freeze({
  ttlMs: 120_000,
  futureSkewMs: 5_000,
  wireBytes: 2048,
});
const sharedLocationSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().nonnegative().max(100_000).optional(),
    capturedAt: timestamp,
  })
  .strict();
export type SharedLocation = z.infer<typeof sharedLocationSchema>;
const locationBodySchema = z
  .object({
    version: z.literal(1),
    type: z.literal("location"),
    nodeId: hex32,
    publicKey: hex32,
    scope: scopeSchema,
    createdAt: timestamp,
    expiresAt: timestamp,
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    location: sharedLocationSchema.nullable(),
  })
  .strict();
const locationSchema = locationBodySchema.extend({ signature }).strict();
export interface LocationUpdate {
  nodeId: string;
  publicKey: string;
  scope: string | null;
  createdAt: number;
  expiresAt: number;
  location: SharedLocation | null;
}
function locationFresh(
  location: SharedLocation | null,
  createdAt: number,
  now: number,
) {
  return (
    !location ||
    (location.capturedAt <= createdAt + LOCATION_LIMITS.futureSkewMs &&
      location.capturedAt <= now + LOCATION_LIMITS.futureSkewMs &&
      location.capturedAt + LOCATION_LIMITS.ttlMs > now)
  );
}
/** Ephemeral disclosure only: never persist, cloud-sync, flood, or relay this wire. */
export function createLocation(
  identity: Identity,
  location: SharedLocation | null,
  scope: string | null,
  now: number,
  random: RandomBytes,
): string {
  const body = locationBodySchema.parse({
    version: 1,
    type: "location",
    nodeId: identity.nodeId,
    publicKey: identity.publicKey,
    scope,
    createdAt: now,
    expiresAt: now + LOCATION_LIMITS.ttlMs,
    nonce: bytesToHex(checkedRandom(random, 16)),
    location,
  });
  if (!locationFresh(body.location, now, now))
    throw new Error("Location fix is stale or in the future");
  return encode({ ...body, signature: sign(identity, body) });
}
export function verifyLocation(
  wire: string,
  now: number,
): LocationUpdate | null {
  try {
    if (
      wire.length > LOCATION_LIMITS.wireBytes ||
      utf8ToBytes(wire).length > LOCATION_LIMITS.wireBytes
    )
      return null;
    const { signature: proof, ...body } = locationSchema.parse(parse(wire));
    if (
      body.nodeId !== nodeId(body.publicKey) ||
      !live(
        body.createdAt,
        body.expiresAt,
        LOCATION_LIMITS.ttlMs,
        now,
        LOCATION_LIMITS.futureSkewMs,
      ) ||
      !locationFresh(body.location, body.createdAt, now) ||
      !validSignature(body.publicKey, body, proof)
    )
      return null;
    return {
      nodeId: body.nodeId,
      publicKey: body.publicKey,
      scope: body.scope,
      createdAt: body.createdAt,
      expiresAt: body.expiresAt,
      location: body.location,
    };
  } catch {
    return null;
  }
}
