# Rewards ads check

Updated: 2026-11-14
A small app that proves the whole rewarded-ad flow on a real phone: sign in to your Supabase project, link
RevenueCat to that user, watch a RevenueCat-verified rewarded ad, and see the rewards engine count it (`ad_watched`).
Design: [ADR 0002 §18.5](../../docs/adr/0002-rewards-engine.md) · setup: [rewards integration §10](../../docs/rewards-integration.md).

Status: **compiles (Android debug APK built, `flutter analyze` clean, 3 tests); never run against live RevenueCat, AdMob
or a phone.**

## What you need first (owner, once per app)

| Where | What |
|---|---|
| Supabase | Rewards migrations applied; the Edge Function `rewards` deployed with `REWARDS_RC_WEBHOOK_TOKEN`; a `server` event type `ad_watched` (created by the first ad automatically) and a program listening to it, e.g. a milestone |
| RevenueCat | Ad monetization on, AdMob linked; a **second webhook** to `https://<ref>.supabase.co/functions/v1/rewards/revenuecat` with the token as Authorization; the ad unit's reward set (currency or temporary entitlement) |
| AdMob | Impression-level revenue on; the **real** rewarded ad unit's server-side verification pointed at `https://api.revenuecat.com/v1/incoming-webhooks/admob-ssv-rewarded` |
| Admin page | Settings → "Count rewarded ads" on (`ads_enabled`) |

## Run

1. Put your AdMob **app id** in `android/app/src/main/AndroidManifest.xml` (`com.google.android.gms.ads.APPLICATION_ID`)
   and `ios/Runner/Info.plist` (`GADApplicationIdentifier`). The ones in the repo are Google's sample ids, so the app
   starts; they cannot verify rewards.
2. Run with public values only (never a service-role key or a RevenueCat `sk_` key):

```bash
cd examples/rewards_ads_check
flutter run \
  --dart-define=SUPABASE_URL=https://<ref>.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=<anon or publishable key> \
  --dart-define=RC_API_KEY=<RevenueCat public SDK key for this platform: appl_… or goog_…> \
  --dart-define=AD_UNIT_ID=<real rewarded ad unit id>
```

3. On the phone: the checklist shows what is missing. Sign in with an email code, check "RevenueCat user is the
   Supabase user" is ticked, tap **Watch a verified ad**, watch it to the end. The log shows RevenueCat's verdict
   (`verified` with "10 GEMS", or `notVerified`), and within ~20 s the rewards below refresh with the ad counted.
4. Confirm on the admin page: Users → the test user's id → Events shows `ad_watched`.

## What each outcome means

| Log says | Meaning | Fix |
|---|---|---|
| `failedToLoad (…)` | AdMob gave no ad | Real ad unit, app id set, wait a few minutes after creating the unit |
| `notVerified` | RevenueCat did not verify | SSV callback URL in AdMob, ad unit reward in RevenueCat, `Purchases.configure` before loading |
| `verifiedNoReward` | Verified, no reward configured | Set the ad unit's reward in RevenueCat |
| `verified` but the engine shows nothing | Webhook or switch | Second webhook URL and token; `ads_enabled` on; RevenueCat user = Supabase user id |
| `dismissed` | Closed before the end | Watch to the end |

## Files

| File | What |
|---|---|
| `lib/revenuecat_rewarded_ad.dart` | One verified rewarded ad; copy it into an app and pass `.show` to `RewardedAdButton` |
| `lib/check_config.dart` | The dart-define values and the on-screen checklist (flags a secret key, Google's test unit, a RevenueCat user that is not the Supabase user) |
| `lib/main.dart` | The check screen |
