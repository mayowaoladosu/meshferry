import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";

const root = new URL("..", import.meta.url);
const backendPort = 3000;
const controlPort = 7000;
const edgePort = 8080;
const token = "meshferry-dev-token";
const subdomain = "demo";
const processes = [];

function startServer() {
  return spawn("node", ["dist/server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      MESHFERRY_CONTROL_PORT: `${controlPort}`,
      MESHFERRY_EDGE_PORT: `${edgePort}`,
      MESHFERRY_AUTH_TOKENS: token,
      MESHFERRY_TUNNEL_GRACE_MS: "8000"
    },
    stdio: "inherit"
  });
}

function startAgent() {
  return spawn(
    "node",
    [
      "dist/cli/index.js",
      `${backendPort}`,
      "--subdomain",
      subdomain,
      "--server",
      `http://127.0.0.1:${controlPort}`,
      "--token",
      token
    ],
    {
      cwd: root,
      stdio: "inherit"
    }
  );
}

const backend = createServer(async (req, res) => {
  if (req.url === "/style.css") {
    const css = "body{background:#102030;color:#f5efe4}";
    const body = gzipSync(Buffer.from(css, "utf8"));
    res.setHeader("content-type", "text/css; charset=utf-8");
    res.setHeader("content-encoding", "gzip");
    res.setHeader("content-length", body.length);
    res.writeHead(200);
    res.end(body);
    return;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  const payload = JSON.stringify(
    {
      ok: true,
      method: req.method,
      url: req.url,
      body
    },
    null,
    2
  );

  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.writeHead(200);
  res.end(payload);
});

try {
  await new Promise((resolve) => backend.listen(backendPort, "127.0.0.1", resolve));

  processes.push(startServer());

  await delay(2_000);

  const firstAgent = startAgent();
  processes.push(firstAgent);

  await delay(3_000);

  const edgeResponse = await fetch(`http://${subdomain}.meshferry.localhost:${edgePort}/smoke`);
  const assetResponse = await fetch(`http://${subdomain}.meshferry.localhost:${edgePort}/style.css`, {
    headers: {
      "accept-encoding": "gzip"
    }
  });
  const status = spawnSync(
    "node",
    ["dist/cli/index.js", "status", "--json", "--server", `http://127.0.0.1:${controlPort}`],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  firstAgent.kill();
  await delay(1_000);

  const disconnectedResponse = await fetch(`http://${subdomain}.meshferry.localhost:${edgePort}/during-disconnect`);
  const disconnectedBody = await disconnectedResponse.json();

  const secondAgent = startAgent();
  processes.push(secondAgent);

  await delay(3_000);

  const resumedResponse = await fetch(`http://${subdomain}.meshferry.localhost:${edgePort}/after-reconnect`);

  if (status.status !== 0) {
    throw new Error(status.stderr || status.stdout || "Status command failed.");
  }

  const result = {
    tunnels: JSON.parse(status.stdout),
    edgeStatus: edgeResponse.status,
    edgeBody: await edgeResponse.json(),
    assetStatus: assetResponse.status,
    assetEncoding: assetResponse.headers.get("content-encoding"),
    assetBody: await assetResponse.text(),
    disconnectedStatus: disconnectedResponse.status,
    disconnectedBody,
    resumedStatus: resumedResponse.status,
    resumedBody: await resumedResponse.json()
  };

  if (result.assetBody !== "body{background:#102030;color:#f5efe4}") {
    throw new Error(`Compressed asset proxying failed. Received: ${result.assetBody}`);
  }

  if (result.assetEncoding !== null) {
    throw new Error(`Compressed asset proxying leaked content-encoding=${result.assetEncoding}.`);
  }

  if (result.disconnectedStatus !== 503) {
    throw new Error(`Expected a 503 during disconnect, received ${result.disconnectedStatus}.`);
  }

  if (!String(result.disconnectedBody.error ?? "").includes("temporarily disconnected")) {
    throw new Error(`Unexpected disconnect response: ${JSON.stringify(result.disconnectedBody)}`);
  }

  if (result.resumedStatus !== 200) {
    throw new Error(`Expected tunnel to resume after reconnect, received ${result.resumedStatus}.`);
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const child of processes) {
    if (!child.killed) {
      child.kill();
    }
  }

  await new Promise((resolve) => backend.close(resolve));
}
