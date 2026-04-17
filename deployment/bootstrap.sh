#!/usr/bin/env bash
#
# bootstrap.sh — one-shot setup for a fresh Ubuntu 24.04 VPS.
#
# Run as root on the target server:
#   export DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... user@laptop"
#   export REPO_URL="https://github.com/vertexcover-io/ai-news-aggregator.git"
#   bash bootstrap.sh
#
# Idempotent — safe to re-run to pick up changes.

set -euo pipefail

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Must run as root. Try: sudo bash bootstrap.sh"
[[ -n "${DEPLOY_SSH_PUBKEY:-}" ]] || die "DEPLOY_SSH_PUBKEY env var must be set (the public key that GitHub Actions will use to SSH in)"

REPO_URL="${REPO_URL:-git@github.com:vertexcover-io/ai-news-aggregator.git}"
DEPLOY_USER="deploy"
APP_DIR="/opt/newsletter"
GITHUB_DEPLOY_KEY_PATH="/root/.ssh/github-deploy"

# ─── 1. Base packages ─────────────────────────────────────────────────────
log "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
	ca-certificates \
	curl \
	gnupg \
	git \
	ufw \
	rsync \
	unattended-upgrades \
	age

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

# ─── 4. SOPS ──────────────────────────────────────────────────────────────
if ! command -v sops >/dev/null 2>&1; then
	log "Installing SOPS"
	SOPS_VERSION="v3.9.4"
	ARCH="$(dpkg --print-architecture)"
	case "$ARCH" in
		amd64) SOPS_ARCH="amd64" ;;
		arm64) SOPS_ARCH="arm64" ;;
		*) die "Unsupported arch: $ARCH" ;;
	esac
	curl -fsSL -o /usr/local/bin/sops \
		"https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.${SOPS_ARCH}"
	chmod +x /usr/local/bin/sops
else
	log "SOPS already installed — skipping"
fi

# ─── 5. Deploy user ───────────────────────────────────────────────────────
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

# Allow deploy user to reload caddy and write /etc/newsletter/.env without a password.
SUDO_FILE="/etc/sudoers.d/newsletter-deploy"
if [[ ! -f "$SUDO_FILE" ]]; then
	log "Granting deploy user restricted sudo for caddy reload + env write"
	cat > "$SUDO_FILE" <<-EOF
	$DEPLOY_USER ALL=(root) NOPASSWD: /bin/systemctl reload caddy
	$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/tee /etc/newsletter/.env
	$DEPLOY_USER ALL=(root) NOPASSWD: /bin/chmod 600 /etc/newsletter/.env
	$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/install -m 644 /opt/newsletter/deployment/Caddyfile /etc/caddy/Caddyfile
	$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/sops --decrypt /opt/newsletter/deployment/.env.prod.enc
	$DEPLOY_USER ALL=(root) NOPASSWD: /bin/cat /etc/newsletter/.env
	EOF
	chmod 440 "$SUDO_FILE"
fi

# ─── 6. SSH hardening ─────────────────────────────────────────────────────
log "Hardening SSH (disable password + root login)"
SSHD_CONFIG="/etc/ssh/sshd_config"
sed -i -E 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i -E 's/^#?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
grep -q '^PasswordAuthentication no' "$SSHD_CONFIG" || echo 'PasswordAuthentication no' >> "$SSHD_CONFIG"
grep -q '^PermitRootLogin no'       "$SSHD_CONFIG" || echo 'PermitRootLogin no'       >> "$SSHD_CONFIG"
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# ─── 7. Firewall ──────────────────────────────────────────────────────────
log "Configuring UFW (22/80/443)"
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy + ACME)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw --force enable

# ─── 8. Unattended upgrades ───────────────────────────────────────────────
log "Enabling unattended security upgrades"
systemctl enable --now unattended-upgrades

# ─── 9. Filesystem layout ─────────────────────────────────────────────────
log "Creating app directories"
install -d -m 755 /etc/newsletter
install -d -m 755 /var/lib/newsletter/pgdata
install -d -m 755 /var/lib/newsletter/redisdata
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/www/newsletter/web
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/log/caddy

# ─── 10. Clone (or update) the repo ───────────────────────────────────────
# Uses a GitHub deploy key at $GITHUB_DEPLOY_KEY_PATH for SSH auth.
# Drop the private key there (chmod 600) BEFORE running bootstrap.
[[ -f "$GITHUB_DEPLOY_KEY_PATH" ]] \
	|| die "GitHub deploy private key missing at $GITHUB_DEPLOY_KEY_PATH. Install it first: install -m 600 <path> $GITHUB_DEPLOY_KEY_PATH"

# Trust GitHub's SSH host key so clone doesn't hang on the prompt.
mkdir -p /root/.ssh
chmod 700 /root/.ssh
ssh-keyscan -t ed25519,rsa github.com 2>/dev/null | sort -u > /root/.ssh/known_hosts.github
cat /root/.ssh/known_hosts.github >> /root/.ssh/known_hosts || true
sort -u /root/.ssh/known_hosts -o /root/.ssh/known_hosts
rm /root/.ssh/known_hosts.github

export GIT_SSH_COMMAND="ssh -i $GITHUB_DEPLOY_KEY_PATH -o IdentitiesOnly=yes"

if [[ ! -d "$APP_DIR/.git" ]]; then
	log "Cloning $REPO_URL to $APP_DIR"
	git clone "$REPO_URL" "$APP_DIR"
else
	log "Repo already cloned at $APP_DIR — fetching latest"
	git -C "$APP_DIR" fetch --depth=1 origin main
fi

# Also make GIT_SSH_COMMAND persistent for the deploy user (deploy.sh runs git fetch).
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$GITHUB_DEPLOY_KEY_PATH" "/home/$DEPLOY_USER/.ssh/github-deploy"
cat > "/home/$DEPLOY_USER/.ssh/config" <<EOF
Host github.com
    User git
    IdentityFile ~/.ssh/github-deploy
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
chown "$DEPLOY_USER":"$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/config"
chmod 600 "/home/$DEPLOY_USER/.ssh/config"

chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"

# ─── 11. Caddy config ─────────────────────────────────────────────────────
log "Installing Caddyfile"
install -m 644 "$APP_DIR/deployment/Caddyfile" /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy || true

# ─── 12. Done ─────────────────────────────────────────────────────────────
cat <<EOF

✅ Bootstrap complete.

Next steps (perform once, as root):

  1. Drop the age private key so deploy.sh can decrypt secrets:
       install -d -m 700 /root/.config/sops/age
       \$EDITOR /root/.config/sops/age/keys.txt   # paste AGE-SECRET-KEY-1...
       chmod 600 /root/.config/sops/age/keys.txt

  2. Point DNS: newsletter.vertexcover.io  A  \$(curl -s https://ipv4.icanhazip.com)

  3. Trigger the first deploy from GitHub:
       gh workflow run deploy.yml
     …or SSH in as 'deploy' and run:
       /opt/newsletter/deployment/deploy.sh \$(git -C /opt/newsletter rev-parse origin/main)

EOF
