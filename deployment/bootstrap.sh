#!/usr/bin/env bash
#
# bootstrap.sh — one-shot setup for a fresh Ubuntu 24.04 VPS.
#
# The server is a dumb target: GitHub Actions rsyncs deployment/* from
# the repo to /opt/newsletter/deployment/ on every deploy. This script
# only installs tools, creates the deploy user, hardens SSH, configures
# UFW, installs Caddy, and creates the empty directories CI will rsync
# into. NO git operations, no GitHub credentials, no production secrets.
#
# Run as root on the target server:
#   export DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... user@laptop"
#   bash bootstrap.sh
#
# Idempotent — safe to re-run to pick up changes.

set -euo pipefail

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Must run as root. Try: sudo bash bootstrap.sh"
[[ -n "${DEPLOY_SSH_PUBKEY:-}" ]] || die "DEPLOY_SSH_PUBKEY env var must be set (the public key that GitHub Actions will use to SSH in)"

DEPLOY_USER="deploy"

# ─── 1. Base packages ─────────────────────────────────────────────────────
log "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
	ca-certificates \
	curl \
	gnupg \
	ufw \
	rsync \
	unattended-upgrades

# ─── 2. Docker CE ─────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
	log "Installing Docker CE"
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	. /etc/os-release
	echo \
		"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
		> /etc/apt/sources.list.d/docker.list
	apt-get update -y
	apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	systemctl enable --now docker
else
	log "Docker already installed — skipping"
fi

# ─── 3. Caddy ─────────────────────────────────────────────────────────────
if ! command -v caddy >/dev/null 2>&1; then
	log "Installing Caddy"
	curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
	apt-get update -y
	apt-get install -y caddy
else
	log "Caddy already installed — skipping"
fi

# ─── 4. Deploy user ───────────────────────────────────────────────────────
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
	log "Creating user '$DEPLOY_USER'"
	useradd -m -s /bin/bash -G docker "$DEPLOY_USER"
	passwd -l "$DEPLOY_USER" >/dev/null
else
	log "User '$DEPLOY_USER' already exists"
	usermod -aG docker "$DEPLOY_USER"
fi

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
AUTH_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
if ! { [[ -f "$AUTH_KEYS" ]] && grep -qxF "$DEPLOY_SSH_PUBKEY" "$AUTH_KEYS"; }; then
	log "Installing deploy SSH public key"
	printf '%s\n' "$DEPLOY_SSH_PUBKEY" >> "$AUTH_KEYS"
fi
chown "$DEPLOY_USER":"$DEPLOY_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

# Restricted sudo so deploy.sh can reload caddy + write /etc/newsletter/.env
# without a password, and nothing else.
SUDO_FILE="/etc/sudoers.d/newsletter-deploy"
log "Writing restricted sudoers rules"
cat > "$SUDO_FILE" <<-EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /bin/systemctl reload caddy
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/tee /etc/newsletter/.env
$DEPLOY_USER ALL=(root) NOPASSWD: /bin/chmod 640 /etc/newsletter/.env
$DEPLOY_USER ALL=(root) NOPASSWD: /bin/chown root\:$DEPLOY_USER /etc/newsletter/.env
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/install -m 644 /opt/newsletter/deployment/Caddyfile /etc/caddy/Caddyfile
$DEPLOY_USER ALL=(root) NOPASSWD: /bin/cat /etc/newsletter/.env
EOF
chmod 440 "$SUDO_FILE"
visudo -cf "$SUDO_FILE" >/dev/null

# ─── 5. SSH hardening ─────────────────────────────────────────────────────
log "Hardening SSH (disable password + root login)"
SSHD_CONFIG="/etc/ssh/sshd_config"
sed -i -E 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i -E 's/^#?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
grep -q '^PasswordAuthentication no' "$SSHD_CONFIG" || echo 'PasswordAuthentication no' >> "$SSHD_CONFIG"
grep -q '^PermitRootLogin no'       "$SSHD_CONFIG" || echo 'PermitRootLogin no'       >> "$SSHD_CONFIG"
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# ─── 6. Firewall ──────────────────────────────────────────────────────────
log "Configuring UFW (22/80/443)"
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy + ACME)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw --force enable

# ─── 7. Unattended upgrades ───────────────────────────────────────────────
log "Enabling unattended security upgrades"
systemctl enable --now unattended-upgrades

# ─── 8. Filesystem layout ─────────────────────────────────────────────────
log "Creating app directories"
install -d -m 755 /etc/newsletter
install -d -m 755 /var/lib/newsletter/pgdata
install -d -m 755 /var/lib/newsletter/redisdata
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/www/newsletter/web
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/newsletter
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/newsletter/deployment
install -d -m 755 -o caddy -g caddy /var/log/caddy

# Minimal placeholder Caddyfile so caddy can start before the first deploy.
# CI will overwrite /etc/caddy/Caddyfile with the committed version during deploy.
if [[ ! -f /etc/caddy/Caddyfile.bootstrap-placeholder ]]; then
	log "Writing placeholder Caddyfile (CI overwrites this on first deploy)"
	cat > /etc/caddy/Caddyfile <<-'EOF'
	:80 {
	    respond "Waiting for first deploy..." 200
	}
	EOF
	touch /etc/caddy/Caddyfile.bootstrap-placeholder
fi

systemctl enable --now caddy
systemctl reload caddy || true

# ─── 9. Done ─────────────────────────────────────────────────────────────
cat <<EOF

✅ Bootstrap complete.

Next steps:

  1. Create the production GitHub Environment secrets listed in deployment/README.md.

  2. Point DNS: news.vertexcover.io  A  \$(curl -s https://ipv4.icanhazip.com)

  3. Trigger the first deploy from GitHub:
       gh workflow run deploy.yml

EOF
