#!/bin/sh
# Restore drill: proves that the newest database backup restores. A throwaway
# Postgres (the live database's image, no port, no volume) takes the newest
# db-*.dump; every table's rows are then counted next to the live database's
# (read only), the newest data-*.tar.gz is read through to the end, and the
# container is removed. A backup that was never restored is only a hope.
# Run on the VPS like backup.sh, by hand or from cron; see web/README.md.
#
#   sudo sh web/deploy/restore-check.sh                  # the newest dump in ~/tradingagents/backups
#   sudo BACKUP_DIR=/srv/backups sh web/deploy/restore-check.sh
#   sudo sh web/deploy/restore-check.sh /path/to/db-<stamp>.dump
#
# Exit status 0 only when the dump restored and holds an admin account.
set -eu

PROJECT=tradingagents
DIR="${BACKUP_DIR:-$HOME/tradingagents/backups}"
LIVE="${DB_CONTAINER:-$PROJECT-db-1}"
NAME="$PROJECT-restore-check"
DUMP="${1:-$(ls -1t "$DIR"/db-*.dump 2>/dev/null | head -n 1)}"
DATA=$(ls -1t "$DIR"/data-*.tar.gz 2>/dev/null | head -n 1)
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "no database dump (db-*.dump) in $DIR" >&2
  exit 1
fi
# The live database's image, so pg_restore reads what its pg_dump wrote; 16 when it is gone.
IMAGE="${IMAGE:-$(docker inspect -f '{{.Config.Image}}' "$LIVE" 2>/dev/null || echo postgres:16-alpine)}"
TMP=$(mktemp -d)
START=$(date +%s)

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" -e POSTGRES_USER=tradingagents -e POSTGRES_PASSWORD=restore-check \
  -e POSTGRES_DB=tradingagents "$IMAGE" >/dev/null
# Over TCP: on its first start the image runs a socket-only server for setup, then restarts.
tries=0
until docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U tradingagents; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "the throwaway Postgres did not start" >&2
    exit 1
  fi
  sleep 1
done

docker exec -i "$NAME" pg_restore -U tradingagents -d tradingagents --exit-on-error < "$DUMP"

# Each table's row count, from one query: a table added later is counted without a change here.
COUNTS="select table_name || '|' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
MIGRATIONS="select 'migrations|' || count(*) from drizzle.__drizzle_migrations"
docker exec "$NAME" psql -U tradingagents -d tradingagents -At -c "$COUNTS" -c "$MIGRATIONS" > "$TMP/backup"
: > "$TMP/live"
if docker exec "$LIVE" true 2>/dev/null; then
  docker exec "$LIVE" psql -U tradingagents -d tradingagents -At -c "$COUNTS" -c "$MIGRATIONS" > "$TMP/live"
fi

echo "restore check: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)) into $IMAGE"
printf '  %-20s %10s %10s\n' table backup live
# Tables made after the backup (a later migration) come last, with "-" for the backup.
awk -F'|' 'FILENAME == ARGV[1] { live[$1] = $2; order[++n] = $1; next }
  { seen[$1] = 1; printf "  %-20s %10s %10s\n", $1, $2, (($1 in live) ? live[$1] : "-") }
  END { for (i = 1; i <= n; i++) if (!(order[i] in seen)) printf "  %-20s %10s %10s\n", order[i], "-", live[order[i]] }' "$TMP/live" "$TMP/backup"

if [ -n "$DATA" ]; then
  tar -tzf "$DATA" > "$TMP/data"
  echo "  data archive: $(basename "$DATA") ($(du -h "$DATA" | cut -f1)), $(wc -l < "$TMP/data") entries, reads to the end"
fi

ADMINS=$(docker exec "$NAME" psql -U tradingagents -d tradingagents -At -c "select count(*) from users where role = 'admin'")
if [ "$ADMINS" -lt 1 ]; then
  echo "$(date -Is) restore check FAILED: the restored database has no admin account" >&2
  exit 1
fi
echo "$(date -Is) restore check ok in $(($(date +%s) - START))s"
