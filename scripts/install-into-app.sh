#!/usr/bin/env bash
# Copy the rewards engine (and optionally the referral kit) into an app's Supabase folder.
# Usage: scripts/install-into-app.sh <app-root> <app-name> [--referral] [--dry-run]
#   <app-root>  the app repo (it has, or will get, supabase/migrations)
#   <app-name>  lower case, used in the config migration's file name: <timestamp>_rewards_<app-name>.sql
#   --referral  also copy the referral kit's migrations and config template (invite friends)
#   --dry-run   print what would be copied, change nothing
# Copies, never overwrites: an existing file with the same name is left alone and reported.
# After it: fill the config migration (every <<...>>), then follow docs/fresh-app-quickstart.md.
set -euo pipefail

KIT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-}"
NAME="${2:-}"
shift 2 || true
REFERRAL=0
DRY=0
for a in "$@"; do
  case "$a" in
    --referral) REFERRAL=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
if [[ -z "$APP" || -z "$NAME" ]]; then
  echo "usage: $0 <app-root> <app-name> [--referral] [--dry-run]" >&2
  exit 2
fi
if [[ ! "$NAME" =~ ^[a-z][a-z0-9_]{1,30}$ ]]; then
  echo "app-name: lower case letters, digits and _ (2-31)" >&2
  exit 2
fi
if [[ ! -d "$APP" ]]; then
  echo "no such folder: $APP" >&2
  exit 2
fi
APP="$(cd "$APP" && pwd)"
if [[ "$APP" == "$KIT" ]]; then
  echo "that is the kit itself; give the app's folder" >&2
  exit 2
fi

copied=0
skipped=0
copy() { # src dst
  local src="$1" dst="$2"
  if [[ -e "$dst" ]]; then
    echo "  keep   ${dst#"$APP"/} (already there)"
    skipped=$((skipped + 1))
    return
  fi
  echo "  copy   ${dst#"$APP"/}"
  copied=$((copied + 1))
  if [[ $DRY -eq 0 ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

MIG="$APP/supabase/migrations"
echo "Into $APP"

if [[ $REFERRAL -eq 1 ]]; then
  echo "Referral kit migrations:"
  for f in "$KIT"/supabase/migrations/2026111[2-4]*_referral_*.sql; do copy "$f" "$MIG/$(basename "$f")"; done
fi

echo "Rewards engine migrations (unchanged, in order):"
for f in "$KIT"/supabase/migrations/*_rewards_*.sql; do copy "$f" "$MIG/$(basename "$f")"; done

# The app's own config runs after every kit migration: a timestamp later than the last one copied.
STAMP="$(date -u +%Y%m%d%H%M%S)"
last="$(ls "$KIT"/supabase/migrations/*.sql | xargs -n1 basename | sort | tail -1 | cut -c1-14)"
if [[ "$STAMP" < "$last" ]]; then STAMP="$((last + 1))"; fi
echo "The app's config (fill every <<...>>):"
config() { # template kind stamp: one config per app and kind, whatever its timestamp
  local existing
  existing="$(ls "$MIG"/*_"$2"_"$NAME".sql 2>/dev/null | head -1 || true)"
  if [[ -n "$existing" ]]; then
    echo "  keep   ${existing#"$APP"/} (the app's config is already there)"
    skipped=$((skipped + 1))
  else
    copy "$1" "$MIG/${3}_${2}_${NAME}.sql"
  fi
}
config "$KIT/supabase/app-config/rewards-template.sql" rewards "$STAMP"
if [[ $REFERRAL -eq 1 ]]; then
  config "$KIT/supabase/app-config/template.sql" referral "$((STAMP + 1))"
fi

echo "Edge Functions (rewards imports the referral function's RevenueCat code, so both are copied):"
for fn in rewards referral; do
  for f in "$KIT"/supabase/functions/"$fn"/*.ts "$KIT"/supabase/functions/"$fn"/deno.json; do
    [[ "$(basename "$f")" == *_test.ts || "$(basename "$f")" == test_* || "$(basename "$f")" == integration_story.ts ]] && continue
    copy "$f" "$APP/supabase/functions/$fn/$(basename "$f")"
  done
done
# the rewards function's own code imports these two test helpers' types nowhere; tests stay in the kit.

echo "Presets for the admin page's Copy setup:"
for f in "$KIT"/supabase/app-config/presets/*.json; do copy "$f" "$APP/supabase/rewards-presets/$(basename "$f")"; done

echo
echo "$copied to copy, $skipped already there$([[ $DRY -eq 1 ]] && echo ' (dry run: nothing changed)')."
echo "Next: docs/fresh-app-quickstart.md in the kit (fill the config, apply in a rolled-back transaction first, deploy, admin page)."
