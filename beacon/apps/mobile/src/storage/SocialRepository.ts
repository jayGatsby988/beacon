import type { Database } from "./Repository";

export interface StoredPerson {
  nodeId: string;
  publicKey: string;
  name: string;
  scope: string | null;
  lastSeenAt: number;
}
export interface StoredDirect {
  id: string;
  origin: string;
  publicKey: string;
  destination: string;
  scope: string | null;
  createdAt: number;
  expiresAt: number;
  wire: string;
}
interface PersonRow {
  node_id: string;
  public_key: string;
  name: string;
  scope: string;
  last_seen_at: number;
}
interface PacketRow {
  id: string;
  origin: string;
  public_key: string;
  destination: string;
  scope: string;
  created_at: number;
  expires_at: number;
  wire: string;
}
const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS social_people (
  node_id TEXT NOT NULL, public_key TEXT NOT NULL, name TEXT NOT NULL,
  scope TEXT NOT NULL, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(node_id,scope)
);
CREATE TABLE IF NOT EXISTS social_packets (
  id TEXT PRIMARY KEY, origin TEXT NOT NULL, public_key TEXT NOT NULL,
  destination TEXT NOT NULL, scope TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, wire TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS social_packets_expiry ON social_packets(expires_at);
`;
function bounded(value: string, limit: number, empty = false): boolean {
  return (
    typeof value === "string" &&
    (empty || value.length > 0) &&
    value.length <= limit
  );
}
function identifier(value: string): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validScope(scope: string | null): boolean {
  return scope === null || identifier(scope);
}
function timestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Single writer per connection. Callers verify signatures and ciphertext before admission.
 * Only explicit columns are persisted: never decrypted content or arbitrary input properties.
 * Expired packets remain for seven days of history; retained packets and contacts are never silently evicted.
 */
export class SocialRepository {
  private writeTail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly db: Database,
    private readonly clock = Date.now,
  ) {}
  async initialize(): Promise<void> {
    await this.db.execAsync(SCHEMA);
    await this.write(() => this.prune());
  }
  private write<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.writeTail.then(async () => {
      await this.db.execAsync("BEGIN IMMEDIATE");
      try {
        const result = await operation();
        await this.db.execAsync("COMMIT");
        return result;
      } catch (error) {
        await this.db.execAsync("ROLLBACK");
        throw error;
      }
    });
    this.writeTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
  private async prune(): Promise<void> {
    await this.db.runAsync(
      "DELETE FROM social_packets WHERE expires_at<=?",
      this.clock() - HISTORY_MS,
    );
  }
  async people(): Promise<StoredPerson[]> {
    await this.writeTail;
    return (
      await this.db.getAllAsync<PersonRow>(
        "SELECT * FROM social_people ORDER BY last_seen_at DESC,node_id,scope",
      )
    ).map((row) => ({
      nodeId: row.node_id,
      publicKey: row.public_key,
      name: row.name,
      scope: row.scope || null,
      lastSeenAt: row.last_seen_at,
    }));
  }
  async savePerson(person: StoredPerson): Promise<void> {
    if (
      !identifier(person.nodeId) ||
      !identifier(person.publicKey) ||
      !bounded(person.name, 48) ||
      person.name !== person.name.trim() ||
      !validScope(person.scope) ||
      !timestamp(person.lastSeenAt)
    )
      throw new Error("Invalid contact");
    await this.write(async () => {
      const old = await this.db.getFirstAsync<PersonRow>(
        "SELECT * FROM social_people WHERE node_id=? AND scope=?",
        person.nodeId,
        person.scope ?? "",
      );
      if (old && old.public_key !== person.publicKey)
        throw new Error("Contact identity changed");
      if (!old) {
        const count = await this.db.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) n FROM social_people",
        );
        if ((count?.n ?? 0) >= 200) throw new Error("Contact storage is full");
      }
      if (old && old.last_seen_at > person.lastSeenAt) return;
      await this.db.runAsync(
        "INSERT INTO social_people VALUES(?,?,?,?,?) ON CONFLICT(node_id,scope) DO UPDATE SET name=excluded.name,last_seen_at=excluded.last_seen_at",
        person.nodeId,
        person.publicKey,
        person.name,
        person.scope ?? "",
        person.lastSeenAt,
      );
    });
  }
  async packets(): Promise<StoredDirect[]> {
    return this.write(async () => {
      await this.prune();
      return (
        await this.db.getAllAsync<PacketRow>(
          "SELECT * FROM social_packets ORDER BY created_at,id",
        )
      ).map((row) => ({
        id: row.id,
        origin: row.origin,
        publicKey: row.public_key,
        destination: row.destination,
        scope: row.scope || null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        wire: row.wire,
      }));
    });
  }
  async savePacket(packet: StoredDirect): Promise<boolean> {
    if (
      !identifier(packet.id) ||
      !identifier(packet.origin) ||
      !identifier(packet.publicKey) ||
      !identifier(packet.destination) ||
      !validScope(packet.scope) ||
      !bounded(packet.wire, 16_384) ||
      new TextEncoder().encode(packet.wire).length > 16_384 ||
      !timestamp(packet.createdAt) ||
      !timestamp(packet.expiresAt) ||
      packet.expiresAt <= packet.createdAt
    )
      throw new Error("Invalid encrypted packet");
    return this.write(async () => {
      if (packet.expiresAt <= this.clock())
        throw new Error("Encrypted packet expired");
      await this.prune();
      const old = await this.db.getFirstAsync<PacketRow>(
        "SELECT * FROM social_packets WHERE id=?",
        packet.id,
      );
      if (old) {
        if (
          old.wire !== packet.wire ||
          old.origin !== packet.origin ||
          old.public_key !== packet.publicKey ||
          old.destination !== packet.destination ||
          old.scope !== (packet.scope ?? "") ||
          old.created_at !== packet.createdAt ||
          old.expires_at !== packet.expiresAt
        )
          throw new Error("Encrypted packet identity conflict");
        return false;
      }
      const count = await this.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM social_packets",
      );
      if ((count?.n ?? 0) >= 1000)
        throw new Error(
          "Encrypted message storage is full; live messages are retained",
        );
      await this.db.runAsync(
        "INSERT INTO social_packets(id,origin,public_key,destination,scope,created_at,expires_at,wire) VALUES(?,?,?,?,?,?,?,?)",
        packet.id,
        packet.origin,
        packet.publicKey,
        packet.destination,
        packet.scope ?? "",
        packet.createdAt,
        packet.expiresAt,
        packet.wire,
      );
      return true;
    });
  }
  async deliveredIds(): Promise<string[]> {
    return this.write(async () => {
      await this.prune();
      return (
        await this.db.getAllAsync<{ id: string }>(
          "SELECT id FROM social_packets WHERE delivered=1 ORDER BY created_at,id",
        )
      ).map((row) => row.id);
    });
  }
  /** Caller must authenticate the acknowledgment; transport send completion is insufficient. */
  async markDelivered(id: string, recipientId: string): Promise<void> {
    await this.write(async () => {
      await this.prune();
      const packet = await this.db.getFirstAsync<{ destination: string }>(
        "SELECT destination FROM social_packets WHERE id=?",
        id,
      );
      if (!packet || packet.destination !== recipientId)
        throw new Error("Invalid delivery recipient");
      await this.db.runAsync(
        "UPDATE social_packets SET delivered=1 WHERE id=?",
        id,
      );
    });
  }
}
