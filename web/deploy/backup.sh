#!/bin/sh
# Backup of the deployed app: the Postgres database (analyses, backtests, agent
# sessions, memories, skills, drawings) and the engine's data volume (reports,
# decision memory, cache). Run on the VPS from cron; see web/README.md.
#
#   sh web/deploy/backup.sh            # backups in ~/tradingagents/backups
#   BACKUP_DIR=/srv/backups KEEP_DAYS=30 sh web/deploy/backup.sh
#
# Restore the database (the app stopped first):
#   docker exec -i tradingagents-db-1 pg_restore -U tradingagents -d tradingagents --clean --if-exists < db-<stamp>.dump
set -eu

PROJECT=tradingagents
DIR="${BACKUP_DIR:-$HOME/tradingagents/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$DIR"
chmod 700 "$DIR"

# Custom format: compressed, and pg_restore can pick tables from it.
docker exec "$PROJECT-db-1" pg_dump -U tradingagents -Fc tradingagents > "$DIR/db-$STAMP.dump.part"
mv "$DIR/db-$STAMP.dump.part" "$DIR/db-$STAMP.dump"

# The data volume, read-only, through the Postgres image already on the host.
docker run --rm -v "${PROJECT}_data:/data:ro" -v "$DIR:/out" postgres:16-alpine \
  tar -czf "/out/data-$STAMP.tar.gz.part" -C /data .
mv "$DIR/data-$STAMP.tar.gz.part" "$DIR/data-$STAMP.tar.gz"

find "$DIR" -maxdepth 1 \( -name 'db-*.dump' -o -name 'data-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
find "$DIR" -maxdepth 1 -name '*.part' -mmin +60 -delete

echo "$(date -Is) backup ok: db-$STAMP.dump ($(du -h "$DIR/db-$STAMP.dump" | cut -f1)), data-$STAMP.tar.gz ($(du -h "$DIR/data-$STAMP.tar.gz" | cut -f1))"
