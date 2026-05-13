# Deployment — ops runbook

This folder is the single source of truth for deploying the AI Newsletter Aggregator to an Ubuntu 24.04 VPS.

## Architecture at a glance

```
Internet → Caddy (host) → {  /api/*  → 127.0.0.1:3000  (api container)
                             /*      → /var/www/newsletter/web  (static) }

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
   - `DEPLOY_HOST` — server hostname or IP, for example `news.vertexcover.io`
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
   - `TWITTER_CLIENT_ID`
   - `TWITTER_CLIENT_SECRET`
   - `AUTO_REVIEW` if used
   - `GHCR_REPO_OWNER`
   - `GHCR_USERNAME`
   - `GHCR_TOKEN`

   Required secrets are enforced by `.github/workflows/deploy.yml`; optional secrets may be left empty.

### 1. Provision the server

- Ubuntu 24.04 LTS, 2 GB RAM minimum.
- Firewall/security group allowing inbound 22, 80, and 443.
- Attach an initial SSH key you control.
- Point `news.vertexcover.io` at the server IP before the first real deploy.

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
curl -sI https://news.vertexcover.io/api/health
curl -s  https://news.vertexcover.io/ | head
```

On the server:

```bash
ssh deploy@news.vertexcover.io
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml ps
```

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
ssh deploy@news.vertexcover.io
/opt/newsletter/deployment/deploy.sh <PREVIOUS_SHA>
```

Manual rollback requires `/etc/newsletter/.env` to already exist. Migrations are forward-only; rollback across a migration may require a manual schema revert.

### Check container state

```bash
ssh deploy@news.vertexcover.io
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml ps
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml logs -f api
```

### Tail Caddy access log

```bash
ssh deploy@news.vertexcover.io 'tail -f /var/log/caddy/newsletter.log'
```

### Edit the Caddyfile

Edit `deployment/Caddyfile` and push. Every deploy runs `install + systemctl reload caddy`, so the next deploy picks it up automatically.

### Postgres: manual one-off dump

```bash
ssh deploy@news.vertexcover.io
docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml exec -T postgres \
  pg_dump -U newsletter newsletter | gzip > ~/backup-$(date +%F).sql.gz
```

## Seed social-post tokens (LinkedIn / X)

The auto-post feature reads user tokens from the `social_tokens` table, not from GitHub Secrets. GitHub Secrets only store the app-level Client ID/Secret.

1. Run the OAuth helper locally:

   ```bash
   pnpm tsx scripts/auth-linkedin.ts
   pnpm tsx scripts/auth-twitter.ts
   ```

2. Insert or update the printed tokens in production Postgres:

   ```bash
   ssh deploy@news.vertexcover.io
   docker compose --env-file /etc/newsletter/.env -f /opt/newsletter/deployment/compose.prod.yml exec postgres \
     psql -U newsletter newsletter
   ```

3. Verify without printing token values:

   ```sql
   SELECT platform, expires_at, length(access_token) AS access_len, length(refresh_token) AS refresh_len, metadata
   FROM social_tokens
   ORDER BY platform;
   ```

Re-seed only when the account/app authorization changes, a refresh chain breaks, or LinkedIn lacks programmatic refresh tokens and the access token is close to expiry.

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
