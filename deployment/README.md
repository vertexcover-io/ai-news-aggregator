# Deployment — ops runbook

This folder is the single source of truth for deploying the AI Newsletter Aggregator to any Ubuntu 24.04 VPS.

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

All secrets live in `deployment/.env.prod.enc` (SOPS + age). One age private key on the server decrypts everything.

---

## First-time setup — new VPS (~45 min)

### 0. Prerequisites on your laptop (one-time)

1. **Generate an age keypair** (do NOT commit the private key anywhere):
   ```bash
   age-keygen -o age-key.txt
   # Output shows:
   #   # created: ...
   #   # public key: age1...
   #   AGE-SECRET-KEY-1...
   ```
   Save the `AGE-SECRET-KEY-1...` line in 1Password (or equivalent). You need it exactly once per server.

2. **Wire the public key into SOPS config:**
   Edit `deployment/.sops.yaml` — replace `REPLACE_WITH_AGE_PUBLIC_KEY` with the `age1...` public key.

3. **Create and encrypt the production env file:**
   ```bash
   cp deployment/.env.prod.example deployment/.env.prod
   # fill in real secrets: DATABASE_URL, ANTHROPIC_API_KEY, JINA_API_KEY,
   # POSTGRES_PASSWORD, GHCR_USERNAME, GHCR_TOKEN, …
   sops --encrypt deployment/.env.prod > deployment/.env.prod.enc
   rm deployment/.env.prod            # never commit plaintext
   git add deployment/.sops.yaml deployment/.env.prod.enc
   git commit -m "chore(deploy): encrypt prod env"
   git push
   ```

4. **Generate a deploy SSH key** for GitHub Actions:
   ```bash
   ssh-keygen -t ed25519 -f deploy-key -C "gh-actions-newsletter-deploy"
   # deploy-key      — private key, paste into GH Actions secret DEPLOY_SSH_KEY
   # deploy-key.pub  — public key, feeds into DEPLOY_SSH_PUBKEY on the server
   ```

5. **Add GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions):
   - `DEPLOY_SSH_KEY` — contents of `deploy-key` (include `-----BEGIN OPENSSH PRIVATE KEY-----` through `-----END OPENSSH PRIVATE KEY-----`)
   - `DEPLOY_HOST` — the server's hostname or IP (e.g. `news.vertexcover.io`)
   - `DEPLOY_USER` — `deploy`

### 1. Provision the server

- Ubuntu 24.04 LTS, 2 GB RAM minimum (t3.small / Hetzner CX21 / DO 2GB)
- Security group / firewall allowing inbound **22, 80, 443** from `0.0.0.0/0`
- Attach an initial SSH key that you control — you'll only use it to run bootstrap
- Note the public IP

### 2. Point DNS at the server

`news.vertexcover.io  A  <public IP>` (TTL 300 or less).

Wait for `dig +short news.vertexcover.io` to return the right IP before running bootstrap — Caddy will request a cert during bootstrap and DNS must be live.

### 3. Run bootstrap.sh on the server

```bash
ssh ubuntu@<public-ip>
sudo -i
export DEPLOY_SSH_PUBKEY="$(cat <<'EOF'
ssh-ed25519 AAAAC3... gh-actions-newsletter-deploy
EOF
)"
curl -fsSL https://raw.githubusercontent.com/vertexcover-io/ai-news-aggregator/main/deployment/bootstrap.sh | bash
```

The script installs Docker, Caddy, UFW, SOPS, age; creates the `deploy` user with your GitHub Actions public key; hardens SSH; enables the firewall; clones the repo to `/opt/newsletter`; starts Caddy with the committed Caddyfile.

It takes about 8–10 minutes. It is idempotent — re-run any time to pick up changes to `bootstrap.sh`.

### 4. Install the age private key (one time, as root)

```bash
install -d -m 700 /root/.config/sops/age
nano /root/.config/sops/age/keys.txt
# paste the AGE-SECRET-KEY-1... line from step 0.1
chmod 600 /root/.config/sops/age/keys.txt
```

### 5. Trigger the first deploy

From your laptop, push any commit to `main` — the workflow runs automatically. Or manually:

```bash
gh workflow run deploy.yml
```

First deploy is ~5 minutes (no image cache yet). Subsequent deploys are ~90 seconds.

### 6. Verify

```bash
curl -sI https://news.vertexcover.io/api/health   # 200
curl -s  https://news.vertexcover.io/ | head       # React HTML
```

---

## Day-to-day ops

### Rotate a secret

```bash
sops deployment/.env.prod.enc          # opens editor, edits in place, re-encrypts
git commit -am "chore(deploy): rotate ANTHROPIC_API_KEY"
git push
```

Next deploy (triggered by the push) picks up the new value.

### Force-deploy the current main

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

Migrations are forward-only; a rollback across a migration requires a manual schema revert.

### Check container state

```bash
ssh deploy@news.vertexcover.io
docker compose -f /opt/newsletter/deployment/compose.prod.yml ps
docker compose -f /opt/newsletter/deployment/compose.prod.yml logs -f api
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
docker compose -f /opt/newsletter/deployment/compose.prod.yml exec -T postgres \
  pg_dump -U newsletter newsletter | gzip > ~/backup-$(date +%F).sql.gz
```

---

## Move to a different VPS

1. Provision a new Ubuntu 24.04 box (steps 1–2 above).
2. (Optional) Take a manual `pg_dump` on the old box and `scp` it to your laptop.
3. Run `bootstrap.sh` on the new box (step 3).
4. Drop the **same** age private key at `/root/.config/sops/age/keys.txt` (step 4).
5. Update `DEPLOY_HOST` in GitHub Actions secrets to the new IP/hostname.
6. Update DNS to point at the new IP.
7. Trigger a deploy (step 5).
8. (Optional) Restore the pg_dump from step 2:
   ```bash
   scp ~/backup-<date>.sql.gz deploy@new-host:~
   ssh deploy@new-host
   gunzip < ~/backup-<date>.sql.gz | docker compose -f /opt/newsletter/deployment/compose.prod.yml exec -T postgres psql -U newsletter newsletter
   ```

Total: ~45 minutes.

---

## File map

| Path | Purpose |
|---|---|
| `deployment/bootstrap.sh` | One-shot setup for a fresh VPS. Idempotent. |
| `deployment/deploy.sh` | Runs on the VPS, invoked over SSH by CI. |
| `deployment/compose.prod.yml` | Production docker compose file. |
| `deployment/Caddyfile` | Caddy reverse proxy + TLS config. |
| `deployment/.sops.yaml` | SOPS encryption rules (age public key). |
| `deployment/.env.prod.example` | Template for the plaintext env file (never commit a filled copy). |
| `deployment/.env.prod.enc` | SOPS-encrypted production env (committed). |
| `deployment/dockerfiles/*.Dockerfile` | Multi-stage builds for api and pipeline. |
| `.github/workflows/deploy.yml` | CI/CD: build images → push GHCR → rsync web → SSH deploy.sh. |
| `.dockerignore` | Repo-root ignore file; keeps the Docker build context small. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Caddy can't obtain a cert | DNS not propagated, or port 80 blocked | `dig +short news.vertexcover.io`; check cloud provider firewall |
| `sops: no key could decrypt the data` | `/root/.config/sops/age/keys.txt` missing or wrong key | Paste the key that matches the `age1...` public key in `.sops.yaml` |
| `docker login ghcr.io` fails | `GHCR_TOKEN` expired / missing | Generate a new PAT with `read:packages`, update `.env.prod.enc`, re-deploy |
| GH Action `Permission denied (publickey)` | `DEPLOY_SSH_KEY` wrong format or not in server's `authorized_keys` | Re-run bootstrap with correct `DEPLOY_SSH_PUBKEY`; ensure secret includes BEGIN/END lines |
| Migration command hangs | Postgres container not healthy yet | `docker compose logs postgres`; fix the underlying issue and re-run deploy |
| Web bundle out of date | `build-web` job failed | Check the run's `build-web` logs; re-run the workflow |
| Health check `/api/health` 502 | api container crashed on startup | `docker compose logs api` — usually a missing env var in `/etc/newsletter/.env` |
