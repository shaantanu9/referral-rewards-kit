#!/usr/bin/env bash
# Runs the rewards Edge Function's tests: the unit tests (no permissions, no network), then the integration story
# against a throwaway local Postgres with the Supabase stub and every migration (same setup as scripts/test-db.sh).
# Usage: scripts/test-rewards-function.sh   (deno on PATH; Postgres 15+ binaries on PATH, or PGBIN=/path/to/bin)
# Exit 0 only when everything passes. Leaves nothing running and nothing on disk.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FN="$ROOT/supabase/functions/rewards"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")}"
DATA="$ROOT/.pgtest-rewards-fn"
PORT="${PGTEST_REWARDS_FN_PORT:-54331}"
ADMIN=referral_admin
DB=referral_test

echo "unit tests"
deno test --no-prompt "$FN/"

rm -rf "$DATA"
"$PGBIN/initdb" -D "$DATA" -A trust -U "$ADMIN" -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
  -o "-p $PORT -c listen_addresses=localhost -k '' -c fsync=off" start >/dev/null
stop() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap stop EXIT

PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT")
"${PSQL[@]}" -U "$ADMIN" -d postgres -c "create database $DB" >/dev/null
"${PSQL[@]}" -U "$ADMIN" -d "$DB" -f "$ROOT/supabase/tests/stub/supabase_stub.sql" >/dev/null
for m in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -U postgres -d "$DB" -f "$m" >/dev/null
done

echo "integration story"
PGBIN="$PGBIN" PGTEST_PORT="$PORT" deno test --no-prompt --allow-run --allow-env=PGBIN,PGTEST_PORT \
  "$FN/integration_story.ts"
