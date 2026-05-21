CREATE TABLE IF NOT EXISTS tunnel_events (
  id bigserial PRIMARY KEY,
  tunnel_id text REFERENCES tunnels(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  protocol text NOT NULL CHECK (protocol IN ('http', 'tcp', 'udp')),
  event_type text NOT NULL,
  method text,
  path text,
  status integer,
  bytes_in bigint NOT NULL DEFAULT 0,
  bytes_out bigint NOT NULL DEFAULT 0,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tunnel_events_org_created_idx ON tunnel_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tunnel_events_tunnel_created_idx ON tunnel_events(tunnel_id, created_at DESC);
