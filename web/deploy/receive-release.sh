#!/bin/sh
# The deploy key's only command. In the VPS user's ~/.ssh/authorized_keys:
#   command="/usr/local/bin/tradingagents-deploy",restrict ssh-ed25519 AAAA... deploy@github-actions
# It reads a release (a gzipped git archive of the repository) on stdin, unpacks
# it beside the running one in ~/tradingagents/releases, and hands over to that
# release's own deploy.sh, so the deploy steps always come with the code they
# deploy. The commit id arrives as the SSH command; only its hex digits are kept.
# Install once, from a checkout or a release:
#   sudo install -m 0755 web/deploy/receive-release.sh /usr/local/bin/tradingagents-deploy
# By hand, from a checkout on a machine with ordinary SSH access:
#   git archive --format=tar.gz HEAD | ssh <user>@<host> /usr/local/bin/tradingagents-deploy "$(git rev-parse HEAD)"
set -eu

BASE="$HOME/tradingagents"
REV=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-${1:-}}" | tr -cd '0-9a-f' | cut -c1-12)
DIR="$BASE/releases/$(date +%Y%m%d-%H%M%S)-${REV:-manual}"

mkdir -p "$DIR"
trap 'rm -rf "$DIR"' EXIT
tar -xzf - -C "$DIR"
printf '%s\n' "${REV:-manual}" > "$DIR/REVISION"
trap - EXIT
exec sudo sh "$DIR/web/deploy/deploy.sh" "$DIR" "$BASE"
