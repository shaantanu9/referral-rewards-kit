# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you open a pull request

1. Open an issue first for anything bigger than a small fix, so the approach can be agreed.
2. One change per pull request, with tests for it.
3. Run the checks for the parts you touched:

| Part | Command |
|---|---|
| Database | `scripts/test-db.sh` (Postgres 15+ on PATH, or `PGBIN=...`) |
| Referral function | `deno test supabase/functions/referral` and `scripts/test-function.sh` |
| Rewards function | `deno test supabase/functions/rewards` and `scripts/test-rewards-function.sh` |
| Flutter packages | `flutter analyze && flutter test` in `packages/referral_kit` or `packages/rewards_kit` |
| Invite page | `deno test --allow-read=. web/invite` from the repo root |
| Admin page | `deno test --allow-read=. web/rewards-admin` from the repo root |

CI (`.github/workflows/ci.yml`) runs all of them, plus a secret scan.

## Rules the code follows

- Every reward is granted exactly once: grant keys always hold the user id, and a new path gets a test proving a
  replay grants nothing.
- Database functions are `security definer` with `search_path = ''`, and every new RPC gets a privilege test.
- New migrations go at the end with the next number. A migration that has been released is never edited.
- No fake urgency: deadlines and stock are real server values.
- Never commit real keys. Use `.env.example` with blank values.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
