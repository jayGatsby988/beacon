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

export const CALL_LIMITS = Object.freeze({
  wireBytes: 4096,
  ttlMs: 30_000,
  futureSkewMs: 5_000,
  replayEntries: 1000,
});
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const base64 = z
  .string()
  .max(2048)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const key = base64.refine((value) => {
  try {
    return (
      toByteArray(value).length === 32 &&
      fromByteArray(toByteArray(value)) === value
    );
  } catch {
    return false;
  }
});
const common = { callId: hex, version: z.literal(1) };
const contentSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...common,
        kind: z.literal("invite"),
        keyBase64: key,
        initiator: z.boolean(),
        psm: z.number().int().min(0).max(65535),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("accept"),
        psm: z.number().int().min(0).max(65535),
      })
      .strict(),
    z.object({ ...common, kind: z.literal("decline") }).strict(),
    z.object({ ...common, kind: z.literal("end") }).strict(),
    z.object({ ...common, kind: z.literal("busy") }).strict(),
  ])
  .refine(
    (content) =>
      content.kind !== "invite" ||
      (content.initiator ? content.psm === 0 : content.psm > 0),
    "Invalid L2CAP role/PSM",
  );
export type CallContent = z.infer<typeof contentSchema>;
const headerSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("call"),
    origin: hex,
    publicKey: hex,
    destination: hex,
    recipientPublicKey: hex,
    scope: hex.nullable(),
    createdAt: time,
    expiresAt: time,
    nonce: z.string().regex(/^[0-9a-f]{48}$/),
  })
  .strict();
const packetSchema = headerSchema
  .extend({
    id: hex,
    ciphertext: base64.min(24),
    signature: z.string().regex(/^[0-9a-f]{128}$/),
  })
  .strict();
export type CallPacket = Readonly<z.infer<typeof packetSchema>>;
type Header = z.infer<typeof headerSchema>;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
    .join(",")}}`;
}
const bytes = (value: unknown) => utf8ToBytes(canonical(value));
const domain = (label: string, value: unknown) =>
  concatBytes(utf8ToBytes(`beacon/call/${label}/v1\0`), bytes(value));
const nodeId = (publicKey: string) => bytesToHex(sha256(hexToBytes(publicKey)));
function checkIdentity(identity: Identity) {
  if (
    bytesToHex(ed25519.getPublicKey(hexToBytes(identity.privateKey))) !==
      identity.publicKey ||
    nodeId(identity.publicKey) !== identity.nodeId
  )
    throw new Error("Invalid call identity");
}
function encode(value: unknown): string {
  const wire = JSON.stringify(value);
  if (utf8ToBytes(wire).length > CALL_LIMITS.wireBytes)
    throw new Error("Call signal too large");
  return wire;
}
function encryptionKey(identity: Identity, otherKey: string, header: Header) {
  const secret = ed25519.utils.toMontgomerySecret(
    hexToBytes(identity.privateKey),
  );
  let shared: Uint8Array | undefined;
  try {
    shared = x25519.getSharedSecret(
      secret,
      ed25519.utils.toMontgomery(hexToBytes(otherKey)),
    );
    return hkdf(
      sha256,
      shared,
      hexToBytes(header.nonce),
      domain("key", header),
      32,
    );
  } finally {
    secret.fill(0);
    shared?.fill(0);
  }
}
function verified(value: unknown): CallPacket {
  const packet = packetSchema.parse(value);
  encode(packet);
  const { signature, ...signed } = packet;
  const { id, ...unsigned } = signed;
  if (
    packet.origin !== nodeId(packet.publicKey) ||
    packet.destination !== nodeId(packet.recipientPublicKey) ||
    packet.expiresAt - packet.createdAt !== CALL_LIMITS.ttlMs ||
    id !== bytesToHex(sha256(domain("id", unsigned))) ||
    !ed25519.verify(
      hexToBytes(signature),
      domain("signature", signed),
      hexToBytes(packet.publicKey),
      { zip215: false },
    ) ||
    fromByteArray(toByteArray(packet.ciphertext)) !== packet.ciphertext
  )
    throw new Error("Invalid call signature");
  return Object.freeze(packet);
}
export function createCallSignal(
  identity: Identity,
  recipientPublicKey: string,
  content: CallContent,
  scope: string | null,
  now: number,
  random: RandomBytes,
): CallPacket {
  checkIdentity(identity);
  const nonce = random(24);
  if (!(nonce instanceof Uint8Array) || nonce.length !== 24)
    throw new Error("Invalid random source");
  const header = headerSchema.parse({
    version: 1,
    type: "call",
    origin: identity.nodeId,
    publicKey: identity.publicKey,
    destination: nodeId(recipientPublicKey),
    recipientPublicKey,
    scope,
    createdAt: now,
    expiresAt: now + CALL_LIMITS.ttlMs,
    nonce: bytesToHex(nonce),
  });
  const secret = encryptionKey(identity, recipientPublicKey, header);
  const plaintext = bytes(contentSchema.parse(content));
  try {
    const unsigned = {
      ...header,
      ciphertext: fromByteArray(
        xchacha20poly1305(secret, nonce, bytes(header)).encrypt(plaintext),
      ),
    };
    const signed = {
      ...unsigned,
      id: bytesToHex(sha256(domain("id", unsigned))),
    };
    const packet = Object.freeze({
      ...signed,
      signature: bytesToHex(
        ed25519.sign(
          domain("signature", signed),
          hexToBytes(identity.privateKey),
        ),
      ),
    });
    encode(packet);
    return packet;
  } finally {
    secret.fill(0);
    plaintext.fill(0);
  }
}
export function encodeCallSignal(packet: CallPacket): string {
  return encode(verified(packet));
}
export function decodeCallSignal(wire: string, now: number): CallPacket | null {
  try {
    if (
      typeof wire !== "string" ||
      wire.length > CALL_LIMITS.wireBytes ||
      utf8ToBytes(wire).length > CALL_LIMITS.wireBytes ||
      !Number.isSafeInteger(now) ||
      now < 0
    )
      return null;
    const packet = verified(JSON.parse(wire));
    return packet.expiresAt > now &&
      packet.createdAt <= now + CALL_LIMITS.futureSkewMs
      ? packet
      : null;
  } catch {
    return null;
  }
}
/** Recipient-only opening; these ephemeral signals are never suitable for storage/retry queues. */
export function openCallSignal(
  identity: Identity,
  packet: CallPacket,
  now: number,
): CallContent | null {
  let secret: Uint8Array | undefined, plaintext: Uint8Array | undefined;
  try {
    checkIdentity(identity);
    const valid = decodeCallSignal(encode(packet), now);
    if (
      !valid ||
      valid.destination !== identity.nodeId ||
      valid.recipientPublicKey !== identity.publicKey
    )
      return null;
    const { id: _id, signature: _signature, ciphertext, ...header } = valid;
    secret = encryptionKey(identity, header.publicKey, header);
    plaintext = xchacha20poly1305(
      secret,
      hexToBytes(header.nonce),
      bytes(header),
    ).decrypt(toByteArray(ciphertext));
    return contentSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch {
    return null;
  } finally {
    secret?.fill(0);
    plaintext?.fill(0);
  }
}
