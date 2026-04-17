#!/usr/bin/env bash
#
# deploy.sh — runs on the VPS, invoked over SSH by GitHub Actions.
#
# The server is a dumb target: GitHub Actions rsyncs the deployment/
# directory (this script, compose.prod.yml, Caddyfile, .env.prod.enc)
# to /opt/newsletter/deployment/ BEFORE invoking this script. No git
# operations happen here — $GIT_SHA comes in as an argument purely to
# be interpolated into the image tag via env.
#
# Assumptions (satisfied by bootstrap.sh + one-time manual steps):
#   - Runs as the 'deploy' user (member of docker group).
#   - /opt/newsletter/deployment/ exists and contains files rsynced by CI.
#   - /root/.config/sops/age/keys.txt contains the age private key.
#   - /etc/newsletter/ exists and is writable via sudo tee.

set -euo pipefail

GIT_SHA="${1:?usage: deploy.sh <git-sha>}"
DEPLOY_DIR="/opt/newsletter/deployment"
COMPOSE_FILE="$DEPLOY_DIR/compose.prod.yml"
ENV_ENC="$DEPLOY_DIR/.env.prod.enc"
ENV_PLAIN="/etc/newsletter/.env"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

[[ -d "$DEPLOY_DIR" ]] || die "Missing $DEPLOY_DIR — GitHub Actions should have rsynced the deployment dir before invoking this script."
[[ -f "$ENV_ENC" ]] || die "Missing $ENV_ENC — encrypted env not rsynced?"
[[ -f "$COMPOSE_FILE" ]] || die "Missing $COMPOSE_FILE."

cd "$DEPLOY_DIR"

# ─── 1. Decrypt prod env ──────────────────────────────────────────────────
log "Decrypting production env file"
sudo -n /usr/local/bin/sops --decrypt "$ENV_ENC" | sudo -n tee "$ENV_PLAIN" > /dev/null
sudo -n chown root:deploy "$ENV_PLAIN"
sudo -n chmod 640 "$ENV_PLAIN"

# Load selected non-secret vars for compose interpolation (GHCR_REPO_OWNER,
# POSTGRES_PASSWORD, etc.). Compose itself reads $ENV_PLAIN via env_file,
# so this only exposes the vars to `docker compose` CLI resolution.
set -a
# shellcheck disable=SC1090
source <(sudo -n /bin/cat "$ENV_PLAIN")
set +a
export GIT_SHA

[[ -n "${GHCR_REPO_OWNER:-}" ]] || die "GHCR_REPO_OWNER missing from $ENV_PLAIN"

# ─── 2. GHCR login ────────────────────────────────────────────────────────
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USERNAME:-}" ]]; then
	log "Logging into GHCR as $GHCR_USERNAME"
	echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

# ─── 3. Pull + up ─────────────────────────────────────────────────────────
log "Pulling images"
docker compose -f "$COMPOSE_FILE" pull

log "Starting containers"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# ─── 4. Migrations ────────────────────────────────────────────────────────
log "Waiting for api to be healthy"
for i in $(seq 1 30); do
	state="$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose -f "$COMPOSE_FILE" ps -q api)" 2>/dev/null || echo unknown)"
	[[ "$state" == "healthy" ]] && break
	sleep 2
	[[ $i -eq 30 ]] && die "api container did not become healthy within 60s"
done

log "Running database migrations"
docker compose -f "$COMPOSE_FILE" exec -T api node /app/migrate.mjs

# ─── 5. Sync Caddyfile + reload ──────────────────────────────────────────
log "Syncing Caddyfile and reloading Caddy"
sudo -n /usr/bin/install -m 644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
sudo -n /bin/systemctl reload caddy

# ─── 6. Prune old images ──────────────────────────────────────────────────
log "Pruning unused images older than 7 days"
docker image prune -af --filter "until=168h" || true

log "Deploy complete — GIT_SHA=$GIT_SHA"
