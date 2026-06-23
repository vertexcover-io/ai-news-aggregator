# Deployment — ops runbook

This folder is the single source of truth for deploying the AI Newsletter Aggregator to an Ubuntu 24.04 VPS.

## Architecture at a glance

```
Internet → Caddy (host) → {  /api/*  → 127.0.0.1:3000  (api container)
                             /*      → /var/www/newsletter/web  (static) }
   (same SPA + API serve every host: <slug>.<root>, app.<root>, custom domains;
    the API resolves the tenant from the inbound Host header — see
    "Multi-tenant subdomains")

              docker compose newsletter:
                api        → postgres + redis
                pipeline   → postgres + redis
                postgres   (bind /var/lib/newsletter/pgdata)
                redis      (bind /var/lib/newsletter/redisdata)
```

Production secrets live in GitHub Environment secrets under the `production` environment. The deploy workflow renders those secrets into a temporary `runtime.env`, uploads it over SSH, installs it as `/etc/newsletter/.env`, and then runs `deployment/deploy.sh`.

## First-time setup — new VPS

### 0. GitHub prerequisites

1. **Generate a deploy SSH key** for GitHub Actions:

   ```bash
   ssh-keygen -t ed25519 -f deploy-key -C "gh-actions-newsletter-deploy"
   ```

   - `deploy-key` — private key, paste into GitHub secret `DEPLOY_SSH_KEY`.
   - `deploy-key.pub` — public key, pass to `DEPLOY_SSH_PUBKEY` during server bootstrap.

2. **Create the `production` GitHub Environment**:

   Repo → Settings → Environments → New environment → `production`.

3. **Add deploy-control secrets** to the `production` environment:

   - `DEPLOY_SSH_KEY`
   - `DEPLOY_HOST` — server hostname or IP, for example `agentloop.vertexcover.io`
   - `DEPLOY_USER` — usually `deploy`

4. **Add runtime secrets** to the `production` environment.

   `deployment/.env.prod.example` is the source-of-truth list. Create one GitHub Environment secret for each key in that file:

   - `DATABASE_URL`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `POSTGRES_DB`
   - `REDIS_URL`
   - `ANTHROPIC_API_KEY`
   - `JINA_API_KEY`
   - `RANKING_MODEL`
   - `WEB_CRAWLER_CONCURRENCY` if used
   - `RETTIWT_API_KEY`
   - `API_PORT`
   - `ROOT_DOMAIN` — apex for tenant subdomains, e.g. `agentloop.live` (see "Multi-tenant subdomains" below)
   - `APP_HOST` — admin/signup host, e.g. `app.agentloop.live`
   - `CUSTOM_DOMAIN_MAP` if used — `host=slug` pairs for legacy/custom domains
   - `PUBLIC_BASE_URL`
   - `NEWSLETTER_BASE_URL`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `RESEND_API_KEY`
   - `FROM_MAIL`
   - `NEWSLETTER_REPLY_TO_EMAIL`
   - `SLACK_WEBHOOK_URL`
   - `LINKEDIN_CLIENT_ID`
   - `LINKEDIN_CLIENT_SECRET`
   - `LINKEDIN_API_VERSION`
   - `TWITTER_API_KEY`
   - `TWITTER_API_SECRET`
   - `TWITTER_ACCESS_TOKEN`
   - `TWITTER_ACCESS_TOKEN_SECRET`
   - `AUTO_REVIEW` if used
   - `GHCR_REPO_OWNER`
   - `GHCR_USERNAME`
   - `GHCR_TOKEN`

   Required secrets are enforced by `.github/workflows/deploy.yml`; optional secrets may be left empty.

### 1. Provision the server

- Ubuntu 24.04 LTS, 2 GB RAM minimum.
- Firewall/security group allowing inbound 22, 80, and 443.
- Attach an initial SSH key you control.
- DNS, before the first real deploy (see "Multi-tenant subdomains" for detail):
  - `app.<ROOT_DOMAIN>` → server IP (A/AAAA).
  - `*.<ROOT_DOMAIN>` → server IP (wildcard A/AAAA) for tenant public sites.
  - any custom domain in `CUSTOM_DOMAIN_MAP` → server IP.

### 2. Run bootstrap.sh on the server

```bash
ssh ubuntu@<public-ip>
sudo -i
export DEPLOY_SSH_PUBKEY="$(cat <<'EOF'
ssh-ed25519 AAAAC3... gh-actions-newsletter-deploy
EOF
)"
curl -fsSL https://raw.githubusercontent.com/vertexcover-io/ai-news-aggregator/main/deployment/bootstrap.sh | bash
```

The script installs Docker, Caddy, UFW, rsync, and unattended upgrades; creates the `deploy` user; writes restricted sudoers rules; hardens SSH; enables the firewall; and creates the directories CI will use.

It is idempotent and safe to rerun to pick up sudoers/bootstrap changes.

### 3. Trigger the first deploy

Push to `main`, or run:

```bash
gh workflow run deploy.yml
```

First deploy is usually a few minutes. Subsequent deploys are faster because images are cached.

### 4. Verify

```bash
curl -sI https://agentloop.vertexcover.io/api/health
curl -s  https://agentloop.vertexcover.io/ | head
```

On the server:

```bash
ssh deploy@agentloop.vertexcover.io
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml ps
```

## Multi-tenant subdomains

Each tenant gets a public site at `<slug>.<ROOT_DOMAIN>`; the admin/signup app lives at `<APP_HOST>` (e.g. `app.<ROOT_DOMAIN>`). The **same** static SPA and API serve every host — the API resolves the tenant from the inbound `Host` header (`packages/api/src/middleware/resolve-tenant.ts`):

- `<slug>.<root>` → look up the tenant by slug; only **active** tenants serve a public site (others 404). A renamed tenant's old slug 301-redirects to the new one.
- `<APP_HOST>` / loopback → admin/signup surface; tenant comes from the session, never the Host.
- a host in `CUSTOM_DOMAIN_MAP` → its mapped tenant slug.
- anything else → generic 404 (leaks no tenant existence).

Caddy's `reverse_proxy` forwards the inbound `Host` unchanged, so once the env + DNS + TLS below are in place, resolution works with no app code changes.

### 1. Environment

Set these production secrets (also listed in `deployment/.env.prod.example`):

- `ROOT_DOMAIN` — **required**. Without it the resolver classifies every `<slug>.<root>` request as "unknown" and 404s.
- `APP_HOST` — **required**. The admin/signup host (defaults to `app.<ROOT_DOMAIN>` in code, but the Caddyfile needs it as a concrete site address).
- `CUSTOM_DOMAIN_MAP` — optional, `host=slug` comma-separated. Use it to keep the existing single-tenant domain serving tenant 0 during cutover, e.g. `agentloop.vertexcover.io=agentloop`.

### 2. DNS

Point all tenant-facing names at the server IP:

| Record | Type | Value |
|---|---|---|
| `app.<root>` | A / AAAA | server IP |
| `*.<root>` | A / AAAA | server IP (wildcard — covers every tenant slug) |
| `<root>` (apex) | A / AAAA | server IP (optional landing) |
| each custom domain | A / AAAA (or CNAME) | server IP |

### 3. TLS (wildcard requires DNS-01)

`app.<root>` and any single custom domain obtain certs automatically over HTTP-01. The **wildcard** `*.<root>` cert **cannot** use HTTP-01 — Caddy must solve the **DNS-01** challenge, which needs:

1. A Caddy binary that includes your DNS provider's module. The stock binary does not; build one with [`xcaddy`](https://caddyserver.com/docs/build#xcaddy) or download a custom build:
   ```bash
   xcaddy build --with github.com/caddy-dns/<provider>
   ```
   (e.g. `caddy-dns/cloudflare`, `caddy-dns/route53`).
2. An API token for that provider, stored as the `CADDY_DNS_API_TOKEN` secret (or provider-specific vars), rendered into the server env.
3. Uncomment the `tls { dns <provider> {$CADDY_DNS_API_TOKEN} }` block in `deployment/Caddyfile` and set `<provider>` to your module.

If you do not need a wildcard yet, you can instead add an explicit site block per tenant slug (HTTP-01) — but that does not scale and is only a stop-gap.

### 4. Validate & deploy

```bash
# Locally, before pushing — confirm the Caddyfile parses with the env set:
ROOT_DOMAIN=<root> APP_HOST=app.<root> caddy validate --config deployment/Caddyfile --adapter caddyfile
```

Push to `main` (deploy installs the Caddyfile and reloads Caddy). Then verify resolution end-to-end:

```bash
# Admin surface up:
curl -sI https://app.<root>/api/health

# A known ACTIVE tenant resolves to its own site (Host drives the tenant):
curl -s https://<slug>.<root>/api/branding | jq '{name, isTenantZero}'

# An unknown slug leaks nothing:
curl -s -o /dev/null -w '%{http_code}\n' https://nope.<root>/api/branding   # → 404
```

`/api/branding` should return the tenant's own `name`; two different `<slug>.<root>` hosts must return different branding and isolated archives.

## Day-to-day ops

### Rotate a production secret

1. Update the matching GitHub Environment secret in `production`.
2. Trigger `deploy.yml`.
3. The workflow rewrites `/etc/newsletter/.env` and restarts the containers.

No secret file is committed to git.

### Force-deploy current main

```bash
gh workflow run deploy.yml
```

### Roll back

Re-dispatch the workflow on a prior commit:

```bash
gh workflow run deploy.yml --ref <PREVIOUS_SHA>
```

Or SSH in and run:

```bash
ssh deploy@agentloop.vertexcover.io
/opt/newsletter/deployment/deploy.sh <PREVIOUS_SHA>
```

Manual rollback requires `/etc/newsletter/.env` to already exist. Migrations are forward-only; rollback across a migration may require a manual schema revert.

### Check container state

```bash
ssh deploy@agentloop.vertexcover.io
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml ps
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml logs -f api
```

### Tail Caddy access log

```bash
ssh deploy@agentloop.vertexcover.io 'tail -f /var/log/caddy/newsletter.log'
```

### Edit the Caddyfile

Edit `deployment/Caddyfile` and push. Every deploy runs `install + systemctl reload caddy`, so the next deploy picks it up automatically.

### Postgres: manual one-off dump

```bash
ssh deploy@agentloop.vertexcover.io
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml exec -T postgres \
  pg_dump -U newsletter newsletter | gzip > ~/backup-$(date +%F).sql.gz
```

## Seed social-post tokens (LinkedIn) and X OAuth1 credentials

LinkedIn auto-posting reads user tokens from the `social_tokens` table. X auto-posting uses OAuth 1.0a user-context credentials from GitHub Environment secrets, which avoids the OAuth2 refresh-token chain for the owned posting account.

1. Run the OAuth helper locally:

   ```bash
   pnpm tsx scripts/auth-linkedin.ts
   ```

2. Insert or update the printed LinkedIn tokens in production Postgres:

   ```bash
   ssh deploy@agentloop.vertexcover.io
   docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml exec postgres \
     psql -U newsletter newsletter
   ```

3. Verify LinkedIn without printing token values:

   ```sql
   SELECT platform, expires_at, length(access_token) AS access_len, length(refresh_token) AS refresh_len, metadata
   FROM social_tokens
   ORDER BY platform;
   ```

Re-seed LinkedIn only when the account/app authorization changes, a refresh chain breaks, or LinkedIn lacks programmatic refresh tokens and the access token is close to expiry.

4. For X, create/regenerate credentials in the X Developer Portal:

   - App permissions: Read and write.
   - Keys and tokens: API Key, API Secret, Access Token, Access Token Secret.
   - Regenerate the Access Token/Secret after changing permissions.

5. Store the X values as production GitHub Environment secrets:

   - `TWITTER_API_KEY`
   - `TWITTER_API_SECRET`
   - `TWITTER_ACCESS_TOKEN`
   - `TWITTER_ACCESS_TOKEN_SECRET`

6. Validate X credentials without posting:

   ```bash
   pnpm tsx scripts/probe-twitter-oauth1.ts
   ```

## Move to a different VPS

1. Provision a new Ubuntu 24.04 box.
2. Run `bootstrap.sh` on the new box.
3. Update `DEPLOY_HOST` in the `production` GitHub Environment.
4. Update DNS to point at the new IP.
5. Trigger `deploy.yml`; the workflow writes `/etc/newsletter/.env` from GitHub Secrets.
6. Optionally restore a `pg_dump` from the old box.

## File map

| Path | Purpose |
|---|---|
| `deployment/bootstrap.sh` | One-shot setup for a fresh VPS. Idempotent. |
| `deployment/deploy.sh` | Runs on the VPS, invoked over SSH by CI. |
| `deployment/compose.prod.yml` | Production Docker Compose file. |
| `deployment/Caddyfile` | Caddy reverse proxy + TLS config. |
| `deployment/.env.prod.example` | Template and checklist for GitHub Environment runtime secrets. |
| `deployment/dockerfiles/*.Dockerfile` | Multi-stage builds for api and pipeline. |
| `.github/workflows/deploy.yml` | CI/CD: build images → render env from secrets → deploy over SSH. |
| `.dockerignore` | Repo-root ignore file; keeps the Docker build context small. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Deploy fails with `Missing required production secrets` | A required GitHub Environment secret is empty or missing | Add the secret under Environment `production`, then rerun deploy |
| Deploy fails with `Missing /etc/newsletter/.env` | The env install step failed before `deploy.sh` ran | Check the `Install runtime env on server` workflow step |
| Docker Compose says an interpolation variable is missing | The key is missing from GitHub Secrets or `runtime.env` generation | Compare `deployment/.env.prod.example` with the workflow env list |
| `docker login ghcr.io` fails | `GHCR_TOKEN` expired or missing | Generate a PAT with `read:packages`, update the GitHub secret, rerun deploy |
| GH Action `Permission denied (publickey)` | `DEPLOY_SSH_KEY` wrong format or not in server authorized keys | Rerun bootstrap with the matching `DEPLOY_SSH_PUBKEY` |
| Migration command hangs | Postgres container not healthy yet | Check `docker compose ... logs postgres`, fix the root cause, rerun deploy |
| Web bundle out of date | `build-web` job failed | Check the run's `build-web` logs; rerun the workflow |
| Health check `/api/health` returns 502 | api container crashed on startup | Check `docker compose ... logs api`; usually a missing or invalid env var |
