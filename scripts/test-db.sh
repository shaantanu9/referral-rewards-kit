#!/usr/bin/env bash
# Runs every migration and SQL test against a throwaway local Postgres with Supabase stubs.
# Usage: scripts/test-db.sh            (Postgres 15+ binaries on PATH, or PGBIN=/path/to/bin)
#        PGTEST_LOCALE=C scripts/test-db.sh   (UTF-8 database with the C locale, the case where `[:space:]` differs)
# Exit 0 only when every migration applies and every test passes. Leaves nothing running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"  # tests read repo files (presets) by path relative to the root
PGBIN="${PGBIN:-$(dirname "$(command -v initdb || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")}"
DATA="$ROOT/.pgtest"
PORT="${PGTEST_PORT:-54329}"
ADMIN=referral_admin
DB=referral_test

rm -rf "$DATA"
"$PGBIN/initdb" -D "$DATA" -A trust -U "$ADMIN" -E UTF8 ${PGTEST_LOCALE:+--locale="$PGTEST_LOCALE"} >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
  -o "-p $PORT -c listen_addresses=localhost -k '' -c fsync=off" start >/dev/null
stop() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap stop EXIT

PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT")
"${PSQL[@]}" -U "$ADMIN" -d postgres -c "create database $DB" >/dev/null
"${PSQL[@]}" -U "$ADMIN" -d "$DB" -f "$ROOT/supabase/tests/stub/supabase_stub.sql" >/dev/null

for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate $(basename "$m")"
  "${PSQL[@]}" -U postgres -d "$DB" -f "$m" >/dev/null
done

passed=0
for t in "$ROOT"/supabase/tests/*.test.sql; do
  echo "test $(basename "$t")"
  out="$("${PSQL[@]}" -U "$ADMIN" -d "$DB" -f "$t" 2>&1)" || { echo "$out" | grep -v '^NOTICE:  ok - ' ; echo "FAILED: $(basename "$t")"; exit 1; }
  n=$(grep -c 'NOTICE:  ok - ' <<<"$out" || true)
  passed=$((passed + n))
  echo "  $n passed"
done
echo "all tests passed: $passed"
