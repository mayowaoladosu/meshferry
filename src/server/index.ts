#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  decodeBody,
  encodeBody,
  readJsonMessage,
  sanitizeAgentResponseHeaders,
  sanitizeIncomingRequestHeaders,
  type ClientMessage,
  type ProxyRequestMessage,
  type ProxyResponseMessage
} from "../protocol.js";
import { generateReadableSubdomain } from "./name-generator.js";

const CONTROL_PORT = parseNumber(process.env.MESHFERRY_CONTROL_PORT ?? process.env.PORT, 7000);
const EDGE_PORT = parseNumber(process.env.MESHFERRY_EDGE_PORT, 8080);
const PUBLIC_HOST = process.env.MESHFERRY_PUBLIC_HOST ?? "meshferry.localhost";
const CONTROL_PUBLIC_HOST = process.env.MESHFERRY_CONTROL_HOST ?? inferControlPublicHost(PUBLIC_HOST);
const PUBLIC_SCHEME = process.env.MESHFERRY_PUBLIC_SCHEME ?? inferPublicScheme(PUBLIC_HOST);
const PUBLIC_PORT = parseOptionalNumber(process.env.MESHFERRY_PUBLIC_PORT) ?? inferPublicPort(PUBLIC_HOST, EDGE_PORT, PUBLIC_SCHEME);
const REQUEST_TIMEOUT_MS = parseNumber(process.env.MESHFERRY_REQUEST_TIMEOUT_MS, 30_000);
const TUNNEL_GRACE_MS = parseNumber(process.env.MESHFERRY_TUNNEL_GRACE_MS, 300_000);
const HEARTBEAT_INTERVAL_MS = parseNumber(process.env.MESHFERRY_HEARTBEAT_INTERVAL_MS, 15_000);
const HEARTBEAT_TIMEOUT_MS = parseNumber(process.env.MESHFERRY_HEARTBEAT_TIMEOUT_MS, 45_000);
const RESERVED_SUBDOMAINS = new Set(
  (process.env.MESHFERRY_RESERVED_SUBDOMAINS ?? "app,api,connect,www,admin,status")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const AUTH_TOKENS = new Set(
  (process.env.MESHFERRY_AUTH_TOKENS ?? "meshferry-dev-token")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const SINGLE_PORT_MODE = CONTROL_PORT === EDGE_PORT;

interface PendingRequest {
  resolve: (message: ProxyResponseMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface TunnelInfo {
  subdomain: string;
  connectedAt: string;
  publicUrl: string;
  pathUrl: string;
  status: "connected" | "disconnected";
  disconnectedAt: string | null;
  leaseExpiresAt: string | null;
  requestCount: number;
  lastRequestAt: string | null;
}

class TunnelSession {
  readonly pending = new Map<string, PendingRequest>();
  readonly connectedAt = new Date();
  requestCount = 0;
  lastRequestAt: Date | null = null;
  ws: WebSocket | null = null;
  disconnectedAt: Date | null = null;
  leaseExpiresAt: Date | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeatAt = Date.now();

  constructor(
    readonly subdomain: string,
    readonly token: string,
    readonly publicUrl: string,
    readonly pathUrl: string
  ) {}

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.disconnectedAt === null;
  }

  get isReconnectable(): boolean {
    return this.disconnectedAt !== null && this.leaseExpiresAt !== null && this.leaseExpiresAt.getTime() > Date.now();
  }

  async forwardRequest(message: ProxyRequestMessage): Promise<ProxyResponseMessage> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Tunnel is not connected.");
    }

    const socket = this.ws;
    this.requestCount += 1;
    this.lastRequestAt = new Date();

    return new Promise<ProxyResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new Error(`Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms.`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(message.requestId, { resolve, reject, timer });
      socket.send(JSON.stringify(message), (error?: Error) => {
        if (!error) {
          return;
        }

        clearTimeout(timer);
        this.pending.delete(message.requestId);
        reject(error);
      });
    });
  }

  attachSocket(ws: WebSocket): void {
    this.clearGraceTimer();
    this.clearHeartbeat();
    this.ws = ws;
    this.disconnectedAt = null;
    this.leaseExpiresAt = null;
    this.noteHeartbeat();
  }

  canReconnect(token: string): boolean {
    return this.token === token && this.isReconnectable;
  }

  handleMessage(raw: RawData): void {
    this.noteHeartbeat();
    const message = readJsonMessage(raw as Buffer) as ClientMessage;

    if (message.type === "proxy-response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve(message);
      return;
    }

    if (message.type === "error") {
      console.error(`[meshferry] agent ${this.subdomain} error: ${message.message}`);
    }
  }

  noteHeartbeat(): void {
    this.lastHeartbeatAt = Date.now();
  }

  startHeartbeat(onTimeout: () => void): void {
    this.clearHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const socket = this.ws;
      if (!socket) {
        this.clearHeartbeat();
        return;
      }

      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (Date.now() - this.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[meshferry] heartbeat timed out for ${this.subdomain}`);
        socket.terminate();
        onTimeout();
        return;
      }

      try {
        socket.ping();
      } catch {
        socket.terminate();
        onTimeout();
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatTimer.unref?.();
  }

  beginGracePeriod(reason: string, onExpire: () => void): void {
    if (this.disconnectedAt) {
      return;
    }

    this.closePending(reason);
    this.clearHeartbeat();
    this.ws = null;

    if (TUNNEL_GRACE_MS <= 0) {
      onExpire();
      return;
    }

    const disconnectedAt = new Date();
    this.disconnectedAt = disconnectedAt;
    this.leaseExpiresAt = new Date(disconnectedAt.getTime() + TUNNEL_GRACE_MS);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      onExpire();
    }, TUNNEL_GRACE_MS);
    this.graceTimer.unref?.();
  }

  release(reason: string): void {
    this.clearGraceTimer();
    this.clearHeartbeat();
    this.closePending(reason);
    this.ws = null;
    this.disconnectedAt = null;
    this.leaseExpiresAt = null;
  }

  retryAfterSeconds(): number | null {
    if (!this.leaseExpiresAt) {
      return null;
    }

    return Math.max(1, Math.ceil((this.leaseExpiresAt.getTime() - Date.now()) / 1_000));
  }

  private closePending(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }

    this.pending.clear();
  }

  private clearGraceTimer(): void {
    if (!this.graceTimer) {
      return;
    }

    clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

const tunnels = new Map<string, TunnelSession>();

const controlServer = createServer((req, res) => {
  if (SINGLE_PORT_MODE) {
    void handleSinglePortRequest(req, res);
    return;
  }

  if (handleControlRequest(req, res)) {
    return;
  }

  json(res, 404, {
    error: "Not found.",
    endpoints: ["/health", "/api/tunnels"]
  });
});

async function handleSinglePortRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (handleControlRequest(req, res)) {
      return;
    }

    await handleEdgeRequest(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled server error.";
    console.error("[meshferry] single-port error:", error);
    json(res, 500, { error: message });
  }
}

function handleControlRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${CONTROL_PORT}`}`);

  if (url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      controlPort: CONTROL_PORT,
      edgePort: EDGE_PORT,
      connectedTunnels: Array.from(tunnels.values()).filter((session) => session.isConnected).length,
      reconnectableTunnels: Array.from(tunnels.values()).filter((session) => session.isReconnectable).length,
      tunnelGraceMs: TUNNEL_GRACE_MS
    });
    return true;
  }

  if (url.pathname === "/api/tunnels") {
    const data: TunnelInfo[] = Array.from(tunnels.values())
      .map((session) => ({
        subdomain: session.subdomain,
        connectedAt: session.connectedAt.toISOString(),
        publicUrl: session.publicUrl,
        pathUrl: session.pathUrl,
        status: session.isConnected ? ("connected" as const) : ("disconnected" as const),
        disconnectedAt: session.disconnectedAt?.toISOString() ?? null,
        leaseExpiresAt: session.leaseExpiresAt?.toISOString() ?? null,
        requestCount: session.requestCount,
        lastRequestAt: session.lastRequestAt?.toISOString() ?? null
      }))
      .sort((left, right) => left.subdomain.localeCompare(right.subdomain));

    json(res, 200, { tunnels: data });
    return true;
  }

  return false;
}

const wss = new WebSocketServer({ noServer: true });

controlServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${CONTROL_PORT}`}`);

  if (url.pathname !== "/connect") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${CONTROL_PORT}`}`);
  const token = url.searchParams.get("token")?.trim() ?? "";
  const requestedSubdomain = url.searchParams.get("subdomain")?.trim().toLowerCase() ?? "";

  if (!AUTH_TOKENS.has(token)) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid token." }));
    ws.close(4001, "Invalid token");
    return;
  }

  if (requestedSubdomain && !isValidSubdomain(requestedSubdomain)) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Invalid subdomain. Use 3-32 lowercase letters, digits, or hyphens."
      })
    );
    ws.close(4002, "Invalid subdomain");
    return;
  }

  if (requestedSubdomain && RESERVED_SUBDOMAINS.has(requestedSubdomain)) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `The subdomain "${requestedSubdomain}" is reserved. Choose another name.`
      })
    );
    ws.close(4004, "Reserved subdomain");
    return;
  }

  const subdomain = requestedSubdomain || generateUniqueSubdomain();

  const existing = tunnels.get(subdomain);
  if (existing?.isConnected) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `The subdomain "${subdomain}" is already in use.`
      })
    );
    ws.close(4003, "Subdomain already connected");
    return;
  }

  if (existing && !existing.canReconnect(token)) {
    const leaseExpiresAt = existing.leaseExpiresAt?.toISOString();
    const message = leaseExpiresAt
      ? `The subdomain "${subdomain}" is reserved until ${leaseExpiresAt}.`
      : `The subdomain "${subdomain}" is already in use.`;

    ws.send(
      JSON.stringify({
        type: "error",
        message
      })
    );
    ws.close(4005, "Subdomain reserved");
    return;
  }

  const session =
    existing ??
    new TunnelSession(
      subdomain,
      token,
      `${buildBaseUrl(subdomain ? `${subdomain}.${PUBLIC_HOST}` : PUBLIC_HOST)}`,
      `${buildBaseUrl(CONTROL_PUBLIC_HOST)}/t/${subdomain}`
    );

  tunnels.set(subdomain, session);
  attachSocketToSession(session, ws);
  console.log(`[meshferry] ${existing ? "reconnected" : "connected"} ${subdomain} -> ${session.publicUrl}`);

  ws.send(
    JSON.stringify({
      type: "registered",
      subdomain,
      publicUrl: session.publicUrl,
      pathUrl: session.pathUrl
    })
  );
});

const edgeServer = SINGLE_PORT_MODE
  ? null
  : createServer(async (req, res) => {
      try {
        await handleEdgeRequest(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unhandled edge error.";
        console.error("[meshferry] edge error:", error);
        json(res, 500, { error: message });
      }
    });

controlServer.listen(CONTROL_PORT, "0.0.0.0", () => {
  if (SINGLE_PORT_MODE) {
    console.log(`[meshferry] unified control and edge plane listening on http://127.0.0.1:${CONTROL_PORT}`);
    return;
  }

  console.log(`[meshferry] control plane listening on http://127.0.0.1:${CONTROL_PORT}`);
});

if (edgeServer) {
  edgeServer.listen(EDGE_PORT, "0.0.0.0", () => {
    console.log(`[meshferry] edge plane listening on http://127.0.0.1:${EDGE_PORT}`);
  });
}

async function handleEdgeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = resolveRoute(req);
  if (!route) {
    json(res, 404, {
      error: "No tunnel route matched this request.",
      examplePathRoute: `${buildBaseUrl(CONTROL_PUBLIC_HOST)}/t/demo/`,
      exampleHostRoute: `${buildBaseUrl(`demo.${PUBLIC_HOST}`)}/`
    });
    return;
  }

  const session = tunnels.get(route.subdomain);
  if (!session) {
    json(res, 404, { error: `No active tunnel for "${route.subdomain}".` });
    return;
  }

  if (!session.isConnected) {
    const retryAfter = session.retryAfterSeconds();
    if (retryAfter !== null) {
      res.setHeader("retry-after", retryAfter);
    }

    json(res, 503, {
      error: `Tunnel "${route.subdomain}" is temporarily disconnected.`,
      reconnectBy: session.leaseExpiresAt?.toISOString() ?? null
    });
    return;
  }

  const body = await readBody(req);
  const headers = sanitizeIncomingRequestHeaders(req.headers);
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] = PUBLIC_SCHEME;
  headers["x-meshferry-subdomain"] = route.subdomain;

  const message: ProxyRequestMessage = {
    type: "proxy-request",
    requestId: randomUUID(),
    method: req.method ?? "GET",
    path: route.forwardPath,
    headers,
    body: encodeBody(body)
  };

  const response = await session.forwardRequest(message).catch((error) => {
    if (!session.isConnected) {
      const retryAfter = session.retryAfterSeconds();
      if (retryAfter !== null) {
        res.setHeader("retry-after", retryAfter);
      }

      json(res, 503, {
        error: `Tunnel "${route.subdomain}" is temporarily disconnected.`,
        reconnectBy: session.leaseExpiresAt?.toISOString() ?? null
      });
      return null;
    }

    throw error;
  });
  if (!response) {
    return;
  }

  const responseBody = decodeBody(response.body);
  const responseHeaders = sanitizeAgentResponseHeaders(response.headers);

  for (const [name, value] of Object.entries(responseHeaders)) {
    res.setHeader(name, value);
  }

  res.setHeader("content-length", responseBody.length);
  res.setHeader("x-meshferry-subdomain", route.subdomain);
  res.writeHead(response.status);
  res.end(responseBody);
}

function resolveRoute(req: IncomingMessage): { subdomain: string; forwardPath: string } | null {
  const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase() ?? "";
  const rawUrl = req.url ?? "/";
  const parsed = new URL(rawUrl, "http://meshferry.local");

  if (parsed.pathname.startsWith("/t/")) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const subdomain = parts[1]?.toLowerCase() ?? "";
    if (!isValidSubdomain(subdomain)) {
      return null;
    }

    const rest = parts.slice(2).join("/");
    const forwardPath = `/${rest}${parsed.search}`;
    return {
      subdomain,
      forwardPath: forwardPath === "/" ? "/" : forwardPath.replace(/\/{2,}/g, "/")
    };
  }

  const suffix = `.${PUBLIC_HOST.toLowerCase()}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const subdomain = host.slice(0, -suffix.length);
  if (!isValidSubdomain(subdomain)) {
    return null;
  }

  return {
    subdomain,
    forwardPath: `${parsed.pathname}${parsed.search}`
  };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", body.length);
  res.writeHead(status);
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function isValidSubdomain(subdomain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(subdomain);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferPublicScheme(host: string): string {
  return isLocalDevelopmentHost(host) ? "http" : "https";
}

function inferControlPublicHost(host: string): string {
  return isLocalDevelopmentHost(host) ? host : `connect.${host}`;
}

function inferPublicPort(host: string, edgePort: number, scheme: string): number | null {
  if (isLocalDevelopmentHost(host)) {
    return edgePort;
  }

  return scheme === "https" || scheme === "http" ? null : edgePort;
}

function isLocalDevelopmentHost(host: string): boolean {
  const value = host.toLowerCase();
  return value === "localhost" || value.endsWith(".localhost") || value.startsWith("127.0.0.1") || value === "0.0.0.0";
}

function buildBaseUrl(host: string): string {
  const port = PUBLIC_PORT ? `:${PUBLIC_PORT}` : "";
  return `${PUBLIC_SCHEME}://${host}${port}`;
}

function attachSocketToSession(session: TunnelSession, ws: WebSocket): void {
  session.attachSocket(ws);
  session.startHeartbeat(() => undefined);

  ws.on("pong", () => {
    session.noteHeartbeat();
  });

  ws.on("message", (raw: RawData) => {
    try {
      session.handleMessage(raw);
    } catch (error) {
      console.error(`[meshferry] failed to handle agent message for ${session.subdomain}:`, error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Malformed agent message."
        })
      );
    }
  });

  ws.on("close", (_code: number, reason: Buffer) => {
    if (session.ws !== ws) {
      return;
    }

    const detail = reason.toString() || "Tunnel disconnected.";
    session.beginGracePeriod(detail, () => releaseTunnel(session.subdomain, "Tunnel reconnect window expired."));
    const retryAfter = session.retryAfterSeconds();
    const retrySuffix = retryAfter !== null ? `; holding ${retryAfter}s for reconnect` : "";
    console.log(`[meshferry] disconnected ${session.subdomain}${retrySuffix}`);
  });

  ws.on("error", (error: Error) => {
    if (session.ws !== ws) {
      return;
    }

    console.error(`[meshferry] websocket error for ${session.subdomain}:`, error);
  });
}

function generateUniqueSubdomain(): string {
  return generateReadableSubdomain((candidate) => !tunnels.has(candidate) && !RESERVED_SUBDOMAINS.has(candidate));
}

function releaseTunnel(subdomain: string, reason: string): void {
  const session = tunnels.get(subdomain);
  if (!session) {
    return;
  }

  session.release(reason);
  tunnels.delete(subdomain);
  console.log(`[meshferry] released ${subdomain}`);
}
