CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_links (
  code text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending_terminal', 'awaiting_approval', 'approved', 'expired')),
  device_id text,
  device_name text,
  platform text,
  api_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  terminal_seen_at timestamptz,
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS device_links_org_created_idx ON device_links(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS device_links_org_status_idx ON device_links(org_id, status);
CREATE INDEX IF NOT EXISTS device_links_device_idx ON device_links(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS device_links_api_token_idx ON device_links(api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS subdomains (
  slug text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subdomains_org_idx ON subdomains(org_id);

CREATE TABLE IF NOT EXISTS tunnels (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  protocol text NOT NULL CHECK (protocol IN ('http', 'tcp', 'udp')),
  subdomain text,
  target text NOT NULL,
  status text NOT NULL CHECK (status IN ('online', 'offline')),
  requests bigint NOT NULL DEFAULT 0,
  bytes_in bigint NOT NULL DEFAULT 0,
  bytes_out bigint NOT NULL DEFAULT 0,
  public_url text,
  fallback_url text,
  public_host text,
  public_port integer CHECK (public_port IS NULL OR (public_port >= 1 AND public_port <= 65535)),
  gateway_id text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tunnels_org_last_seen_idx ON tunnels(org_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS tunnels_org_status_idx ON tunnels(org_id, status);
CREATE INDEX IF NOT EXISTS tunnels_subdomain_idx ON tunnels(subdomain) WHERE subdomain IS NOT NULL;
