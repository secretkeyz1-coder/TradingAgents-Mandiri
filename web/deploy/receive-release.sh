#!/bin/sh
# The deploy key's only command. In the VPS user's ~/.ssh/authorized_keys:
#   command="/usr/local/bin/tradingagents-deploy",restrict ssh-ed25519 AAAA... deploy@github-actions
# It reads a release (a gzipped git archive of the repository) on stdin, unpacks
# it beside the running one in ~/tradingagents/releases, and hands over to that
# release's own deploy.sh, so the deploy steps always come with the code they
# deploy. The commit id arrives as the SSH command; only its hex digits are kept.
#
# deploy.sh runs in a session of its own and writes to <release>/deploy.log, which
# streams back while the connection lasts. A dropped connection or a cancelled job
# therefore cannot stop a deploy halfway (after the old app has stopped and before
# the new one runs, say): it finishes or rolls back, and its exit status comes back
# whenever the connection holds. A lock keeps a second deploy out until then.
#
# Install once, from a checkout or a release:
#   sudo install -m 0755 web/deploy/receive-release.sh /usr/local/bin/tradingagents-deploy
# By hand, from a checkout on a machine with ordinary SSH access:
#   git -c core.autocrlf=false archive --format=tar.gz HEAD | ssh <user>@<host> /usr/local/bin/tradingagents-deploy "$(git rev-parse HEAD)"
set -eu

BASE="$HOME/tradingagents"
LOCK="$BASE/.deploy.lock"
REV=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-${1:-}}" | tr -cd '0-9a-f' | cut -c1-12)
DIR="$BASE/releases/$(date +%Y%m%d-%H%M%S)-${REV:-manual}"

if ! flock -n "$LOCK" true; then
  echo "$(date -Is) deploy: another deploy holds $LOCK; its log is the newest $BASE/releases/*/deploy.log" >&2
  exit 1
fi

mkdir -p "$DIR"
trap 'rm -rf "$DIR"' EXIT
tar -xzf - -C "$DIR"
printf '%s\n' "${REV:-manual}" > "$DIR/REVISION"
trap - EXIT

LOG="$DIR/deploy.log"
: > "$LOG"
# flock holds the lock until deploy.sh exits; 75 means another deploy took it after the check above.
setsid -w flock -n -E 75 "$LOCK" sudo sh "$DIR/web/deploy/deploy.sh" "$DIR" "$BASE" < /dev/null > "$LOG" 2>&1 &
pid=$!
tail -n +1 -f --pid="$pid" "$LOG" || true
status=0
wait "$pid" || status=$?
if [ "$status" -eq 75 ]; then
  rm -rf "$DIR"
  echo "$(date -Is) deploy: another deploy started at the same moment; nothing changed" >&2
fi
exit "$status"
