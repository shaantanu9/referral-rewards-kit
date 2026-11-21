# Fresh app quick start: rewards (and invites) in a new Flutter + Supabase app

Updated: 2026-11-14
The short path from an empty app to rewards working, in order, with every command ready to paste. Details and
gotchas: [rewards integration](rewards-integration.md) · API: [rewards-api.md](rewards-api.md) · design:
[ADR 0002](adr/0002-rewards-engine.md) · invites: [integration.md](integration.md).

Repo: `https://github.com/shaantanu9/referral-rewards-kit`. Packages on pub.dev: `flutter pub add referral_kit rewards_kit` (git tags `referral_kit-v0.5.0`, `rewards_kit-v0.7.0` also work).

## 0. What you get, and what to switch on

Streaks, a daily quiz, milestones (incl. "pass 10 quizzes", "invite 3 friends"), quests, friend streaks, comebacks,
recharging hearts, Happy Hour windows, timed offers, Instagram tag rewards, mystery and surprise rewards with shown
odds, rewarded ads through RevenueCat; an admin page; every reward paid exactly once. Turn on only what the app needs.

## 1. Copy the server parts into the app (one command)

```bash
cd ~/Documents/GitHub/referral-kit
scripts/install-into-app.sh ~/Documents/GitHub/<your-app> <app_name>              # rewards only
scripts/install-into-app.sh ~/Documents/GitHub/<your-app> <app_name> --referral   # + invite friends
```

It copies the migrations (unchanged), one config migration `<timestamp>_rewards_<app_name>.sql` to fill in, the Edge
Functions `rewards` (+ `referral`, whose RevenueCat code it imports) and the presets. It never overwrites a file;
`--dry-run` shows what it would do.

## 2. Fill the config migration

Open `supabase/migrations/<timestamp>_rewards_<app_name>.sql` and replace every `<<...>>`:

| Part | What to write |
|---|---|
| Event types | What counts (`chapter_finished`, `quiz_finished`…); `server` unless the phone may send it |
| Grant hook | `rewards_app.app_reward_grant`: pay your kinds (coins, minutes) with `'rewards:' \|\| grant_id` as the idempotency key |
| Triggers | On the app's own tables (quiz attempts, reading progress) with `rewards.event_from_row(...)` |
| Paid users | Optional: `rewards_app.app_is_paid(user_id)` for rules with `audience` |
| Deletion | The `rewards_delete_user` trigger on `auth.users` (in the template) |
| First admin | `insert into rewards.admins (user_id) values ('<your auth user id>');` |

Programs and rules can be left out here: import a preset in step 5 instead.

## 3. Apply (with the owner's go-ahead: it changes the project)

```bash
cd ~/Documents/GitHub/<your-app>
supabase link --project-ref <ref>
supabase db push --dry-run      # read the list
supabase db push
```

Then check nothing is exposed (expect no rows):

```sql
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('rewards', 'rewards_app') and has_function_privilege('authenticated', p.oid, 'EXECUTE');
```

## 4. Edge Function (only for Premium days, RevenueCat currency, Instagram, or ads)

```bash
supabase secrets set REWARDS_WORKER_SECRET=<random> REVENUECAT_SECRET_KEY=<sk_…> REVENUECAT_PROJECT_ID=<proj…> \
  REWARDS_RC_WEBHOOK_TOKEN=<random>
supabase functions deploy rewards --no-verify-jwt
```

Schedule `/rewards/worker` every 15 min (snippet at the end of the config template). Ads, purchases as events and
Instagram: [rewards-integration.md §6, §10](rewards-integration.md).

## 5. Admin page and a preset

```bash
cd ~/Documents/GitHub/referral-kit/web/rewards-admin
deno run --allow-net=127.0.0.1:8080 --allow-read=. jsr:@std/http@1.1.4/file-server --host 127.0.0.1 --port 8080 .
```

Open `http://127.0.0.1:8080`, enter the project URL + anon key, sign in with the email code (step 2's admin). Copy
setup → choose `supabase/rewards-presets/reader.json` (or `quiz.json`, `habit.json`) → Check → Apply. Rename reward
kinds to your own in the file first if they differ. New programs from a file keep their on/off state; check Programs.

## 6. Flutter

```yaml
# pubspec.yaml
dependencies:
  rewards_kit:
    git:
      url: https://github.com/shaantanu9/referral-rewards-kit.git
      ref: rewards_kit-v0.7.0
      path: packages/rewards_kit
```

```dart
final rewards = RewardsController(
  client: RewardsClient(
    rpc: (fn, params) => Supabase.instance.client.rpc(fn, params: params),
    timezone: () async => (await FlutterTimezone.getLocalTimezone()).identifier, // IANA name (flutter_timezone 5.x)
    onEvent: (e) => analytics.log(e.name.wire, e.props),
  ),
);

// Around the main screen: toasts, and the reveal for surprise / mystery rewards.
RewardToastListener(controller: rewards, child: const HomeScreen());

// A rewards screen in one line (or each widget with your own builder):
RewardsHub(controller: rewards, onOpenInstagram: openInstagram);
```

After an action the app tracks itself (when no trigger does it): `await rewards.track('lesson_opened', dedupeKey: 'lesson:$id');`

Ads: copy `examples/rewards_ads_check/lib/revenuecat_rewarded_ad.dart`, `Purchases.logIn(supabaseUserId)`, then
`RewardedAdButton(controller: rewards, label: 'Watch an ad', onShowAd: RevenueCatRewardedAd(adUnitId: …).show)`.

## 6b. Follow-ups (bring people back)

```dart
final followups = FollowupScheduler(controller: rewards, notifier: MyLocalNotifier()); // wraps your plugin
followups.start();   // after sign-in
followups.stop();    // on sign-out
// in the notification tap handler:
rewards.followupOpened(program);
```

Import `presets/retention.json` on the admin page for the standard schedule; emails stay off until you switch them on
([rewards-integration.md §12](rewards-integration.md)).

## 7. Prove it on a phone

| Check | How |
|---|---|
| An event counts | Finish a quiz → admin page Users → the user's id → Events |
| A reward lands | The toast or reveal shows; the app's balance changes once |
| Timers are real | Change the phone's clock: countdowns do not move |
| Ads | Run `examples/rewards_ads_check` first ([README](../examples/rewards_ads_check/README.md)) |
| Follow-ups | Admin page → Follow-ups → a user's planned notifications; practise, and the comeback nudge moves out |
| Deletion | Delete a test account: Users lookup shows nothing for it |

## Updating later

New kit migrations get new timestamps: run `install-into-app.sh` again (it only copies what is missing), then
`supabase db push`. Bump the package `ref` to the new tag.
