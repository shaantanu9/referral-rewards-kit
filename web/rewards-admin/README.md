# Rewards admin page

Updated: 2026-11-19\
The dashboard for the rewards engine: overview, programs and rules, quiz bank, user lookup, Instagram review, failed
rewards, settings (incl. the ads switch), copy a setup between apps, audit log. Static files, no build step, on the
admin API ([rewards-api.md §2–7](../../docs/rewards-api.md)).

Status: **tested locally in demo mode (22 Deno tests; Referrals section clicked through 2026-11-19; every section and action clicked through in Chromium at desktop
and phone width, no console errors); never run against a live project.**

## Try it now (no project)

```bash
cd web/rewards-admin
deno run --allow-net=127.0.0.1:8080 --allow-read=. jsr:@std/http@1.1.4/file-server --host 127.0.0.1 --port 8080 .
# open http://127.0.0.1:8080/?demo   (fake data, in this tab only)
```

Use Deno's file server (or any normal static host). Python's `http.server` dropped some of the parallel module loads on
a busy machine during testing.

## Use it on a project

1. Host the folder anywhere static (any CDN, Supabase Storage public bucket, Netlify, a local server). Keep it out of
   search engines (the page already says `noindex`). If the host can set headers, add
   `Content-Security-Policy: frame-ancestors 'none'` (a meta tag cannot) and `X-Content-Type-Options: nosniff`.
2. Make the first admin, once, in the SQL editor: `insert into rewards.admins (user_id) values ('<your auth user id>');`
   More admins later from the API (`rewards_admin_set_admin`).
   The Referrals section uses the same list: referral kit migration 21 reads `rewards.admins` through the hook
   `referral_app.app_referral_is_admin` (replace it in an app without the rewards kit). It shows people's emails, so
   only add accounts that may see them.
3. Open the page, enter the project URL and the **anon / publishable** key (the page refuses a service-role or secret
   key), sign in with the email code. Only accounts in `rewards.admins` get past the sign-in; every admin function
   checks that itself, so the public key alone opens nothing.

## Sections

| Section    | Calls                                                                                    | Notes                                                                |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Overview   | `rewards_admin_analytics`                                                                | 7 / 30 / 90 days; counts only                                        |
| Referrals  | `referral_admin_overview`, `_referrals`, `_user`, `_rewards`, `_retry_reward`, `_check_activation`, `_log` | Referral kit migration 21. Every referral with both people's emails, states, dates and rewards; search by email, id or code; a person's page; failing rewards with Retry now |
| Programs   | `rewards_admin_config`, `save_program`, `add_rule`, `set_rule_active`, `save_event_type` | New programs start switched off; rules are added, never edited       |
| Quiz bank  | `rewards_admin_quiz_list`, `quiz_save`, `quiz_stats`                                     | Add one, edit, hide, paste many as CSV; hardest questions            |
| Users      | `rewards_admin_user`, `rewards_admin_track`, `rewards_admin_grant`                       | Test events; give a reward (note goes to the audit log)              |
| Leagues    | `rewards_admin_leagues`, `rewards_admin_league_close`                                    | Members by tier and each recent week in counts; close ended weeks now |
| Instagram  | `rewards_admin_social_queue`, `review_social`                                            | Only real instagram.com post links are clickable                     |
| Problems   | `rewards_admin_grants`, `retry_grant`                                                    | Retrying never pays twice                                            |
| Settings   | `rewards_admin_save_settings`                                                            | Master switch, ads switch, sandbox, caps                             |
| Copy setup | `rewards_admin_export`, `rewards_admin_import`                                           | Dry run first, then apply; presets in `supabase/app-config/presets/` |
| Audit log  | `rewards_admin_log`                                                                      | Who changed what                                                     |

## Files

`index.html` (shell, theme tokens, light and dark) · `app.js` (project, sign-in, routing) · `api.js` (supabase-js 2.45.4
from jsDelivr, or the demo) · `demo.js` (in-memory admin API) · `dom.js` (text-only DOM helpers) · `lib.js` (pure
helpers) · `view_*.js` (sections) · `lib_test.js` (`deno test --allow-read=. web/rewards-admin/` from the repo root).

## Security notes

- All text from the database (handles, links, quiz prompts, errors) is inserted as text, never as HTML.
- The Content-Security-Policy allows scripts only from the page and jsDelivr, connections only to `*.supabase.co` (and
  localhost for a local Supabase).
- The session is kept in this browser's local storage under `rewards-admin.auth`; Sign out clears it.
