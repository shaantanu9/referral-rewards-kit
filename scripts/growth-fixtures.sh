#!/usr/bin/env bash
# Writes the real JSON of the growth RPCs (migration 23) to packages/referral_kit/test/fixtures/growth/<name>.json, so
# the Flutter models are tested against what the SQL returns. Runs every migration on a throwaway local Postgres (its
# own data folder and port, so it never touches scripts/test-db.sh's .pgtest), then
# supabase/tests/fixtures/growth_fixtures.sql. Timestamps and ids change on every run; shapes do not.
# Usage: scripts/growth-fixtures.sh   (Postgres 15+ binaries on PATH, or PGBIN=/path/to/bin; port GROWTH_FIXTURES_PORT)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb || echo /opt/homebrew/opt/postgresql@17/bin/initdb)")}"
DATA="$(mktemp -d)"
PORT="${GROWTH_FIXTURES_PORT:-54339}"
OUT="$ROOT/packages/referral_kit/test/fixtures/growth"

"$PGBIN/initdb" -D "$DATA" -A trust -U referral_admin -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
  -o "-p $PORT -c listen_addresses=localhost -k '' -c fsync=off" start >/dev/null
stop() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap stop EXIT

PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT")
"${PSQL[@]}" -U referral_admin -d postgres -c "create database referral_test" >/dev/null
"${PSQL[@]}" -U referral_admin -d referral_test -f supabase/tests/stub/supabase_stub.sql >/dev/null
for m in supabase/migrations/*.sql; do
  "${PSQL[@]}" -U postgres -d referral_test -f "$m" >/dev/null
done

mkdir -p "$OUT"
"${PSQL[@]}" -U referral_admin -d referral_test -f supabase/tests/fixtures/growth_fixtures.sql \
  | python3 -c '
import json, sys
out = sys.argv[1]
n = 0
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line:
        continue
    name, text = line.split("\t", 1)
    with open(f"{out}/{name}.json", "w") as f:
        json.dump(json.loads(text), f, indent=2, ensure_ascii=False)
        f.write("\n")
    n += 1
print(f"wrote {n} fixtures to {out}")
' "$OUT"
