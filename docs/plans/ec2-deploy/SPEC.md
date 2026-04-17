# SPEC: EC2 Deploy + GitHub Actions CI/CD

**Source:** `docs/plans/2026-04-17-ec2-deploy-design.md`
**Generated:** 2026-04-17
**Domain:** `newsletter.vertexcover.io`

## Requirements

### Bootstrap (one-time VPS setup)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When `deployment/bootstrap.sh` is run as root on a fresh Ubuntu 24.04 VPS with `DEPLOY_SSH_PUBKEY` set in the environment, the system shall install Docker CE, docker-compose-v2, Caddy, UFW, SOPS, age, rsync, git, and unattended-upgrades. | `dpkg -s docker-ce docker-compose-plugin caddy ufw sops age rsync git unattended-upgrades` exits 0 for every package. | Must |
| REQ-002 | Event-driven | When `bootstrap.sh` runs, the system shall create a `deploy` user that is a member of the `docker` group and has no login password. | `id deploy` shows `docker` in groups; `passwd -S deploy` reports `NP` or `L`. | Must |
| REQ-003 | Event-driven | When `bootstrap.sh` runs, the system shall write `$DEPLOY_SSH_PUBKEY` to `/home/deploy/.ssh/authorized_keys` with mode 600 and `/home/deploy/.ssh` with mode 700 owned by `deploy:deploy`. | `stat -c '%a %U' /home/deploy/.ssh/authorized_keys` returns `600 deploy`; contents match `$DEPLOY_SSH_PUBKEY`. | Must |
| REQ-004 | Event-driven | When `bootstrap.sh` runs, the system shall set `PasswordAuthentication no` and `PermitRootLogin no` in `/etc/ssh/sshd_config` and reload sshd. | `sshd -T` prints `passwordauthentication no` and `permitrootlogin no`. | Must |
| REQ-005 | Event-driven | When `bootstrap.sh` runs, the system shall configure UFW to deny incoming by default and allow only TCP 22, 80, and 443 inbound, then enable the firewall. | `ufw status verbose` shows `Status: active`, `Default: deny (incoming)`, and exactly the rules `22/tcp ALLOW`, `80/tcp ALLOW`, `443/tcp ALLOW`. | Must |
| REQ-006 | Event-driven | When `bootstrap.sh` runs, the system shall enable the `unattended-upgrades` systemd service. | `systemctl is-enabled unattended-upgrades` returns `enabled`. | Must |
| REQ-007 | Event-driven | When `bootstrap.sh` runs, the system shall create the directories `/etc/newsletter`, `/var/lib/newsletter/pgdata`, `/var/lib/newsletter/redisdata`, `/var/www/newsletter/web`, `/opt/newsletter`, and `/var/log/caddy` if they do not already exist. | Each path exists and is a directory. | Must |
| REQ-008 | Event-driven | When `bootstrap.sh` runs and `/opt/newsletter` is empty, the system shall clone the repo into `/opt/newsletter` and set ownership to `deploy:deploy` recursively. | `/opt/newsletter/.git` exists; `stat -c '%U' /opt/newsletter` returns `deploy`. | Must |
| REQ-009 | Event-driven | When `bootstrap.sh` runs, the system shall copy `/opt/newsletter/deployment/Caddyfile` to `/etc/caddy/Caddyfile` and enable + start the `caddy` systemd unit. | `systemctl is-active caddy` returns `active`; `systemctl is-enabled caddy` returns `enabled`; `diff /etc/caddy/Caddyfile /opt/newsletter/deployment/Caddyfile` is empty. | Must |
| REQ-010 | Ubiquitous | The `bootstrap.sh` script shall be idempotent — running it a second time shall not error, duplicate users, duplicate UFW rules, or overwrite the operator's authorized_keys if already equal. | Run `bootstrap.sh` twice in sequence; second run exits 0 with no duplicate entries in `ufw status numbered`, `/etc/passwd`, or `authorized_keys`. | Must |

### Secrets management (SOPS)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-020 | Ubiquitous | The repository shall contain `deployment/.sops.yaml` specifying the age public key used to encrypt production env files. | `sops --config deployment/.sops.yaml -d deployment/.env.prod.enc` succeeds when the matching private key is present. | Must |
| REQ-021 | Ubiquitous | The repository shall contain `deployment/.env.prod.enc` as a SOPS-encrypted file; no plaintext production env file shall exist under version control. | `grep -r "ANTHROPIC_API_KEY=" --include="*.env*" .` returns no matches outside of `.env.example` / `.env.test.example`. | Must |
| REQ-022 | Event-driven | When `deploy.sh` runs on the server, the system shall decrypt `deployment/.env.prod.enc` using the age key at `/root/.config/sops/age/keys.txt` and write the result to `/etc/newsletter/.env` with mode 600. | `stat -c '%a' /etc/newsletter/.env` returns `600`; file contains every key present in the encrypted original. | Must |
| REQ-023 | Unwanted | If the age private key is missing or cannot decrypt `deployment/.env.prod.enc`, then the system shall exit `deploy.sh` with a non-zero status before touching docker compose state. | Rename the keys file and run `deploy.sh`; script exits non-zero and `docker compose ps` shows no new containers. | Must |

### Reverse proxy (Caddy)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-030 | Ubiquitous | The Caddyfile shall route `/api/*` on `newsletter.vertexcover.io` to `127.0.0.1:3000`. | `curl -s https://newsletter.vertexcover.io/api/health` returns HTTP 200 from the api container. | Must |
| REQ-031 | Ubiquitous | The Caddyfile shall serve static files from `/var/www/newsletter/web` for all non-`/api/*` paths on `newsletter.vertexcover.io`, falling back to `/index.html` for unknown paths. | `curl -s https://newsletter.vertexcover.io/` returns the React index HTML; `curl -s https://newsletter.vertexcover.io/nonexistent-route` returns the same index HTML. | Must |
| REQ-032 | Ubiquitous | The Caddyfile shall enable automatic TLS for `newsletter.vertexcover.io` via Let's Encrypt. | `openssl s_client -connect newsletter.vertexcover.io:443 -servername newsletter.vertexcover.io` reports a certificate issued by Let's Encrypt and valid for the domain. | Must |
| REQ-033 | Ubiquitous | The Caddyfile shall write JSON access logs to `/var/log/caddy/newsletter.log`. | After one request to the domain, `tail -1 /var/log/caddy/newsletter.log` is valid JSON containing `request.uri`. | Should |
| REQ-034 | Event-driven | When `deploy.sh` completes successfully, the system shall run `systemctl reload caddy`. | `journalctl -u caddy -n 20` shows a reload entry dated within the last minute of the deploy. | Must |

### Container images & compose

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-040 | Ubiquitous | The repository shall contain three Dockerfiles at `deployment/dockerfiles/{base,api,pipeline}.Dockerfile`. | Files exist; `docker build -f deployment/dockerfiles/api.Dockerfile .` and the same for `pipeline` both succeed locally. | Must |
| REQ-041 | Ubiquitous | The api and pipeline Dockerfiles shall produce images that run as a non-root user and have `NODE_ENV=production` set. | `docker run --rm <image> id -u` returns a non-zero UID; `docker run --rm <image> env` contains `NODE_ENV=production`. | Must |
| REQ-042 | Ubiquitous | The repository shall contain `deployment/compose.prod.yml` defining services `api`, `pipeline`, `postgres`, and `redis`. | `docker compose -f deployment/compose.prod.yml config --services` lists exactly those four services. | Must |
| REQ-043 | Ubiquitous | The `api` and `pipeline` service images in `compose.prod.yml` shall reference `ghcr.io/vertexcover-io/ai-news-aggregator-{api,pipeline}:${GIT_SHA}`. | `GIT_SHA=abc123 docker compose -f deployment/compose.prod.yml config` renders those exact image tags. | Must |
| REQ-044 | Ubiquitous | The `postgres` service shall bind-mount `/var/lib/newsletter/pgdata` to `/var/lib/postgresql/data`; the `redis` service shall bind-mount `/var/lib/newsletter/redisdata` to `/data`. | `docker compose -f deployment/compose.prod.yml config` renders both mounts as `type: bind`. | Must |
| REQ-045 | Ubiquitous | The `api` service shall bind only to `127.0.0.1:3000` on the host; `postgres` and `redis` shall not publish any host ports. | `docker compose -f deployment/compose.prod.yml config` shows `api` port as `127.0.0.1:3000:3000` and no `ports:` key for postgres or redis. | Must |
| REQ-046 | Ubiquitous | Every service in `compose.prod.yml` shall declare `restart: unless-stopped`. | `docker compose -f deployment/compose.prod.yml config` shows `restart: unless-stopped` for all four services. | Must |
| REQ-047 | Ubiquitous | The `postgres`, `redis`, and `api` services shall each declare a healthcheck; `api` and `pipeline` shall `depends_on` `postgres` and `redis` with `condition: service_healthy`. | `docker compose -f deployment/compose.prod.yml config` renders healthchecks and the dependency conditions as specified. | Must |
| REQ-048 | Ubiquitous | Both `api` and `pipeline` services shall load their environment via `env_file: /etc/newsletter/.env`. | Rendered compose shows `env_file: [/etc/newsletter/.env]` on both services. | Must |

### Deploy script

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-060 | Event-driven | When `deploy.sh $SHA` runs, the system shall `git fetch` and `git checkout $SHA` inside `/opt/newsletter` before any container work. | `git -C /opt/newsletter rev-parse HEAD` returns `$SHA` after a successful deploy. | Must |
| REQ-061 | Event-driven | When `deploy.sh` pulls images, the system shall authenticate to GHCR using a token read from `/etc/newsletter/.env` as `$GHCR_TOKEN`. | `docker login ghcr.io` is invoked prior to `docker compose pull`; a deploy with an invalid token fails at pull and exits non-zero. | Must |
| REQ-062 | Event-driven | When `deploy.sh` runs, the system shall execute `docker compose -f deployment/compose.prod.yml up -d --remove-orphans` after pull. | `docker compose -f deployment/compose.prod.yml ps --format json` shows every service `State: running` within 60s of the command. | Must |
| REQ-063 | Event-driven | When the api container is healthy after compose up, the system shall run `docker compose exec -T api node packages/api/dist/migrate.js`. | Drizzle migrations table (`__drizzle_migrations`) reflects all applied migrations at the current HEAD. | Must |
| REQ-064 | Event-driven | When `deploy.sh` completes all prior steps, the system shall invoke `docker image prune -f --filter "until=168h"`. | `docker images --format '{{.CreatedSince}}'` shows no dangling images older than 7 days. | Should |
| REQ-065 | Ubiquitous | `deploy.sh` shall use `set -euo pipefail` so any step failure aborts the script. | Deliberately break one step (e.g. remove the sops key); script exits non-zero at that step and does not continue. | Must |

### GitHub Actions workflow

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-080 | Event-driven | When a commit is pushed to `main`, the system shall trigger `.github/workflows/deploy.yml`. | GitHub Actions run history shows one run of `deploy` per push to main. | Must |
| REQ-081 | Ubiquitous | `deploy.yml` shall support manual execution via `workflow_dispatch`. | The Actions UI exposes a "Run workflow" button for `deploy`. | Must |
| REQ-082 | Event-driven | When `deploy.yml` runs, the `build-images` job shall build and push one image per service (api, pipeline) to `ghcr.io/vertexcover-io/ai-news-aggregator-<service>` tagged with `${{ github.sha }}` and `latest`. | `docker manifest inspect ghcr.io/vertexcover-io/ai-news-aggregator-api:<sha>` succeeds after the run. | Must |
| REQ-083 | Event-driven | When `deploy.yml` runs, the `build-web` job shall produce `packages/web/dist` and upload it as an artifact named `web-dist`. | The Actions run page shows a `web-dist` artifact of non-zero size. | Must |
| REQ-084 | Event-driven | When the `deploy` job runs, the system shall rsync the `web-dist` artifact to `/var/www/newsletter/web/` on the host with `--delete`, then SSH in and run `/opt/newsletter/deployment/deploy.sh ${{ github.sha }}`. | After deploy, `sha256sum` of any file in the dist matches the file at `/var/www/newsletter/web/` on the host; `/opt/newsletter` HEAD equals the workflow's commit SHA. | Must |
| REQ-085 | Ubiquitous | `deploy.yml` shall require the secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, and `DEPLOY_USER`; missing secrets shall fail the job before any SSH attempt. | A run with a missing secret fails with a clear "secret not set" error at the SSH step. | Must |
| REQ-086 | Ubiquitous | `deploy.yml` shall only run the `deploy` job after `build-images` and `build-web` succeed. | Forcing `build-web` to fail (e.g. `exit 1`) skips `deploy`; run summary shows `deploy` as skipped. | Must |

### Portability

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-100 | Ubiquitous | The deploy pipeline shall depend on no cloud-provider-specific APIs — only SSH, Docker, and DNS. | No `aws`, `gcloud`, `doctl`, or `hcloud` CLI invocations appear in `bootstrap.sh`, `deploy.sh`, or `.github/workflows/deploy.yml`. | Must |
| REQ-101 | Ubiquitous | The `deployment/README.md` shall document the "move to a new VPS" runbook as an ordered list with verification commands per step. | Following the runbook on a fresh VPS of a different provider produces a working deploy in ≤60 minutes. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `bootstrap.sh` is re-run on an already-bootstrapped server. | Script exits 0; `ufw status numbered` shows no duplicate rules; `authorized_keys` contains one copy of the pubkey. | REQ-010 |
| EDGE-002 | DNS for `newsletter.vertexcover.io` has not propagated when Caddy starts. | Caddy logs repeated Let's Encrypt HTTP-01 failures but continues to serve without TLS; once DNS resolves, next renewal attempt succeeds automatically. | REQ-032 |
| EDGE-003 | Port 80 is blocked by the cloud provider's external firewall. | Caddy cannot obtain a cert; the runbook flags the SG/firewall as a pre-bootstrap requirement. | REQ-032 |
| EDGE-004 | `deploy.sh` is invoked with a `$SHA` that does not exist on origin. | `git checkout $SHA` fails; `set -e` aborts the script before pulling images; previous containers continue running. | REQ-060, REQ-065 |
| EDGE-005 | Migration command fails mid-deploy (e.g. Drizzle throws on a broken SQL file). | Script exits non-zero after migration step; new api/pipeline containers are already running but the database may be in an inconsistent state. Runbook entry covers rollback: `git checkout PREV_SHA && deploy.sh PREV_SHA`. | REQ-063, REQ-065 |
| EDGE-006 | GHCR token in `/etc/newsletter/.env` is expired or missing. | `docker login ghcr.io` fails; `docker compose pull` fails; script exits non-zero; previous containers keep serving traffic. | REQ-061 |
| EDGE-007 | Host runs out of disk because old images accumulate. | `docker image prune` at end of each deploy removes images older than 168h; `df -h /var/lib/docker` stays within acceptable limits. | REQ-064 |
| EDGE-008 | Postgres container is recreated by compose but the bind-mounted pgdata directory already contains an initialized cluster. | Postgres skips init, attaches to existing data, and comes up healthy. | REQ-044 |
| EDGE-009 | Two pushes to main land within seconds. | The second workflow run queues or cancels the first per GitHub's concurrency rules; the final HEAD on the host matches the later SHA. | REQ-080 |
| EDGE-010 | `deploy.sh` is re-run with the same SHA (no-op deploy). | `docker compose pull` reports images up to date; `up -d` detects no changes and does not recreate containers. | REQ-062 |
| EDGE-011 | Age private key file mode is wider than 600. | SOPS refuses to use the key; `deploy.sh` fails at decryption step per REQ-023. | REQ-022, REQ-023 |
| EDGE-012 | Operator runs `bootstrap.sh` without `DEPLOY_SSH_PUBKEY` set. | Script detects the missing variable and exits non-zero before touching the system. | REQ-003 |
| EDGE-013 | `/var/www/newsletter/web` is empty when the first request arrives (web rsync hasn't run yet on a fresh box). | Caddy returns a 404 on `/`; `/api/*` routes continue to work once containers are up. Runbook states that the first deploy populates the directory. | REQ-031 |
| EDGE-014 | Compose `up -d` fails because a new image's healthcheck never passes. | `depends_on: service_healthy` keeps dependent services in `created` state; `up -d` exits non-zero after timeout; previous healthy containers are untouched for services with no image change. | REQ-047, REQ-062 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | No | Yes | No | Yes | Shellcheck + running bootstrap inside a Multipass/LXD Ubuntu 24.04 VM and asserting package presence. |
| REQ-002 | No | Yes | No | Yes | Same VM harness. |
| REQ-003 | No | Yes | No | Yes | Same VM harness. |
| REQ-004 | No | Yes | No | Yes | Same VM harness; run `sshd -T`. |
| REQ-005 | No | Yes | No | Yes | Same VM harness. |
| REQ-006 | No | Yes | No | Yes | Same VM harness. |
| REQ-007 | No | Yes | No | Yes | Same VM harness. |
| REQ-008 | No | Yes | No | Yes | Same VM harness. |
| REQ-009 | No | Yes | No | Yes | Same VM harness; verify `systemctl is-active caddy`. |
| REQ-010 | No | Yes | No | Yes | Run bootstrap twice in the VM harness. |
| REQ-020 | Yes | No | No | No | Lint `.sops.yaml` syntax; decrypt smoke test. |
| REQ-021 | No | Yes | No | No | `grep` grep guard in CI. |
| REQ-022 | No | Yes | No | Yes | VM harness with a test age key. |
| REQ-023 | No | Yes | No | Yes | VM harness; rename keys file, run deploy, assert failure. |
| REQ-030 | No | Yes | Yes | Yes | Live curl against staging domain. |
| REQ-031 | No | Yes | Yes | Yes | Curl `/` and a nonexistent path. |
| REQ-032 | No | No | Yes | Yes | Manual once per domain; `openssl s_client` check. |
| REQ-033 | No | Yes | No | Yes | Tail log after a request. |
| REQ-034 | No | Yes | No | Yes | Check `journalctl -u caddy` after deploy. |
| REQ-040 | No | Yes | No | No | `docker build` in CI. |
| REQ-041 | No | Yes | No | No | `docker run --rm <image> id -u` in CI. |
| REQ-042 | No | Yes | No | No | `docker compose config --services` in CI. |
| REQ-043 | No | Yes | No | No | Render compose with a fake SHA in CI. |
| REQ-044 | No | Yes | No | No | Parse compose config. |
| REQ-045 | No | Yes | No | No | Parse compose config. |
| REQ-046 | No | Yes | No | No | Parse compose config. |
| REQ-047 | No | Yes | No | No | Parse compose config. |
| REQ-048 | No | Yes | No | No | Parse compose config. |
| REQ-060 | No | Yes | No | Yes | VM harness; assert HEAD SHA. |
| REQ-061 | No | Yes | No | Yes | VM harness; bad token path. |
| REQ-062 | No | Yes | Yes | Yes | VM harness; `docker compose ps` assertion. |
| REQ-063 | No | Yes | No | Yes | VM harness; query `__drizzle_migrations`. |
| REQ-064 | No | Yes | No | Yes | VM harness; `docker images` diff before/after. |
| REQ-065 | No | Yes | No | Yes | Inject a failing step. |
| REQ-080 | No | No | Yes | Yes | Observe an actual push. |
| REQ-081 | No | No | No | Yes | Manual UI check. |
| REQ-082 | No | Yes | Yes | Yes | `docker manifest inspect` after run. |
| REQ-083 | No | Yes | No | Yes | Actions UI artifact check. |
| REQ-084 | No | Yes | Yes | Yes | Compare hashes post-deploy. |
| REQ-085 | No | No | No | Yes | Remove a secret, run workflow. |
| REQ-086 | No | Yes | No | Yes | Introduce a `build-web` failure. |
| REQ-100 | No | Yes | No | No | CI grep guard against cloud CLIs. |
| REQ-101 | No | No | No | Yes | Quarterly runbook drill. |
| EDGE-001 | No | Yes | No | Yes | Bootstrap twice, diff state. |
| EDGE-002 | No | No | No | Yes | Operator checklist. |
| EDGE-003 | No | No | No | Yes | Operator checklist. |
| EDGE-004 | No | Yes | No | Yes | VM harness with invalid SHA. |
| EDGE-005 | No | Yes | No | Yes | VM harness with broken migration. |
| EDGE-006 | No | Yes | No | Yes | VM harness with bad GHCR token. |
| EDGE-007 | No | Yes | No | Yes | VM harness; simulate old images. |
| EDGE-008 | No | Yes | No | Yes | Second deploy over populated pgdata. |
| EDGE-009 | No | No | No | Yes | Push twice rapidly; inspect run history. |
| EDGE-010 | No | Yes | No | Yes | Re-run same SHA; assert no recreate. |
| EDGE-011 | No | Yes | No | Yes | chmod 644 on keys file; assert failure. |
| EDGE-012 | No | Yes | No | Yes | Unset env var; run bootstrap. |
| EDGE-013 | No | No | No | Yes | First deploy on clean host. |
| EDGE-014 | No | Yes | No | Yes | Push an image with a failing healthcheck. |

## Out of Scope

- **Zero-downtime rolling restart.** `docker compose up -d` incurs a 2–5s restart blip per replaced service. Acceptable for an internal tool.
- **Multi-host topology.** Single VPS only; no load balancer, no failover, no blue/green.
- **Managed Postgres or Redis.** Both run as containers on the same host with bind-mounted data directories.
- **Automated backups.** No `pg_dump` timer, no S3 lifecycle, no PITR. If needed later, use provider-level volume snapshots or spec a separate backups feature.
- **Observability stack.** No Axiom, Betterstack, Prometheus, Grafana, or log shipping. `docker compose logs` + Caddy access log is the entire debugging surface.
- **Staging environment.** The same bootstrap + deploy flow can stand up a second server later; not in scope here.
- **Secrets rotation automation.** Rotations are a manual edit of `deployment/.env.prod.enc` via `sops` plus a push.
- **Tailscale / zero-trust SSH.** SSH uses public-key auth on port 22 with password auth disabled; no VPN layer.
- **Container image signing / SBOM.** GHCR images are pushed without Cosign signing or SBOM generation.
- **Cost / capacity planning.** Instance sizing, autoscaling, disk growth planning are operator decisions outside this spec.
