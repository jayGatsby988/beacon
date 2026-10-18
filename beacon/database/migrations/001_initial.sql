CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE incidents (id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE devices (id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE device_tokens (token_hash text PRIMARY KEY, device_id text NOT NULL REFERENCES devices(id), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE TABLE incident_participants (incident_id text NOT NULL REFERENCES incidents(id), device_id text NOT NULL REFERENCES devices(id), PRIMARY KEY(incident_id,device_id));
-- Global identity lives in an ordinary table: a hypertable unique index must include its partition key.
CREATE TABLE event_dedupe (event_id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incidents(id), device_id text NOT NULL REFERENCES devices(id), sequence bigint NOT NULL CHECK(sequence>=0), content_hash text NOT NULL, recorded_at timestamptz NOT NULL, UNIQUE(device_id,sequence));
CREATE TABLE events (
  event_id text NOT NULL REFERENCES event_dedupe(event_id), incident_id text NOT NULL REFERENCES incidents(id),
  device_id text NOT NULL REFERENCES devices(id), sequence bigint NOT NULL, recorded_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT clock_timestamp(), kind text NOT NULL, request_id text, message jsonb, peer_id text,
  PRIMARY KEY(recorded_at,event_id)
);
SELECT create_hypertable('events', by_range('recorded_at', INTERVAL '1 day'));
CREATE INDEX events_incident_ingested ON events(incident_id,ingested_at,event_id);
CREATE INDEX events_request ON events(incident_id,request_id,recorded_at);
CREATE MATERIALIZED VIEW incident_activity_hourly WITH(timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 hour',recorded_at) AS bucket,incident_id,kind,count(*) AS event_count
FROM events GROUP BY bucket,incident_id,kind WITH NO DATA;
SELECT add_continuous_aggregate_policy('incident_activity_hourly', start_offset=>INTERVAL '7 days',end_offset=>INTERVAL '1 hour',schedule_interval=>INTERVAL '5 minutes');
-- Durable refresh work also covers events older than the rolling policy window.
CREATE TABLE aggregate_refresh_queue (bucket timestamptz PRIMARY KEY,revision bigint NOT NULL DEFAULT 1);
CREATE TABLE sync_metadata (incident_id text NOT NULL REFERENCES incidents(id),device_id text NOT NULL REFERENCES devices(id),last_upload_at timestamptz NOT NULL DEFAULT now(),accepted_count bigint NOT NULL DEFAULT 0,PRIMARY KEY(incident_id,device_id));
