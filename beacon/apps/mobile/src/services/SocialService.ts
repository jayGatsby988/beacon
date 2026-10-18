import {
  createPresence,
  createLocation,
  verifyLocation,
  LOCATION_LIMITS,
  type SharedLocation,
  verifyPresence,
  createDirectMessage,
  createDirectReceipt,
  encodeDirect,
  decodeDirect,
  openDirect,
  SOCIAL_LIMITS,
  type Identity,
  type DirectContent,
} from "@beacon/protocol";
import {
  SocialRepository,
  type StoredDirect,
} from "../storage/SocialRepository";
import type { PersonView, DirectMessageView } from "../ui/types";

interface Options {
  identity: Identity;
  repository: SocialRepository;
  scope(): string | null;
  name(): string;
  location?(): SharedLocation | null;
  random(n: number): Uint8Array;
  send(peerId: string, wire: string, scope: string | null): Promise<void>;
  getRead(key: string): Promise<number>;
  setRead(key: string, time: number): Promise<void>;
  onChange(people: PersonView[], messages: DirectMessageView[]): void;
  onError(error: unknown): void;
  clock?: () => number;
}

/** Only authenticated Beacon identities appear as people. BLE session IDs are never contacts. */
export class SocialService {
  private sessions = new Map<
    string,
    {
      nodeId?: string;
      sent: Set<string>;
      receipts: Set<string>;
      lastPresence: number;
      announcing?: Promise<void>;
      lastLocation: number;
      sharedLocation: boolean;
      rateStart: number;
      received: number;
      sends: number;
      attempts: Map<string, number>;
      attemptOrder: number;
    }
  >();
  private contentCache = new Map<
    string,
    { wire: string; metadata: string; content: DirectContent | null }
  >();
  private readMarkers = new Map<string, number>();
  private operations = new Set<Promise<unknown>>();
  private disposed = false;
  private generation = 0;
  private refreshing?: Promise<void>;
  private refreshAgain = false;
  private flushing?: Promise<void>;
  private flushAgain = false;
  private now: () => number;
  private locations = new Map<
    string,
    {
      scope: string | null;
      createdAt: number;
      expiresAt: number;
      capturedAt: number;
      location: SharedLocation | null;
    }
  >();
  private locationStamp = 0;
  private locationSending?: Promise<void>;
  private locationAgain = false;
  private locationForce = false;
  constructor(private options: Options) {
    this.now = options.clock ?? Date.now;
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed)
      return Promise.reject(new Error("Nearby messaging is closed."));
    const pending = operation().finally(() => this.operations.delete(pending));
    this.operations.add(pending);
    return pending;
  }
  connect(peerId: string) {
    return this.track(() => this.connectOnce(peerId));
  }
  private async connectOnce(peerId: string) {
    if (!this.sessions.has(peerId)) {
      if (this.sessions.size >= 16)
        throw new Error("Nearby connection limit reached.");
      this.sessions.set(peerId, {
        sent: new Set(),
        receipts: new Set(),
        lastPresence: 0,
        lastLocation: 0,
        sharedLocation: false,
        rateStart: this.now(),
        received: 0,
        sends: 0,
        attempts: new Map(),
        attemptOrder: 0,
      });
    }
    await this.announce(peerId);
  }
  disconnect(peerId: string) {
    const nodeId = this.sessions.get(peerId)?.nodeId;
    this.sessions.delete(peerId);
    if (nodeId && !this.getPeer(nodeId)) {
      const previous = this.locations.get(nodeId);
      if (previous) previous.location = null;
    }
    void this.refresh().catch(this.options.onError);
  }
  /** Only sessions whose signed presence/message has established a Beacon identity. */
  peerNodeId(peerId: string): string | undefined {
    return this.sessions.get(peerId)?.nodeId;
  }
  getPeer(nodeId: string): string | undefined {
    const peers = [...this.sessions].filter(
      ([, session]) => session.nodeId === nodeId,
    );
    return peers.find(([id]) => id.startsWith("c:"))?.[0] ?? peers[0]?.[0];
  }
  reset() {
    this.generation++;
    this.sessions.clear();
    this.locations.clear();
    this.contentCache.clear();
    this.readMarkers.clear();
  }
  /** Terminal shutdown: stop new work and drain native sends/reads before the owner closes SQLite. */
  async settle(): Promise<void> {
    this.disposed = true;
    this.reset();
    while (
      this.operations.size ||
      this.flushing ||
      this.refreshing ||
      this.locationSending
    ) {
      await Promise.allSettled([
        ...this.operations,
        ...[this.flushing, this.refreshing, this.locationSending].filter(
          (p): p is Promise<void> => Boolean(p),
        ),
      ]);
    }
    this.contentCache.clear();
    this.readMarkers.clear();
  }
  private resetRate(session: {
    rateStart: number;
    received: number;
    sends: number;
  }) {
    if (this.now() - session.rateStart >= 60_000) {
      session.rateStart = this.now();
      session.received = 0;
      session.sends = 0;
    }
  }
  private content(record: StoredDirect): DirectContent | null {
    const metadata = JSON.stringify([
      record.id,
      record.origin,
      record.publicKey,
      record.destination,
      record.scope,
      record.createdAt,
      record.expiresAt,
    ]);
    const known = this.contentCache.get(record.id);
    if (known?.wire === record.wire && known.metadata === metadata)
      return known.content;
    const packet = decodeDirect(
      record.wire,
      Math.min(this.now(), record.expiresAt - 1),
    );
    const matches =
      packet &&
      packet.id === record.id &&
      packet.origin === record.origin &&
      packet.destination === record.destination &&
      packet.publicKey === record.publicKey &&
      packet.scope === record.scope &&
      packet.createdAt === record.createdAt &&
      packet.expiresAt === record.expiresAt;
    const content = matches ? openDirect(this.options.identity, packet) : null;
    if (this.contentCache.size >= 1000 && !this.contentCache.has(record.id))
      this.contentCache.delete(this.contentCache.keys().next().value!);
    this.contentCache.set(record.id, { wire: record.wire, metadata, content });
    return content;
  }
  private announce(peerId: string): Promise<void> {
    const session = this.sessions.get(peerId);
    if (!session) return Promise.resolve();
    if (session.announcing) return session.announcing;
    const scope = this.options.scope();
    session.announcing = (async () => {
      await this.options.send(
        peerId,
        createPresence(
          this.options.identity,
          this.options.name(),
          scope,
          this.now(),
          this.options.random,
        ),
        scope,
      );
      session.lastPresence = this.now();
    })().finally(() => {
      session.announcing = undefined;
    });
    return session.announcing;
  }
  /** Broadcast a current opt-in fix, or withdraw only from sessions already disclosed to. */
  announceLocation(): Promise<void> {
    return this.track(() => this.sendLocations(true));
  }
  private sendLocations(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.locationForce ||= force;
    if (this.locationSending) {
      this.locationAgain = true;
      return this.locationSending;
    }
    this.locationSending = (async () => {
      do {
        this.locationAgain = false;
        const forced = this.locationForce;
        this.locationForce = false;
        const generation = this.generation,
          scope = this.options.scope();
        let location = this.options.location?.() ?? null;
        if (
          location &&
          location.capturedAt + LOCATION_LIMITS.ttlMs <= this.now()
        )
          location = null;
        const createdAt = Math.max(this.now(), this.locationStamp + 1);
        let wire: string | undefined;
        for (const [peerId, session] of this.sessions) {
          if (
            this.disposed ||
            generation !== this.generation ||
            scope !== this.options.scope()
          )
            break;
          // A user can withdraw while a prior peer's native send is pending.
          // Never disclose the captured snapshot to additional peers after that change.
          const currentLocation = this.options.location?.() ?? null;
          if (
            location &&
            (!currentLocation ||
              currentLocation.capturedAt + LOCATION_LIMITS.ttlMs <= this.now())
          ) {
            this.locationAgain = true;
            break;
          }
          if (
            !session.nodeId ||
            (!location && !session.sharedLocation) ||
            (location &&
              !forced &&
              session.sharedLocation &&
              this.now() - session.lastLocation < 30_000)
          )
            continue;
          this.resetRate(session);
          if (session.sends >= 240 && location) continue;
          wire ??= createLocation(
            this.options.identity,
            location,
            scope,
            createdAt,
            this.options.random,
          );
          this.locationStamp = createdAt;
          // Record disclosure before awaiting: a failed native write may still have reached the peer.
          if (location) session.sharedLocation = true;
          session.sends++;
          try {
            await this.options.send(peerId, wire, scope);
            if (
              this.disposed ||
              generation !== this.generation ||
              scope !== this.options.scope() ||
              this.sessions.get(peerId) !== session
            )
              continue;
            session.lastLocation = this.now();
            if (!location) session.sharedLocation = false;
          } catch (error) {
            if (!this.disposed) this.options.onError(error);
          }
        }
      } while (this.locationAgain && !this.disposed);
    })()
      .catch((error: unknown) => {
        if (!this.disposed) this.options.onError(error);
      })
      .finally(() => {
        this.locationSending = undefined;
      });
    return this.locationSending;
  }
  private liveLocation(
    nodeId: string,
    scope: string | null,
  ): SharedLocation | undefined {
    const known = this.locations.get(nodeId);
    if (
      !known ||
      known.scope !== scope ||
      !this.getPeer(nodeId) ||
      !known.location ||
      known.expiresAt <= this.now() ||
      known.location.capturedAt + LOCATION_LIMITS.ttlMs <= this.now()
    ) {
      if (known) known.location = null;
      return undefined;
    }
    return { ...known.location };
  }
  /** Returns false for ordinary SOS mesh packets. Invalid social traffic is consumed, never reinterpreted. */
  receive(peerId: string, wire: string): Promise<boolean> {
    return this.track(() => this.receiveOnce(peerId, wire));
  }
  private async receiveOnce(peerId: string, wire: string): Promise<boolean> {
    if (
      wire.length > SOCIAL_LIMITS.wireBytes ||
      new TextEncoder().encode(wire).length > SOCIAL_LIMITS.wireBytes
    )
      return true;
    let type: unknown;
    try {
      type = (JSON.parse(wire) as { type?: unknown }).type;
    } catch {
      return false;
    }
    if (type !== "presence" && type !== "direct" && type !== "location")
      return false;
    const session = this.sessions.get(peerId);
    if (!session) return true;
    this.resetRate(session);
    if (++session.received > 240) return true;
    const generation = this.generation;
    const scope = this.options.scope();
    const current = () =>
      !this.disposed &&
      generation === this.generation &&
      scope === this.options.scope() &&
      this.sessions.get(peerId) === session;
    const identity = this.options.identity;
    if (type === "location") {
      const update = verifyLocation(wire, this.now());
      if (
        !update ||
        update.scope !== scope ||
        update.nodeId !== session.nodeId ||
        update.nodeId === identity.nodeId
      )
        return true;
      for (const [id, known] of this.locations)
        if (known.expiresAt + LOCATION_LIMITS.futureSkewMs <= this.now())
          this.locations.delete(id);
      const previous = this.locations.get(update.nodeId);
      if (
        previous &&
        (update.createdAt <= previous.createdAt ||
          (update.location && update.location.capturedAt < previous.capturedAt))
      )
        return true;
      if (!previous && this.locations.size >= 1000) return true;
      this.locations.set(update.nodeId, {
        scope,
        createdAt: update.createdAt,
        expiresAt: update.expiresAt,
        capturedAt: update.location?.capturedAt ?? previous?.capturedAt ?? 0,
        location: update.location,
      });
      await this.refresh();
      return true;
    }
    if (type === "presence") {
      const person = verifyPresence(wire, this.now());
      if (
        !person ||
        person.scope !== scope ||
        person.nodeId === identity.nodeId
      )
        return true;
      if (session.nodeId && session.nodeId !== person.nodeId) return true;
      session.nodeId = person.nodeId;
      await this.options.repository.savePerson({
        ...person,
        lastSeenAt: this.now(),
      });
      if (!current()) return true;
      // A peer may join this group while the native connection remains open.
      if (this.now() - session.lastPresence > 5_000)
        void this.track(() => this.announce(peerId)).catch(this.options.onError);
      // Receiving must not wait on outbound radio writes: it owns the durable inbound queue.
      void this.sendLocations().catch(this.options.onError);
      void this.flush().catch(this.options.onError);
      await this.refresh();
      return true;
    }
    const packet = decodeDirect(wire, this.now());
    if (
      !packet ||
      packet.scope !== scope ||
      packet.destination !== identity.nodeId ||
      packet.origin === identity.nodeId
    )
      return true;
    if (session.nodeId && session.nodeId !== packet.origin) return true;
    const content = openDirect(identity, packet);
    if (!content) return true;
    const repository = this.options.repository;
    if (content.kind === "receipt") {
      const original = (await repository.packets()).find(
        (p) => p.id === content.messageId,
      );
      if (!current()) return true;
      if (
        original &&
        original.origin === identity.nodeId &&
        original.destination === packet.origin &&
        original.scope === scope
      ) {
        await repository.markDelivered(original.id, packet.origin);
      }
    } else {
      const stored = { ...packet, wire: encodeDirect(packet) };
      await repository.savePacket(stored);
      if (!current()) return true;
      const people = await repository.people();
      if (!current()) return true;
      if (
        !people.some(
          (person) => person.nodeId === packet.origin && person.scope === scope,
        )
      ) {
        // Presence can be lost while the direct packet arrives. Keep its conversation reachable
        // without inventing a human identity; a later signed presence supplies the display name.
        await repository.savePerson({
          nodeId: packet.origin,
          publicKey: packet.publicKey,
          name: `Beacon user ${packet.origin.slice(0, 8)}`,
          scope,
          lastSeenAt: this.now(),
        });
        if (!current()) return true;
      }
      // A receipt means this phone persisted the message, not that its owner read it.
      const pending = await repository.packets();
      if (!current()) return true;
      const receipt = pending.find((p) => {
        if (
          p.origin !== identity.nodeId ||
          p.destination !== packet.origin ||
          p.scope !== scope
        )
          return false;
        if (p.expiresAt <= this.now()) return false;
        const payload = this.content(p);
        return payload?.kind === "receipt" && payload.messageId === packet.id;
      });
      if (receipt) {
        session.sent.delete(receipt.id);
      } else {
        const ack = createDirectReceipt(
          identity,
          packet.publicKey,
          packet.id,
          scope,
          this.now(),
          this.options.random,
        );
        await repository.savePacket({ ...ack, wire: encodeDirect(ack) });
      }
      if (!current()) return true;
      // Signed encrypted messages can arrive before a presence response; the key is still authenticated.
      session.nodeId = packet.origin;
      void this.sendLocations().catch(this.options.onError);
      void this.flush().catch(this.options.onError);
    }
    await this.refresh();
    return true;
  }
  sendText(nodeId: string, text: string) {
    return this.track(() => this.sendTextOnce(nodeId, text));
  }
  private async sendTextOnce(nodeId: string, text: string) {
    const generation = this.generation;
    const scope = this.options.scope();
    const person = (await this.options.repository.people()).find(
      (p) => p.nodeId === nodeId && p.scope === scope,
    );
    if (
      this.disposed ||
      generation !== this.generation ||
      scope !== this.options.scope()
    )
      throw new Error("Active group changed; message was not sent.");
    if (!person || nodeId === this.options.identity.nodeId)
      throw new Error("Open a nearby person's profile before messaging.");
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 500)
      throw new Error("Write a message of up to 500 characters.");
    const packet = createDirectMessage(
      this.options.identity,
      person.publicKey,
      trimmed,
      scope,
      this.now(),
      this.options.random,
    );
    await this.options.repository.savePacket({
      ...packet,
      wire: encodeDirect(packet),
    });
    await this.refresh();
    // Persistence is success. A transient radio failure leaves a visible queued message for retry.
    void this.flush().catch(this.options.onError);
  }
  tick() {
    return this.track(() => this.tickOnce());
  }
  private async tickOnce() {
    for (const [peerId, session] of this.sessions) {
      if (this.now() - session.lastPresence >= 30_000) {
        try {
          await this.announce(peerId);
        } catch (error) {
          this.options.onError(error);
        }
      }
      // A native write completing is not delivery; retry undelivered packets while connected too.
      // Receipts have no receipts of their own. Retry messages, retaining receipt suppression
      // until reconnect or the sender repeats the original message to request its receipt again.
      for (const id of session.sent)
        if (!session.receipts.has(id)) session.sent.delete(id);
    }
    await this.sendLocations();
    await this.flush();
    await this.refresh();
  }
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        const generation = this.generation;
        const scope = this.options.scope();
        const delivered = new Set(await this.options.repository.deliveredIds());
        const packets = await this.options.repository.packets();
        for (const [peerId, session] of this.sessions) {
          if (
            !session.nodeId ||
            this.disposed ||
            generation !== this.generation
          )
            continue;
          this.resetRate(session);
          const queue = packets.filter(
            (p) =>
              p.scope === scope &&
              p.origin === this.options.identity.nodeId &&
              p.destination === session.nodeId &&
              p.expiresAt > this.now() &&
              !delivered.has(p.id),
          );
          // Prefer packets that have waited longest for an attempt. Retrying the
          // oldest 32 every tick otherwise permanently starves newer messages and receipts.
          const queuedIds = new Set(queue.map((packet) => packet.id));
          for (const id of session.attempts.keys())
            if (!queuedIds.has(id)) session.attempts.delete(id);
          queue.sort(
            (a, b) =>
              (session.attempts.get(a.id) ?? 0) - (session.attempts.get(b.id) ?? 0),
          );
          let sent = 0;
          for (const packet of queue) {
            if (
              this.disposed ||
              generation !== this.generation ||
              scope !== this.options.scope() ||
              this.sessions.get(peerId) !== session ||
              session.sends >= 240
            )
              break;
            if (session.sent.has(packet.id)) continue;
            if (++sent > 32) break;
            const content = this.content(packet);
            if (!content) continue;
            if (session.sent.size >= 1000) {
              const first = session.sent.values().next().value!;
              session.sent.delete(first);
              session.receipts.delete(first);
            }
            session.attempts.set(packet.id, ++session.attemptOrder);
            session.sent.add(packet.id);
            session.sends++;
            if (content.kind === "receipt") session.receipts.add(packet.id);
            try {
              await this.options.send(peerId, packet.wire, scope);
            } catch (error) {
              session.sent.delete(packet.id);
              this.options.onError(error);
              break;
            }
          }
        }
      } while (this.flushAgain);
    })().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  markChatRead(nodeId: string) {
    return this.track(() => this.markChatReadOnce(nodeId));
  }
  private async markChatReadOnce(nodeId: string) {
    const scope = this.options.scope();
    const generation = this.generation;
    const packets = await this.options.repository.packets();
    const current = () =>
      !this.disposed &&
      generation === this.generation &&
      scope === this.options.scope();
    for (const packet of packets) {
      if (!current()) return;
      if (
        packet.scope !== scope ||
        packet.origin !== nodeId ||
        packet.destination !== this.options.identity.nodeId ||
        this.content(packet)?.kind !== "message"
      )
        continue;
      const key = this.readKey(nodeId, packet.id, scope);
      if ((await this.readMarker(key, generation)) === 1) continue;
      if (!current()) return;
      await this.options.setRead(key, 1);
      if (!current()) return;
      this.cacheRead(key, 1);
    }
    if (current()) await this.refresh();
  }
  private readKey(nodeId: string, messageId: string, scope: string | null) {
    return `chatRead:${scope ?? "nearby"}:${nodeId}:${messageId}`;
  }
  private cacheRead(key: string, value: number) {
    if (this.readMarkers.size >= 1000 && !this.readMarkers.has(key))
      this.readMarkers.delete(this.readMarkers.keys().next().value!);
    this.readMarkers.set(key, value);
  }
  private async readMarker(key: string, generation: number): Promise<number> {
    const known = this.readMarkers.get(key);
    if (known !== undefined) return known;
    const value = await this.options.getRead(key);
    if (!this.disposed && generation === this.generation) {
      // An overlapping mark-read may have finished while this storage read was pending.
      if (!this.readMarkers.has(key)) this.cacheRead(key, value === 1 ? 1 : 0);
      return this.readMarkers.get(key)!;
    }
    return value;
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        const generation = this.generation;
        const scope = this.options.scope();
        const people = (await this.options.repository.people()).filter(
          (p) => p.scope === scope,
        );
        const delivered = new Set(await this.options.repository.deliveredIds());
        const packets = await this.options.repository.packets();
        if (
          this.disposed ||
          generation !== this.generation ||
          scope !== this.options.scope()
        )
          continue;
        const messages = packets
          .flatMap((p: StoredDirect): DirectMessageView[] => {
            if (p.scope !== scope) return [];
            const content = this.content(p);
            if (!content || content.kind !== "message") return [];
            const mine = p.origin === this.options.identity.nodeId;
            return [
              {
                id: p.id,
                peerId: mine ? p.destination : p.origin,
                mine,
                text: content.text,
                createdAt: p.createdAt,
                status:
                  !mine || delivered.has(p.id)
                    ? "received"
                    : p.expiresAt <= this.now()
                      ? "expired"
                      : "queued",
              },
            ];
          })
          .sort(
            (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
          );
        const unread = new Map<string, number>();
        for (const message of messages) {
          if (
            this.disposed ||
            generation !== this.generation ||
            scope !== this.options.scope()
          )
            break;
          if (message.mine) continue;
          const marker = await this.readMarker(
            this.readKey(message.peerId, message.id, scope),
            generation,
          );
          if (marker !== 1)
            unread.set(message.peerId, (unread.get(message.peerId) ?? 0) + 1);
        }
        const views: PersonView[] = people.map((person) => ({
          ...person,
          connected: [...this.sessions.values()].some(
            (session) => session.nodeId === person.nodeId,
          ),
          unreadCount: unread.get(person.nodeId) ?? 0,
          location: this.liveLocation(person.nodeId, scope),
        }));
        if (
          !this.disposed &&
          generation === this.generation &&
          scope === this.options.scope()
        )
          this.options.onChange(
            views.sort(
              (a, b) =>
                Number(b.connected) - Number(a.connected) ||
                b.lastSeenAt - a.lastSeenAt,
            ),
            messages,
          );
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
}
