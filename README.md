# MeshFerry

MeshFerry is an open source secure tunnel gateway for self-hosters and small teams. It lets you expose a local HTTP service through a public edge without opening inbound ports on the machine running your app.

This repo is the first usable release:

- `meshferry-server` accepts agent connections and exposes public routes.
- `meshferry` is the main CLI for opening tunnels and checking server status.
- `meshferry-agent` still exists as a low-level compatibility entrypoint.
- Routing works by subdomain or by a path fallback for local development.

## Why this exists

The goal is not to clone every part of ngrok. The goal is to ship a clean, understandable tunnel core that can grow into a broader traffic gateway later.

## Current architecture

```text
local app <-> meshferry-agent <== websocket ==> meshferry-server <-> public HTTP client
```

The server runs two listeners:

- control plane on `:7000` for agent WebSocket connections and tunnel inspection
- edge plane on `:8080` for incoming public HTTP traffic

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Start the server

```bash
npm run start:server
```

The defaults are:

- control server: `http://127.0.0.1:7000`
- edge server: `http://127.0.0.1:8080`
- local dev host: `*.meshferry.localhost`
- default auth token: `meshferry-dev-token`

### 4. Install the CLI locally

```bash
npm link
```

### 5. Start any local HTTP app

Example:

```bash
python -m http.server 3000
```

### 6. Open a tunnel

```bash
meshferry 3000 --subdomain demo
```

You can also use the explicit form:

```bash
meshferry http 3000 --subdomain demo --server http://127.0.0.1:7000 --token meshferry-dev-token
```

If you omit `--subdomain`, MeshFerry derives it from the target port in local development, so `meshferry 3000` defaults to `3000.meshferry.localhost`. Against a non-local server, omit `--subdomain` or pass `--random` to let the server assign a random public URL.

The CLI prints two URLs:

- subdomain route: `http://demo.meshferry.localhost:8080`
- path fallback: `http://meshferry.localhost:8080/t/demo`

The path fallback is the easiest way to test locally:

```bash
curl http://meshferry.localhost:8080/t/demo/
```

You can inspect active tunnels here:

```bash
meshferry status
```

If you want raw JSON:

```bash
meshferry status --json
```

For a production-style generated public URL:

```bash
meshferry http 3000 --random --server https://connect.meshferry.tech
```

That generated URL now uses a readable shape like `unstable-banana.meshferry.tech` instead of an opaque token string.

## Config file

MeshFerry looks for `meshferry.yml`, `meshferry.yaml`, `.meshferry.yml`, `.meshferry.yaml`, or `meshferry.json` in the current directory.

Use `*.meshferry.localhost` for local development. Do not use `.local` for the public local-dev domain. `.local` is typically reserved for mDNS/Bonjour on local networks and will make routing and TLS harder than necessary.

You can copy [meshferry.yml.example](./meshferry.yml.example) and start with:

```yaml
server: http://127.0.0.1:7000
token: meshferry-dev-token

tunnel:
  local: 3000
  subdomain: demo

tunnels:
  app:
    local: 3000
    subdomain: app
  docs:
    local: http://127.0.0.1:4173
    subdomain: docs
```

Then run:

```bash
meshferry up
meshferry up docs
```

## Smoke test

After building, you can run a local end-to-end verification:

```bash
npm run smoke
```

The smoke script starts a tiny local HTTP app, the MeshFerry server, the MeshFerry CLI, then performs a request through the edge and prints the result.

## Configuration

Server environment variables:

- `MESHFERRY_AUTH_TOKENS`: comma-separated list of valid agent tokens
- `MESHFERRY_CONTROL_PORT`: control plane port, default `7000`
- `MESHFERRY_EDGE_PORT`: edge plane port, default `8080`
- `MESHFERRY_PUBLIC_HOST`: host used to generate public URLs, default `meshferry.localhost`
- `MESHFERRY_PUBLIC_SCHEME`: scheme used in generated public URLs, default `http` for localhost and `https` otherwise
- `MESHFERRY_PUBLIC_PORT`: optional public port override for generated URLs
- `MESHFERRY_REQUEST_TIMEOUT_MS`: upstream timeout, default `30000`

Agent environment variables:

- `MESHFERRY_SERVER`
- `MESHFERRY_LOCAL`
- `MESHFERRY_SUBDOMAIN`
- `MESHFERRY_TOKEN`

CLI flags override environment variables.

## Project layout

```text
src/
  cli/
    config.ts
    index.ts
  agent/
    core.ts
    index.ts
  server/
    index.ts
  protocol.ts
```

## Limitations

- HTTP only for now
- one active agent per subdomain
- in-memory tunnel registry
- no persistence, TLS termination, teams, or policy engine yet

## Open source housekeeping

- [Contributing](./CONTRIBUTING.md)
- [Deployment](./DEPLOYMENT.md)
- [Roadmap](./ROADMAP.md)
- MIT license
- CI workflows in `.github/workflows`
- production compose and Caddy files for `meshferry.tech`
- Railway can host the current HTTP/WebSocket version with `connect.meshferry.tech` and `*.meshferry.tech`
- Railway config-as-code is in `railway.toml`
