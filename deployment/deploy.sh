#!/usr/bin/env bash
#
# deploy.sh — runs on the VPS, invoked over SSH by GitHub Actions.
#
# The server is a dumb target: GitHub Actions rsyncs deployment/ files
# to /opt/newsletter/deployment/ and installs /etc/newsletter/.env from
# GitHub Environment secrets BEFORE invoking this script. No git operations
# happen here — $GIT_SHA comes in as an argument purely to be interpolated
# into the image tag via env.
#
# Assumptions (satisfied by bootstrap.sh + one-time manual steps):
#   - Runs as the 'deploy' user (member of docker group).
#   - /opt/newsletter/deployment/ exists and contains files rsynced by CI.
#   - /etc/newsletter/.env exists and was written by the deploy workflow.

set -euo pipefail

GIT_SHA="${1:?usage: deploy.sh <git-sha>}"
DEPLOY_DIR="/opt/newsletter/deployment"
COMPOSE_FILE="$DEPLOY_DIR/compose.prod.yml"
ENV_PLAIN="/etc/newsletter/.env"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

[[ -d "$DEPLOY_DIR" ]] || die "Missing $DEPLOY_DIR — GitHub Actions should have rsynced the deployment dir before invoking this script."
[[ -f "$COMPOSE_FILE" ]] || die "Missing $COMPOSE_FILE."
[[ -f "$ENV_PLAIN" ]] || die "Missing $ENV_PLAIN — GitHub Actions should install it from production secrets before invoking this script."

cd "$DEPLOY_DIR"

# Keep compose interpolation and service env loading pointed at the same
# GitHub-Secrets-generated dotenv file without shell-sourcing secret values.
export GIT_SHA
COMPOSE=(docker compose --env-file "$ENV_PLAIN" -f "$COMPOSE_FILE")

get_env_value() {
	local key="$1"
	awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_PLAIN"
}

[[ -n "$(get_env_value GHCR_REPO_OWNER)" ]] || die "GHCR_REPO_OWNER missing from $ENV_PLAIN"

# ─── 1. GHCR login ────────────────────────────────────────────────────────
GHCR_USERNAME="$(get_env_value GHCR_USERNAME)"
GHCR_TOKEN="$(get_env_value GHCR_TOKEN)"
if [[ -n "$GHCR_TOKEN" && -n "$GHCR_USERNAME" ]]; then
	log "Logging into GHCR as $GHCR_USERNAME"
	echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

# ─── 2. Pull + up ─────────────────────────────────────────────────────────
log "Pulling images"
"${COMPOSE[@]}" pull

log "Starting containers"
"${COMPOSE[@]}" up -d --remove-orphans

# ─── 3. Migrations ────────────────────────────────────────────────────────
log "Waiting for api to be healthy"
for i in $(seq 1 30); do
	state="$(docker inspect --format='{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q api)" 2>/dev/null || echo unknown)"
	[[ "$state" == "healthy" ]] && break
	sleep 2
	[[ $i -eq 30 ]] && die "api container did not become healthy within 60s"
done

log "Running database migrations"
"${COMPOSE[@]}" exec -T api node /app/migrate.mjs

# ─── 4. Sync Caddyfile + reload ──────────────────────────────────────────
log "Syncing Caddyfile and reloading Caddy"
sudo -n /usr/bin/install -m 644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
sudo -n /bin/systemctl reload caddy

# ─── 5. Prune old images ──────────────────────────────────────────────────
log "Pruning unused images older than 72h"
docker image prune -af --filter "until=72h" || true

log "Deploy complete — GIT_SHA=$GIT_SHA"
