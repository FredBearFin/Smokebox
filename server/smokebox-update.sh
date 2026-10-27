#!/usr/bin/env bash
# Nightly updater for the Smokebox server. Installed by go.sh as /usr/local/bin/smokebox-update and run by smokebox-update.timer.
# It downloads the latest deploy build, checks it, swaps it in, restarts the service and, if the new build does not answer, puts the old one back.
# Saved data is never deleted: a copy is taken before the swap, and a rollback puts that copy back (keeping whatever the new build wrote beside it),
# because the old build cannot start on a file a newer build rewrote or set aside. Every path and command can be replaced through SMOKEBOX_* variables
# so the steps can be tested.
set -euo pipefail

PREFIX="${SMOKEBOX_PREFIX:-/opt/smokebox}"
REPO_ARCHIVE="https://github.com/FredBearFin/SmokeBoxKDS/archive"
REF="${SMOKEBOX_UPDATE_REF:-}"                  # a tag or a full commit id to stay on, instead of following the moving deploy branch
PUBKEY="${SMOKEBOX_PUBKEY:-/etc/smokebox/update-pubkey}"   # if this file exists the build must carry a signature made with its private key
SYSTEMCTL="${SMOKEBOX_SYSTEMCTL:-systemctl}"
HEALTH_URL="${SMOKEBOX_HEALTH_URL:-http://127.0.0.1:8787/health}"   # /health also says when the saved file had to be set aside
# The hub's saved file (SMOKEBOX_DATA in the service). WATCH OUT: the default applies only to the real instance (no SMOKEBOX_PREFIX); another
# instance (the beta) must name its own file, or none is copied, so a rollback there can never put back the real kitchen's file.
DATA="${SMOKEBOX_DATA_FILE:-}"
if [ -z "$DATA" ] && [ -z "${SMOKEBOX_PREFIX:-}" ]; then DATA=/var/lib/smokebox/state.json; fi
SELF_DEST="${SMOKEBOX_SELF_DEST:-/usr/local/bin/smokebox-update}"
LOCK="${SMOKEBOX_LOCK:-/run/lock/smokebox-update.lock}"
MIN_BYTES="${SMOKEBOX_MIN_BYTES:-100000}"     # the built page alone is over a megabyte; anything tiny is an error page
HEALTH_TRIES="${SMOKEBOX_HEALTH_TRIES:-20}"
say() { echo "smokebox-update: $*"; }
fail() { say "$*"; exit 1; }
if [ -n "$REF" ]; then
  case "$REF" in *[!A-Za-z0-9._/-]*|*..*|/*) fail "SMOKEBOX_UPDATE_REF has characters that are not allowed; the running version is kept" ;; esac
  if printf '%s' "$REF" | grep -Eq '^[0-9a-f]{40}$'; then DEFAULT_URL="$REPO_ARCHIVE/$REF.tar.gz"; else DEFAULT_URL="$REPO_ARCHIVE/refs/tags/$REF.tar.gz"; fi
  say "pinned to $REF"
else
  DEFAULT_URL="$REPO_ARCHIVE/refs/heads/deploy.tar.gz"
fi
URL="${SMOKEBOX_UPDATE_URL:-$DEFAULT_URL}"

# One update at a time (the timer and a hand-started run could overlap).
mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || { say "another update is running; nothing to do"; exit 0; }

WORK="$(mktemp -d "${TMPDIR:-/var/tmp}/smokebox-update.XXXXXX")"
NEW="$PREFIX.new"; OLD="$PREFIX.old"
trap 'rm -rf "$WORK" "$NEW"' EXIT

# 1. Download, and make sure it is a real, reasonably large archive.
curl -fsSL --max-time 180 --retry 2 "$URL" -o "$WORK/update.tar.gz" || fail "download failed; the running version is kept"
[ -s "$WORK/update.tar.gz" ] || fail "the download is empty; the running version is kept"
SIZE="$(wc -c < "$WORK/update.tar.gz")"
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "the download is only $SIZE bytes (expected at least $MIN_BYTES); the running version is kept"
gzip -t "$WORK/update.tar.gz" || fail "the download is not a valid gzip file; the running version is kept"

# 2. Refuse archives that could write outside the folder: absolute paths, '..' parts, links of any kind.
# (The listings go to files first: with "grep -q" straight after a pipe, tar can be cut off early and the check silently counted as "no match".)
tar -tzf "$WORK/update.tar.gz" > "$WORK/names.txt" || fail "the archive cannot be read; the running version is kept"
tar -tvzf "$WORK/update.tar.gz" > "$WORK/types.txt" || fail "the archive cannot be read; the running version is kept"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$WORK/names.txt"; then fail "the archive has unsafe paths; the running version is kept"; fi
if grep -Eq '^[^-d]' "$WORK/types.txt"; then fail "the archive contains links, devices or other special files; the running version is kept"; fi

# 3. Unpack beside the live folder and check the pieces the service needs.
rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf "$WORK/update.tar.gz" -C "$NEW" --strip-components=1 --no-same-owner --no-same-permissions
for f in server/server.mjs dist/smokebox.html src/js/20-engine.js; do
  [ -s "$NEW/$f" ] || fail "the new build has no $f; the running version is kept"
done
HTML_BYTES="$(wc -c < "$NEW/dist/smokebox.html")"
[ "$HTML_BYTES" -ge "$MIN_BYTES" ] || fail "the new page is only $HTML_BYTES bytes; the running version is kept"
# Integrity. With a public key installed, the build must carry deploy.manifest (a sha256 line for every file) and deploy.manifest.sig (its signature):
# the signature must verify, every file must match its line and no file may be missing from or extra to the list. Without a key nothing is verified.
if [ -f "$PUBKEY" ]; then
  command -v openssl >/dev/null || fail "openssl is needed to check the signature; the running version is kept"
  [ -s "$NEW/deploy.manifest" ] && [ -s "$NEW/deploy.manifest.sig" ] || fail "the build is not signed (deploy.manifest.sig is missing) and $PUBKEY exists; the running version is kept"
  openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$NEW/deploy.manifest" -sigfile "$NEW/deploy.manifest.sig" >/dev/null 2>&1 || fail "the signature does not match $PUBKEY; the running version is kept"
  ( cd "$NEW" && sha256sum --quiet -c deploy.manifest >/dev/null 2>&1 ) || fail "a file does not match the signed list; the running version is kept"
  LISTED="$(sed -E 's/^[0-9a-f]{64}  //' "$NEW/deploy.manifest" | LC_ALL=C sort)"
  ACTUAL="$(cd "$NEW" && find . -type f ! -name deploy.manifest ! -name deploy.manifest.sig | LC_ALL=C sort)"
  [ "$LISTED" = "$ACTUAL" ] || fail "the build has files that are not on the signed list (or the list names missing files); the running version is kept"
  say "signature OK ($PUBKEY)"
else
  say "WARNING: updates are NOT verified (no $PUBKEY): whoever can write the deploy branch controls this server. See docs/connected-howto.md to turn signing on."
fi
node --check "$NEW/server/server.mjs" || fail "the new server file does not parse; the running version is kept"
if [ "$(id -u)" -eq 0 ]; then chown -R root:root "$NEW"; fi

# 4. Copy the saved file, swap in, restart, and wait for the new build to answer.
SAVED_COPY=""
if [ -n "$DATA" ] && [ -f "$DATA" ]; then SAVED_COPY="$DATA.before-update"; cp -p "$DATA" "$SAVED_COPY" || fail "could not copy $DATA before the update; the running version is kept"; fi
rm -rf "$OLD"
mv "$PREFIX" "$OLD"
mv "$NEW" "$PREFIX"
# Puts the old build back. The service is stopped first (it saves on the way out). Then, if the saved file is no longer the copy taken before the swap
# (the new build rewrote it in a newer format, or set it aside as damaged and started empty), what the new build left is kept as
# <file>.from-new-build-<time> and the copy goes back, so the old build starts on data it can read. Nothing is deleted.
rollback() {
  say "$1; putting the previous version back"
  "$SYSTEMCTL" stop smokebox || true
  rm -rf "$PREFIX"
  mv "$OLD" "$PREFIX"
  if [ -n "$SAVED_COPY" ] && ! cmp -s "$SAVED_COPY" "$DATA"; then
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    if [ -f "$DATA" ]; then mv "$DATA" "$DATA.from-new-build-$STAMP"; say "the file the new build saved is kept as $DATA.from-new-build-$STAMP"; fi
    cp -p "$SAVED_COPY" "$DATA" && say "the saved file from before the update is back in $DATA"
  fi
  "$SYSTEMCTL" restart smokebox || true
  exit 1
}
"$SYSTEMCTL" restart smokebox || rollback "the service would not restart"
# Healthy means it answers AND, when the answer is the hub's /health, the hub did not have to set the saved file aside. A new build that cannot read
# the kitchen's data starts with an empty board and still answers, so without this check it would be kept.
healthy=0
for _ in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS --max-time 3 "$HEALTH_URL" -o "$WORK/health.txt" 2>/dev/null; then
    case "$HEALTH_URL" in */health) ;; *) : > "$WORK/health.txt" ;; esac   # only the hub's /health answer is read; a page is not
    if grep -q '"dataProblem"' "$WORK/health.txt"; then rollback "the new build could not read the saved data: $(head -c 300 "$WORK/health.txt")"; fi
    healthy=1; break
  fi
  sleep 1
done
[ "$healthy" -eq 1 ] || rollback "the new build did not answer at $HEALTH_URL"

# 5. Refresh this script from the new build (atomic), so improvements to the updater arrive too.
if [ -f "$PREFIX/server/smokebox-update.sh" ]; then
  cp "$PREFIX/server/smokebox-update.sh" "$SELF_DEST.new" && chmod 755 "$SELF_DEST.new" && mv "$SELF_DEST.new" "$SELF_DEST" || true
fi
say "updated; the previous version is kept in $OLD"
