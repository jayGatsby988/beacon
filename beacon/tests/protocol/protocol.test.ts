import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes, createIdentity, createRequestId, createEnvelope, verifyEnvelope, encodePacket, decodePacket, deriveRequests, MeshRouter, LIMITS, type Envelope, type Identity, type MessageInput, type MessageRepository, type StoredMessage } from '../../packages/protocol/src/index.js';

class MemoryRepository implements MessageRepository {
  records=new Map<string,StoredMessage>();forwarded=new Map<string,Set<string>>();
  async listMessages(){return [...this.records.values()];}
  async getMessage(id:string){return this.records.get(id);}
  async saveMessage(envelope:Envelope,hops:number,receivedAt:number){if(this.records.has(envelope.id))return false;if(this.records.size>=LIMITS.messages)throw new Error('Storage full');this.records.set(envelope.id,{envelope,hops,receivedAt});return true;}
  async listForwarded(peer:string){return [...(this.forwarded.get(peer)??[])];}
  async markForwarded(peer:string,id:string){if(!this.forwarded.has(peer))this.forwarded.set(peer,new Set());this.forwarded.get(peer)!.add(id);}
}
const now=1_800_000_000_000;
const identity=()=>createIdentity(randomBytes);
function sosInput(id:Identity):MessageInput {return {type:'sos',requestId:createRequestId(id,randomBytes),destination:'community',payload:{category:'stranded',note:'Need assistance',displayName:'Demo requester',location:{source:'manual_description',description:'Synthetic campus point',capturedAt:now}}};}
const sign=(id:Identity,input:MessageInput)=>createEnvelope(id,input,now,randomBytes);

class Network {
  time=now;sent=0;queue:{from:string;to:string;wire:string}[]=[];links=new Set<string>();
  nodes=new Map<string,{id:Identity;repo:MemoryRepository;router:MeshRouter}>();
  add(name:string,repo=new MemoryRepository(),id=identity()){
    const router=new MeshRouter({identity:id,repository:repo,clock:()=>this.time,randomBytes,transport:{send:async(to,wire)=>{if(!this.links.has(`${name}:${to}`))throw new Error('Disconnected');this.sent++;this.queue.push({from:name,to,wire});}}});
    const node={id,repo,router};this.nodes.set(name,node);return node;
  }
  async connect(a:string,b:string){this.links.add(`${a}:${b}`);this.links.add(`${b}:${a}`);await this.nodes.get(a)!.router.connect(b);await this.nodes.get(b)!.router.connect(a);await this.drain();}
  disconnect(a:string,b:string){this.links.delete(`${a}:${b}`);this.links.delete(`${b}:${a}`);this.nodes.get(a)!.router.disconnect(b);this.nodes.get(b)!.router.disconnect(a);}
  async drain(){let count=0;while(this.queue.length){assert.ok(++count<2000,'network must settle without loops');const packet=this.queue.shift()!;if(this.links.has(`${packet.from}:${packet.to}`))await this.nodes.get(packet.to)!.router.receive(packet.from,packet.wire);}}
}

test('Ed25519 RFC 8032 vector and canonical authenticated wire roundtrip',()=>{
  const secret=hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  assert.equal(bytesToHex(ed25519.getPublicKey(secret)),'d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  assert.equal(bytesToHex(ed25519.sign(new Uint8Array(),secret)),'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
  const id=identity(),envelope=sign(id,sosInput(id));
  assert.deepEqual(decodePacket(encodePacket({envelope,hops:2}),now),{envelope,hops:2});
  assert.equal(verifyEnvelope({...envelope,payload:{...envelope.payload,note:'tampered'}}),false);
  assert.equal(verifyEnvelope({...envelope,origin:identity().nodeId}),false);
});

test('reject malformed, excessive, expired, future and over-hop traffic',()=>{
  const id=identity(),envelope=sign(id,sosInput(id));
  assert.throws(()=>decodePacket('x'.repeat(LIMITS.wireBytes+1),now),/Oversized/);
  assert.throws(()=>decodePacket('{',now));
  assert.throws(()=>decodePacket(JSON.stringify({envelope,hops:9}),now));
  assert.throws(()=>decodePacket(encodePacket({envelope,hops:0}),envelope.expiresAt),/Expired/);
  assert.throws(()=>decodePacket(encodePacket({envelope,hops:0}),now-LIMITS.futureSkewMs-1),/future/);
  assert.throws(()=>sign(id,{...sosInput(id),ttlMs:LIMITS.maxTtlMs+1}));
});

test('A → B → C carries SOS and return endpoint receipt; relay alone never reports delivery',async()=>{
  const n=new Network(),a=n.add('A'),b=n.add('B'),c=n.add('C');await n.connect('A','B');await n.connect('B','C');
  const message=await a.router.publish(sosInput(a.id));await n.drain();
  assert.equal((await b.repo.getMessage(message.id))?.hops,1);assert.equal((await c.repo.getMessage(message.id))?.hops,2);
  assert.equal(deriveRequests((await a.repo.listMessages()).map(x=>x.envelope))[0]!.receipts.length,0);
  await c.router.acknowledge(message.id);await n.drain();
  assert.equal(deriveRequests((await a.repo.listMessages()).map(x=>x.envelope))[0]!.receipts[0]?.nodeId,c.id.nodeId);
  const count=n.sent;await c.router.acknowledge(message.id);await n.drain();await a.router.flush();await n.drain();assert.equal(n.sent,count);
});

test('store-carry-forward survives relay restart and receipts return over later contacts',async()=>{
  const n=new Network(),a=n.add('A'),b=n.add('B'),c=n.add('C');await n.connect('A','B');
  const message=await a.router.publish(sosInput(a.id));await n.drain();n.disconnect('A','B');
  n.add('B',b.repo,b.id);await n.connect('B','C');assert.ok(await c.repo.getMessage(message.id));
  await c.router.acknowledge(message.id);await n.drain();n.disconnect('B','C');await n.connect('A','B');
  assert.equal(deriveRequests((await a.repo.listMessages()).map(r=>r.envelope))[0]!.receipts.length,1);
  assert.equal((await b.repo.getMessage(message.id))!.envelope.expiresAt,message.expiresAt);
});

test('hop limit accepts endpoint but prevents further relay; expired history does not retransmit',async()=>{
  const n=new Network(),a=n.add('A'),b=n.add('B'),c=n.add('C');await n.connect('A','B');await n.connect('B','C');
  const message=await a.router.publish({...sosInput(a.id),hopLimit:1});await n.drain();assert.ok(await b.repo.getMessage(message.id));assert.equal(await c.repo.getMessage(message.id),undefined);
  n.disconnect('A','B');n.time=message.expiresAt+1;await n.connect('A','B');assert.equal(n.queue.length,0);
});

test('only requester assigns; wrong request/endpoint receipts ignored; terminal state resists replay',()=>{
  const a=identity(),b=identity(),c=identity(),root=sign(a,sosInput(a)),requestId=root.requestId;
  const offer=sign(b,{type:'offer',requestId,destination:a.nodeId,payload:{displayName:'Volunteer B',note:'Can assist'}});
  const competing=sign(c,{type:'offer',requestId,destination:a.nodeId,payload:{displayName:'Volunteer C',note:'Also available'}});
  const accept=sign(a,{type:'accept',requestId,destination:b.nodeId,revision:1,payload:{offerId:offer.id,helperId:b.nodeId,assignmentId:createRequestId(a,randomBytes)}});
  const fake=sign(c,{type:'cancel',requestId,destination:'community',revision:999,payload:{reason:'Forged authority'}});
  const wrongReceipt=sign(c,{type:'assignment_receipt',requestId,destination:a.nodeId,revision:1,payload:{messageId:accept.id,assignmentId:accept.type==='accept'?accept.payload.assignmentId:''}});
  let state=deriveRequests([wrongReceipt,accept,competing,fake,offer,root])[0]!;assert.equal(state.status,'accepted');assert.equal(state.offers.length,2);assert.equal(state.assignment?.received,false);
  const actualReceipt=sign(b,{type:'assignment_receipt',requestId,destination:a.nodeId,revision:1,payload:{messageId:accept.id,assignmentId:accept.type==='accept'?accept.payload.assignmentId:''}});
  const cancel=sign(a,{type:'cancel',requestId,destination:'community',revision:2,payload:{reason:'Resolved elsewhere'}});
  const staleAccept=sign(a,{type:'accept',requestId,destination:c.nodeId,revision:3,payload:{offerId:competing.id,helperId:c.nodeId,assignmentId:createRequestId(a,randomBytes)}});
  state=deriveRequests([staleAccept,cancel,actualReceipt,accept,root,offer,competing])[0]!;assert.equal(state.status,'canceled');assert.equal(state.revision,2);assert.equal(state.assignment?.received,true);
  assert.equal(deriveRequests([sign(c,{...sosInput(c),requestId})]).length,0,'a different signer cannot claim the request ID');
});

test('assignment receipt generated after dependencies arrive out of order',async()=>{
  const n=new Network(),a=n.add('A'),b=n.add('B');await n.connect('A','B');
  const root=sign(a.id,sosInput(a.id)),requestId=root.requestId;
  const offer=sign(b.id,{type:'offer',requestId,destination:a.id.nodeId,payload:{displayName:'B',note:'Available'}});
  const accept=sign(a.id,{type:'accept',requestId,destination:b.id.nodeId,revision:1,payload:{offerId:offer.id,helperId:b.id.nodeId,assignmentId:createRequestId(a.id,randomBytes)}});
  await b.router.receive('A',encodePacket({envelope:accept,hops:1}));await b.router.receive('A',encodePacket({envelope:offer,hops:1}));await b.router.receive('A',encodePacket({envelope:root,hops:1}));await n.drain();
  assert.equal((await b.repo.listMessages()).filter(m=>m.envelope.type==='assignment_receipt').length,1);
});

test('validly signed wrong-request acknowledgment and duplicate packet do not change application state',async()=>{
  const n=new Network(),a=n.add('A'),b=n.add('B');await n.connect('A','B');const root=await a.router.publish(sosInput(a.id));await n.drain();
  const wrong=sign(b.id,{type:'receipt',requestId:createRequestId(a.id,randomBytes),destination:a.id.nodeId,payload:{messageId:root.id}});
  const wire=encodePacket({envelope:wrong,hops:1});await a.router.receive('B',wire);await a.router.receive('B',wire);await n.drain();
  assert.equal(deriveRequests((await a.repo.listMessages()).map(r=>r.envelope))[0]!.receipts.length,0);assert.equal((await a.repo.listMessages()).filter(r=>r.envelope.id===wrong.id).length,1);
});

test('no location is representable honestly and canonical wire vector remains stable',async()=>{
  const {readFile}=await import('node:fs/promises');
  const vector=JSON.parse(await readFile(new URL('./wire-vector.json',import.meta.url),'utf8'));
  assert.equal(verifyEnvelope(vector.packet.envelope),true);
  const rng=(n:number)=>new Uint8Array(n).fill(7),id=createIdentity(rng);
  const envelope=createEnvelope(id,{type:'sos',requestId:createRequestId(id,rng),destination:'community',payload:{category:'other',note:'Synthetic interoperability vector',displayName:'Vector',location:{source:'unavailable',capturedAt:now}}},now,rng);
  assert.deepEqual({envelope,hops:1},vector.packet);
});

test('failed writes remain retryable and never produce endpoint evidence',async()=>{
  const repo=new MemoryRepository(),id=identity();let fail=false;const sent:string[]=[],errors:Error[]=[];
  const router=new MeshRouter({identity:id,repository:repo,clock:()=>now,randomBytes,onError:e=>errors.push(e),transport:{send:async(_peer,wire)=>{if(fail)throw new Error('Radio unavailable');sent.push(wire);}}});
  await router.connect('peer');fail=true;const root=await router.publish(sosInput(id));assert.ok(await repo.getMessage(root.id));assert.equal(errors.length,1);assert.equal((await repo.listForwarded('peer')).length,0);
  fail=false;await router.flush();assert.equal((await repo.listForwarded('peer')).length,1);assert.equal(deriveRequests((await repo.listMessages()).map(r=>r.envelope))[0]!.receipts.length,0);
});

test('low priority traffic gets reserved forwarding capacity under receipt backlog',async()=>{
  const repo=new MemoryRepository(),id=identity(),other=identity(),root=sign(id,sosInput(id));
  const offer=createEnvelope(other,{type:'offer',requestId:root.requestId,destination:id.nodeId,payload:{note:'Older low priority',displayName:'Helper'}},now-1,randomBytes);
  await repo.saveMessage(offer,0,now);
  for(let i=0;i<80;i++)await repo.saveMessage(sign(id,{type:'receipt',requestId:root.requestId,destination:other.nodeId,payload:{messageId:root.id}}),0,now);
  const wires:string[]=[];const router=new MeshRouter({identity:id,repository:repo,clock:()=>now,randomBytes,transport:{send:async(_peer,wire)=>{wires.push(wire);}}});
  await router.connect('peer');const messages=wires.map(w=>decodePacket(w,now).envelope).filter(m=>m.type!=='inventory');assert.equal(messages.length,LIMITS.sendsPerFlush);assert.ok(messages.some(m=>m.id===offer.id));
  await router.flush();assert.equal((await repo.listForwarded('peer')).length,81);
});
