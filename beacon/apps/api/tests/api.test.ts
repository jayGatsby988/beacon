import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createIdentity,createEnvelope,createRequestId} from '@beacon/protocol';
import {createApp,tokenHash} from '../src/app.js';
import type {Repository,UploadEvent,BatchResult} from '../src/contracts.js';
const now=Date.now();const identity=createIdentity(randomBytes);const stranger=createIdentity(randomBytes);const token='a'.repeat(43);
class MemoryRepository implements Repository {
  records=new Map<string,UploadEvent>();available=true;
  async authenticate(hash:string){return hash===tokenHash(token)?{deviceId:identity.nodeId}:null;}
  async isMember(_device:string,incident:string){return incident==='campus';}
  async ready(){if(!this.available)throw new Error('offline');}
  async ingest(_incident:string,_device:string,events:UploadEvent[]){const result:BatchResult={accepted:[],duplicates:[],rejected:[]};for(const event of events){if(this.records.has(event.id))result.duplicates.push(event.id);else{this.records.set(event.id,event);result.accepted.push(event.id);}}return result;}
  async replay(){return {events:[...this.records.values()].map(e=>({...e,ingestedAt:now})),updatedAt:now,incomplete:true as const};}
  async summary(){return {incomplete:true};}
}
async function withServer(fn:(url:string,repo:MemoryRepository)=>Promise<void>){const repo=new MemoryRepository();const server=createApp(repo,{now:()=>now}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');try{await fn(`http://127.0.0.1:${address.port}`,repo);}finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}
const event=(patch:Partial<UploadEvent>={}):UploadEvent=>({id:'event-1',deviceId:identity.nodeId,sequence:1,recordedAt:now,kind:'message_received',...patch});
const post=(url:string,body:unknown,authorized=true)=>fetch(`${url}/v1/events/batch`,{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
test('requires valid credentials and incident membership for upload and replay',async()=>withServer(async(url,repo)=>{
  assert.equal((await post(url,{incidentId:'campus',events:[event()]},false)).status,401);
  assert.equal((await post(url,{incidentId:'private',events:[event()]})).status,403);
  assert.equal((await fetch(`${url}/v1/incidents/private/events`,{headers:{authorization:`Bearer ${token}`}})).status,403);
  assert.equal(repo.records.size,0);
}));
test('returns durable acceptance/duplicate outcomes and rejects impersonated observers',async()=>withServer(async(url,repo)=>{
  const response=await post(url,{incidentId:'campus',events:[event(),event({id:'forged',deviceId:stranger.nodeId,sequence:2})]});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{accepted:['event-1'],duplicates:[],rejected:[{id:'forged',reason:'Device does not match credentials'}]});
  assert.deepEqual((await (await post(url,{incidentId:'campus',events:[event()]})).json()).duplicates,['event-1']);assert.equal(repo.records.size,1);
}));
test('validates signatures while allowing enrolled devices to upload observed third-party envelopes',async()=>withServer(async(url,repo)=>{
  const requestId=createRequestId(stranger,randomBytes);const message=createEnvelope(stranger,{type:'sos',requestId,destination:'community',payload:{category:'other',note:'',displayName:'Peer',location:{source:'unavailable',capturedAt:now}}},now,randomBytes);
  const valid=event({requestId,message});const forged=event({id:'forged',sequence:2,requestId,message:{...message,signature:'0'.repeat(128)}});
  const result=await (await post(url,{incidentId:'campus',events:[valid,forged,event({id:'mismatch',sequence:3,message,requestId:'f'.repeat(64)})]})).json();
  assert.deepEqual(result.accepted,['event-1']);assert.equal(result.rejected.length,2);assert.equal(repo.records.size,1);
}));
test('bounds batch size, future timestamps, malformed envelopes and extra fields',async()=>withServer(async(url)=>{
  assert.equal((await post(url,{incidentId:'campus',events:Array.from({length:101},()=>event())})).status,400);
  const result=await (await post(url,{incidentId:'campus',events:[event({recordedAt:now+300001}),{...event({id:'extra'}),admin:true},event({id:'past',recordedAt:now-30*86400000})]})).json();assert.deepEqual(result.accepted,['past']);assert.equal(result.rejected.length,2);
}));
test('health and readiness differ when storage fails; cloud replay remains explicitly incomplete',async()=>withServer(async(url,repo)=>{
  repo.available=false;assert.equal((await fetch(`${url}/healthz`)).status,200);assert.equal((await fetch(`${url}/readyz`)).status,503);
  const replay=await fetch(`${url}/v1/incidents/campus/events`,{headers:{authorization:`Bearer ${token}`}});assert.equal(replay.headers.get('cache-control'),'no-store');assert.equal((await replay.json()).incomplete,true);
}));
