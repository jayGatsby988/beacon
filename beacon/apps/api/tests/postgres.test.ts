import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {PgRepository,refreshAggregates} from '../src/repository.js';
import type {UploadEvent} from '../src/contracts.js';
const url=process.env.BEACON_TEST_DATABASE_URL;
test('Timescale: concurrent retry, transaction rollback, changed-ID rejection and late aggregate refresh',{skip:!url},async()=>{
  // Explicitly opt in with a disposable database. This test creates a unique schema and installs Timescale if absent.
  const schema=`beacon_test_${randomBytes(8).toString('hex')}`;
  const admin=new Pool({connectionString:url,ssl:process.env.DB_SSL==='require'?{rejectUnauthorized:true}:false});
  const pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`,ssl:process.env.DB_SSL==='require'?{rejectUnauthorized:true}:false});
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);await pool.query(await readFile(new URL('../../../database/migrations/001_initial.sql',import.meta.url),'utf8'));
    const device='a'.repeat(64);await pool.query("INSERT INTO incidents(id,name) VALUES('test','Test')");await pool.query('INSERT INTO devices(id) VALUES($1)',[device]);await pool.query("INSERT INTO incident_participants VALUES('test',$1)",[device]);
    const repository=new PgRepository(pool);const recordedAt=Date.now()-30*86400000;const event:UploadEvent={id:'stable-event',deviceId:device,sequence:1,kind:'peer_connected',recordedAt};
    const responses=await Promise.all([repository.ingest('test',device,[event]),repository.ingest('test',device,[event])]);assert.equal(responses.flatMap(r=>r.accepted).length,1);assert.equal(responses.flatMap(r=>r.duplicates).length,1);
    assert.equal((await repository.ingest('test',device,[{...event,recordedAt:recordedAt+1}])).rejected.length,1);
    // A database failure after the dedupe insert must roll the whole transaction back.
    await pool.query("CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='fail' THEN RAISE EXCEPTION 'Injected failure'; END IF; RETURN NEW; END $$");
    await pool.query('CREATE TRIGGER reject_test_event BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_test_event()');
    await assert.rejects(repository.ingest('test',device,[{...event,id:'rollback-event',sequence:2,kind:'fail'}]));
    assert.equal((await pool.query("SELECT 1 FROM event_dedupe WHERE event_id='rollback-event'")).rowCount,0);
    assert.equal(await refreshAggregates(pool),1);
    assert.equal(Number((await pool.query('SELECT event_count FROM incident_activity_hourly')).rows[0].event_count),1);
    await repository.ingest('test',device,[{...event,id:'late-event',sequence:3}]);await refreshAggregates(pool);
    assert.equal(Number((await pool.query('SELECT event_count FROM incident_activity_hourly')).rows[0].event_count),2);
    assert.equal((await repository.replay('test')).events.length,2);
  }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
