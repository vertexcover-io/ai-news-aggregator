# EC2 Deploy + GitHub Actions CI/CD — Design

**Date:** 2026-04-17
**Status:** Approved (pending written-spec review)
**Domain:** `newsletter.vertexcover.io`

## Goal

Deploy the AI Newsletter Aggregator (api + pipeline + web + Postgres + Redis) to a single Ubuntu 24.04 VPS with:

- **Zero hand-configuration** after the first bootstrap — a fresh VPS becomes deploy-ready in under 15 minutes.
- **Portable across providers** — EC2, Hetzner, DigitalOcean, Linode all work with the same scripts.
- **Git-native CI/CD** — push to `main` triggers a GitHub Actions deploy.
- **Automatic HTTPS** via Caddy + Let's Encrypt.
- **Secrets in the repo** via SOPS encryption — no external secret manager.
- **Guard rails** — UFW firewall, key-only SSH, unattended security upgrades.

## Non-goals

- Zero-downtime rolling restart (compose up -d gives ~2–5s per service; acceptable for an internal tool).
- Multi-host, load balancing, blue/green.
- Managed Postgres/Redis (same box with a bind-mount; data stays on the host FS).
- **Automated backups** — no `pg_dump` timer in this slice. Data is mostly re-derivable (re-run the pipeline); the only unique data is human review edits. If backups become important later, rely on provider-level volume snapshots (EBS, Hetzner, DO) or revisit this as its own design.
- Observability stack (Axiom/Betterstack deferred).
- Staging environment (can be cloned later by pointing at a second server).

## Architecture

```
Internet
  │
  ▼ :80 / :443
┌──────────────────────────────────────────────┐
│  Caddy (host apt package)                    │
│  - auto-TLS via Let's Encrypt                │
│  - newsletter.vertexcover.io/api/* → :3000   │
│  - newsletter.vertexcover.io/*     → static  │
└──────────────────────────────────────────────┘
  │                          │
  ▼ 127.0.0.1:3000           ▼ /var/www/newsletter/web (static React build)
┌─────────────┐
│ api (Node)  │
└─────────────┘
  │
  ├──▶ postgres:5432 (container, bind-mount /var/lib/newsletter/pgdata)
  └──▶ redis:6379    (container, bind-mount /var/lib/newsletter/redisdata)

┌─────────────────┐
│ pipeline (Node) │──▶ same postgres + redis
└─────────────────┘
```

All application containers share a private Docker network. Only Caddy binds host ports (80, 443). UFW allows only 22/80/443.

## Repo layout

Everything deploy-related lives under `deployment/` except two files GitHub and Docker require elsewhere:

```
deployment/
  bootstrap.sh                   # fresh VPS setup (run once as root)
  deploy.sh                      # deploy script (called by GH Actions over SSH)
  compose.prod.yml               # prod docker-compose
  Caddyfile                      # reverse proxy config
  .sops.yaml                     # SOPS creation rules (age public key)
  .env.prod.enc                  # SOPS-encrypted prod env file (committed)
  dockerfiles/
    base.Dockerfile              # shared pnpm install + workspace build layer
    api.Dockerfile
    pipeline.Dockerfile
  README.md                      # ops runbook

.github/workflows/deploy.yml     # GitHub requirement: must live under .github/workflows/
.dockerignore                    # Docker requirement: must live at build-context root
```

## Components

### 1. Dockerfiles

Three-stage build shared across services:

- **`deployment/dockerfiles/base.Dockerfile`** — `node:22-alpine`, installs pnpm, copies `pnpm-lock.yaml` + `package.json` + all workspace `package.json` files, runs `pnpm install --frozen-lockfile`. Cached across all service builds.
- **`deployment/dockerfiles/api.Dockerfile`** — `FROM base`, copies source, runs `pnpm --filter @newsletter/api build`, final stage is `node:22-alpine` running `node packages/api/dist/index.js`.
- **`deployment/dockerfiles/pipeline.Dockerfile`** — same shape for pipeline.
- **Web is not containerized** — CI builds `packages/web/dist` and rsyncs it to `/var/www/newsletter/web` on the host; Caddy serves directly.

Build context is the monorepo root (Dockerfiles reference via `docker build -f deployment/dockerfiles/api.Dockerfile .`). Root `.dockerignore` excludes `node_modules`, `dist`, `.git`, `.env*`.

### 2. `deployment/compose.prod.yml`

Services: `api`, `pipeline`, `postgres`, `redis`. Key properties:

- `api` and `pipeline` images: `ghcr.io/vertexcover-io/ai-news-aggregator-{api,pipeline}:${GIT_SHA}`.
- Bind mounts for data: `/var/lib/newsletter/pgdata:/var/lib/postgresql/data`, `/var/lib/newsletter/redisdata:/data`.
- `env_file: /etc/newsletter/.env` (written by the deploy script from the decrypted SOPS file).
- `restart: unless-stopped` on all services.
- Healthchecks: api `GET /health`, postgres `pg_isready`, redis `redis-cli ping`.
- `api` and `pipeline` `depends_on` postgres + redis with `condition: service_healthy`.
- Postgres and redis bound to `127.0.0.1` only (via compose network — no host port publish).
- Api binds `127.0.0.1:3000:3000` so only Caddy can reach it.

### 3. `deployment/Caddyfile`

```
newsletter.vertexcover.io {
    encode zstd gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    handle {
        root * /var/www/newsletter/web
        try_files {path} /index.html
        file_server
    }

    log {
        output file /var/log/caddy/newsletter.log
        format json
    }
}
```

Deploys finish with `sudo systemctl reload caddy` (graceful, zero-downtime reload).

### 4. Secrets — SOPS + age

- **`.sops.yaml`** in `deployment/` specifies the age public key that encrypts `.env.prod.enc`.
- **`.env.prod.enc`** is committed. It is the authoritative production env file.
- **Age private key** lives at `/root/.config/sops/age/keys.txt` on the server. Dropped once during bootstrap by the operator.
- **Deploy step** decrypts: `sops -d deployment/.env.prod.enc > /etc/newsletter/.env && chmod 600 /etc/newsletter/.env`.
- **Rotating a secret**: operator runs `sops deployment/.env.prod.enc` locally, edits, commits. Next deploy picks it up.

Generating the age key pair and the public-key entry in `.sops.yaml` is part of the first-time setup documented in `deployment/README.md`.

### 5. `deployment/bootstrap.sh` — fresh VPS setup

Idempotent one-shot against Ubuntu 24.04. Runs as root. Steps:

1. `apt update && apt upgrade -y && apt install -y ca-certificates curl gnupg`
2. Install Docker CE (official repo), Caddy (official Cloudsmith repo), `ufw`, `sops`, `age`, `unattended-upgrades`, `rsync`.
3. Create `deploy` user, add to `docker` group.
4. Install operator's SSH public key at `/home/deploy/.ssh/authorized_keys` (path passed via env var `DEPLOY_SSH_PUBKEY`).
5. Harden SSH: `PasswordAuthentication no`, `PermitRootLogin no`. Reload sshd.
6. UFW: `default deny incoming`, `default allow outgoing`, allow `22/tcp` `80/tcp` `443/tcp`, enable.
7. Enable `unattended-upgrades` for security patches.
8. Create dirs: `/etc/newsletter`, `/var/lib/newsletter/{pgdata,redisdata}`, `/var/www/newsletter/web`, `/opt/newsletter`, `/var/log/caddy`.
9. Clone the repo to `/opt/newsletter` (read-only — deploys don't `git pull`; see §6).
10. Copy `deployment/Caddyfile` → `/etc/caddy/Caddyfile`, `systemctl enable --now caddy`.
11. Print next-step instructions: drop age key, configure DNS, run first deploy from GitHub Actions.

Target: ~120 lines, runs in ~10 minutes on a fresh VPS.

### 6. `deployment/deploy.sh` — deploy script

Called by GitHub Actions over SSH. Runs on the host as the `deploy` user. Arguments: `$1 = GIT_SHA`.

```
set -euo pipefail
cd /opt/newsletter
git fetch --depth=1 origin main
git checkout "$1"
sops -d deployment/.env.prod.enc | sudo tee /etc/newsletter/.env > /dev/null
sudo chmod 600 /etc/newsletter/.env
export GIT_SHA="$1"
docker compose -f deployment/compose.prod.yml pull
docker compose -f deployment/compose.prod.yml up -d --remove-orphans
docker compose -f deployment/compose.prod.yml exec -T api node packages/api/dist/migrate.js
sudo systemctl reload caddy
docker image prune -f --filter "until=168h"
```

Drizzle migrations are idempotent and run on every deploy.

### 7. `.github/workflows/deploy.yml`

Triggers: `push` to `main`, `workflow_dispatch`.

Jobs:

**`build-images`** (matrix: api, pipeline)
- `actions/checkout@v4`
- `pnpm/action-setup@v4` + `actions/setup-node@v4` with `cache: pnpm`
- `docker/login-action@v3` → GHCR (uses `GITHUB_TOKEN`)
- `docker/build-push-action@v6` — builds `deployment/dockerfiles/${service}.Dockerfile`, tags `ghcr.io/vertexcover-io/ai-news-aggregator-${service}:${{ github.sha }}` + `:latest`, enables GHA build cache.

**`build-web`**
- Checkout + pnpm install.
- `pnpm --filter @newsletter/web build`
- `actions/upload-artifact@v4` with `packages/web/dist`.

**`deploy`** (needs: build-images, build-web)
- `actions/download-artifact@v4` for the web dist.
- `rsync` the web dist to the host via SSH (`--delete` to prune old assets).
- `appleboy/ssh-action@v1` to run `/opt/newsletter/deployment/deploy.sh ${{ github.sha }}`.

Required secrets:
- `DEPLOY_SSH_KEY` — private SSH key authorized on the host.
- `DEPLOY_HOST` — e.g. `newsletter.vertexcover.io` or the raw IP.
- `DEPLOY_USER` — `deploy`.
- `GITHUB_TOKEN` — provided automatically, used for GHCR push.

Public GHCR images are fine (source is public); if the repo turns private we switch to `docker/login-action` on the host with a PAT.

### 8. Backups (deferred)

No automated backups in this slice — see Non-goals. Postgres data lives on the host FS at `/var/lib/newsletter/pgdata`; if the operator wants a one-off snapshot before a risky change, the runbook shows the manual `pg_dump` + `scp` incantation. Revisit as its own design when/if it matters.

### 9. Observability (minimal)

- `docker compose logs -f <service>` is the primary debugging tool.
- Caddy access/error logs at `/var/log/caddy/newsletter.log` (JSON), rotated by the Caddy apt package's logrotate rules.
- Future: Axiom or Betterstack log shipper. Out of scope for this slice.

## Portability — moving to a new VPS

1. Provision fresh Ubuntu 24.04.
2. Copy the operator SSH pubkey into `DEPLOY_SSH_PUBKEY`, run `bash bootstrap.sh` (curl'd from the repo).
3. Copy the age private key to `/root/.config/sops/age/keys.txt`.
4. Point DNS at the new IP.
5. Trigger the GitHub Action (or SSH in and run `deploy.sh HEAD`).
6. (Optional) Manually restore a `pg_dump` if one was taken before the move.

Target: ~45 minutes end to end. No file is created by hand that isn't covered by the bootstrap script.

## Risks / edge cases

- **Out-of-disk from Docker images** — handled by `docker image prune -f --filter "until=168h"` at the end of each deploy.
- **Caddy cert renewal** — handled automatically by Caddy; we only need to ensure port 80 stays open for ACME HTTP-01.
- **Postgres major upgrade** — out of scope; documented as a manual runbook in `deployment/README.md` (pg_dump, stop compose, bump image tag, pg_restore).
- **Migration failure mid-deploy** — deploy script fails hard (`set -e`), previous containers keep running because `up -d` only replaces healthy ones that differ. Operator fixes the migration and re-deploys.
- **GHCR rate limits for unauthenticated pulls** — host authenticates to GHCR during `docker compose pull` using a PAT stored in `/etc/newsletter/.env`; `deploy.sh` runs `docker login ghcr.io` before pull if `$GHCR_TOKEN` is set.
- **Compose recreates containers with data loss** — mitigated by bind mounts (not named volumes); data lives on the host FS.

## Acceptance criteria

1. `bash deployment/bootstrap.sh` on a fresh Ubuntu 24.04 VPS produces a box that is deploy-ready, with Docker, Caddy, UFW, SOPS, and age installed, the `deploy` user created, SSH hardened, and the firewall enabled.
2. Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds + pushes two images to GHCR, builds the web bundle, rsyncs it to the host, and runs `deploy.sh` over SSH. Deploy completes in under 5 minutes.
3. `https://newsletter.vertexcover.io/` returns the React app; `https://newsletter.vertexcover.io/api/health` returns 200.
4. Rotating a secret is: `sops deployment/.env.prod.enc`, commit, push — no manual server action.
5. `ufw status` shows only 22/80/443 allowed.
6. A second VPS can be brought up and serving traffic in under 60 minutes using only the procedure in `deployment/README.md`.

## Open questions

None for this slice. The following are deliberately deferred and will be their own design docs when needed:

- Staging environment
- Log shipping / uptime monitoring
- Managed Postgres migration
- Kamal / blue-green rollout (if traffic grows)
