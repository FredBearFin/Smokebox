#!/usr/bin/env bash
# OPTIONAL hardening for a Smokebox server that already ran go.sh. Run as root: bash harden.sh     Undo it with: bash harden-remove.sh
# What it does (and prints each step):
#   1. Turns on Caddy's access log (JSON, /var/log/caddy/access.log, rolled at 10 MB, 3 kept) through one snippet that is imported by the site blocks.
#   2. Installs fail2ban with a jail "caddy-401": an address that gets 8 "401 wrong password" answers within 10 minutes is blocked for 1 hour
#      (ports 80 and 443). Each wrong password costs the small server a bcrypt check, so this stops an anonymous caller from burning its CPU.
#   3. Turns on automatic SECURITY upgrades (no automatic reboot: a restart in the middle of service is your decision).
# What it does NOT do: no firewall rate limit (ufw limit is for ssh, not for a web site), no nftables rules, no change to the app or its data.
# Caddy's file is validated before the reload; if Caddy refuses it, every file is put back and nothing is left half done. Safe to run twice.
# NOT RUN ON A REAL SERVER when this was written: it was tested only against stand-ins (test/harden-scripts.test.mjs). See docs/connected-howto.md.
set -euo pipefail
R="${SMOKEBOX_HARDEN_ROOT:-}"   # empty on a real server; tests point it at a scratch folder
CADDYFILE="$R/etc/caddy/Caddyfile"; BETACADDY="$R/etc/caddy/beta.caddy"; SNIPPET="$R/etc/caddy/harden-log.caddy"
LOGDIR="$R/var/log/caddy"; FILTER="$R/etc/fail2ban/filter.d/caddy-401.conf"; JAIL="$R/etc/fail2ban/jail.d/caddy-401.local"
AUTOUP="$R/etc/apt/apt.conf.d/20auto-upgrades"; MARK="# smokebox-harden"
say() { echo "harden: $*"; }
die() { echo "harden: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Run as root"
[ -f "$CADDYFILE" ] || die "$CADDYFILE is missing: install the server first (go.sh); stopping."
command -v caddy >/dev/null || die "caddy is not installed; stopping."

# 1. Packages. Existing configuration of them is not touched.
export DEBIAN_FRONTEND=noninteractive
say "installing fail2ban and unattended-upgrades"
apt-get install -y fail2ban unattended-upgrades >/dev/null

# 2. The log snippet and the filter/jail.
mkdir -p "$LOGDIR"
if id caddy >/dev/null 2>&1; then chown caddy:caddy "$LOGDIR"; fi
chmod 750 "$LOGDIR"
# The beta's tablet links carry their codes in the address (?code=...), so the "code" part is taken out of every logged address before it is
# written: the log must not keep a copy of them. (Caddy already leaves passwords and cookies out of its log.)
cat > "$SNIPPET" <<'CADDY'
(smokebox_log) {
	log {
		output file /var/log/caddy/access.log {
			mode 0640
			roll_size 10MiB
			roll_keep 3
		}
		format filter {
			wrap json
			fields {
				request>uri query {
					delete code
				}
			}
		}
	}
}
CADDY
mkdir -p "$(dirname "$FILTER")" "$(dirname "$JAIL")"
cat > "$FILTER" <<'F2B'
# Caddy JSON access log: a request answered 401 (wrong or missing password). The address is request.remote_ip.
[Definition]
failregex = ^.*"remote_ip":"<HOST>".*"status":401,.*$
ignoreregex =
datepattern = "ts":{EPOCH}
F2B
cat > "$JAIL" <<'F2B'
[caddy-401]
enabled  = true
filter   = caddy-401
logpath  = /var/log/caddy/access.log
port     = http,https
maxretry = 8
findtime = 10m
bantime  = 1h
ignoreip = 127.0.0.0/8 ::1
F2B

# 3. Caddy: one import line for the snippet, and "import smokebox_log" inside each site block. Everything is saved first and put back if Caddy says no.
BACKUP="$CADDYFILE.before-harden"
[ -f "$BACKUP" ] || cp -p "$CADDYFILE" "$BACKUP"
[ ! -f "$BETACADDY" ] || [ -f "$BETACADDY.before-harden" ] || cp -p "$BETACADDY" "$BETACADDY.before-harden"
# Adds "import smokebox_log" as the first line inside every site block (a line at the left margin that ends in "{", not a snippet and not the global block).
add_import() {
  awk '
    /^[^[:space:]#(}{][^{]*\{[[:space:]]*$/ { print; print "\timport smokebox_log"; next }
    { print }
  ' "$1" > "$1.new"
}
for f in "$CADDYFILE" "$BETACADDY"; do
  [ -f "$f" ] || continue
  if ! grep -q 'import smokebox_log' "$f"; then add_import "$f"; cat "$f.new" > "$f"; rm -f "$f.new"; fi
done
# WATCH OUT: the snippet file is imported at the TOP. Caddy reads the file in order, so a site block that says "import smokebox_log" before the
# snippet is defined is refused ("File to import not found"), and every run would quietly roll itself back.
if ! grep -qF "import ${SNIPPET#"$R"}" "$CADDYFILE"; then
  { printf '%s\nimport %s\n\n' "$MARK" "${SNIPPET#"$R"}"; cat "$CADDYFILE"; } > "$CADDYFILE.new"; cat "$CADDYFILE.new" > "$CADDYFILE"; rm -f "$CADDYFILE.new"
fi
undo_caddy() {
  cp -p "$BACKUP" "$CADDYFILE"; [ ! -f "$BETACADDY.before-harden" ] || cp -p "$BETACADDY.before-harden" "$BETACADDY"
  rm -f "$SNIPPET" "$FILTER" "$JAIL"
}
if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
  say "Caddy now writes $LOGDIR/access.log"
else
  undo_caddy
  die "Caddy did not accept the log settings; its files were put back and the jail and filter were removed. Nothing else was changed."
fi

# 4. Start the jail and the automatic security upgrades.
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban
mkdir -p "$(dirname "$AUTOUP")"
# An existing file that is not ours is kept as .before-harden (harden-remove.sh puts it back).
if [ -f "$AUTOUP" ] && ! grep -q "^$MARK\$" "$AUTOUP" && [ ! -f "$AUTOUP.before-harden" ]; then cp -p "$AUTOUP" "$AUTOUP.before-harden"; fi
cat > "$AUTOUP" <<UP
$MARK
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
UP
say "automatic security upgrades are on (no automatic reboot)"
echo
echo "Done. NOT RUN ON A REAL SERVER when this script was written: check it now, with these three commands:"
echo "  fail2ban-client status caddy-401          (the jail is listed; 'Currently banned' is 0 at first)"
echo "  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile"
echo "  journalctl -u fail2ban -u caddy -n 40 --no-pager     (no errors about the filter or the log file)"
echo "Try it: from another computer, give 8 wrong passwords at the sign-in page; that computer is then blocked for an hour"
echo "(unban: fail2ban-client set caddy-401 unbanip ADDRESS). Traffic that comes in through tunnel.sh arrives from 127.0.0.1 and cannot be banned this way."
echo "Undo everything: bash harden-remove.sh"
