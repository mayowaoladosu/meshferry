# Deployment

## Local development

Use:

- `MESHFERRY_PUBLIC_HOST=meshferry.localhost`
- `MESHFERRY_PUBLIC_SCHEME=http`

That gives you routes like:

- `http://3000.meshferry.localhost:8080`
- `http://meshferry.localhost:8080/t/3000`

## Production domain layout

Recommended public layout for `meshferry.tech`:

- `meshferry.tech` for the main site
- `app.meshferry.tech` for the dashboard
- `api.meshferry.tech` for the control-plane API
- `connect.meshferry.tech` for agent WebSocket connections
- `*.meshferry.tech` for public tunnel URLs

## Your current origin

Current origin IP:

- `164.92.175.191`

## Initial DNS records

Point these records at `164.92.175.191`:

- `A @ -> 164.92.175.191`
- `A app -> 164.92.175.191`
- `A api -> 164.92.175.191`
- `A connect -> 164.92.175.191`
- `A * -> 164.92.175.191`

If you put MeshFerry behind Cloudflare, proxy the records you want Cloudflare to front. The wildcard `*` record is the important one for generated tunnel subdomains.

## Recommended production environment

```env
MESHFERRY_AUTH_TOKENS=replace-me
MESHFERRY_CONTROL_PORT=7000
MESHFERRY_EDGE_PORT=8080
MESHFERRY_PUBLIC_HOST=meshferry.tech
MESHFERRY_PUBLIC_SCHEME=https
MESHFERRY_RESERVED_SUBDOMAINS=app,api,connect,www,admin,status
MESHFERRY_REQUEST_TIMEOUT_MS=30000
```

Set `MESHFERRY_PUBLIC_PORT` only if your public URLs need a non-default port.

## Current routing model

- Agents connect to the control plane with `MESHFERRY_SERVER`, for example `https://connect.meshferry.tech`
- Public traffic lands on the edge plane for `*.meshferry.tech`
- The server can assign a readable generated subdomain such as `unstable-banana.meshferry.tech` when the client does not request one

## Reverse proxy shape

At the reverse proxy or ingress layer:

- `connect.meshferry.tech` -> MeshFerry control port `7000`
- `api.meshferry.tech` -> MeshFerry control/API service
- `*.meshferry.tech` -> MeshFerry edge port `8080`
- `app.meshferry.tech` -> dashboard app later

## Notes

- For local development, prefer `*.meshferry.localhost`, not `.local`
- For production, terminate TLS before traffic reaches the Node process or put the Node process directly behind a TLS-capable proxy

## Production stack in this repo

Files added for the first production deployment:

- `docker-compose.prod.yml`
- `deploy/Caddyfile`
- `.env.production.example`

Expected certificate files on the server:

- `deploy/certs/origin.pem`
- `deploy/certs/origin-key.pem`

## First deploy steps

1. Add `meshferry.tech` to Cloudflare and switch the registrar nameservers to Cloudflare.
2. Create the proxied DNS records listed above.
3. In Cloudflare, create an Origin CA certificate for:
   - `meshferry.tech`
   - `*.meshferry.tech`
4. Copy the certificate and key to:
   - `deploy/certs/origin.pem`
   - `deploy/certs/origin-key.pem`
5. Copy `.env.production.example` to `.env.production` and set a strong `MESHFERRY_AUTH_TOKENS` value.
6. On the server, run:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

7. Set Cloudflare SSL/TLS mode to `Full (strict)`.

## Railway deployment

Railway is a valid host for the current MeshFerry architecture because the current product is HTTP-first:

- control plane on one HTTP port (`7000`)
- edge plane on one HTTP port (`8080`)
- agent transport over WebSockets on the control plane

That maps cleanly to Railway's public networking and custom domains.

### Recommended first Railway layout

Use one Railway service for now with two public domains:

- `connect.meshferry.tech` -> target port `7000`
- `*.meshferry.tech` -> target port `8080`

That is enough for:

- CLI agent connections on `https://connect.meshferry.tech/connect`
- control-plane health and tunnel APIs on `https://connect.meshferry.tech`
- public tunnel URLs like `https://quick-harbor.meshferry.tech`

Do not add `api.meshferry.tech` yet unless you want a separate domain for the same control-plane service. The current code already serves the API on the control-plane port, so `connect.meshferry.tech` is enough for now.

### Cloudflare + Railway notes

When using Cloudflare in front of Railway:

- point DNS records to the Railway-provided CNAME, not to your old VPS IP
- use Cloudflare proxying on the public records
- for wildcard domains, keep the `_acme-challenge` CNAME as DNS only
- set Cloudflare SSL/TLS mode to `Full`

For Railway wildcard domains on Cloudflare:

- `*.meshferry.tech` is fine without Advanced Certificate Manager
- `*.subdomain.meshferry.tech` would need extra Cloudflare certificate support

### Railway setup steps

1. Create a Railway project from this repo.
2. Let Railway build from the root `Dockerfile`.
3. Set service variables:

```env
MESHFERRY_AUTH_TOKENS=replace-me
MESHFERRY_CONTROL_PORT=7000
MESHFERRY_EDGE_PORT=8080
MESHFERRY_PUBLIC_HOST=meshferry.tech
MESHFERRY_PUBLIC_SCHEME=https
MESHFERRY_RESERVED_SUBDOMAINS=app,api,connect,www,admin,status
MESHFERRY_REQUEST_TIMEOUT_MS=30000
PORT=7000
```

There is a ready-to-copy example file in `.env.railway.example`.

4. In Railway networking, add `connect.meshferry.tech` and select target port `7000`.
5. In Railway networking, add `*.meshferry.tech` and select target port `8080`.
6. Create the DNS records in Cloudflare exactly as Railway instructs.
7. For the wildcard domain, add both CNAMEs Railway gives you:
   - the wildcard CNAME
   - the `_acme-challenge` CNAME

### Plan constraints

Railway docs say:

- Trial plan: 1 custom domain per service
- Hobby plan: 2 custom domains per service
- Pro plan: 20 custom domains per service by default

That means the two-domain setup above fits Hobby. If you later want `app.meshferry.tech`, `api.meshferry.tech`, `meshferry.tech`, and `www.meshferry.tech` all on the same service, you will likely want Pro or separate services.

### When Railway stops being ideal

Railway is a strong fit for the current HTTP/WebSocket MeshFerry.

It becomes less ideal if you want:

- raw TCP tunnel products with nice host-only URLs
- low-level edge control
- provider-managed static IP assumptions
- more custom network behavior than Railway's public edge allows
