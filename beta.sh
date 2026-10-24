#!/usr/bin/env bash
# Installs a SECOND Smokebox instance for trying the experimental connected build (two tablets writing through one hub), next to the real one.
# The real instance (service smokebox, port 8787, /opt/smokebox, /var/lib/smokebox) is never stopped, changed or restarted by this script.
# Usage (as root, on the server that already ran go.sh):  bash beta.sh [beta host name]
#   With no name: "beta." in front of the real site's name when that ends in .sslip.io (works at once); with your own domain give a name whose
#   DNS A record already points at this server.   Remove it again with: bash beta-remove.sh
# Installs: /opt/smokebox-beta (branch connected), user smokebox-beta, service smokebox-beta on 127.0.0.1:8788, data /var/lib/smokebox-beta,
# codes in /etc/smokebox-beta.env (root only), /etc/caddy/beta.caddy (one "import" line is added to /etc/caddy/Caddyfile), nightly update 04:50.
set -euo pipefail
R="${SMOKEBOX_BETA_ROOT:-}"   # empty on a real server; tests point it at a scratch folder
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
BRANCH="${SMOKEBOX_BETA_BRANCH:-connected}"
URL="${SMOKEBOX_BETA_URL:-https://github.com/FredBearFin/SmokeBoxKDS/archive/refs/heads/${BRANCH}.tar.gz}"
PREFIX="$R/opt/smokebox-beta"; DATA="$R/var/lib/smokebox-beta"; ENVF="$R/etc/smokebox-beta.env"; PORT="${SMOKEBOX_BETA_PORT:-8788}"
CADDYFILE="$R/etc/caddy/Caddyfile"; BETACADDY="$R/etc/caddy/beta.caddy"
say() { echo "beta: $*"; }
die() { echo "beta: $*" >&2; exit 1; }

# 0. The real instance must be there, and this must not collide with it.
[ -f $R/etc/systemd/system/smokebox.service ] || die "the real Smokebox is not installed here (run go.sh first); stopping."
[ -f "$CADDYFILE" ] || die "$CADDYFILE is missing; stopping."
command -v caddy >/dev/null && command -v node >/dev/null && command -v curl >/dev/null || die "caddy, node and curl are needed; stopping."
if ss -ltn 2>/dev/null | grep -q "127.0.0.1:$PORT " && ! systemctl is-active --quiet smokebox-beta; then die "port $PORT is already used by something else; stopping."; fi
TZNAME="$(sed -n 's/^Environment=SMOKEBOX_TZ=//p' $R/etc/systemd/system/smokebox.service | head -n1)"; TZNAME="${TZNAME:-America/New_York}"

# 1. The name the beta is reached at: a second HOST NAME, never a path on the real site (the page asks the hub for /follow and /action from the
#    root of its address, so a path prefix would need every screen to be opened with the prefix typed into its address).
MAIN_HOST="$(awk '!/^[[:space:]]*(#|$)/ && /\{[[:space:]]*$/ {print $1; exit}' "$CADDYFILE")"
BETA_HOST="${1:-}"
if [ -z "$BETA_HOST" ]; then
  case "$MAIN_HOST" in *.sslip.io) BETA_HOST="beta.$MAIN_HOST" ;; *) die "give the beta host name (its DNS A record must already point at this server), e.g. bash beta.sh beta.example.com" ;; esac
fi
printf '%s' "$BETA_HOST" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$' || die "'$BETA_HOST' does not look like a host name; stopping."
[ "$BETA_HOST" != "$MAIN_HOST" ] || die "the beta name must differ from the real site's name; stopping."
# The same login as the real site (its basic_auth lines are copied, so no second password to remember).
AUTH="$(awk '/basic_auth[[:space:]]*\{/ {f=1; next} f && /\}/ {exit} f {print}' "$CADDYFILE")"
[ -n "$AUTH" ] || die "could not find the login (basic_auth) in $CADDYFILE; stopping."

# 2. Download the connected build and check it like the nightly updater does.
WORK="$(mktemp -d $R/var/tmp/smokebox-beta.XXXXXX)"; trap 'rm -rf "$WORK" "$PREFIX.new"' EXIT
curl -fsSL --max-time 180 --retry 2 "$URL" -o "$WORK/beta.tar.gz" || die "download failed; nothing was changed."
[ "$(wc -c < "$WORK/beta.tar.gz")" -ge 100000 ] || die "the download is too small to be the app; nothing was changed."
gzip -t "$WORK/beta.tar.gz" || die "the download is not a valid gzip file; nothing was changed."
NAMES="$(tar -tzf "$WORK/beta.tar.gz")"; TYPES="$(tar -tvzf "$WORK/beta.tar.gz")"   # read fully first: a pipe into grep -q can cut tar off and look like "no match"
if grep -Eq '(^/|(^|/)\.\.(/|$))' <<< "$NAMES"; then die "the archive has unsafe paths; nothing was changed."; fi
if grep -Eq '^[^-d]' <<< "$TYPES"; then die "the archive contains links or special files; nothing was changed."; fi
rm -rf "$PREFIX.new"; mkdir -p "$PREFIX.new"
tar -xzf "$WORK/beta.tar.gz" -C "$PREFIX.new" --strip-components=1 --no-same-owner --no-same-permissions
for f in server/server.mjs dist/smokebox.html src/js/30-store.js; do [ -s "$PREFIX.new/$f" ] || die "the build has no $f; nothing was changed."; done
grep -q "initHubClient" "$PREFIX.new/src/js/30-store.js" || die "this branch has no connected (writing tablet) code; nothing was changed."
node --check "$PREFIX.new/server/server.mjs" || die "the server file does not parse; nothing was changed."
chown -R root:root "$PREFIX.new"
rm -rf "$PREFIX.old"; [ -d "$PREFIX" ] && mv "$PREFIX" "$PREFIX.old"; mv "$PREFIX.new" "$PREFIX"

# 3. Own user, own data, own codes. The codes are made once (kept on a re-run) and shown once.
id smokebox-beta >/dev/null 2>&1 || useradd --system --home "$PREFIX" --shell /usr/sbin/nologin smokebox-beta
mkdir -p "$DATA"; chown -R smokebox-beta:smokebox-beta "$DATA"; chmod 700 "$DATA"
NEWCODES=0
if [ ! -s "$ENVF" ]; then
  mk() { head -c 24 /dev/urandom | base32 | tr -d '=\n' | cut -c1-16; }
  ( umask 077; printf 'SMOKEBOX_FOLLOW_CODE=%s\nSMOKEBOX_WRITE_CODE=%s\n' "$(mk)" "$(mk)" > "$ENVF" )
  NEWCODES=1
fi
chown root:root "$ENVF"; chmod 600 "$ENVF"
cat > $R/etc/systemd/system/smokebox-beta.service <<UNIT
[Unit]
Description=Smokebox beta hub (connected build)
After=network.target

[Service]
User=smokebox-beta
EnvironmentFile=$ENVF
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=SMOKEBOX_TZ=$TZNAME
Environment=SMOKEBOX_DATA=$DATA/state.json
WorkingDirectory=$PREFIX
ExecStart=/usr/bin/node $PREFIX/server/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
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
systemctl enable smokebox-beta >/dev/null 2>&1
systemctl restart smokebox-beta
ok=0; for _ in $(seq 1 20); do curl -fsS --max-time 3 "http://127.0.0.1:$PORT/" -o /dev/null 2>/dev/null && { ok=1; break; }; sleep 1; done
[ "$ok" -eq 1 ] || { systemctl stop smokebox-beta; die "the beta hub did not answer on port $PORT (journalctl -u smokebox-beta); it is stopped, the real Smokebox was not touched."; }

# 4. Caddy: a second site block in its own file, pulled in by one import line. Checked before it is used; undone if Caddy refuses it.
cat > "$BETACADDY" <<CADDY
${BETA_HOST} {
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
${AUTH}
	}
	reverse_proxy 127.0.0.1:${PORT} {
		flush_interval -1
	}
}
CADDY
cp -p "$CADDYFILE" "$CADDYFILE.before-beta"
grep -qF "import $BETACADDY" "$CADDYFILE" || printf '\nimport %s\n' "$BETACADDY" >> "$CADDYFILE"
if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
else
  cp -p "$CADDYFILE.before-beta" "$CADDYFILE"; rm -f "$BETACADDY"
  die "Caddy did not accept the beta site block; its file was put back. The beta hub runs on 127.0.0.1:$PORT only. The real site was not changed."
fi

# 5. Nightly update from the same branch, through the real updater with the beta's own paths. It never touches the real instance.
cat > $R/usr/local/bin/smokebox-beta-systemctl <<'CTL'
#!/bin/sh
# The updater calls "systemctl restart smokebox"; for the beta that means the beta service.
exec systemctl "$1" smokebox-beta
CTL
cat > $R/usr/local/bin/smokebox-beta-update <<UPD
#!/bin/sh
[ -x $R/usr/local/bin/smokebox-update ] || { echo "smokebox-beta-update: the real updater is missing"; exit 1; }
export SMOKEBOX_PREFIX=$PREFIX SMOKEBOX_UPDATE_URL=$URL SMOKEBOX_SYSTEMCTL=$R/usr/local/bin/smokebox-beta-systemctl
export SMOKEBOX_DATA_FILE=$DATA/state.json SMOKEBOX_HEALTH_URL=http://127.0.0.1:$PORT/ SMOKEBOX_LOCK=$R/run/lock/smokebox-beta-update.lock SMOKEBOX_SELF_DEST=$R/run/smokebox-beta-update.unused
exec $R/usr/local/bin/smokebox-update
UPD
chmod 755 $R/usr/local/bin/smokebox-beta-systemctl $R/usr/local/bin/smokebox-beta-update
cat > $R/etc/systemd/system/smokebox-beta-update.service <<EOF
[Unit]
Description=Update Smokebox beta from GitHub
[Service]
Type=oneshot
ExecStart=$R/usr/local/bin/smokebox-beta-update
EOF
cat > $R/etc/systemd/system/smokebox-beta-update.timer <<EOF
[Unit]
Description=Nightly Smokebox beta update
[Timer]
OnCalendar=*-*-* 04:50:00 $TZNAME
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now smokebox-beta-update.timer >/dev/null 2>&1

# 6. What to do next.
FC="$(sed -n 's/^SMOKEBOX_FOLLOW_CODE=//p' "$ENVF")"; WC="$(sed -n 's/^SMOKEBOX_WRITE_CODE=//p' "$ENVF")"
echo
echo "The beta is running next to the real Smokebox (which was not touched)."
echo "  Writing tablet:   https://${BETA_HOST}/?hub&code=${WC}"
echo "  Watching screen:  https://${BETA_HOST}/?follow&code=${FC}"
if [ "$NEWCODES" -eq 1 ]; then echo "  These codes are shown now; they are also in $ENVF (root only). Do not share them."; else echo "  (codes unchanged from the earlier install; see $ENVF)"; fi
echo "  Sign in with the same login as the real site. Beta data: $DATA (separate; the real data is never used)."
echo "  Status: systemctl status smokebox-beta    Logs: journalctl -u smokebox-beta -f    Update now: systemctl start smokebox-beta-update"
echo "  Remove everything: bash beta-remove.sh"
