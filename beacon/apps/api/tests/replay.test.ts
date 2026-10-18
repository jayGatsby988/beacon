import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createEnvelope,createIdentity,createRequestId} from '@beacon/protocol';
import {replayPageLength} from '../src/repository.js';
test('replay fits mobile response limit even with maximum-length Unicode envelope fields',()=>{
  const identity=createIdentity(randomBytes);const now=Date.now();
  const message=createEnvelope(identity,{type:'sos',requestId:createRequestId(identity,randomBytes),destination:'community',payload:{category:'other',note:'界'.repeat(280),displayName:'界'.repeat(48),location:{source:'manual_description',capturedAt:now,description:'界'.repeat(160),building:'界'.repeat(80),floor:'界'.repeat(32),room:'界'.repeat(32)}}},now,randomBytes);
  const events=Array.from({length:2000},(_,sequence)=>({id:`event-${sequence}`,deviceId:identity.nodeId,sequence,recordedAt:now,ingestedAt:now,kind:'sos',requestId:message.requestId,message}));
  const count=replayPageLength(events);assert.ok(count>0&&count<2000);
  assert.ok(Buffer.byteLength(JSON.stringify(events.slice(0,count)))<4_000_100);
  assert.ok(Buffer.byteLength(JSON.stringify(events.slice(0,count+1)))>4_000_000);
});
