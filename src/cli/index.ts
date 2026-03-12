#!/usr/bin/env node

import { createAgentConfig, runAgent } from "../agent/core.js";
import { deriveTargetSubdomain, loadMeshFerryConfig, pickTunnelProfile, readConfigValue } from "./config.js";

interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

const argv = process.argv.slice(2);

try {
  await main(argv);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unhandled MeshFerry CLI error.";
  console.error(`[meshferry] ${message}`);
  process.exitCode = 1;
}

async function main(args: string[]): Promise<void> {
  const first = args[0];

  if (!first || first === "help" || first === "--help" || first === "-h") {
    printHelp();
    return;
  }

  if (first === "http") {
    await handleHttpCommand(args.slice(1));
    return;
  }

  if (first === "up") {
    await handleUpCommand(args.slice(1));
    return;
  }

  if (first === "status") {
    await handleStatusCommand(args.slice(1));
    return;
  }

  if (first === "server") {
    console.error("[meshferry] Use `meshferry-server` to start the public gateway.");
    process.exitCode = 1;
    return;
  }

  if (!first.startsWith("-")) {
    await handleHttpCommand(args);
    return;
  }

  throw new Error(`Unknown command "${first}". Run \`meshferry help\` for usage.`);
}

async function handleHttpCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const target = parsed.positionals[0];
  if (!target) {
    throw new Error("Expected a port or local URL. Example: `meshferry 3000`.");
  }

  const loadedConfig = await loadMeshFerryConfig(getStringFlag(parsed, "config"));
  const profile = pickTunnelProfile(loadedConfig?.config ?? {});
  const server = getStringFlag(parsed, "server") ?? loadedConfig?.config.server ?? process.env.MESHFERRY_SERVER ?? "http://127.0.0.1:7000";
  const explicitSubdomain =
    getStringFlag(parsed, "subdomain") ??
    readConfigValue(profile?.subdomain) ??
    loadedConfig?.config.subdomain ??
    process.env.MESHFERRY_SUBDOMAIN;
  const subdomain =
    parsed.flags.get("random") === true
      ? ""
      : explicitSubdomain ?? (isLocalServer(server) ? deriveTargetSubdomain(target, process.cwd()) : "");

  if (loadedConfig) {
    console.log(`[meshferry] using config ${loadedConfig.path}`);
  }

  const agentConfig = createAgentConfig({
    server,
    local: target,
    subdomain,
    token: getStringFlag(parsed, "token") ?? loadedConfig?.config.token
  });

  process.exitCode = await runAgent(agentConfig);
}

async function handleUpCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const profileName = parsed.positionals[0];
  const loadedConfig = await loadMeshFerryConfig(getStringFlag(parsed, "config"));
  const server = getStringFlag(parsed, "server") ?? loadedConfig?.config.server ?? process.env.MESHFERRY_SERVER ?? "http://127.0.0.1:7000";

  if (!loadedConfig) {
    throw new Error("No config file found. Create `meshferry.yml` or pass `--config`.");
  }

  const profile = pickTunnelProfile(loadedConfig.config, profileName);
  const localTarget =
    getStringFlag(parsed, "local") ??
    readConfigValue(profile?.local) ??
    readConfigValue(loadedConfig.config.local) ??
    readConfigValue(loadedConfig.config.tunnel?.local);

  if (!localTarget) {
    throw new Error("No local target configured. Add `local:` to your config or pass `--local`.");
  }

  const explicitSubdomain =
    getStringFlag(parsed, "subdomain") ??
    readConfigValue(profile?.subdomain) ??
    loadedConfig.config.subdomain ??
    process.env.MESHFERRY_SUBDOMAIN;
  const subdomain =
    parsed.flags.get("random") === true
      ? ""
      : explicitSubdomain ?? (isLocalServer(server) ? deriveTargetSubdomain(localTarget, process.cwd(), profileName) : "");

  console.log(`[meshferry] using config ${loadedConfig.path}`);
  if (profileName) {
    console.log(`[meshferry] using tunnel profile "${profileName}"`);
  }

  const agentConfig = createAgentConfig({
    server,
    local: localTarget,
    subdomain,
    token: getStringFlag(parsed, "token") ?? loadedConfig.config.token
  });

  process.exitCode = await runAgent(agentConfig);
}

async function handleStatusCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const loadedConfig = await loadMeshFerryConfig(getStringFlag(parsed, "config"));
  const server = getStringFlag(parsed, "server") ?? loadedConfig?.config.server ?? process.env.MESHFERRY_SERVER ?? "http://127.0.0.1:7000";
  const apiUrl = new URL("/api/tunnels", server).toString();

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Status request failed with ${response.status} ${response.statusText}.`);
  }

  const payload = (await response.json()) as {
    tunnels?: Array<{
      subdomain: string;
      publicUrl: string;
      pathUrl: string;
      connectedAt: string;
      status?: "connected" | "disconnected";
      disconnectedAt?: string | null;
      leaseExpiresAt?: string | null;
      requestCount?: number;
      lastRequestAt?: string | null;
    }>;
  };

  if (parsed.flags.get("json") === true) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const tunnels = payload.tunnels ?? [];
  console.log("MeshFerry status");
  console.log(`Server: ${server}`);
  console.log(`Active tunnels: ${tunnels.length}`);

  if (tunnels.length === 0) {
    return;
  }

  for (const tunnel of tunnels) {
    const requestCount = tunnel.requestCount ?? 0;
    const lastSeen = tunnel.lastRequestAt ?? "never";
    const status = tunnel.status ?? "connected";
    console.log("");
    console.log(`- ${tunnel.subdomain}`);
    console.log(`  public: ${tunnel.publicUrl}`);
    console.log(`  path: ${tunnel.pathUrl}`);
    console.log(`  status: ${status}`);
    console.log(`  connected: ${tunnel.connectedAt}`);
    if (tunnel.disconnectedAt) {
      console.log(`  disconnected: ${tunnel.disconnectedAt}`);
    }
    if (tunnel.leaseExpiresAt) {
      console.log(`  reconnect by: ${tunnel.leaseExpiresAt}`);
    }
    console.log(`  requests: ${requestCount}`);
    console.log(`  last request: ${lastSeen}`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }

    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return {
    flags,
    positionals
  };
}

function getStringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function printHelp(): void {
  console.log(`MeshFerry

Usage:
  meshferry 3000
  meshferry http 3000 --subdomain demo
  meshferry up [profile]
  meshferry status [--json]

Commands:
  meshferry 3000              Expose a local port through MeshFerry
  meshferry http 3000         Explicit form of the same command
  meshferry up                Start a tunnel from meshferry.yml
  meshferry up blog           Start a named tunnel profile from config
  meshferry status            Show active tunnels on the control server

Options:
  --server <url>              MeshFerry control server, default http://127.0.0.1:7000
  --local <target>            Local port or URL, used with up
  --subdomain <name>          Requested subdomain
  --random                    Let the server generate a random public subdomain
  --token <token>             Agent auth token
  --config <path>             Path to meshferry.yml
  --json                      Print status output as JSON

Examples:
  meshferry 3000
  meshferry http http://127.0.0.1:3000 --subdomain api
  meshferry http 3000 --random --server https://connect.meshferry.tech
  meshferry up
  meshferry up app --config ./meshferry.yml
  meshferry status --server http://127.0.0.1:7000
`);
}

function isLocalServer(server: string): boolean {
  try {
    const url = new URL(server);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}
