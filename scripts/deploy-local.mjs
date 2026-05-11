import { spawn, spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { existsSync, openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "apps", "web", ".env.local") });

const nextBin = path.join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next");
const runtimeDir = path.join(root, ".meshferry", "runtime");
const webPort = process.env.MESHFERRY_WEB_PORT ?? "3000";
const gatewayPort = process.env.MESHFERRY_GATEWAY_PORT ?? "4040";
const controlToken = process.env.MESHFERRY_CONTROL_API_TOKEN ?? "dev-control-token";
const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;

const requiredBuildArtifacts = [
  path.join(root, "apps", "web", ".next", "BUILD_ID"),
  path.join(root, "apps", "gateway", "dist", "index.js"),
  path.join(root, "apps", "cli", "dist", "index.js"),
  path.join(root, "packages", "core", "dist", "index.js")
];

const missing = requiredBuildArtifacts.filter((artifact) => !existsSync(artifact));
if (missing.length > 0) {
  console.error("Missing build artifacts. Run `npm run build` once before `npm run deploy:local`.");
  for (const artifact of missing) console.error(`- ${artifact}`);
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Set it to your Neon pooled PostgreSQL connection string.");
  process.exit(1);
}

await mkdir(runtimeDir, { recursive: true });

const migration = spawnSync(process.execPath, [path.join(root, "apps", "web", "scripts", "migrate.mjs")], {
  cwd: path.join(root, "apps", "web"),
  env: process.env,
  stdio: "inherit"
});
if (migration.status !== 0) {
  process.exit(migration.status ?? 1);
}

const web = startService("web", process.execPath, [nextBin, "start", "-p", webPort], {
  PORT: webPort,
  NEXT_PUBLIC_APP_URL: `http://localhost:${webPort}`,
  NEXT_PUBLIC_GATEWAY_URL: `http://localhost:${gatewayPort}`,
  DATABASE_URL: databaseUrl,
  MESHFERRY_CONTROL_API_TOKEN: controlToken,
  MESHFERRY_ALLOW_DEV_AUTH: process.env.CLERK_SECRET_KEY ? "false" : "true"
}, path.join(root, "apps", "web"));

const gateway = startService("gateway", process.execPath, ["apps/gateway/dist/index.js"], {
  PORT: gatewayPort,
  MESHFERRY_EDGE_DOMAIN: `localhost:${gatewayPort}`,
  MESHFERRY_CONTROL_API_URL: `http://localhost:${webPort}`,
  MESHFERRY_CONTROL_API_TOKEN: controlToken
});

await writeFile(
  path.join(runtimeDir, "pids.json"),
  JSON.stringify(
    {
      web: web.pid,
      gateway: gateway.pid,
      dashboard: `http://localhost:${webPort}/dashboard`,
      gatewayHealth: `http://localhost:${gatewayPort}/healthz`
    },
    null,
    2
  ),
  "utf8"
);

console.log(`Meshferry web started: http://localhost:${webPort}/dashboard`);
console.log(`Meshferry gateway started: http://localhost:${gatewayPort}/healthz`);
console.log(`Logs: ${runtimeDir}`);

function startService(name, command, args, env, cwd = root) {
  const out = openSync(path.join(runtimeDir, `${name}.out.log`), "a");
  const err = openSync(path.join(runtimeDir, `${name}.err.log`), "a");
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", out, err],
    windowsHide: true
  });
  child.unref();
  return child;
}
