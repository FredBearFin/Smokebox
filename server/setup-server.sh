#!/usr/bin/env bash
# Sets up the Smokebox prototype hub on a fresh Ubuntu 22.04 or 24.04 server, with automatic HTTPS and a password.
# Usage (as root): bash setup-server.sh <time zone> <login name> <password> [domain]
# If smokebox-server.tar.gz is not in the current folder, it is downloaded from the public GitHub repo (branch deploy).
# Example: bash setup-server.sh America/New_York freddy 'a-long-password' smokebox.example.com
# With no domain it uses <your-server-ip>.sslip.io, a free name that points at your IP, so HTTPS works at once.
set -euo pipefail
TZNAME="${1:?time zone, for example America/New_York}"
LOGIN="${2:?login name}"
PASS="${3:-${SMOKEBOX_PASS:-}}"   # or set SMOKEBOX_PASS so it is not on the command line
DOMAIN="${4:-}"
[ -n "$PASS" ] || { echo "password needed (third argument or SMOKEBOX_PASS)"; exit 1; }
[ "${#PASS}" -ge 8 ] || { echo "Use a password of at least 8 characters (a long phrase is best): this server is on the internet."; exit 1; }
# These go into the Caddy file and the service file as they are, so only plain characters are allowed (a space or a brace would break them).
[[ "$LOGIN" =~ ^[A-Za-z0-9._@-]{1,64}$ ]] || { echo "Use a login name of letters, digits, dots, dashes or underscores only."; exit 1; }
[[ "$TZNAME" =~ ^[A-Za-z0-9/_+-]+$ ]] && [ -e "/usr/share/zoneinfo/$TZNAME" ] || { echo "Unknown time zone: $TZNAME (for example America/New_York); stopping."; exit 1; }
[ -z "$DOMAIN" ] || [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || { echo "'$DOMAIN' does not look like a web address name; stopping."; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash ...)"; exit 1; }
if [ ! -f smokebox-server.tar.gz ]; then
  curl -fsSL --max-time 180 --retry 2 https://github.com/FredBearFin/SmokeBoxKDS/archive/refs/heads/deploy.tar.gz -o smokebox-server.tar.gz
fi
[ "$(wc -c < smokebox-server.tar.gz)" -ge 100000 ] || { echo "smokebox-server.tar.gz is too small to be the app; stopping."; exit 1; }
gzip -t smokebox-server.tar.gz
NAMES="$(tar -tzf smokebox-server.tar.gz)"   # read fully first: a pipe into grep -q can cut tar off and look like "no match"
if grep -Eq '(^/|(^|/)\.\.(/|$))' <<< "$NAMES"; then echo "The archive has unsafe paths; stopping."; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy (web server that gets and renews HTTPS certificates by itself)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

# The app
id smokebox >/dev/null 2>&1 || useradd --system --home /opt/smokebox --shell /usr/sbin/nologin smokebox
rm -rf /opt/smokebox.new && mkdir -p /opt/smokebox.new
tar -xzf smokebox-server.tar.gz -C /opt/smokebox.new --strip-components=1 --no-same-owner --no-same-permissions
[ -s /opt/smokebox.new/server/server.mjs ] && [ -s /opt/smokebox.new/dist/smokebox.html ] || { echo "The download is missing app files; stopping."; exit 1; }
rm -rf /opt/smokebox && mv /opt/smokebox.new /opt/smokebox
mkdir -p /var/lib/smokebox
chown -R smokebox:smokebox /var/lib/smokebox
chown -R root:root /opt/smokebox

cat > /etc/systemd/system/smokebox.service <<UNIT
[Unit]
Description=Smokebox prototype hub
After=network.target

[Service]
User=smokebox
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=SMOKEBOX_TZ=${TZNAME}
Environment=SMOKEBOX_DATA=/var/lib/smokebox/state.json
WorkingDirectory=/opt/smokebox
ExecStart=/usr/bin/node /opt/smokebox/server/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/smokebox
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now smokebox
systemctl restart smokebox

# Name for HTTPS: your own domain, or <ip>.sslip.io
if [ -z "$DOMAIN" ]; then
  IP="$(curl -4 -fsS https://api.ipify.org)"
  DOMAIN="${IP//./-}.sslip.io"
fi
# The password goes to Caddy on its input, not on the command line (where any user on the server could read it in the process list). An older Caddy
# that cannot read it that way gets it on the command line as before.
HASH="$(printf '%s\n' "$PASS" | caddy hash-password 2>/dev/null || true)"
case "$HASH" in '$2'*) ;; *) HASH="$(caddy hash-password --plaintext "$PASS")" ;; esac

# Re-running (go.sh on an existing server) writes the site again, but keeps what beta.sh and harden.sh added to the old file: harden's snippet import
# at the top and its "import smokebox_log" in the site, and every other top-level import line (the beta site) at the end. If Caddy refuses the
# result, the plain site is installed and the old file is kept as Caddyfile.before-setup.
keep_imports() {
  local old="$1" new="$2" body
  [ -f "$old" ] || return 0
  body="$(cat "$new")"
  if grep -q '^[[:space:]][[:space:]]*import smokebox_log[[:space:]]*$' "$old"; then body="$(printf '%s\n' "$body" | awk 'NR == 1 { print; print "\timport smokebox_log"; next } { print }')"; fi
  {
    if grep -qx 'import /etc/caddy/harden-log.caddy' "$old"; then printf '# smokebox-harden\nimport /etc/caddy/harden-log.caddy\n\n'; fi
    printf '%s\n' "$body"
    { grep '^import ' "$old" || true; } | { grep -vx 'import /etc/caddy/harden-log.caddy' || true; } | while IFS= read -r line; do printf '\n%s\n' "$line"; done
  } > "$new.tmp"
  cat "$new.tmp" > "$new"; rm -f "$new.tmp"
}
CADDYFILE=/etc/caddy/Caddyfile
cat > "$CADDYFILE.plain" <<CADDY
${DOMAIN} {
	encode gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy no-referrer
		-Server
	}
	request_body {
		max_size 2MB
	}
	basic_auth {
		${LOGIN} ${HASH}
	}
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
CADDY
cp "$CADDYFILE.plain" "$CADDYFILE.setup"
if [ -f "$CADDYFILE" ]; then
  cp -p "$CADDYFILE" "$CADDYFILE.before-setup"
  keep_imports "$CADDYFILE" "$CADDYFILE.setup"
  if ! cmp -s "$CADDYFILE.plain" "$CADDYFILE.setup" && ! caddy validate --config "$CADDYFILE.setup" --adapter caddyfile >/dev/null 2>&1; then
    echo "Caddy did not accept the site with the earlier extras (beta.sh, harden.sh) kept, so the plain site is installed. Run those scripts again;"
    echo "the earlier file is $CADDYFILE.before-setup."
    cp "$CADDYFILE.plain" "$CADDYFILE.setup"
  fi
fi
mv "$CADDYFILE.setup" "$CADDYFILE"; rm -f "$CADDYFILE.plain"
systemctl restart caddy

# The firewall lets in ssh on every port sshd really listens on (not only 22), so a server with ssh moved elsewhere does not lock its owner out.
ufw allow OpenSSH >/dev/null
for p in $(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}'); do if [[ "$p" =~ ^[0-9]+$ ]]; then ufw allow "$p/tcp" >/dev/null; fi; done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 3
echo
echo "Done. Open https://${DOMAIN}/ and sign in as ${LOGIN}."
echo "If your own domain was given, point its A record at this server's IP first."
echo "Check:   systemctl status smokebox caddy"
echo "Logs:    journalctl -u smokebox -f"
echo "Data:    /var/lib/smokebox/state.json (back this file up)"
