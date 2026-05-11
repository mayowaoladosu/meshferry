# Meshferry

Meshferry is a self-hostable tunnel product in the same product category as ngrok and OutRay. It includes a Clerk-ready dashboard, terminal device linking, subdomain reservations, and a Node edge gateway that forwards HTTP, TCP, and UDP traffic over persistent agent WebSocket connections.

## Apps

- `apps/web`: Next.js dashboard and control-plane API.
- `apps/gateway`: public edge gateway for HTTP/TCP/UDP tunnels.
- `apps/cli`: terminal agent used to connect devices and run tunnels.
- `packages/core`: shared protocol schemas, subdomain validation, token helpers, and naming utilities.

## Quick Start

```bash
npm install
cp .env.example .env.local
$env:DATABASE_URL="postgresql://user:password@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require"
npm run db:migrate
npm run build
npm run deploy:local
```

In another terminal:

```bash
npm run dev:cli -- connect
npm run dev:cli -- tunnel http 3000 --subdomain demo
```

Open `http://localhost:3000/dashboard` for the dashboard. Local development uses `MESHFERRY_ALLOW_DEV_AUTH=true`; production should set Clerk keys and leave development auth disabled.

For hot development instead of built-local deployment:

```bash
npm run dev:web
npm run dev:gateway
```

## PostgreSQL / Neon

Meshferry persists organization data, terminal approvals, reserved subdomains, tunnels, and telemetry in PostgreSQL.
Use Neon’s pooled connection string in `DATABASE_URL`; Neon’s docs recommend pooled connection strings for apps that create concurrent connections, and the driver works from Node/Next.js through `@neondatabase/serverless`.

```bash
$env:DATABASE_URL="postgresql://user:password@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require"
npm run db:migrate
```

## Real Control Plane

Meshferry does not accept arbitrary agent tokens. The gateway calls the web control-plane API before any tunnel is opened:

- `/api/control/agent/validate` checks the approved terminal token and subdomain ownership.
- `/api/control/tunnels/register` creates the live tunnel record shown in the dashboard.
- `/api/control/tunnels/traffic` records requests and proxied bytes from real gateway traffic.
- `/api/control/tunnels/offline` marks tunnels offline when the agent disconnects.

The dashboard tunnel inventory is empty until an actual CLI agent connects through the gateway.

## Deployment

Fast local deployment after a build:

```bash
npm run build
npm run deploy:local
```

Docker deployment:

```bash
MESHFERRY_CONTROL_API_TOKEN=replace-this docker compose up --build
```

## Production Notes

- Put `apps/gateway` behind a wildcard DNS record such as `*.tunnel.example.com`.
- Set `MESHFERRY_EDGE_DOMAIN=tunnel.example.com` and serve gateway traffic behind TLS.
- Configure Clerk keys in the web app and keep `CLERK_SECRET_KEY` server-only.
- Use a strong `MESHFERRY_CONTROL_API_TOKEN` between `apps/gateway` and `apps/web`.
- Run `npm run db:migrate` during deploy before starting the web control plane.

## Tunnel Model

1. A user signs up in the web dashboard.
2. The dashboard creates a terminal link code for the organization.
3. The user runs `meshferry connect --code <code>`.
4. The terminal appears in the dashboard and must be approved there.
5. The CLI receives an API token only after dashboard approval.
6. The CLI opens an agent WebSocket to the gateway and registers HTTP, TCP, or UDP tunnels.
7. The gateway forwards public traffic over the WebSocket to the local port.
