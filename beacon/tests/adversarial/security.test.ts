import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  createIdentity, createRequestId, createEnvelope, verifyEnvelope, encodePacket, decodePacket,
  deriveRequests, MeshRouter, LIMITS, type Envelope, type MessageInput, type MessageRepository, type StoredMessage,
} from '../../packages/protocol/src/index.js';

const initialTime = 1_800_000_000_000;
class Repository implements MessageRepository {
  records = new Map<string, StoredMessage>();
  async listMessages() { return [...this.records.values()]; }
  async getMessage(id: string) { return this.records.get(id); }
  async saveMessage(envelope: Envelope, hops: number, receivedAt: number) {
    if (this.records.has(envelope.id)) return false;
    if (this.records.size >= LIMITS.messages) throw new Error('Capacity reached');
    this.records.set(envelope.id, { envelope, hops, receivedAt }); return true;
  }
  async listForwarded() { return []; }
  async markForwarded() { }
}
function fixture() {
  const local = createIdentity(randomBytes), attacker = createIdentity(randomBytes), repository = new Repository();
  let time = initialTime;
  const wires: string[] = [];
  const router = new MeshRouter({ identity: local, repository, randomBytes, clock: () => time,
    transport: { send: async (_peer, wire) => { wires.push(wire); } } });
  const sign = (input: MessageInput) => createEnvelope(attacker, input, time, randomBytes);
  const control = (type: 'inventory' | 'missing', ids: string[]) => encodePacket({ envelope: sign({type, requestId: '0'.repeat(64), destination: local.nodeId, payload: {ids}, ttlMs: LIMITS.controlTtlMs}), hops: 0 });
  return { local, attacker, repository, router, wires, sign, control, advance: (ms: number) => { time += ms; } };
}
function root(f = fixture()) {
  return f.sign({ type: 'sos', requestId: createRequestId(f.attacker, randomBytes), destination: 'community',
    payload: { category: 'other', displayName: 'Alice', note: 'Synthetic test', location: {source: 'unavailable', capturedAt: initialTime} } });
}

test('signed display names reject unsigned whitespace mutation and padding bypass', () => {
  const envelope = root();
  assert.equal(verifyEnvelope(envelope), true);
  assert.equal(verifyEnvelope({...envelope, payload: {...envelope.payload, displayName: ' '.repeat(1000) + 'Alice'}}), false);
});

test('inventories cannot grow per-session suppression memory beyond durable capacity', async () => {
  const f = fixture(); await f.router.connect('radio');
  for (let i = 0; i < Math.ceil((LIMITS.messages + 1) / LIMITS.inventory); i++) {
    const ids = Array.from({length: LIMITS.inventory}, (_, j) => (i * LIMITS.inventory + j + 1).toString(16).padStart(64, '0'));
    await f.router.receive('radio', f.control('inventory', ids));
  }
  // Inspection intentionally targets the resource bound, which is not observable in the public API.
  const state = (f.router as unknown as {peers: Map<string, {sent: Set<string>}>}).peers.get('radio');
  assert.ok(state && state.sent.size <= LIMITS.messages, `unbounded inventory IDs retained: ${state?.sent.size}`);
});

test('a repeated ID in one missing request does not amplify a record 64 times', async () => {
  const f = fixture(), envelope = root(f); await f.repository.saveMessage(envelope, 0, initialTime);
  await f.router.connect('radio'); f.wires.length = 0;
  await f.router.receive('radio', f.control('missing', Array(LIMITS.inventory).fill(envelope.id)));
  assert.equal(f.wires.filter(w => decodePacket(w, initialTime).envelope.id === envelope.id).length, 1);
});

test('replaying the same signed missing control does not trigger repeated retransmission', async () => {
  const f = fixture(), envelope = root(f); await f.repository.saveMessage(envelope, 0, initialTime);
  await f.router.connect('radio'); f.wires.length = 0;
  const wire = f.control('missing', [envelope.id]);
  await f.router.receive('radio', wire); await f.router.receive('radio', wire);
  assert.equal(f.wires.filter(w => decodePacket(w, initialTime).envelope.id === envelope.id).length, 1);
});

test('simultaneous endpoint acknowledgments create only one durable receipt', async () => {
  const f = fixture(), envelope = root(f); await f.repository.saveMessage(envelope, 1, initialTime);
  const responses = await Promise.all([f.router.acknowledge(envelope.id), f.router.acknowledge(envelope.id)]);
  assert.equal(responses[0].id, responses[1].id);
  assert.equal((await f.repository.listMessages()).filter(r => r.envelope.type === 'receipt').length, 1);
});

test('a valid outsider signature cannot cancel, complete, or assign another requester', () => {
  const f = fixture(), envelope = root(f);
  const forged = (['cancel', 'complete'] as const).map(type => createEnvelope(f.local, {
    type, requestId: envelope.requestId, destination: 'community', revision: 1000000,
    payload: type === 'cancel' ? {reason: 'Attack'} : {note: 'Attack'},
  } as MessageInput, initialTime, randomBytes));
  const state = deriveRequests([envelope, ...forged])[0];
  assert.equal(state.status, 'open'); assert.equal(state.requesterId, f.attacker.nodeId);
});

test('oversized Unicode traffic and rewrapped expired traffic remain rejected', () => {
  const envelope = root();
  assert.throws(() => decodePacket('😀'.repeat(LIMITS.wireBytes / 2), initialTime), /Oversized/);
  assert.throws(() => decodePacket(encodePacket({envelope, hops: 0}), envelope.expiresAt), /Expired/);
});

test('self announcements, changed session identity, unsigned and long-lived controls are rejected', async () => {
  const f = fixture(); await f.router.connect('radio');
  const input: MessageInput = {type: 'inventory', requestId: '0'.repeat(64), destination: 'community', payload: {ids: []}, ttlMs: LIMITS.controlTtlMs};
  const self = createEnvelope(f.local, input, initialTime, randomBytes);
  await assert.rejects(f.router.receive('radio', encodePacket({envelope: self, hops: 0})), /Self-contact/);
  await assert.rejects(f.router.receive('radio', JSON.stringify({envelope: {...self, signature: '0'.repeat(128)}, hops: 0})), /Invalid signature/);
  await assert.rejects(f.router.receive('radio', encodePacket({envelope: f.sign({...input, ttlMs: LIMITS.ttlMs}), hops: 0})), /control scope/);
  await f.router.receive('radio', f.control('inventory', []));
  const stranger = createEnvelope(createIdentity(randomBytes), input, initialTime, randomBytes);
  await assert.rejects(f.router.receive('radio', encodePacket({envelope: stranger, hops: 0})), /identity changed/);
});

test('concurrent fresh missing controls cannot retransmit the same record concurrently', async () => {
  const f = fixture(), envelope = root(f); await f.repository.saveMessage(envelope, 0, initialTime);
  await f.router.connect('radio'); f.wires.length = 0;
  await Promise.all(Array.from({length: LIMITS.receivesInFlight}, () => f.router.receive('radio', f.control('missing', [envelope.id]))));
  assert.equal(f.wires.filter(w => decodePacket(w, initialTime).envelope.id === envelope.id).length, 1);
});

test('duplicate connect events cannot reset rate limits and controls do not create durable records', async () => {
  const f = fixture(); await f.router.connect('radio');
  const wire = f.control('inventory', []);
  for(let i = 0; i < LIMITS.receivesPerMinute; i++) await f.router.receive('radio', wire);
  await f.router.connect('radio');
  await assert.rejects(f.router.receive('radio', wire), /rate limit/);
  assert.equal(f.repository.records.size, 0);
});

test('repeated flushes obey the send budget and resume the durable backlog next minute', async () => {
  const f = fixture();
  for(let i = 0; i < LIMITS.sendsPerMinute + 5; i++) {
    await f.repository.saveMessage(root(f), 0, initialTime);
  }
  await f.router.connect('radio');
  for(let i = 0; i < 5; i++) await f.router.flush();
  const sent = () => f.wires.filter(w => JSON.parse(w).envelope.type === 'sos').length;
  assert.equal(sent(), LIMITS.sendsPerMinute);
  f.advance(60_000); await f.router.flush();
  assert.equal(sent(), LIMITS.sendsPerMinute + 5);
});

test('queued publish returns after persistence while a native send waits, and surfaces its eventual failure', async () => {
  const f = fixture(); let rejectSend: ((error: Error) => void) | undefined; const failures:Error[]=[];
  const router = new MeshRouter({identity:f.local,repository:f.repository,randomBytes,clock:()=>initialTime,awaitForwarding:false,onError:e=>failures.push(e),
    transport:{send:async(_peer,wire)=>{if(JSON.parse(wire).envelope.type!=='inventory')await new Promise<void>((_resolve,reject)=>{rejectSend=reject;});}}});
  await router.connect('radio');
  const message = await router.publish({type:'sos',requestId:createRequestId(f.local,randomBytes),destination:'community',payload:{category:'other',note:'Test',displayName:'Test',location:{source:'unavailable',capturedAt:initialTime}}});
  assert.ok(await f.repository.getMessage(message.id));
  assert.ok(rejectSend, 'background transport should have started');
  rejectSend!(new Error('Synthetic radio loss'));
  // Join the coalesced flush to wait for the failed write. Disconnect avoids intentionally retrying here.
  router.disconnect('radio'); await router.flush();
  assert.equal(failures.length,1); assert.equal(failures[0].message,'Synthetic radio loss');
  assert.equal(deriveRequests((await f.repository.listMessages()).map(r=>r.envelope))[0].receipts.length,0);
});
