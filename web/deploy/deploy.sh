#!/bin/sh
# Deploys one release on the VPS: a directory holding the repository at one commit
# (an unpacked git archive) becomes the running app, or the running app stays as
# it was. receive-release.sh (the CI deploy key's only command) unpacks a release
# and calls this; by hand:
#   sudo sh <release>/web/deploy/deploy.sh <release> [<base, default ~/tradingagents>]
#
# 1. Carry .env over from the running release; tag the running image :previous.
# 2. Build the new image and `docker compose up -d`: the migrate service runs
#    first, and the app and the worker are replaced only after it succeeds.
# 3. Wait for the app to answer /healthz and for the worker to run.
# A failed step brings the previous image and release back. On success <base>/src
# points at the new release (the first deploy keeps a plain src directory as a
# release), the newest KEEP_RELEASES (3) stay, and this project's unused images go.
set -eu

NEW=$(cd "$1" && pwd)
BASE=$(cd "${2:-$HOME/tradingagents}" && pwd)
KEEP="${KEEP_RELEASES:-3}"
IMAGE=tradingagents-web
CURRENT=$(readlink -f "$BASE/src")
say() { echo "$(date -Is) deploy: $*"; }

if [ "$NEW" = "$CURRENT" ]; then
  say "this release is already the running one"
  exit 1
fi
if [ ! -f "$CURRENT/web/deploy/.env" ]; then
  say "no .env in the running release ($CURRENT/web/deploy)"
  exit 1
fi
cp -p "$CURRENT/web/deploy/.env" "$NEW/web/deploy/.env"
PORT=$(sed -n 's/^APP_PORT=//p' "$NEW/web/deploy/.env" | tail -n 1)
PORT=${PORT:-8410}

rollback() {
  say "FAILED: $1; bringing the previous release back"
  if docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
    docker tag "$IMAGE:previous" "$IMAGE:latest"
    (cd "$CURRENT/web/deploy" && docker compose up -d --no-build) || say "the previous release did not start either: see docker compose ps"
  fi
  exit 1
}

if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE:latest" "$IMAGE:previous"
fi

cd "$NEW/web/deploy"
say "building $(cat "$NEW/REVISION" 2>/dev/null || basename "$NEW")"
docker compose build || rollback "the image did not build"
# The running app keeps serving until the migrate service has succeeded.
docker compose up -d || rollback "a migration or the new containers failed (docker compose logs migrate)"

tries=0
until curl -fsS -m 5 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || rollback "the app did not answer /healthz within 3 minutes"
  sleep 3
done
[ -n "$(docker compose ps -q --status running worker)" ] || rollback "the worker is not running"

mkdir -p "$BASE/releases"
if [ ! -L "$BASE/src" ]; then
  mv "$BASE/src" "$BASE/releases/$(date +%Y%m%d-%H%M%S)-before-releases"
fi
ln -sfn "$NEW" "$BASE/src"

# The newest KEEP releases stay, the running one always.
ls -1dt "$BASE"/releases/*/ | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$(readlink -f "$old")" = "$NEW" ] || rm -rf "$old"
done
docker image prune -f --filter "label=org.opencontainers.image.title=$IMAGE" >/dev/null
say "ok: $(cat "$NEW/REVISION" 2>/dev/null || basename "$NEW") runs on port $PORT"
