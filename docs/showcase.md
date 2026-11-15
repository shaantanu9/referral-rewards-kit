# Screens

Updated: 2026-11-15
Every screen of the kit, captured from the real code: the Flutter widgets come from the example apps (`packages/rewards_kit/example`, `examples/starter_app`) running against their fake servers, and the admin dashboard comes from `web/rewards-admin` in demo mode (`?demo`, fake data in the tab only). No mock-ups. How to retake them is at the end.

Related: [README](../README.md) · [rewards integration](rewards-integration.md) · [referral integration](integration.md) · [admin API](rewards-api.md)

## Rewards widgets (`rewards_kit`)

Every widget takes a `builder`, so an app can keep the engine's logic and draw its own look. The amounts, odds, deadlines and progress all come from the server's state call, never from the app.

| Screen | What you see |
|---|---|
| ![Rewards hub](../packages/rewards_kit/screenshots/01-hub.png) | **Rewards hub, default look.** Surprise rewards with their odds shown (30 % chance of 5–50 coins), a 2-day streak with its best and its freezes, and "50 coins in 5 more days". The milestone "Read 5 chapters" shows 3 of 5 and the badge it earns. The welcome gift's countdown is the server's deadline, and "7 left" is a real stock count. The floating "Read a chapter" button sends a demo event. |
| ![Hub scrolled](../packages/rewards_kit/screenshots/02-hub-scrolled.png) | **Further down the hub.** The Instagram tag reward ("Tag @myapp on Instagram, 200 coins"), where the user enters their username and gets a code to put in the post. Below it, the daily quiz entry card. |
| ![Dark mode](../packages/rewards_kit/screenshots/03-hub-dark.png) | **Dark mode.** The same widgets follow the app's `ThemeData`, with no colours of their own. |
| ![Custom look](../packages/rewards_kit/screenshots/04-custom-look.png) | **Custom look.** The same streak and offer drawn by the app's own builders: a black streak banner, a purple gift card with its live countdown, and a button that simulates Meta's webhook for the Instagram check. |
| ![Quiz and goal](../packages/rewards_kit/screenshots/05-quiz-and-goal.png) | **Daily quiz, goal ring, heatmap.** Today's quiz (4 questions, a timer per question, the next quiz's countdown). Below it, the daily goal ring ("0/2: read 2 chapters a day to keep the streak") and the activity heatmap with frozen days hatched. |
| ![Follow-ups](../packages/rewards_kit/screenshots/06-follow-ups.png) | **Follow-ups.** The user's own switches: reminders, comeback reminders, Sunday recap and progress emails, plus a reminder time. Below them, "Scheduled on this phone" lists the notifications the engine planned and the app scheduled, with their times and ids. |
| ![League and recap](../packages/rewards_kit/screenshots/07-league-and-recap.png) | **League and year recap.** An opt-in weekly league ("up to 20 people, only your display name and score are shown, leave any time") with its prizes. Below it, the "Your 2026" recap card (days active, best streak, badges, most-done actions, earnings), which the user can share as an image. |

## Referral screens (`referral_kit`)

| Screen | What you see |
|---|---|
| ![App entry points](../packages/referral_kit/screenshots/01-app-entry.png) | **Where an app links in.** "Invite friends" and "Got a code from a friend?" open the same `InviteHub` at different sections. The demo switches below them simulate the server's states. |
| ![Invite hub](../packages/referral_kit/screenshots/02-invite-hub.png) | **Invite hub.** The user's own code (`K7QM-2XRA`) with Share and Copy. Under it, the rules in plain words, built from the live rule set: what both sides get, the subscription reward, and the monthly and yearly caps. |
| ![Invite hub dark](../packages/referral_kit/screenshots/03-invite-hub-dark.png) | **Dark mode** of the same screen. |
| ![Enter a code](../packages/referral_kit/screenshots/04-enter-code.png) | **The friend's side.** "A gift is waiting for you: 4 free chapters" with a deadline chip ("Only 3 days left to add a code") taken from the server, the code field with Add and Paste, a plain explanation of what the inviter gets, and the three steps. |
| ![Code typed](../packages/referral_kit/screenshots/05-code-typed.png) | **Code typed.** The code is normalised before it is sent (case, spaces and the dash don't matter). A code entered while offline is kept and retried later. |
| ![Almost yours](../packages/referral_kit/screenshots/06-almost-yours.png) | **Almost yours.** The code is accepted: "1 of 2 done", with the one step left and a button into the app ("Start reading"). |
| ![Reward cards](../packages/referral_kit/screenshots/07-reward-cards.png) | **Reward cards on home.** Once the friend starts using the app, both sides get their reward. A card says so, once per device, and the analytics funnel below shows the events the app received (`reward_shown` …). |

## Admin dashboard (`web/rewards-admin`)

A static page: no build step, no server of its own. It signs in as a Supabase user listed in `rewards.admins` and only calls the admin RPCs. Everything below is the demo backend.

| Screen | What you see |
|---|---|
| ![Connect](screenshots/admin/00-connect-project.png) | **Connect.** The project URL and its public key. The page refuses a service-role key. |
| ![Overview](screenshots/admin/01-overview.png) | **Overview.** Events, rewards given, most active users in a day, open problems and posts to review, for 7, 30 or 90 days. Charts of events and rewards a day, then tables: events by type, rewards by program and state, live streaks by length, offer claim rates, milestones, Instagram posts. |
| ![Overview dark](screenshots/admin/01-overview-dark.png) | **Overview, dark mode** (follows the system setting). |
| ![Programs](screenshots/admin/02-programs.png) | **Programs.** Every program with its kind and state (live, paused), and "+ New program". Event types with their source and daily limit per user. Names with "review" or "rating" are refused, because the stores forbid rewarding them. |
| ![Quiz bank](screenshots/admin/03-quiz.png) | **Quiz bank.** Questions with their choices, right answer and seconds; edit or hide one, add one with media and an explanation, or paste many as CSV (checked before adding). The answer never reaches the app. |
| ![Leagues](screenshots/admin/04-leagues.png) | **Leagues.** This week's members, groups and tiers (Bronze, Silver, Gold), past weeks' summaries, and "Close ended weeks now". |
| ![Follow-ups](screenshots/admin/05-followups.png) | **Follow-ups.** The guardrails in one line (emails off by default, at most 3 per person, 4 days apart, quiet hours, one notification a day per group). Each follow-up's channel, trigger and group, a "who now?" preview, a user's planned notifications, and branded email templates with a safe sandboxed preview. |
| ![Retention](screenshots/admin/06-retention.png) | **Retention.** By sign-up week: active in 24 h, back on day 1, the north-star "3 of first 7 days", notification opens → active, and emails and unsubscribes. |
| ![Users](screenshots/admin/07-users.png) | **Users.** Look up a user id to see their streaks, rewards and events, and give a manual reward (logged, note required). |
| ![Instagram](screenshots/admin/08-instagram.png) | **Instagram.** Posts Meta's webhook could not match, with the handle, the code and a link. Approve or reject after checking the post. |
| ![Problems](screenshots/admin/09-problems.png) | **Problems.** Grants that gave up after their retries, with the last error and a Retry. A retried reward is never paid twice. |
| ![Settings](screenshots/admin/10-settings.png) | **Settings.** The master switch, rewarded ads (RevenueCat), sandbox events, the daily surprise cap, the email switch and limits, quiet hours, the default reminder time and timezone, the daily grant cap, the Instagram window, event retention, retries and the worker lease. |
| ![Copy setup](screenshots/admin/11-copy.png) | **Copy setup.** Export this app's setup (optionally with quiz questions) and import one, from another app or a preset. The import is a dry run first, never deletes, and never changes a program's kind. |
| ![Audit log](screenshots/admin/12-log.png) | **Audit log.** Every change made through the page or the admin API. |
| ![Phone width](screenshots/admin/13-overview-phone.png) | **On a phone.** The same page at 390 px; the section bar scrolls sideways. |

## Retaking the screenshots

1. Admin: `python3 -m http.server 8771 --directory web`, then open `http://localhost:8771/rewards-admin/?demo#demo/<section>` at 1280 px wide.
2. Flutter: in `packages/rewards_kit/example` and `examples/starter_app`, run `flutter create --platforms web .` and then `flutter build web`. Serve `build/web` and capture at 390×844. Remove the generated `web/` folder afterwards; the examples are mobile apps.
3. Keep the file names: the package READMEs and the `screenshots:` entries in each `pubspec.yaml` point at them.
