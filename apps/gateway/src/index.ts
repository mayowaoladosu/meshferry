import "dotenv/config";

import {
  agentRegisterSchema,
  decodeBody,
  encodeBody,
  generateTunnelName,
  isJsonMessage,
  normalizeSubdomain,
  parseJsonMessage,
  type AgentRegisterMessage,
  type GatewayToAgentMessage,
  type HttpProxyResponseMessage,
  type TcpCloseMessage,
  type TcpDataMessage,
  type UdpPacketMessage
} from "@meshferry/core";
import dgram from "node:dgram";
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import { nanoid } from "nanoid";
import { WebSocketServer, type WebSocket } from "ws";

const port = toInt(process.env.PORT, 4040);
const edgeDomain = process.env.MESHFERRY_EDGE_DOMAIN ?? `localhost:${port}`;
const controlApiUrl = trimTrailingSlash(process.env.MESHFERRY_CONTROL_API_URL ?? "http://localhost:3000");
const controlApiToken = process.env.MESHFERRY_CONTROL_API_TOKEN ?? "dev-control-token";
const gatewayId = process.env.MESHFERRY_GATEWAY_ID ?? `gateway-local-${port}`;
const requestTimeoutMs = toInt(process.env.MESHFERRY_REQUEST_TIMEOUT_MS, 30_000);
const maxBodyBytes = toInt(process.env.MESHFERRY_MAX_BODY_BYTES, 10 * 1024 * 1024);

type PendingHttpRequest = {
  response: ServerResponse;
  timeout: NodeJS.Timeout;
  bytesIn: number;
};

type RegisteredTunnel = {
  id: string;
  orgId: string;
  ws: WebSocket;
  protocol: AgentRegisterMessage["protocol"];
  subdomain?: string;
  localHost: string;
  localPort: number;
  pendingHttp: Map<string, PendingHttpRequest>;
  tcpServer?: net.Server;
  tcpSockets: Map<string, Socket>;
  udpSocket?: dgram.Socket;
  udpRemotes: Map<string, dgram.RemoteInfo>;
};

const tunnelsById = new Map<string, RegisteredTunnel>();
const httpTunnelsBySubdomain = new Map<string, RegisteredTunnel>();

const server = http.createServer((request, response) => {
  void routeHttpRequest(request, response).catch((error: unknown) => {
    console.error("[gateway] request failed", error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: "gateway_request_failed" }));
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/agent") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  let tunnel: RegisteredTunnel | undefined;

  ws.on("message", (raw) => {
    void (async () => {
      const message = parseJsonMessage(raw);
      if (!isJsonMessage(message)) {
        send(ws, { type: "gateway.error", code: "bad_message", message: "Invalid message envelope." });
        return;
      }

      if (message.type === "agent.register") {
        const parsed = agentRegisterSchema.safeParse(message);
        if (!parsed.success) {
          send(ws, {
            type: "gateway.error",
            code: "register_invalid",
            message: parsed.error.issues[0]?.message ?? "Registration failed."
          });
          return;
        }

        tunnel = await registerTunnel(ws, parsed.data);
        return;
      }

      if (!tunnel) {
        send(ws, {
          type: "gateway.error",
          code: "not_registered",
          message: "Register an agent tunnel before sending proxy messages."
        });
        return;
      }

      handleAgentMessage(tunnel, message);
    })().catch((error: unknown) => {
      console.error("[gateway] websocket message failed", error);
      if (error instanceof ControlPlaneError) {
        send(ws, { type: "gateway.error", code: error.code, message: error.message });
        return;
      }
      send(ws, { type: "gateway.error", code: "message_failed", message: "Gateway could not process the message." });
    });
  });

  ws.on("close", () => {
    if (tunnel) void unregisterTunnel(tunnel);
  });

  ws.on("error", (error) => {
    console.error("[gateway] websocket error", error);
  });
});

server.listen(port, () => {
  console.log(`[gateway] listening on http://localhost:${port}`);
  console.log(`[gateway] edge domain ${edgeDomain}`);
  console.log(`[gateway] control plane ${controlApiUrl}`);
});

async function registerTunnel(ws: WebSocket, registration: AgentRegisterMessage): Promise<RegisteredTunnel> {
  const tunnelId = nanoid(12);
  const requestedSubdomain = registration.subdomain ? normalizeSubdomain(registration.subdomain) : generateTunnelName();
  const subdomain = registration.protocol === "http" ? requestedSubdomain : undefined;
  const validation = await validateAgentRegistration(registration.token, registration.orgId, subdomain);

  if (subdomain && httpTunnelsBySubdomain.has(subdomain)) {
    send(ws, {
      type: "gateway.error",
      code: "subdomain_taken",
      message: `${subdomain} is already connected to this gateway.`
    });
    throw new Error("subdomain already connected");
  }

  const tunnel: RegisteredTunnel = {
    id: tunnelId,
    orgId: validation.orgId,
    ws,
    protocol: registration.protocol,
    subdomain,
    localHost: registration.localHost,
    localPort: registration.localPort,
    pendingHttp: new Map(),
    tcpSockets: new Map(),
    udpRemotes: new Map()
  };

  tunnelsById.set(tunnel.id, tunnel);
  if (subdomain) httpTunnelsBySubdomain.set(subdomain, tunnel);

  if (registration.protocol === "tcp") {
    tunnel.tcpServer = await startTcpIngress(tunnel, registration.publicPort);
  }

  if (registration.protocol === "udp") {
    tunnel.udpSocket = await startUdpIngress(tunnel, registration.publicPort);
  }

  const publicPort = registration.protocol === "tcp"
    ? addressPort(tunnel.tcpServer?.address())
    : registration.protocol === "udp"
      ? addressPort(tunnel.udpSocket?.address())
      : undefined;
  const publicUrl = subdomain ? `http://${subdomain}.${edgeDomain}` : undefined;
  const fallbackUrl = subdomain ? `http://localhost:${port}/t/${subdomain}` : undefined;
  const publicHost = edgeDomain.split(":")[0] || "localhost";

  try {
    await registerTunnelWithControlPlane({
      id: tunnelId,
      orgId: validation.orgId,
      protocol: registration.protocol,
      subdomain,
      target: `${registration.localHost}:${registration.localPort}`,
      publicUrl,
      fallbackUrl,
      publicHost,
      publicPort
    });
  } catch (error) {
    await unregisterTunnel(tunnel, false);
    throw error;
  }

  send(ws, {
    type: "agent.registered",
    tunnelId,
    protocol: registration.protocol,
    subdomain,
    publicUrl,
    fallbackUrl,
    publicHost,
    publicPort
  });

  console.log(
    `[gateway] ${registration.protocol} tunnel ${tunnelId} -> ${registration.localHost}:${registration.localPort}`
  );
  return tunnel;
}

async function unregisterTunnel(tunnel: RegisteredTunnel, notifyControlPlane = true): Promise<void> {
  tunnelsById.delete(tunnel.id);
  if (tunnel.subdomain) httpTunnelsBySubdomain.delete(tunnel.subdomain);

  for (const pending of tunnel.pendingHttp.values()) {
    clearTimeout(pending.timeout);
    if (!pending.response.headersSent) {
      pending.response.writeHead(502, { "content-type": "application/json" });
    }
    pending.response.end(JSON.stringify({ error: "agent_disconnected" }));
  }

  for (const socket of tunnel.tcpSockets.values()) {
    socket.destroy();
  }

  tunnel.tcpServer?.close();
  tunnel.udpSocket?.close();
  if (notifyControlPlane) {
    await postControlPlane("/api/control/tunnels/offline", { id: tunnel.id }).catch((error: unknown) => {
      console.error("[gateway] failed to mark tunnel offline", error);
    });
  }
  console.log(`[gateway] tunnel ${tunnel.id} disconnected`);
}

async function routeHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, tunnels: tunnelsById.size }));
    return;
  }

  const routed = resolveHttpTunnel(request);
  if (!routed) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "tunnel_not_found" }));
    return;
  }

  const { tunnel, path } = routed;
  if (tunnel.ws.readyState !== tunnel.ws.OPEN) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "agent_offline" }));
    return;
  }

  const body = await readRequestBody(request, maxBodyBytes);
  const requestId = nanoid(16);
  const timeout = setTimeout(() => {
    tunnel.pendingHttp.delete(requestId);
    if (!response.headersSent) {
      response.writeHead(504, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: "agent_timeout" }));
  }, requestTimeoutMs);

  tunnel.pendingHttp.set(requestId, { response, timeout, bytesIn: body.length });
  send(tunnel.ws, {
    type: "proxy.http.request",
    requestId,
    method: request.method ?? "GET",
    path,
    headers: normalizeHeaders(request.headers),
    body: encodeBody(body)
  });
}

function resolveHttpTunnel(request: IncomingMessage): { tunnel: RegisteredTunnel; path: string } | undefined {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/t/")) {
    const [, , subdomain, ...rest] = url.pathname.split("/");
    if (!subdomain) return undefined;

    const tunnel = httpTunnelsBySubdomain.get(normalizeSubdomain(subdomain));
    if (!tunnel) return undefined;

    url.pathname = `/${rest.join("/")}`;
    return { tunnel, path: `${url.pathname}${url.search}` };
  }

  const host = (request.headers.host ?? "").split(":")[0] ?? "";
  const suffix = `.${edgeDomain.split(":")[0]}`;
  if (!host.endsWith(suffix)) return undefined;

  const subdomain = host.slice(0, -suffix.length);
  const tunnel = httpTunnelsBySubdomain.get(normalizeSubdomain(subdomain));
  return tunnel ? { tunnel, path: `${url.pathname}${url.search}` } : undefined;
}

function handleAgentMessage(tunnel: RegisteredTunnel, message: { type: string }): void {
  if (message.type === "proxy.http.response") {
    completeHttpRequest(tunnel, message as HttpProxyResponseMessage);
    return;
  }

  if (message.type === "proxy.tcp.data") {
    const tcpMessage = message as TcpDataMessage;
    const body = decodeBody(tcpMessage.body);
    tunnel.tcpSockets.get(tcpMessage.streamId)?.write(body);
    void reportTunnelTraffic(tunnel.id, { bytesOut: body.length });
    return;
  }

  if (message.type === "proxy.tcp.close") {
    const tcpMessage = message as TcpCloseMessage;
    const socket = tunnel.tcpSockets.get(tcpMessage.streamId);
    tunnel.tcpSockets.delete(tcpMessage.streamId);
    socket?.destroy();
    return;
  }

  if (message.type === "proxy.udp.packet") {
    const udpMessage = message as UdpPacketMessage;
    const remote = tunnel.udpRemotes.get(udpMessage.remoteId);
    if (remote && tunnel.udpSocket) {
      const body = decodeBody(udpMessage.body);
      tunnel.udpSocket.send(body, remote.port, remote.address);
      void reportTunnelTraffic(tunnel.id, { bytesOut: body.length });
    }
  }
}

function completeHttpRequest(tunnel: RegisteredTunnel, message: HttpProxyResponseMessage): void {
  const pending = tunnel.pendingHttp.get(message.requestId);
  if (!pending) return;

  tunnel.pendingHttp.delete(message.requestId);
  clearTimeout(pending.timeout);

  const headers = stripHopByHopHeaders(message.headers);
  const body = decodeBody(message.body);
  pending.response.writeHead(message.status, headers);
  pending.response.end(body);
  void reportTunnelTraffic(tunnel.id, { requests: 1, bytesIn: pending.bytesIn, bytesOut: body.length });
}

async function startTcpIngress(tunnel: RegisteredTunnel, requestedPort?: number): Promise<net.Server> {
  const tcpServer = net.createServer((socket) => {
    const streamId = nanoid(16);
    tunnel.tcpSockets.set(streamId, socket);
    send(tunnel.ws, { type: "proxy.tcp.open", streamId });
    void reportTunnelTraffic(tunnel.id, { requests: 1 });

    socket.on("data", (chunk) => {
      send(tunnel.ws, { type: "proxy.tcp.data", streamId, body: encodeBody(chunk) });
      void reportTunnelTraffic(tunnel.id, { bytesIn: chunk.length });
    });

    socket.on("close", () => {
      tunnel.tcpSockets.delete(streamId);
      send(tunnel.ws, { type: "proxy.tcp.close", streamId });
    });

    socket.on("error", (error) => {
      tunnel.tcpSockets.delete(streamId);
      send(tunnel.ws, { type: "proxy.tcp.close", streamId, error: error.message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    tcpServer.once("error", reject);
    tcpServer.listen(requestedPort ?? 0, () => {
      tcpServer.off("error", reject);
      resolve();
    });
  });

  return tcpServer;
}

async function startUdpIngress(tunnel: RegisteredTunnel, requestedPort?: number): Promise<dgram.Socket> {
  const socket = dgram.createSocket("udp4");

  socket.on("message", (message, remote) => {
    const remoteId = `${remote.address}:${remote.port}`;
    tunnel.udpRemotes.set(remoteId, remote);
    send(tunnel.ws, { type: "proxy.udp.packet", remoteId, body: encodeBody(message) });
    void reportTunnelTraffic(tunnel.id, { requests: 1, bytesIn: message.length });
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(requestedPort ?? 0, () => {
      socket.off("error", reject);
      resolve();
    });
  });

  return socket;
}

function send(ws: WebSocket, message: GatewayToAgentMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value || hopByHopHeaders.has(key.toLowerCase())) continue;
    normalized[key] = value;
  }

  return normalized;
}

function stripHopByHopHeaders(headers: Record<string, string | string[]>): Record<string, string | string[]> {
  const stripped: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (hopByHopHeaders.has(key.toLowerCase())) continue;
    stripped[key] = value;
  }

  return stripped;
}

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function addressPort(address: string | net.AddressInfo | null | undefined): number | undefined {
  if (!address || typeof address === "string") return undefined;
  return address.port;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function validateAgentRegistration(
  token: string,
  orgId: string | undefined,
  subdomain: string | undefined
): Promise<{ orgId: string; deviceId: string; subdomain?: string }> {
  const response = await postControlPlane("/api/control/agent/validate", {
    token,
    orgId,
    subdomain
  });

  if (response.ok !== true) {
    throw new ControlPlaneError(response.error ?? "agent_denied", response.message ?? "Agent registration denied.");
  }

  return response as { ok: true; orgId: string; deviceId: string; subdomain?: string };
}

async function registerTunnelWithControlPlane(input: {
  id: string;
  orgId: string;
  protocol: AgentRegisterMessage["protocol"];
  subdomain?: string;
  target: string;
  publicUrl?: string;
  fallbackUrl?: string;
  publicHost?: string;
  publicPort?: number;
}): Promise<void> {
  await postControlPlane("/api/control/tunnels/register", {
    ...input,
    gatewayId
  });
}

async function reportTunnelTraffic(
  id: string,
  metrics: { requests?: number; bytesIn?: number; bytesOut?: number }
): Promise<void> {
  await postControlPlane("/api/control/tunnels/traffic", { id, ...metrics }).catch((error: unknown) => {
    console.error("[gateway] telemetry update failed", error);
  });
}

async function postControlPlane(pathname: string, body: unknown): Promise<Record<string, unknown> & { ok?: boolean; error?: string; message?: string }> {
  const response = await fetch(`${controlApiUrl}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${controlApiToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new ControlPlaneError(
      payload.error ?? "control_plane_error",
      payload.message ?? `Control plane returned ${response.status}.`
    );
  }

  return payload;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

class ControlPlaneError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
