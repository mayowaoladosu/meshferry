import { createApiToken, createReadableCode, normalizeSubdomain, validateSubdomain } from "@meshferry/core";
import { query, queryOne, toIsoString, toNumber } from "./db";
import { gatewayWebSocketUrl } from "./utils";

export type DeviceStatus = "pending_terminal" | "awaiting_approval" | "approved" | "expired";

export type Organization = {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
};

export type DeviceLink = {
  code: string;
  orgId: string;
  status: DeviceStatus;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  apiToken?: string;
  createdAt: string;
  terminalSeenAt?: string;
  approvedAt?: string;
};

export type SubdomainReservation = {
  slug: string;
  orgId: string;
  createdAt: string;
};

export type TunnelRecord = {
  id: string;
  orgId: string;
  protocol: "http" | "tcp" | "udp";
  subdomain?: string;
  target: string;
  status: "online" | "offline";
  requests: number;
  bytesIn: number;
  bytesOut: number;
  publicUrl?: string;
  fallbackUrl?: string;
  publicHost?: string;
  publicPort?: number;
  gatewayId: string;
  connectedAt: string;
  lastSeenAt: string;
};

export type TunnelEvent = {
  id: number;
  tunnelId?: string;
  orgId: string;
  protocol: "http" | "tcp" | "udp";
  eventType: string;
  method?: string;
  path?: string;
  status?: number;
  bytesIn: number;
  bytesOut: number;
  durationMs?: number;
  createdAt: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: Date | string;
};

type DeviceLinkRow = {
  code: string;
  org_id: string;
  status: DeviceStatus;
  device_id: string | null;
  device_name: string | null;
  platform: string | null;
  api_token: string | null;
  created_at: Date | string;
  terminal_seen_at: Date | string | null;
  approved_at: Date | string | null;
};

type SubdomainRow = {
  slug: string;
  org_id: string;
  created_at: Date | string;
};

type TunnelRow = {
  id: string;
  org_id: string;
  protocol: "http" | "tcp" | "udp";
  subdomain: string | null;
  target: string;
  status: "online" | "offline";
  requests: string | number | bigint;
  bytes_in: string | number | bigint;
  bytes_out: string | number | bigint;
  public_url: string | null;
  fallback_url: string | null;
  public_host: string | null;
  public_port: number | null;
  gateway_id: string;
  connected_at: Date | string;
  last_seen_at: Date | string;
};

type TunnelEventRow = {
  id: string | number | bigint;
  tunnel_id: string | null;
  org_id: string;
  protocol: "http" | "tcp" | "udp";
  event_type: string;
  method: string | null;
  path: string | null;
  status: number | null;
  bytes_in: string | number | bigint;
  bytes_out: string | number | bigint;
  duration_ms: number | null;
  created_at: Date | string;
};

export async function getDashboardState(viewer: { orgId: string; userId: string; name: string }) {
  const org = await ensureOrganization(viewer);
  const activeLink = await ensureActiveDeviceLink(org.id);
  const [subdomains, devices, tunnels, events] = await Promise.all([
    query<SubdomainRow>("SELECT * FROM subdomains WHERE org_id = $1 ORDER BY created_at DESC", [org.id]),
    query<DeviceLinkRow>("SELECT * FROM device_links WHERE org_id = $1 ORDER BY created_at DESC LIMIT 6", [org.id]),
    query<TunnelRow>("SELECT * FROM tunnels WHERE org_id = $1 ORDER BY last_seen_at DESC", [org.id]),
    query<TunnelEventRow>("SELECT * FROM tunnel_events WHERE org_id = $1 ORDER BY created_at DESC LIMIT 12", [org.id])
  ]);

  return {
    org,
    activeLink,
    subdomains: subdomains.map(mapSubdomain),
    devices: devices.map(mapDeviceLink),
    tunnels: tunnels.map(mapTunnel),
    events: events.map(mapTunnelEvent),
    gatewayUrl: gatewayWebSocketUrl()
  };
}

export async function ensureOrganization(viewer: { orgId: string; userId: string; name: string }): Promise<Organization> {
  const name = `${viewer.name} Org`;
  const row = await queryOne<OrganizationRow>(
    `
      INSERT INTO organizations (id, name, owner_user_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          owner_user_id = EXCLUDED.owner_user_id
      RETURNING *
    `,
    [viewer.orgId, name, viewer.userId]
  );

  if (!row) throw new StoreError("organization_write_failed", "Could not create organization.");
  return mapOrganization(row);
}

export async function ensureActiveDeviceLink(orgId: string): Promise<DeviceLink> {
  await expireOldDeviceLinks(orgId);

  const active = await queryOne<DeviceLinkRow>(
    `
      SELECT *
      FROM device_links
      WHERE org_id = $1
        AND status <> 'approved'
        AND created_at > now() - interval '15 minutes'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [orgId]
  );

  if (active) return mapDeviceLink(active);

  const row = await queryOne<DeviceLinkRow>(
    `
      INSERT INTO device_links (code, org_id, status)
      VALUES ($1, $2, 'pending_terminal')
      RETURNING *
    `,
    [createReadableCode(), orgId]
  );

  if (!row) throw new StoreError("device_link_write_failed", "Could not create device link.");
  return mapDeviceLink(row);
}

export async function createDeviceLink(input: {
  orgId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
}): Promise<DeviceLink> {
  const row = await queryOne<DeviceLinkRow>(
    `
      INSERT INTO device_links (
        code,
        org_id,
        status,
        device_id,
        device_name,
        platform,
        terminal_seen_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        CASE WHEN $4::text IS NULL THEN NULL ELSE now() END
      )
      RETURNING *
    `,
    [
      createReadableCode(),
      input.orgId,
      input.deviceId ? "awaiting_approval" : "pending_terminal",
      input.deviceId ?? null,
      input.deviceName ?? null,
      input.platform ?? null
    ]
  );

  if (!row) throw new StoreError("device_link_write_failed", "Could not create device link.");
  return mapDeviceLink(row);
}

export async function completeDeviceLink(input: {
  code: string;
  deviceId: string;
  deviceName?: string;
  platform?: string;
}): Promise<DeviceLink> {
  const existing = await queryOne<DeviceLinkRow>("SELECT * FROM device_links WHERE code = $1", [input.code]);
  if (!existing) throw new StoreError("device_link_not_found", "Device link code was not found.");

  if (isExpired(existing)) {
    await query("UPDATE device_links SET status = 'expired' WHERE code = $1", [input.code]);
    throw new StoreError("device_link_expired", "Device link code expired.");
  }

  const row = await queryOne<DeviceLinkRow>(
    `
      UPDATE device_links
      SET status = 'awaiting_approval',
          device_id = $2,
          device_name = $3,
          platform = $4,
          terminal_seen_at = now()
      WHERE code = $1
      RETURNING *
    `,
    [input.code, input.deviceId, input.deviceName ?? null, input.platform ?? null]
  );

  if (!row) throw new StoreError("device_link_write_failed", "Could not complete device link.");
  return mapDeviceLink(row);
}

export async function approveDeviceLink(code: string, orgId: string): Promise<DeviceLink> {
  const existing = await queryOne<DeviceLinkRow>("SELECT * FROM device_links WHERE code = $1 AND org_id = $2", [
    code,
    orgId
  ]);
  if (!existing) throw new StoreError("device_link_not_found", "Device link code was not found for this organization.");
  if (!existing.device_id) throw new StoreError("terminal_not_connected", "The terminal has not reported this code yet.");

  if (isExpired(existing)) {
    await query("UPDATE device_links SET status = 'expired' WHERE code = $1", [code]);
    throw new StoreError("device_link_expired", "Device link code expired.");
  }

  const row = await queryOne<DeviceLinkRow>(
    `
      UPDATE device_links
      SET status = 'approved',
          approved_at = now(),
          api_token = $3
      WHERE code = $1
        AND org_id = $2
      RETURNING *
    `,
    [code, orgId, createApiToken()]
  );

  if (!row) throw new StoreError("device_link_write_failed", "Could not approve device link.");
  return mapDeviceLink(row);
}

export async function getDeviceLinkStatus(code: string, deviceId: string): Promise<DeviceLink | undefined> {
  const link = await queryOne<DeviceLinkRow>("SELECT * FROM device_links WHERE code = $1 AND device_id = $2", [
    code,
    deviceId
  ]);

  if (link && isExpired(link) && link.status !== "approved") {
    const expired = await queryOne<DeviceLinkRow>(
      "UPDATE device_links SET status = 'expired' WHERE code = $1 RETURNING *",
      [code]
    );
    return expired ? mapDeviceLink(expired) : undefined;
  }

  return link ? mapDeviceLink(link) : undefined;
}

export async function getDeviceLinkByCode(code: string, orgId: string): Promise<DeviceLink | undefined> {
  const link = await queryOne<DeviceLinkRow>("SELECT * FROM device_links WHERE code = $1 AND org_id = $2", [
    code,
    orgId
  ]);
  return link ? mapDeviceLink(link) : undefined;
}

export async function claimSubdomain(slugInput: string, orgId: string): Promise<SubdomainReservation> {
  const check = validateSubdomain(slugInput);
  if (!check.ok) throw new StoreError("subdomain_invalid", check.reason);

  const slug = normalizeSubdomain(check.value);
  const existing = await queryOne<SubdomainRow>("SELECT * FROM subdomains WHERE slug = $1", [slug]);
  if (existing && existing.org_id !== orgId) {
    throw new StoreError("subdomain_taken", "That subdomain is already reserved.");
  }
  if (existing) return mapSubdomain(existing);

  try {
    const row = await queryOne<SubdomainRow>(
      "INSERT INTO subdomains (slug, org_id) VALUES ($1, $2) RETURNING *",
      [slug, orgId]
    );
    if (!row) throw new StoreError("subdomain_write_failed", "Could not reserve subdomain.");
    return mapSubdomain(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new StoreError("subdomain_taken", "That subdomain is already reserved.");
    }
    throw error;
  }
}

export async function validateAgentToken(input: {
  token: string;
  orgId?: string;
  subdomain?: string;
}): Promise<{ orgId: string; deviceId: string; subdomain?: string }> {
  const link = await queryOne<DeviceLinkRow>(
    "SELECT * FROM device_links WHERE status = 'approved' AND api_token = $1",
    [input.token]
  );

  if (!link?.device_id) {
    throw new StoreError("token_invalid", "Agent token is invalid or has not been approved.");
  }

  if (input.orgId && input.orgId !== link.org_id) {
    throw new StoreError("org_mismatch", "Agent token does not belong to the requested organization.");
  }

  if (!input.subdomain) {
    return { orgId: link.org_id, deviceId: link.device_id };
  }

  const check = validateSubdomain(input.subdomain);
  if (!check.ok) throw new StoreError("subdomain_invalid", check.reason);

  const slug = normalizeSubdomain(check.value);
  const reservation = await queryOne<SubdomainRow>("SELECT * FROM subdomains WHERE slug = $1", [slug]);
  if (reservation && reservation.org_id !== link.org_id) {
    throw new StoreError("subdomain_taken", "That subdomain belongs to another organization.");
  }

  if (!reservation) {
    await query("INSERT INTO subdomains (slug, org_id) VALUES ($1, $2)", [slug, link.org_id]);
  }

  return { orgId: link.org_id, deviceId: link.device_id, subdomain: slug };
}

export async function registerTunnel(input: {
  id: string;
  orgId: string;
  protocol: TunnelRecord["protocol"];
  subdomain?: string;
  target: string;
  publicUrl?: string;
  fallbackUrl?: string;
  publicHost?: string;
  publicPort?: number;
  gatewayId: string;
}): Promise<TunnelRecord> {
  const row = await queryOne<TunnelRow>(
    `
      INSERT INTO tunnels (
        id,
        org_id,
        protocol,
        subdomain,
        target,
        status,
        public_url,
        fallback_url,
        public_host,
        public_port,
        gateway_id,
        connected_at,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, 'online', $6, $7, $8, $9, $10, now(), now())
      ON CONFLICT (id) DO UPDATE
      SET org_id = EXCLUDED.org_id,
          protocol = EXCLUDED.protocol,
          subdomain = EXCLUDED.subdomain,
          target = EXCLUDED.target,
          status = 'online',
          public_url = EXCLUDED.public_url,
          fallback_url = EXCLUDED.fallback_url,
          public_host = EXCLUDED.public_host,
          public_port = EXCLUDED.public_port,
          gateway_id = EXCLUDED.gateway_id,
          last_seen_at = now()
      RETURNING *
    `,
    [
      input.id,
      input.orgId,
      input.protocol,
      input.subdomain ?? null,
      input.target,
      input.publicUrl ?? null,
      input.fallbackUrl ?? null,
      input.publicHost ?? null,
      input.publicPort ?? null,
      input.gatewayId
    ]
  );

  if (!row) throw new StoreError("tunnel_write_failed", "Could not register tunnel.");
  return mapTunnel(row);
}

export async function recordTunnelTraffic(input: {
  id: string;
  requests?: number;
  bytesIn?: number;
  bytesOut?: number;
  eventType?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
}): Promise<TunnelRecord | undefined> {
  const row = await queryOne<TunnelRow>(
    `
      UPDATE tunnels
      SET requests = requests + $2,
          bytes_in = bytes_in + $3,
          bytes_out = bytes_out + $4,
          last_seen_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [input.id, input.requests ?? 0, input.bytesIn ?? 0, input.bytesOut ?? 0]
  );

  if (row && input.eventType) {
    await query(
      `
        INSERT INTO tunnel_events (
          tunnel_id,
          org_id,
          protocol,
          event_type,
          method,
          path,
          status,
          bytes_in,
          bytes_out,
          duration_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        row.id,
        row.org_id,
        row.protocol,
        input.eventType,
        input.method ?? null,
        input.path ?? null,
        input.status ?? null,
        input.bytesIn ?? 0,
        input.bytesOut ?? 0,
        input.durationMs ?? null
      ]
    );
  }

  return row ? mapTunnel(row) : undefined;
}

export async function markTunnelOffline(id: string): Promise<TunnelRecord | undefined> {
  const row = await queryOne<TunnelRow>(
    `
      UPDATE tunnels
      SET status = 'offline',
          last_seen_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [id]
  );

  return row ? mapTunnel(row) : undefined;
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function expireOldDeviceLinks(orgId: string): Promise<void> {
  await query(
    `
      UPDATE device_links
      SET status = 'expired'
      WHERE org_id = $1
        AND status <> 'approved'
        AND created_at <= now() - interval '15 minutes'
    `,
    [orgId]
  );
}

function isExpired(link: DeviceLinkRow): boolean {
  const ageMs = Date.now() - new Date(link.created_at).getTime();
  return link.status !== "approved" && ageMs > 15 * 60 * 1000;
}

function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString()
  };
}

function mapDeviceLink(row: DeviceLinkRow): DeviceLink {
  return {
    code: row.code,
    orgId: row.org_id,
    status: row.status,
    deviceId: row.device_id ?? undefined,
    deviceName: row.device_name ?? undefined,
    platform: row.platform ?? undefined,
    apiToken: row.api_token ?? undefined,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    terminalSeenAt: toIsoString(row.terminal_seen_at),
    approvedAt: toIsoString(row.approved_at)
  };
}

function mapSubdomain(row: SubdomainRow): SubdomainReservation {
  return {
    slug: row.slug,
    orgId: row.org_id,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString()
  };
}

function mapTunnel(row: TunnelRow): TunnelRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    protocol: row.protocol,
    subdomain: row.subdomain ?? undefined,
    target: row.target,
    status: row.status,
    requests: toNumber(row.requests),
    bytesIn: toNumber(row.bytes_in),
    bytesOut: toNumber(row.bytes_out),
    publicUrl: row.public_url ?? undefined,
    fallbackUrl: row.fallback_url ?? undefined,
    publicHost: row.public_host ?? undefined,
    publicPort: row.public_port ?? undefined,
    gatewayId: row.gateway_id,
    connectedAt: toIsoString(row.connected_at) ?? new Date().toISOString(),
    lastSeenAt: toIsoString(row.last_seen_at) ?? new Date().toISOString()
  };
}

function mapTunnelEvent(row: TunnelEventRow): TunnelEvent {
  return {
    id: toNumber(row.id),
    tunnelId: row.tunnel_id ?? undefined,
    orgId: row.org_id,
    protocol: row.protocol,
    eventType: row.event_type,
    method: row.method ?? undefined,
    path: row.path ?? undefined,
    status: row.status ?? undefined,
    bytesIn: toNumber(row.bytes_in),
    bytesOut: toNumber(row.bytes_out),
    durationMs: row.duration_ms ?? undefined,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString()
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
