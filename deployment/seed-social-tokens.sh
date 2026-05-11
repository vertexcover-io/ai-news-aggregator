#!/usr/bin/env bash
# Seed the social_tokens table on the production database by running the
# interactive OAuth scripts from your laptop against a tunneled prod Postgres.
#
# Why this exists: the auth scripts need a browser callback (interactive), so
# they can't run on the headless server. Prod Postgres isn't published to the
# host. So we briefly expose it via a socat sidecar container and tunnel
# through SSH.
#
# Usage:
#   ./deployment/seed-social-tokens.sh linkedin
#   ./deployment/seed-social-tokens.sh twitter
#
# Prerequisites:
#   - SOPS configured locally (age key in ~/.config/sops/age/keys.txt)
#   - SSH access as `deploy` user to $DEPLOY_HOST (default news.vertexcover.io)
#   - deployment/.env.prod.enc contains LINKEDIN_* or TWITTER_* client creds
#   - pnpm + node available locally

set -euo pipefail

PLATFORM="${1:?Usage: $0 linkedin|twitter}"
DEPLOY_HOST="${DEPLOY_HOST:-news.vertexcover.io}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
TUNNEL_PORT="${TUNNEL_PORT:-5433}"
COMPOSE_NETWORK="${COMPOSE_NETWORK:-newsletter_default}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/newsletter/deployment/compose.prod.yml}"
ENV_ENC="${ENV_ENC:-deployment/.env.prod.enc}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$PLATFORM" != "linkedin" && "$PLATFORM" != "twitter" ]]; then
  echo "PLATFORM must be 'linkedin' or 'twitter'" >&2
  exit 1
fi

cd "$REPO_ROOT"
if [[ ! -f "$ENV_ENC" ]]; then
  echo "Missing $ENV_ENC — did you commit the SOPS-encrypted env?" >&2
  exit 1
fi

echo "[1/4] Decrypting prod env locally to extract client creds + DB password..."
PLAIN_ENV=$(sops --decrypt "$ENV_ENC")

get_var() { echo "$PLAIN_ENV" | grep -E "^${1}=" | head -1 | cut -d= -f2-; }

PG_PASS=$(get_var POSTGRES_PASSWORD)
PG_USER=$(get_var POSTGRES_USER); PG_USER="${PG_USER:-newsletter}"
PG_DB=$(get_var POSTGRES_DB);     PG_DB="${PG_DB:-newsletter}"

if [[ "$PLATFORM" == "linkedin" ]]; then
  LINKEDIN_CLIENT_ID=$(get_var LINKEDIN_CLIENT_ID)
  LINKEDIN_CLIENT_SECRET=$(get_var LINKEDIN_CLIENT_SECRET)
  if [[ -z "$LINKEDIN_CLIENT_ID" || -z "$LINKEDIN_CLIENT_SECRET" ]]; then
    echo "LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET missing from $ENV_ENC." >&2
    echo "Run: sops $ENV_ENC, fill them in, commit, redeploy, then retry." >&2
    exit 1
  fi
  export LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET
else
  TWITTER_CLIENT_ID=$(get_var TWITTER_CLIENT_ID)
  TWITTER_CLIENT_SECRET=$(get_var TWITTER_CLIENT_SECRET)
  if [[ -z "$TWITTER_CLIENT_ID" || -z "$TWITTER_CLIENT_SECRET" ]]; then
    echo "TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET missing from $ENV_ENC." >&2
    exit 1
  fi
  export TWITTER_CLIENT_ID TWITTER_CLIENT_SECRET
fi

echo "[2/4] Starting socat sidecar on $DEPLOY_HOST to expose postgres on localhost:$TUNNEL_PORT..."
ssh "$DEPLOY_USER@$DEPLOY_HOST" \
  "docker rm -f pg-tunnel 2>/dev/null || true; \
   docker run --rm -d --name pg-tunnel \
     --network $COMPOSE_NETWORK \
     -p 127.0.0.1:$TUNNEL_PORT:$TUNNEL_PORT \
     alpine/socat \
     TCP-LISTEN:$TUNNEL_PORT,fork,reuseaddr TCP:postgres:5432" > /dev/null

cleanup() {
  echo
  echo "[4/4] Cleaning up socat sidecar..."
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "docker rm -f pg-tunnel >/dev/null 2>&1" || true
  if [[ -n "${SSH_TUNNEL_PID:-}" ]]; then
    kill "$SSH_TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[3/4] Opening SSH tunnel localhost:$TUNNEL_PORT -> $DEPLOY_HOST:$TUNNEL_PORT..."
ssh -N -L "$TUNNEL_PORT:localhost:$TUNNEL_PORT" \
  -o ExitOnForwardFailure=yes \
  "$DEPLOY_USER@$DEPLOY_HOST" &
SSH_TUNNEL_PID=$!
sleep 2

export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@localhost:${TUNNEL_PORT}/${PG_DB}"
echo "Verifying DB reachable..."
if ! psql "$DATABASE_URL" -c "SELECT 1;" >/dev/null 2>&1; then
  echo "Could not reach prod DB through the tunnel. Check docker network name (default newsletter_default)." >&2
  exit 1
fi

echo "Running OAuth script for $PLATFORM (a browser tab will open on your laptop)..."
echo
pnpm tsx "scripts/auth-${PLATFORM}.ts"
echo
echo "Done. Verifying row was written..."
psql "$DATABASE_URL" -c "SELECT platform, expires_at, length(access_token) AS tok_len FROM social_tokens WHERE platform='$PLATFORM';"
