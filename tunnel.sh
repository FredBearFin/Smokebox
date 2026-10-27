#!/usr/bin/env bash
# Adds a second web address (https://<random-words>.trycloudflare.com) that reaches the same Smokebox server through Cloudflare,
# for networks that block the server's own address. The password prompt still applies. Run as root: bash tunnel.sh
# It only adds a service; it changes nothing already installed. To remove it: systemctl disable --now smokebox-tunnel
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
[ -f /etc/caddy/Caddyfile ] || { echo "Install the server first (go.sh)."; exit 1; }
# The site's name: the first line that opens a block, skipping comments and the import lines harden.sh puts at the top.
DOMAIN="$(awk '!/^[[:space:]]*(#|$)/ && /\{[[:space:]]*$/ {print $1; exit}' /etc/caddy/Caddyfile)"
[ -n "$DOMAIN" ] || { echo "Could not find the site name in /etc/caddy/Caddyfile; stopping."; exit 1; }
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in amd64|arm64) ;; *) echo "Unsupported CPU: $ARCH"; exit 1 ;; esac

# The Cloudflare connector, from its official release page.
TMPDEB="$(mktemp /var/tmp/cloudflared.XXXXXX.deb)"
trap 'rm -f "$TMPDEB"' EXIT
curl -fsSL --max-time 180 --retry 2 "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o "$TMPDEB"
[ "$(wc -c < "$TMPDEB")" -ge 1000000 ] || { echo "The download is too small to be the connector; stopping."; exit 1; }
dpkg-deb --info "$TMPDEB" >/dev/null || { echo "The download is not a valid package; stopping."; exit 1; }
dpkg -i "$TMPDEB"

# The tunnel goes through the same web server, so the password prompt is still in front of the app. Note: Cloudflare carries this traffic
# (including the password you type) in a form it can read, and anyone who learns the random address can reach the sign-in page.
# WATCH OUT: tunnel traffic reaches Caddy from 127.0.0.1, so harden.sh's wrong-password blocking can never ban it; the password is the only lock.
# WATCH OUT: --http-host-header makes the hub see the server's own name while the browser still sends the trycloudflare address as its Origin, so the
# hub's same-site check refuses (403) every browser POST /action through this address. Nothing posts from a browser on this branch yet; the
# connected build must settle this before writing tablets use the second address.
cat > /etc/systemd/system/smokebox-tunnel.service <<UNIT
[Unit]
Description=Smokebox second address through Cloudflare
After=network-online.target caddy.service
Wants=network-online.target

[Service]
User=nobody
Group=nogroup
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url https://127.0.0.1:443 --no-tls-verify --http-host-header ${DOMAIN} --origin-server-name ${DOMAIN}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# A tiny command that prints the current address (it changes each time the tunnel restarts).
cat > /usr/local/bin/smokebox-url <<'EOF'
#!/usr/bin/env bash
journalctl -u smokebox-tunnel --no-pager -o cat | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
EOF
chmod +x /usr/local/bin/smokebox-url

systemctl daemon-reload
systemctl enable --now smokebox-tunnel
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  URL="$(smokebox-url || true)"
  [ -n "$URL" ] && break
  sleep 2
done
echo
if [ -n "${URL:-}" ]; then
  echo "Your second address: $URL"
  echo "Sign in with the same login name and password. To see it again later, type: smokebox-url"
  echo "Note: this address changes if the tunnel restarts (for example after a reboot). Type smokebox-url for the new one."
  echo "Wrong passwords through this address are never blocked (harden.sh cannot see who sends them), so use a long password."
else
  echo "The tunnel started but the address is not ready yet. Wait a minute, then type: smokebox-url"
fi
