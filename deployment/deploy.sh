#!/usr/bin/env bash
#
# deploy.sh — runs on the VPS, invoked over SSH by GitHub Actions.
#
# Usage:  deploy.sh <GIT_SHA>
#
# Assumptions (satisfied by bootstrap.sh + one-time manual steps):
#   - Runs as the 'deploy' user (member of docker group).
#   - /opt/newsletter is a clone of the repo, owned by deploy.
#   - /root/.config/sops/age/keys.txt contains the age private key (readable by root).
#   - /etc/newsletter/ exists and is writable via sudo tee.
#   - deployment/.env.prod.enc exists and is encrypted with the matching age key.

set -euo pipefail

GIT_SHA="${1:?usage: deploy.sh <git-sha>}"
APP_DIR="/opt/newsletter"
COMPOSE_FILE="$APP_DIR/deployment/compose.prod.yml"
ENV_ENC="$APP_DIR/deployment/.env.prod.enc"
ENV_PLAIN="/etc/newsletter/.env"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR"

# ─── 1. Checkout target SHA ───────────────────────────────────────────────
log "Checking out $GIT_SHA"
git fetch --depth=1 origin main
git fetch --depth=1 origin "$GIT_SHA" 2>/dev/null || true
git checkout --detach "$GIT_SHA"

# ─── 2. Decrypt prod env ──────────────────────────────────────────────────
log "Decrypting production env file"
[[ -f "$ENV_ENC" ]] || die "Missing $ENV_ENC — run 'sops --encrypt deployment/.env.prod > deployment/.env.prod.enc' on your laptop and push."

# sudo decrypts as root so it can read /root/.config/sops/age/keys.txt,
# then pipes into tee (also via sudo) to write /etc/newsletter/.env.
sudo -n sops --decrypt "$ENV_ENC" | sudo -n tee "$ENV_PLAIN" > /dev/null
sudo -n chmod 600 "$ENV_PLAIN"

# Make selected vars from the decrypted file available to compose interpolation
# for non-secret knobs (GIT_SHA override, GHCR_REPO_OWNER, POSTGRES_PASSWORD, etc.).
set -a
# shellcheck disable=SC1090
source <(sudo -n cat "$ENV_PLAIN")
set +a
export GIT_SHA

[[ -n "${GHCR_REPO_OWNER:-}" ]] || die "GHCR_REPO_OWNER missing from $ENV_PLAIN"

# ─── 3. GHCR login ────────────────────────────────────────────────────────
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USERNAME:-}" ]]; then
	log "Logging into GHCR as $GHCR_USERNAME"
	echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

# ─── 4. Pull + up ─────────────────────────────────────────────────────────
log "Pulling images"
docker compose -f "$COMPOSE_FILE" pull

log "Starting containers (pull-through if unchanged)"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# ─── 5. Migrations ────────────────────────────────────────────────────────
log "Waiting for api to be healthy"
for i in $(seq 1 30); do
	state="$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose -f "$COMPOSE_FILE" ps -q api)" 2>/dev/null || echo unknown)"
	[[ "$state" == "healthy" ]] && break
	sleep 2
	[[ $i -eq 30 ]] && die "api container did not become healthy within 60s"
done

log "Running database migrations"
docker compose -f "$COMPOSE_FILE" exec -T api \
	node --input-type=module -e "
		import { drizzle } from 'drizzle-orm/postgres-js';
		import { migrate } from 'drizzle-orm/postgres-js/migrator';
		import postgres from 'postgres';
		const sql = postgres(process.env.DATABASE_URL, { max: 1 });
		await migrate(drizzle(sql), { migrationsFolder: './migrations' });
		await sql.end();
		console.log('migrations ok');
	"

# ─── 6. Sync Caddyfile + reload ──────────────────────────────────────────
log "Syncing Caddyfile and reloading Caddy"
sudo -n install -m 644 "$APP_DIR/deployment/Caddyfile" /etc/caddy/Caddyfile
sudo -n systemctl reload caddy

# ─── 7. Prune old images ──────────────────────────────────────────────────
log "Pruning unused images older than 7 days"
docker image prune -af --filter "until=168h" || true

log "Deploy complete — HEAD=$GIT_SHA"
