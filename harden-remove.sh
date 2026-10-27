#!/usr/bin/env bash
# Undoes harden.sh: removes the Caddy access-log settings, the fail2ban jail and filter and the automatic-upgrade file that harden.sh wrote, then reloads
# Caddy (after validating it). The packages fail2ban and unattended-upgrades stay installed (remove them with: apt-get remove fail2ban unattended-upgrades).
# The old log files stay in /var/log/caddy. Run as root: bash harden-remove.sh     NOT RUN ON A REAL SERVER when written (test/harden-scripts.test.mjs only).
set -euo pipefail
R="${SMOKEBOX_HARDEN_ROOT:-}"
CADDYFILE="$R/etc/caddy/Caddyfile"; BETACADDY="$R/etc/caddy/beta.caddy"; SNIPPET="$R/etc/caddy/harden-log.caddy"
FILTER="$R/etc/fail2ban/filter.d/caddy-401.conf"; JAIL="$R/etc/fail2ban/jail.d/caddy-401.local"; AUTOUP="$R/etc/apt/apt.conf.d/20auto-upgrades"
say() { echo "harden-remove: $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
# Takes out the import lines that harden.sh added (the snippet import, its marker line, and "import smokebox_log" in the site blocks).
strip() {
  [ -f "$1" ] || return 0
  awk '
    NR == 1 && /^# smokebox-harden$/ { lead = 1; next }                                  # harden.sh puts marker, import and one blank line at the top
    lead == 1 && /^import \/etc\/caddy\/harden-log\.caddy$/ { lead = 2; next }
    lead == 2 && /^$/ { lead = 0; next }
    { lead = 0 }
    /^[[:space:]]*import smokebox_log[[:space:]]*$/ { next }
    /^import \/etc\/caddy\/harden-log\.caddy$/ { next }
    /^# smokebox-harden$/ { held = 0; next }           # the blank line harden.sh put before its marker goes too
    { if (held) print ""; held = 0; if ($0 == "") { held = 1; next } print }
    END { if (held) print "" }
  ' "$1" > "$1.new"; cat "$1.new" > "$1"; rm -f "$1.new"
}
cp -p "$CADDYFILE" "$CADDYFILE.before-harden-remove" 2>/dev/null || true
strip "$CADDYFILE"; strip "$BETACADDY"
rm -f "$SNIPPET" "$CADDYFILE.before-harden" "$BETACADDY.before-harden"
if command -v caddy >/dev/null && caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy; say "Caddy no longer writes the access log"
else say "Caddy would not accept $CADDYFILE; the copy from before this run is $CADDYFILE.before-harden-remove (nothing was reloaded)"; fi
rm -f "$FILTER" "$JAIL"
systemctl restart fail2ban >/dev/null 2>&1 || true
if [ -f "$AUTOUP" ] && grep -q '^# smokebox-harden$' "$AUTOUP"; then
  if [ -f "$AUTOUP.before-harden" ]; then cat "$AUTOUP.before-harden" > "$AUTOUP"; rm -f "$AUTOUP.before-harden"; say "the earlier automatic-upgrades settings were put back"; else rm -f "$AUTOUP"; say "automatic upgrades file removed"; fi
fi
say "done (fail2ban and unattended-upgrades stay installed)"
