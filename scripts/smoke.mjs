import { spawn } from "node:child_process";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "apps", "web", ".env.local") });

const nextBin = path.join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next");
const webPort = 3500 + Math.floor(Math.random() * 400);
const gatewayPort = 4500 + Math.floor(Math.random() * 400);
const controlToken = `smoke-control-${Date.now().toString(36)}`;
const subdomain = `smoke-${Date.now().toString(36)}`;
const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
const children = [];
let localServer;

if (!databaseUrl) {
  console.error("DATABASE_URL is required for smoke tests because Meshferry now persists to PostgreSQL/Neon.");
  process.exit(1);
}

try {
  await runMigrations();
  await cleanupSmokeRows();

  localServer = await listenLocalServer();
  const localPort = localServer.address().port;

  const web = spawn(process.execPath, [nextBin, "start", "-p", String(webPort)], {
    cwd: path.join(root, "apps", "web"),
    env: {
      ...process.env,
      PORT: String(webPort),
      NEXT_PUBLIC_APP_URL: `http://localhost:${webPort}`,
      NEXT_PUBLIC_GATEWAY_URL: `http://localhost:${gatewayPort}`,
      DATABASE_URL: databaseUrl,
      MESHFERRY_CONTROL_API_TOKEN: controlToken,
      MESHFERRY_ALLOW_DEV_AUTH: "true",
      CLERK_SECRET_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(web);
  await waitForHttp(`http://localhost:${webPort}/dashboard`);

  const start = await postJson(`http://localhost:${webPort}/api/devices/start`, {
    deviceId: "mf_device_smoke",
    deviceName: "smoke-agent",
    platform: "smoke"
  });
  const approved = await postJson(`http://localhost:${webPort}/api/devices/confirm`, { code: start.code });
  if (!approved.token || approved.status !== "approved") {
    throw new Error(`Device approval failed: ${JSON.stringify(approved)}`);
  }

  const gateway = spawn(process.execPath, ["apps/gateway/dist/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(gatewayPort),
      MESHFERRY_EDGE_DOMAIN: `localhost:${gatewayPort}`,
      MESHFERRY_CONTROL_API_URL: `http://localhost:${webPort}`,
      MESHFERRY_CONTROL_API_TOKEN: controlToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(gateway);
  await waitForOutput(gateway, "[gateway] listening");

  const cli = spawn(
    process.execPath,
    [
      "apps/cli/dist/index.js",
      "tunnel",
      "http",
      String(localPort),
      "--subdomain",
      subdomain,
      "--token",
      approved.token,
      "--org",
      approved.orgId,
      "--gateway",
      `ws://localhost:${gatewayPort}/agent`
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
  children.push(cli);
  await waitForOutput(cli, "HTTP tunnel online");

  const response = await fetch(`http://localhost:${gatewayPort}/t/${subdomain}/healthz?from=smoke`);
  const body = await response.json();
  if (!response.ok || body.path !== "/healthz?from=smoke") {
    throw new Error(`Unexpected tunnel response: ${response.status} ${JSON.stringify(body)}`);
  }

  await delay(700);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const result = await pool.query("SELECT * FROM tunnels WHERE subdomain = $1", [subdomain]);
  const events = await pool.query(
    "SELECT * FROM tunnel_events WHERE org_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1",
    ["org_development", "http_request"]
  );
  await pool.end();
  const tunnel = result.rows[0];
  if (!tunnel || tunnel.status !== "online" || Number(tunnel.requests) < 1 || Number(tunnel.bytes_out) < 1) {
    throw new Error(`Control-plane telemetry missing: ${JSON.stringify(tunnel)}`);
  }
  const event = events.rows[0];
  if (!event || event.method !== "GET" || event.path !== "/healthz?from=smoke" || Number(event.status) !== 200) {
    throw new Error(`Request event missing: ${JSON.stringify(event)}`);
  }

  console.log("smoke ok: approved token, live tunnel, forwarding, request logs, and dashboard telemetry all work");
} finally {
  localServer?.close();
  for (const child of children) {
    child.kill();
  }
}

async function runMigrations() {
  const migration = spawn(process.execPath, [path.join(root, "apps", "web", "scripts", "migrate.mjs")], {
    cwd: path.join(root, "apps", "web"),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForOutput(migration, "migrations complete");
}

async function cleanupSmokeRows() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query("DELETE FROM organizations WHERE id = $1", ["org_development"]);
  } finally {
    await pool.end();
  }
}

function listenLocalServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${url} returned non-JSON ${response.status}: ${text}\n${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function waitForHttp(url) {
  for (let index = 0; index < 160; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForOutput(child, needle) {
  let output = "";
  const onData = (data) => {
    output += data.toString();
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  for (let index = 0; index < 120; index += 1) {
    if (output.includes(needle)) return output;
    if (child.exitCode !== null) {
      throw new Error(`Process exited before "${needle}". Output:\n${output}`);
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for "${needle}". Output:\n${output}`);
}
