import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("..", import.meta.url);
const backendPort = 3000;
const controlPort = 7000;
const edgePort = 8080;
const token = "meshferry-dev-token";
const subdomain = "demo";
const processes = [];

const backend = createServer(async (req, res) => {
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

  processes.push(
    spawn("node", ["dist/server/index.js"], {
      cwd: root,
      stdio: "inherit"
    })
  );

  await delay(2_000);

  processes.push(
    spawn(
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
    )
  );

  await delay(3_000);

  const edgeResponse = await fetch(`http://${subdomain}.meshferry.localhost:${edgePort}/smoke`);
  const status = spawnSync(
    "node",
    ["dist/cli/index.js", "status", "--json", "--server", `http://127.0.0.1:${controlPort}`],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  if (status.status !== 0) {
    throw new Error(status.stderr || status.stdout || "Status command failed.");
  }

  const result = {
    tunnels: JSON.parse(status.stdout),
    edgeStatus: edgeResponse.status,
    edgeBody: await edgeResponse.json()
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const child of processes) {
    if (!child.killed) {
      child.kill();
    }
  }

  await new Promise((resolve) => backend.close(resolve));
}
