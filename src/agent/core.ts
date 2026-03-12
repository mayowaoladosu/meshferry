import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
import {
  decodeBody,
  encodeBody,
  readJsonMessage,
  sanitizeOutgoingResponseHeaders,
  type ProxyRequestMessage,
  type ProxyResponseMessage,
  type ServerMessage
} from "../protocol.js";

export interface AgentConfig {
  server: string;
  local: string;
  subdomain: string;
  token: string;
}

const HEARTBEAT_INTERVAL_MS = parseNumber(process.env.MESHFERRY_HEARTBEAT_INTERVAL_MS, 15_000);
const HEARTBEAT_TIMEOUT_MS = parseNumber(process.env.MESHFERRY_HEARTBEAT_TIMEOUT_MS, 45_000);

let shuttingDown = false;
let activeSocket: WebSocket | null = null;

export function createAgentConfig(input: Partial<AgentConfig> & { localTarget?: string | number }): AgentConfig {
  const server = input.server ?? process.env.MESHFERRY_SERVER ?? "http://127.0.0.1:7000";
  const localTarget = input.local ?? readLocalTarget(input.localTarget) ?? process.env.MESHFERRY_LOCAL ?? "http://127.0.0.1:3000";
  const local = normalizeLocalTarget(localTarget);
  const subdomain = (input.subdomain ?? process.env.MESHFERRY_SUBDOMAIN ?? "").toLowerCase();
  const token = input.token ?? process.env.MESHFERRY_TOKEN ?? "meshferry-dev-token";

  validateAgentConfig({ server, local, subdomain, token });

  return {
    server,
    local,
    subdomain,
    token
  };
}

export async function runAgent(agentConfig: AgentConfig): Promise<number> {
  let exitCode = 0;
  shuttingDown = false;
  activeSocket = null;

  const handleSignal = () => {
    shuttingDown = true;
    activeSocket?.close(1000, "Agent shutdown");
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  try {
    while (!shuttingDown) {
      const ws = new WebSocket(buildControlUrl(agentConfig));
      activeSocket = ws;

      const closeCode = await new Promise<number>((resolve) => {
        const stopHeartbeat = startHeartbeat(ws);

        ws.on("open", () => {
          console.log(`[meshferry-agent] connected to ${agentConfig.server}`);
          console.log(`[meshferry-agent] local target: ${agentConfig.local}`);
        });

        ws.on("message", async (raw: RawData) => {
          try {
            await handleMessage(ws, agentConfig, raw);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unhandled agent error.";
            console.error("[meshferry-agent] request handling failed:", error);
            sendJson(ws, {
              type: "error",
              message
            });
          }
        });

        ws.on("close", (code: number, reason: Buffer) => {
          stopHeartbeat();
          activeSocket = null;
          if (!shuttingDown) {
            console.log(`[meshferry-agent] disconnected (${code}) ${reason.toString()}`);
          }

          resolve(code);
        });

        ws.on("error", (error: Error) => {
          console.error("[meshferry-agent] websocket error:", error.message);
        });
      });

      if (shuttingDown || closeCode === 1000) {
        break;
      }

      if (closeCode >= 4000) {
        exitCode = 1;
        break;
      }

      await delay(2_000);
      console.log("[meshferry-agent] reconnecting...");
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    activeSocket = null;
  }

  return exitCode;
}

export function normalizeLocalTarget(target: string | number): string {
  const value = `${target}`.trim();

  if (/^\d+$/.test(value)) {
    return `http://127.0.0.1:${value}`;
  }

  if (/^:\d+$/.test(value)) {
    return `http://127.0.0.1${value}`;
  }

  if (/^https?:\/\//.test(value)) {
    return value;
  }

  throw new Error(`Expected a port like "3000" or a local URL like "http://127.0.0.1:3000", received "${value}".`);
}

function readLocalTarget(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return `${value}`;
}

async function handleMessage(ws: WebSocket, agentConfig: AgentConfig, raw: RawData): Promise<void> {
  const message = readJsonMessage(raw as Buffer) as ServerMessage;

  if (message.type === "registered") {
    agentConfig.subdomain = message.subdomain;
    console.log("[meshferry-agent] tunnel ready");
    console.log(`[meshferry-agent] subdomain route: ${message.publicUrl}`);
    console.log(`[meshferry-agent] path route: ${message.pathUrl}`);
    return;
  }

  if (message.type === "error") {
    console.error(`[meshferry-agent] server error: ${message.message}`);
    return;
  }

  if (message.type !== "proxy-request") {
    return;
  }

  const response = await proxyToLocal(agentConfig.local, message);
  sendJson(ws, response);
}

async function proxyToLocal(localBase: string, request: ProxyRequestMessage): Promise<ProxyResponseMessage> {
  const target = new URL(request.path, ensureTrailingSlash(localBase));
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "content-length") {
      continue;
    }

    headers.set(name, value);
  }

  const body = decodeBody(request.body);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: shouldSendBody(request.method) ? new Uint8Array(body) : undefined,
      redirect: "manual"
    });

    return {
      type: "proxy-response",
      requestId: request.requestId,
      status: response.status,
      headers: sanitizeOutgoingResponseHeaders(response.headers),
      body: encodeBody(Buffer.from(await response.arrayBuffer()))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream error.";
    const body = Buffer.from(
      JSON.stringify(
        {
          error: "MeshFerry agent could not reach the local service.",
          target: target.toString(),
          message
        },
        null,
        2
      )
    );

    return {
      type: "proxy-response",
      requestId: request.requestId,
      status: 502,
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: encodeBody(body)
    };
  }
}

function validateAgentConfig(agentConfig: AgentConfig): void {
  if (!/^https?:\/\//.test(agentConfig.server)) {
    throw new Error(`Expected --server to be an http(s) URL, received "${agentConfig.server}".`);
  }

  if (!/^https?:\/\//.test(agentConfig.local)) {
    throw new Error(`Expected the local target to be an http(s) URL, received "${agentConfig.local}".`);
  }

  if (agentConfig.subdomain && !/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(agentConfig.subdomain)) {
    throw new Error("Expected --subdomain to be 3-32 lowercase letters, digits, or hyphens.");
  }
}

function buildControlUrl(agentConfig: AgentConfig): string {
  const url = new URL(agentConfig.server);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/connect";
  if (agentConfig.subdomain) {
    url.searchParams.set("subdomain", agentConfig.subdomain);
  }
  url.searchParams.set("token", agentConfig.token);
  return url.toString();
}

function startHeartbeat(ws: WebSocket): () => void {
  let lastHeartbeatAt = Date.now();
  const noteHeartbeat = () => {
    lastHeartbeatAt = Date.now();
  };

  ws.on("ping", noteHeartbeat);
  ws.on("pong", noteHeartbeat);
  ws.on("message", noteHeartbeat);

  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(timer);
      return;
    }

    if (Date.now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
      console.error("[meshferry-agent] heartbeat timed out, reconnecting...");
      ws.terminate();
      clearInterval(timer);
      return;
    }

    try {
      ws.ping();
    } catch {
      ws.terminate();
      clearInterval(timer);
    }
  }, HEARTBEAT_INTERVAL_MS);

  timer.unref?.();
  return () => clearInterval(timer);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function shouldSendBody(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
