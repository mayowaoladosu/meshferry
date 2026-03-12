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
const PUBLIC_SCHEME = process.env.MESHFERRY_PUBLIC_SCHEME ?? inferPublicScheme(PUBLIC_HOST);
const PUBLIC_PORT = parseOptionalNumber(process.env.MESHFERRY_PUBLIC_PORT) ?? inferPublicPort(PUBLIC_HOST, EDGE_PORT, PUBLIC_SCHEME);
const REQUEST_TIMEOUT_MS = parseNumber(process.env.MESHFERRY_REQUEST_TIMEOUT_MS, 30_000);
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
  requestCount: number;
  lastRequestAt: string | null;
}

class TunnelSession {
  readonly pending = new Map<string, PendingRequest>();
  readonly connectedAt = new Date();
  requestCount = 0;
  lastRequestAt: Date | null = null;

  constructor(
    readonly subdomain: string,
    readonly ws: WebSocket,
    readonly publicUrl: string,
    readonly pathUrl: string
  ) {}

  async forwardRequest(message: ProxyRequestMessage): Promise<ProxyResponseMessage> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Tunnel is not connected.");
    }

    this.requestCount += 1;
    this.lastRequestAt = new Date();

    return new Promise<ProxyResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new Error(`Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms.`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(message.requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify(message), (error?: Error) => {
        if (!error) {
          return;
        }

        clearTimeout(timer);
        this.pending.delete(message.requestId);
        reject(error);
      });
    });
  }

  handleMessage(raw: RawData): void {
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

  close(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }

    this.pending.clear();
  }
}

const tunnels = new Map<string, TunnelSession>();

const controlServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${CONTROL_PORT}`}`);

  if (url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      controlPort: CONTROL_PORT,
      edgePort: EDGE_PORT,
      connectedTunnels: tunnels.size
    });
    return;
  }

  if (url.pathname === "/api/tunnels") {
    const data: TunnelInfo[] = Array.from(tunnels.values())
      .map((session) => ({
        subdomain: session.subdomain,
        connectedAt: session.connectedAt.toISOString(),
        publicUrl: session.publicUrl,
        pathUrl: session.pathUrl,
        requestCount: session.requestCount,
        lastRequestAt: session.lastRequestAt?.toISOString() ?? null
      }))
      .sort((left, right) => left.subdomain.localeCompare(right.subdomain));

    json(res, 200, { tunnels: data });
    return;
  }

  json(res, 404, {
    error: "Not found.",
    endpoints: ["/health", "/api/tunnels"]
  });
});

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

  if (tunnels.has(subdomain)) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `The subdomain "${subdomain}" is already in use.`
      })
    );
    ws.close(4003, "Subdomain already connected");
    return;
  }

  const publicUrl = `${buildBaseUrl(subdomain ? `${subdomain}.${PUBLIC_HOST}` : PUBLIC_HOST)}`;
  const pathUrl = `${buildBaseUrl(PUBLIC_HOST)}/t/${subdomain}`;
  const session = new TunnelSession(subdomain, ws, publicUrl, pathUrl);

  tunnels.set(subdomain, session);
  console.log(`[meshferry] connected ${subdomain} -> ${publicUrl}`);

  ws.send(
    JSON.stringify({
      type: "registered",
      subdomain,
      publicUrl,
      pathUrl
    })
  );

  ws.on("message", (raw: RawData) => {
    try {
      session.handleMessage(raw);
    } catch (error) {
      console.error(`[meshferry] failed to handle agent message for ${subdomain}:`, error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Malformed agent message."
        })
      );
    }
  });

  ws.on("close", () => {
    session.close("Tunnel disconnected.");
    tunnels.delete(subdomain);
    console.log(`[meshferry] disconnected ${subdomain}`);
  });

  ws.on("error", (error: Error) => {
    session.close("Tunnel transport error.");
    tunnels.delete(subdomain);
    console.error(`[meshferry] websocket error for ${subdomain}:`, error);
  });
});

const edgeServer = createServer(async (req, res) => {
  try {
    await handleEdgeRequest(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled edge error.";
    console.error("[meshferry] edge error:", error);
    json(res, 500, { error: message });
  }
});

controlServer.listen(CONTROL_PORT, "0.0.0.0", () => {
  console.log(`[meshferry] control plane listening on http://127.0.0.1:${CONTROL_PORT}`);
});

edgeServer.listen(EDGE_PORT, "0.0.0.0", () => {
  console.log(`[meshferry] edge plane listening on http://127.0.0.1:${EDGE_PORT}`);
});

async function handleEdgeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const route = resolveRoute(req);
  if (!route) {
    json(res, 404, {
      error: "No tunnel route matched this request.",
      examplePathRoute: `${buildBaseUrl(PUBLIC_HOST)}/t/demo/`,
      exampleHostRoute: `${buildBaseUrl(`demo.${PUBLIC_HOST}`)}/`
    });
    return;
  }

  const session = tunnels.get(route.subdomain);
  if (!session) {
    json(res, 404, { error: `No active tunnel for "${route.subdomain}".` });
    return;
  }

  const body = await readBody(req);
  const headers = sanitizeIncomingRequestHeaders(req.headers);
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] = "http";
  headers["x-meshferry-subdomain"] = route.subdomain;

  const message: ProxyRequestMessage = {
    type: "proxy-request",
    requestId: randomUUID(),
    method: req.method ?? "GET",
    path: route.forwardPath,
    headers,
    body: encodeBody(body)
  };

  const response = await session.forwardRequest(message);
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

function generateUniqueSubdomain(): string {
  return generateReadableSubdomain((candidate) => !tunnels.has(candidate) && !RESERVED_SUBDOMAINS.has(candidate));
}
