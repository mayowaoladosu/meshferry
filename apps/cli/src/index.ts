#!/usr/bin/env node
import {
  decodeBody,
  encodeBody,
  normalizeSubdomain,
  type AgentRegisteredMessage,
  type GatewayToAgentMessage,
  type HttpProxyRequestMessage,
  type TcpCloseMessage,
  type TcpDataMessage,
  type TcpOpenMessage,
  type TunnelProtocol,
  type UdpPacketMessage
} from "@meshferry/core";
import { Command } from "commander";
import dgram from "node:dgram";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import net, { type Socket } from "node:net";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { parse as parseToml } from "smol-toml";
import { WebSocket } from "ws";
import { configFilePath, loadConfig, saveConfig, type MeshferryConfig } from "./config.js";

const program = new Command();

program
  .name("meshferry")
  .description("Meshferry tunnel agent")
  .version("0.1.0");

program
  .command("connect")
  .description("Link this terminal to a Meshferry organization")
  .option("--code <code>", "dashboard terminal-link code")
  .option("--api <url>", "Meshferry dashboard API URL")
  .option("--gateway <url>", "Meshferry gateway WebSocket URL")
  .action(async (options: { code?: string; api?: string; gateway?: string }) => {
    const config = await loadConfig();
    if (options.api) config.apiUrl = options.api;
    if (options.gateway) config.gatewayUrl = options.gateway;

    const code = options.code ?? (await createDeviceCode(config));
    await completeDeviceLink(config, code);
  });

program
  .command("tunnel")
  .description("Start an HTTP, TCP, or UDP tunnel to a local port")
  .argument("<protocol>", "http, tcp, or udp")
  .argument("<port>", "local port")
  .option("--host <host>", "local host", "127.0.0.1")
  .option("--subdomain <name>", "requested HTTP subdomain")
  .option("--public-port <port>", "requested TCP/UDP public port")
  .option("--gateway <url>", "gateway WebSocket URL")
  .option("--token <token>", "Meshferry API token")
  .option("--org <orgId>", "organization id")
  .action(async (protocolInput: string, portInput: string, options: TunnelOptions) => {
    const protocol = parseProtocol(protocolInput);
    const localPort = parsePort(portInput);
    const config = await loadConfig();

    await startTunnel(protocol, localPort, {
      ...options,
      gateway: options.gateway ?? config.gatewayUrl,
      token: options.token ?? config.token,
      org: options.org ?? config.orgId
    });
  });

for (const protocol of ["http", "tcp", "udp"] as const) {
  program
    .command(`${protocol} <port>`)
    .description(`Start an ${protocol.toUpperCase()} tunnel, OutRay-style`)
    .option("--host <host>", "local host", "127.0.0.1")
    .option("--subdomain <name>", "requested HTTP subdomain")
    .option("--public-port <port>", "requested TCP/UDP public port")
    .option("--remote-port <port>", "alias for --public-port")
    .option("--gateway <url>", "gateway WebSocket URL")
    .option("--token <token>", "Meshferry API token")
    .option("--key <token>", "alias for --token")
    .option("--org <orgId>", "organization id")
    .action(async (portInput: string, options: TunnelOptions & { key?: string; remotePort?: string }) => {
      const config = await loadConfig();
      await startTunnel(protocol, parsePort(portInput), {
        ...options,
        publicPort: options.publicPort ?? options.remotePort,
        token: options.token ?? options.key ?? config.token,
        org: options.org ?? config.orgId,
        gateway: options.gateway ?? config.gatewayUrl
      });
    });
}

program
  .command("start")
  .description("Start all tunnels from an OutRay-compatible TOML config file")
  .option("--config <path>", "config file path", "outray/config.toml")
  .action(async (options: { config: string }) => {
    const runtimeConfig = await loadConfig();
    const tunnels = await loadTunnelConfig(options.config, runtimeConfig);
    for (const tunnel of tunnels) {
      await startTunnel(tunnel.protocol, tunnel.localPort, tunnel);
    }
    console.log(`Started ${tunnels.length} tunnel${tunnels.length === 1 ? "" : "s"} from ${options.config}`);
  });

program
  .command("validate-config")
  .description("Validate an OutRay-compatible TOML config file")
  .option("--config <path>", "config file path", "outray/config.toml")
  .action(async (options: { config: string }) => {
    const runtimeConfig = await loadConfig();
    const tunnels = await loadTunnelConfig(options.config, runtimeConfig);
    console.log(JSON.stringify({ ok: true, tunnels }, null, 2));
  });

program
  .command("status")
  .description("Show local Meshferry CLI configuration")
  .action(async () => {
    const config = await loadConfig();
    console.log(`config: ${configFilePath()}`);
    console.log(`api: ${config.apiUrl}`);
    console.log(`gateway: ${config.gatewayUrl}`);
    console.log(`device: ${config.deviceId}`);
    console.log(`org: ${config.orgId ?? "not linked"}`);
    console.log(`token: ${config.token ? `${config.token.slice(0, 12)}...` : "not linked"}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

type TunnelOptions = {
  host?: string;
  subdomain?: string;
  publicPort?: string;
  gateway?: string;
  token?: string;
  org?: string;
};

type ConfiguredTunnel = TunnelOptions & {
  name: string;
  protocol: TunnelProtocol;
  localPort: number;
  host: string;
};

async function createDeviceCode(config: MeshferryConfig): Promise<string> {
  const response = await fetchJson<{ code: string; dashboardUrl: string }>(
    `${config.apiUrl}/api/devices/start`,
    {
      method: "POST",
      body: JSON.stringify({
        deviceId: config.deviceId,
        deviceName: os.hostname(),
        platform: `${os.platform()} ${os.arch()}`
      })
    }
  );

  console.log("Open this URL in your browser and approve the terminal:");
  console.log(response.dashboardUrl);
  console.log("");
  console.log(`Device code: ${response.code}`);
  return response.code;
}

async function completeDeviceLink(config: MeshferryConfig, code: string): Promise<void> {
  const normalizedCode = code.trim().toUpperCase();

  await fetchJson(`${config.apiUrl}/api/devices/complete`, {
    method: "POST",
    body: JSON.stringify({
      code: normalizedCode,
      deviceId: config.deviceId,
      deviceName: os.hostname(),
      platform: `${os.platform()} ${os.arch()}`
    })
  });

  console.log("Terminal reported to Meshferry.");
  console.log("Finish approval in the dashboard before full access is granted.");

  for (;;) {
    const status = await fetchJson<{
      status: "pending_terminal" | "awaiting_approval" | "approved" | "expired";
      token?: string;
      orgId?: string;
      gatewayUrl?: string;
    }>(
      `${config.apiUrl}/api/devices/status?code=${encodeURIComponent(normalizedCode)}&deviceId=${encodeURIComponent(
        config.deviceId
      )}`
    );

    if (status.status === "approved" && status.token && status.orgId) {
      await saveConfig({
        ...config,
        token: status.token,
        orgId: status.orgId,
        gatewayUrl: status.gatewayUrl ?? config.gatewayUrl
      });
      console.log("Approved. Meshferry CLI is linked.");
      console.log(`Saved: ${configFilePath()}`);
      return;
    }

    if (status.status === "expired") {
      throw new Error("Device link expired. Create a new code from the dashboard.");
    }

    await delay(2000);
  }
}

async function startTunnel(protocol: TunnelProtocol, localPort: number, options: TunnelOptions): Promise<void> {
  const gatewayUrl = options.gateway ?? "ws://localhost:4040/agent";
  const token = options.token ?? process.env.MESHFERRY_TOKEN;
  const localHost = options.host ?? "127.0.0.1";

  if (!token) {
    throw new Error("Missing token. Run `meshferry connect` or pass --token.");
  }

  const websocket = new WebSocket(gatewayUrl);
  const tcpStreams = new Map<string, Socket>();
  const udpSocket = protocol === "udp" ? dgram.createSocket("udp4") : undefined;

  websocket.on("open", () => {
    websocket.send(
      JSON.stringify({
        type: "agent.register",
        token,
        protocol,
        subdomain: options.subdomain ? normalizeSubdomain(options.subdomain) : undefined,
        localHost,
        localPort,
        publicPort: options.publicPort ? parsePort(options.publicPort) : undefined,
        orgId: options.org,
        clientVersion: "0.1.0"
      })
    );
  });

  websocket.on("message", (raw) => {
    void (async () => {
      const message = JSON.parse(Buffer.from(raw as Buffer).toString("utf8")) as GatewayToAgentMessage;

      if (message.type === "gateway.error") {
        console.error(`[gateway] ${message.code}: ${message.message}`);
        return;
      }

      if (message.type === "agent.registered") {
        printRegistered(message);
        return;
      }

      if (message.type === "proxy.http.request") {
        await handleHttpRequest(websocket, localHost, localPort, message);
        return;
      }

      if (message.type === "proxy.tcp.open") {
        handleTcpOpen(websocket, tcpStreams, localHost, localPort, message);
        return;
      }

      if (message.type === "proxy.tcp.data") {
        const tcpMessage = message as TcpDataMessage;
        tcpStreams.get(tcpMessage.streamId)?.write(decodeBody(tcpMessage.body));
        return;
      }

      if (message.type === "proxy.tcp.close") {
        const tcpMessage = message as TcpCloseMessage;
        const socket = tcpStreams.get(tcpMessage.streamId);
        tcpStreams.delete(tcpMessage.streamId);
        socket?.destroy();
        return;
      }

      if (message.type === "proxy.udp.packet" && udpSocket) {
        handleUdpPacket(websocket, udpSocket, localHost, localPort, message as UdpPacketMessage);
      }
    })().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  });

  websocket.on("close", () => {
    for (const socket of tcpStreams.values()) socket.destroy();
    udpSocket?.close();
    console.error("Gateway connection closed.");
  });

  websocket.on("error", (error) => {
    console.error(`Gateway error: ${error.message}`);
  });
}

async function handleHttpRequest(
  websocket: WebSocket,
  localHost: string,
  localPort: number,
  message: HttpProxyRequestMessage
): Promise<void> {
  const response = await localHttpRequest(localHost, localPort, message);
  console.log(`${message.method} ${message.path} -> ${response.status}`);
  websocket.send(JSON.stringify(response));
}

function localHttpRequest(localHost: string, localPort: number, message: HttpProxyRequestMessage): Promise<{
  type: "proxy.http.response";
  requestId: string;
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}> {
  return new Promise((resolve) => {
    const outbound = request(
      {
        hostname: localHost,
        port: localPort,
        method: message.method,
        path: message.path,
        headers: {
          ...message.headers,
          host: `${localHost}:${localPort}`
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            type: "proxy.http.response",
            requestId: message.requestId,
            status: response.statusCode ?? 502,
            headers: normalizeResponseHeaders(response.headers),
            body: encodeBody(Buffer.concat(chunks))
          });
        });
      }
    );

    outbound.on("error", (error) => {
      resolve({
        type: "proxy.http.response",
        requestId: message.requestId,
        status: 502,
        headers: { "content-type": "application/json" },
        body: encodeBody(Buffer.from(JSON.stringify({ error: "local_request_failed", message: error.message })))
      });
    });

    const body = decodeBody(message.body);
    if (body.length > 0) outbound.write(body);
    outbound.end();
  });
}

function handleTcpOpen(
  websocket: WebSocket,
  tcpStreams: Map<string, Socket>,
  localHost: string,
  localPort: number,
  message: TcpOpenMessage
): void {
  const socket = net.connect(localPort, localHost);
  tcpStreams.set(message.streamId, socket);

  socket.on("data", (chunk) => {
    websocket.send(
      JSON.stringify({ type: "proxy.tcp.data", streamId: message.streamId, body: encodeBody(chunk) })
    );
  });

  socket.on("close", () => {
    tcpStreams.delete(message.streamId);
    websocket.send(JSON.stringify({ type: "proxy.tcp.close", streamId: message.streamId }));
  });

  socket.on("error", (error) => {
    tcpStreams.delete(message.streamId);
    websocket.send(JSON.stringify({ type: "proxy.tcp.close", streamId: message.streamId, error: error.message }));
  });
}

function handleUdpPacket(
  websocket: WebSocket,
  udpSocket: dgram.Socket,
  localHost: string,
  localPort: number,
  message: UdpPacketMessage
): void {
  const onMessage = (response: Buffer) => {
    websocket.send(
      JSON.stringify({ type: "proxy.udp.packet", remoteId: message.remoteId, body: encodeBody(response) })
    );
    udpSocket.off("message", onMessage);
  };

  udpSocket.on("message", onMessage);
  udpSocket.send(decodeBody(message.body), localPort, localHost);
}

function printRegistered(message: AgentRegisteredMessage): void {
  if (message.protocol === "http") {
    console.log(`HTTP tunnel online: ${message.publicUrl}`);
    console.log(`Local fallback URL: ${message.fallbackUrl}`);
    return;
  }

  console.log(`${message.protocol.toUpperCase()} tunnel online: ${message.publicHost}:${message.publicPort}`);
}

function parseProtocol(input: string): TunnelProtocol {
  if (input === "http" || input === "tcp" || input === "udp") return input;
  throw new Error("Protocol must be one of: http, tcp, udp.");
}

function parsePort(input: string): number {
  const port = Number.parseInt(input, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be a number between 1 and 65535.");
  }

  return port;
}

function normalizeResponseHeaders(headers: Record<string, string | string[] | number | undefined>): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" || Array.isArray(value)) normalized[key] = value;
    if (typeof value === "number") normalized[key] = String(value);
  }

  return normalized;
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return (await response.json()) as T;
}

async function loadTunnelConfig(configPath: string, runtimeConfig: MeshferryConfig): Promise<ConfiguredTunnel[]> {
  const raw = await readFile(configPath, "utf8");
  const parsed = parseToml(raw) as {
    global?: Record<string, unknown>;
    tunnel?: Record<string, Record<string, unknown>>;
  };
  const tunnelTable = parsed.tunnel;
  if (!tunnelTable || typeof tunnelTable !== "object") {
    throw new Error(`No [tunnel.<name>] entries found in ${configPath}.`);
  }

  const globalConfig = parsed.global ?? {};
  const tunnels = Object.entries(tunnelTable).map(([name, value]) => {
    const protocol = parseProtocol(readString(value, "protocol") ?? "http");
    const localPort = readNumber(value, "local_port") ?? readNumber(value, "port");
    if (!localPort) {
      throw new Error(`[tunnel.${name}] must include local_port.`);
    }

    return {
      name,
      protocol,
      localPort,
      host: readString(value, "local_host") ?? readString(value, "host") ?? "127.0.0.1",
      subdomain: readString(value, "subdomain"),
      publicPort: stringifyNumber(readNumber(value, "remote_port") ?? readNumber(value, "public_port")),
      gateway: readString(value, "server_url") ?? readString(globalConfig, "server_url") ?? runtimeConfig.gatewayUrl,
      token: readString(value, "token") ?? readString(value, "key") ?? readString(globalConfig, "token") ?? runtimeConfig.token,
      org: readString(value, "org") ?? readString(globalConfig, "org") ?? runtimeConfig.orgId
    };
  });

  if (tunnels.length === 0) {
    throw new Error(`No tunnels configured in ${configPath}.`);
  }

  return tunnels;
}

function readString(table: Record<string, unknown>, key: string): string | undefined {
  const value = table[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(table: Record<string, unknown>, key: string): number | undefined {
  const value = table[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

function stringifyNumber(value: number | undefined): string | undefined {
  return value ? String(value) : undefined;
}
