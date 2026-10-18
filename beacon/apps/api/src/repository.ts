import {Pool,type PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {canonical,deriveRequests,type Envelope} from '@beacon/protocol';
import type {Repository,UploadEvent,ReplayEvent,BatchResult,ReplayPage} from './contracts.js';
export function createPool(env:NodeJS.ProcessEnv=process.env):Pool{
  if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required');
  const url=new URL(env.DATABASE_URL);const local=['localhost','127.0.0.1','::1'].includes(url.hostname);
  if(!local && env.DB_SSL!=='require')throw new Error('Remote databases require DB_SSL=require');
  // Avoid pg connection-string sslmode overriding certificate verification.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  return new Pool({connectionString:url.toString(),max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30_000,statement_timeout:15_000,ssl:env.DB_SSL==='require'?{rejectUnauthorized:true, ...(env.DB_CA_PEM?{ca:env.DB_CA_PEM}:{})}:false});
}
interface EventRow {event_id:string;device_id:string;sequence:string;recorded_at:Date;ingested_at:Date;kind:string;request_id:string|null;message:Envelope|null;peer_id:string|null}
const mapEvent=(r:EventRow):ReplayEvent=>({id:r.event_id,deviceId:r.device_id,sequence:Number(r.sequence),recordedAt:r.recorded_at.getTime(),ingestedAt:r.ingested_at.getTime(),kind:r.kind,...(r.request_id?{requestId:r.request_id}:{}),...(r.message?{message:r.message}:{}),...(r.peer_id?{peerId:r.peer_id}:{})});
const eventHash=(incidentId:string,event:UploadEvent)=>createHash('sha256').update(canonical({incidentId,...event})).digest('hex');
// Mobile rejects responses over 5 MB. Reserve ample room for page metadata and JSON punctuation.
export function replayPageLength(events:readonly ReplayEvent[],budget=4_000_000):number{
  let bytes=0,count=0;
  for(const event of events){const size=Buffer.byteLength(JSON.stringify(event),'utf8')+1;if(bytes+size>budget)break;bytes+=size;count++;}
  return count;
}
export class PgRepository implements Repository {
  constructor(readonly pool:Pool){}
  async ready(){await this.pool.query('SELECT 1 FROM schema_migrations WHERE version=$1',['001_initial.sql']).then(r=>{if(!r.rowCount)throw new Error('Migration required');});}
  async authenticate(digest:string){const r=await this.pool.query('SELECT device_id FROM device_tokens WHERE token_hash=$1 AND revoked_at IS NULL',[digest]);return r.rowCount?{deviceId:r.rows[0].device_id as string}:null;}
  async isMember(deviceId:string,incidentId:string){const r=await this.pool.query('SELECT 1 FROM incident_participants WHERE device_id=$1 AND incident_id=$2',[deviceId,incidentId]);return Boolean(r.rowCount);}
  async ingest(incidentId:string,deviceId:string,events:UploadEvent[]):Promise<BatchResult>{
    const client=await this.pool.connect();const result:BatchResult={accepted:[],duplicates:[],rejected:[]};
    try{await client.query('BEGIN');
      const membership=await client.query('SELECT 1 FROM incident_participants WHERE device_id=$1 AND incident_id=$2 FOR SHARE',[deviceId,incidentId]);if(!membership.rowCount)throw new Error('Membership changed');
      for(const event of events){
        const digest=eventHash(incidentId,event);
        const inserted=await client.query('INSERT INTO event_dedupe(event_id,incident_id,device_id,sequence,content_hash,recorded_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING event_id',[event.id,incidentId,deviceId,event.sequence,digest,new Date(event.recordedAt)]);
        if(!inserted.rowCount){const previous=await client.query('SELECT content_hash FROM event_dedupe WHERE event_id=$1',[event.id]);if(previous.rows[0]?.content_hash===digest)result.duplicates.push(event.id);else result.rejected.push({id:event.id,reason:'Event ID or device sequence conflicts with an existing event'});continue;}
        await client.query('INSERT INTO events(event_id,incident_id,device_id,sequence,recorded_at,kind,request_id,message,peer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[event.id,incidentId,deviceId,event.sequence,new Date(event.recordedAt),event.kind,event.requestId??null,event.message??null,event.peerId??null]);
        await client.query("INSERT INTO aggregate_refresh_queue(bucket) VALUES(time_bucket(INTERVAL '1 hour',$1::timestamptz)) ON CONFLICT(bucket) DO UPDATE SET revision=aggregate_refresh_queue.revision+1",[new Date(event.recordedAt)]);
        result.accepted.push(event.id);
      }
      await client.query('INSERT INTO sync_metadata(incident_id,device_id,accepted_count) VALUES($1,$2,$3) ON CONFLICT(incident_id,device_id) DO UPDATE SET last_upload_at=clock_timestamp(),accepted_count=sync_metadata.accepted_count+$3',[incidentId,deviceId,result.accepted.length]);
      if(result.accepted.length)await client.query('UPDATE incidents SET updated_at=clock_timestamp() WHERE id=$1',[incidentId]);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async replay(incidentId:string,cursor?:string):Promise<ReplayPage>{
    let after:{at:string;id:string}|undefined;
    if(cursor){try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString());if(typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||typeof value.id!=='string'||value.id.length>160)throw new Error();after=value;}catch{throw new Error('Invalid cursor');}}
    // Preserve PostgreSQL microseconds in cursor text; JS Date alone could skip/duplicate boundary records.
    const r=await this.pool.query<EventRow & {cursor_at:string}>('SELECT *,ingested_at::text AS cursor_at FROM events WHERE incident_id=$1 AND ($2::timestamptz IS NULL OR (ingested_at,event_id)>($2::timestamptz,$3::text)) ORDER BY ingested_at,event_id LIMIT 2001',[incidentId,after?.at??null,after?.id??'']);
    const candidates=r.rows.slice(0,2000).map(mapEvent);const length=replayPageLength(candidates);const rows=r.rows.slice(0,length);const last=rows.at(-1);return {events:candidates.slice(0,length),updatedAt:await this.updatedAt(incidentId),incomplete:true,...(r.rows.length>length&&last?{nextCursor:Buffer.from(JSON.stringify({at:last.cursor_at,id:last.event_id})).toString('base64url')}:{})};
  }
  private async updatedAt(id:string){const r=await this.pool.query('SELECT updated_at FROM incidents WHERE id=$1',[id]);return (r.rows[0].updated_at as Date).getTime();}
  async summary(incidentId:string):Promise<Record<string,unknown>>{
    const [counts,observations,buckets,pending]=await Promise.all([
      this.pool.query('SELECT kind,count(*)::int AS count FROM events WHERE incident_id=$1 GROUP BY kind',[incidentId]),
      this.pool.query<{message:Envelope}>('SELECT DISTINCT ON (message->>\'id\') message FROM events WHERE incident_id=$1 AND message IS NOT NULL ORDER BY message->>\'id\' LIMIT 20001',[incidentId]),
      this.pool.query('SELECT bucket,kind,event_count::int FROM incident_activity_hourly WHERE incident_id=$1 ORDER BY bucket DESC LIMIT 1000',[incidentId]),
      this.pool.query('SELECT EXISTS(SELECT 1 FROM aggregate_refresh_queue) AS pending'),
    ]);
    const truncated=observations.rows.length>20000;const messages=observations.rows.slice(0,20000).map(r=>r.message);const requests=deriveRequests(messages);
    const latencies=requests.flatMap(request=>{const valid=request.receipts.map(r=>r.at-request.createdAt).filter(n=>n>=0);return valid.length?[Math.min(...valid)]:[];}).sort((a,b)=>a-b);
    const percentile=(p:number)=>latencies.length?latencies[Math.max(0,Math.ceil(latencies.length*p)-1)]:null;
    return {updatedAt:await this.updatedAt(incidentId),incomplete:true,eventCounts:counts.rows,requestCount:requests.length,requestsWithRecipientReceipt:requests.filter(r=>r.receipts.length).length,completedRequests:requests.filter(r=>r.status==='completed').length,receiptLatencyMs:{sampleCount:latencies.length,p50:percentile(.5),p95:percentile(.95),basis:'signed endpoint receipt timestamp minus signed SOS timestamp; unsynchronized device clocks'},requestStatisticsTruncated:truncated,activityBuckets:buckets.rows,activityBucketsLimit:1000,aggregateRefreshPending:Boolean(pending.rows[0]?.pending)};
  }
}
// Use a session lock: refreshing is intentionally outside the upload transaction and retried after failures.
export async function refreshAggregates(pool:Pool):Promise<number>{
  const client:PoolClient=await pool.connect();let refreshed=0;let locked=false;
  try{locked=Boolean((await client.query('SELECT pg_try_advisory_lock(186924,1) AS locked')).rows[0].locked);if(!locked)return 0;
    const jobs=await client.query<{bucket:Date;revision:string}>('SELECT bucket,revision FROM aggregate_refresh_queue ORDER BY bucket LIMIT 48');
    for(const job of jobs.rows){await client.query("CALL refresh_continuous_aggregate('incident_activity_hourly',$1::timestamptz,$2::timestamptz)",[job.bucket,new Date(job.bucket.getTime()+3600000)]);await client.query('DELETE FROM aggregate_refresh_queue WHERE bucket=$1 AND revision=$2',[job.bucket,job.revision]);refreshed++;}return refreshed;
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(186924,1)');client.release();}
}
