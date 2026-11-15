# To do

Updated: 2026-11-15
What is planned and not built yet, and what has not been proven outside tests. Build order: [build-plan.md](build-plan.md). Known problems: [ISSUES.md](ISSUES.md).

## Proof on the real thing

Everything below passes its local tests and CI, but nothing has yet run against a live Supabase project, real RevenueCat, or a phone.

- [ ] Referral and rewards engines on a live Supabase project: apply the migrations in order, then a test account
      finishes a quiz and the grant lands (`docs/rewards-integration.md` §9). Apply migration 17 before deploying the
      referral function that needs it.
- [ ] RevenueCat sandbox purchase: key permissions, the grant response, the response to a duplicate grant
      (`docs/test-plan.md` §3). The permission `customer_information:subscriptions:read` is [unconfirmed].
- [ ] RevenueCat ad monetization: AdMob SSV to RevenueCat, the second webhook to `/rewards/revenuecat`, a real
      rewarded ad → `ad_watched` (`examples/rewards_ads_check` on a phone with a real ad unit).
- [ ] Real-phone checks M1–M9 (`docs/test-plan.md` §2): install id across reinstall, `UIPasteControl` on iOS 16+,
      Play Install Referrer prefill.
- [ ] Follow-ups on a phone (local notifications, replan after activity), one real Resend email with the unsubscribe
      link, a branded template in Gmail and Apple Mail.
- [ ] The admin page against a live project (only its demo backend has been clicked through).
- [ ] Widgets on a phone: invite hub, reward card, surprise reveal (animation, haptic, reduced motion), league board,
      recap card, the share `channel` on iOS and Android.
- [ ] Instagram: the Meta webhook (mentions, comments, story mentions) with real payloads.
- [ ] A league week closing through `/worker`; the referral give-up, banked-per-entitlement and lifetime-fallback
      paths against real RevenueCat.

## Open decisions

- [ ] Recap card: `rewards_recap` reads `rewards.events`, which is deleted after `events_retention_days` (90). A
      year-end card sees about 90 days: raise retention, or keep yearly totals.
- [ ] Meta's promotion rules and paid-post disclosure for rewarded tags, per market [unconfirmed].
- [ ] Apple privacy label and Play Data safety wording (`docs/store-review.md` §4–5) [unconfirmed].

## Planned

- [ ] Native-speaker review of the Hindi and Indonesian strings (`web/invite/strings.ts`, the package's ARB files).
- [ ] More languages for `packages/referral_kit`.
- [ ] Publish the packages on pub.dev (today they install as a git dependency).
- [ ] Leaderboards between users beyond opt-in leagues.
- [ ] TikTok / X verification.
- [ ] Optional App Attest / Play Integrity check on claims (ADR 0001 §8).
- [ ] Optional deep-link service for iOS install attribution (ADR 0001 §15).
