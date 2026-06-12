# Multi-Tenant Deployment Notes

Reverse-proxy + TLS wiring for the host-resolved multi-tenant setup. The data
cutover itself is in [migration-runbook.md](./migration-runbook.md); local dev
in [dev.md](./dev.md).

## Host model

One apex (`<apex>`, e.g. `newsletters.example.com`) serves everything:

- `app.<apex>` — signup/login, `/admin`, `/onboarding`. No public tenant
  surface (the API 404s public routes on this host by design, REQ-020).
- `<slug>.<apex>` — each tenant's public site (branded home, archives,
  subscribe). Only `active` tenants resolve; renamed slugs 301-redirect.
- Optionally a legacy custom apex for tenant 0 via `TENANT0_CUSTOM_DOMAIN`.

The API resolves the tenant from the **Host header**, so the proxy MUST pass
`Host` through unmodified (Caddy's `reverse_proxy` does by default).

## Wildcard TLS prerequisite (DNS-01 ACME)

`*.<apex>` certificates cannot be issued over HTTP-01 — a **DNS-01 challenge**
is required. Before deploying:

1. DNS: `A`/`AAAA` records for `<apex>` and `*.<apex>` → the proxy host.
2. Build Caddy with your DNS provider module (e.g.
   `xcaddy build --with github.com/caddy-dns/cloudflare`) and provide its API
   token. Without this, the `*.<apex>` site block cannot obtain a cert.

## Caddyfile sketch

```caddyfile
{
    email ops@example.com
}

# App host — admin SPA + API.
app.example.com {
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        root * /srv/newsletter/web/dist
        try_files {path} /index.html
        file_server
    }
}

# Tenant public sites — same SPA + API, tenant resolved from Host.
*.example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}   # DNS-01 (wildcard)
    }
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        root * /srv/newsletter/web/dist
        try_files {path} /index.html
        file_server
    }
}
```

Notes:

- `reverse_proxy` keeps the inbound `Host` and appends the client IP to
  `X-Forwarded-For` — exactly what the API expects.
- Both blocks serve the same SPA build; the frontend brands itself from
  `GET /api/public/tenant-config` (host-resolved, `Vary: Host`).
- If a CDN/cache sits in front, it must key on Host (the API already sends
  `Vary: Host` on tenant-config/logo responses).

## API env behind Caddy

| Var | Value | Why |
|-----|-------|-----|
| `APP_ROOT_DOMAIN` | `example.com` | Tenants resolve at `<slug>.example.com` |
| `APP_HOST` | `app.example.com` | The non-tenant app host |
| `TRUST_PROXY_HOPS` | `1` | Exactly one trusted proxy (Caddy). Auth rate limiting keys on the first untrusted `X-Forwarded-For` hop; **without this the limiter keys on Caddy's IP and one abuser can exhaust the shared bucket. Never set it >0 when the API is reachable without the proxy** (header becomes client-spoofable). |
| `NODE_ENV` | `production` | Disables the `X-Tenant-Slug` dev header override |
| `TENANT0_CUSTOM_DOMAIN` | legacy apex (optional) | Keeps the old AGENTLOOP domain rendering tenant 0 |

## SESSION_SECRET invariant (EC10)

`SESSION_SECRET` is both the session/token HMAC key **and** the HKDF KEK for
every credential encrypted at rest (LinkedIn/Twitter tokens, per-tenant
webhooks). Rotating it:

- invalidates all sessions (acceptable), and
- makes every stored credential undecryptable (NOT acceptable without a plan —
  every tenant must re-connect each integration).

Deploys, migrations, and host moves must carry the secret over verbatim.
`migrate-agentloop` performs a cipher round-trip sanity check and aborts if
the secret cannot decrypt an existing credential. See the
[migration runbook](./migration-runbook.md#invariants-read-before-touching-anything)
before touching it.

## Smoke checks after deploy

```bash
curl -s https://app.example.com/api/health                       # {"status":"ok"}
curl -s https://<slug>.example.com/api/public/tenant-config      # tenant branding JSON
curl -s -H "X-Tenant-Slug: anything" \
  https://app.example.com/api/public/tenant-config               # 404 (dev header OFF)
```

Then: login on `app.<apex>`, archive renders on a tenant host, subscribe
round-trip, and (post-migration) the AGENTLOOP archive under tenant 0.
