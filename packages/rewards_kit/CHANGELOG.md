# Changelog

## 0.6.0 (2026-11-14)

For opt-in weekly leagues and the year-end share card (ADR 0002 §18.10). Nothing changes for a 0.5 app; a server
without a `league` program shows nothing new.

- Models: `LeagueState` (`joined`, `live`, `tier`, `tierName`, `tiers`, `week`, `startsAt`, `endsAt`, `serverTime`,
  `groupSize`, `promote`, `demote`, `minScore`, `rank`, `score`, `size`, `members`, `rewards`, `lastWeek`;
  `canMoveUp`, `nextTierName`), `LeagueMember` (`rank` or null, `name` or null, `score`, `me`; never an id),
  `LeagueLastWeek` (`week`, `rank`, `score`, `tierChange`, `grants`), `LeagueTierChange`; `ProgramKind.league`.
- Client: `league(program)` → `rewards_league`, `joinLeague(program)` → `rewards_league_join`,
  `leaveLeague(program)` → `rewards_league_leave`.
- Controller: `loadLeague`, `joinLeague`, `leaveLeague` (null or a reason), `league(program)`; a load that brings a
  newly closed week with rewards reloads the state so they reach the inbox and `newGrants`.
- `LeagueBoard`: the pitch and Join before opting in; then the tier, the real week end (`Countdown`), the board by
  display name (a neutral word when there is none), the user's row marked, "Top N move up", what each place pays,
  last week's own result, and Leave. Nothing marks who moves down. `maxRows` keeps the user's own row. Builder.
  `RewardsHub` shows it for `league` programs.
- `RewardsRecapCard`: a fixed-ratio (default 4:5) shareable card from a `Recap`: "Your 2026" for a whole year, days
  active, best streak and badges as big numbers, the top actions, what was earned; builder, `RewardsTheme`.
  `RecapShareKey` (`toImage`, `toPngBytes`) renders it for the app's own share sheet; `recapYear(year)`.
- Texts: `RewardsTexts.leagues` (`LeagueTexts`), `RewardsTexts.recapCard` (`RecapCardTexts`), `ordinalSuffix`.
- Analytics: `rewards_league_joined`, `rewards_league_left` {program, result}. Never a name, rank or score.
- Example: a "League" tab (join, a chapter scores a point, leave) with the year recap card and a Share button that
  makes the PNG.

## 0.5.0 (2026-11-14)

For the rewards engine follow-up gaps (ADR 0002 §18.8). Nothing changes for a 0.4 app, and a server without
`groups` shows no new switches.

- Models: `FollowupPrefs.mutedGroups` (`Set<String>` from `muted_groups`; not a list, or an item that is not a
  non-empty string, is left out) and `FollowupPrefs.groups` (`List<FollowupGroup>` from
  `groups: [{"group","label","muted"}]`; items without a group name and repeated groups are skipped, an empty label
  becomes the group name). `FollowupGroup(group, label, muted)`, `FollowupPrefs.groupMutedPatch(group, muted)`
  (the patch from the current list), `parseMutedGroups`, `FollowupPrefs.mutedGroupsKey`; `patched` also updates
  each group's `muted`.
- Client: `followupPrefs(patch)` sends `muted_groups` (a list of names; left out when the value is not a list);
  `lastFollowupPrefs` (the last result); `setFollowupGroupMuted(group, muted)` computes the new list from the last
  known prefs (reads them first when there are none) and saves it.
- `FollowupSettings`: under "Reminders", one switch per group (its label; indented; disabled while reminders are
  off), saved as `muted_groups`; a failed save is undone and shows the error line; `onChanged` still fires so the
  app replans. The builder is unchanged: build per-group switches from `prefs.groups` and
  `save(prefs.groupMutedPatch(group, muted))`.
- Analytics: `rewards_followup_prefs_changed` {field: `muted_groups`}, plus `group` when saved through
  `setFollowupGroupMuted` (a group name is app config, not personal). Never the list.
- Example: the fake prefs have two groups ("Comeback reminders", "Sunday recap"), the fake plan leaves out muted
  groups, and the smoke test mutes one.
- Server-only in §18.8 (nothing to do in Flutter): the daily reminder trigger, `activity_events`, `min_actions`, the
  `app_excluded_from_followups` hook and branded email templates.

## 0.4.0 (2026-11-14)

For the rewards engine follow-ups contract (ADR 0002 §18.7). Nothing changes for an app that does not use them.

- Models: `FollowupPlanItem` (`id`, `program`, `at` UTC, `title`, `body`, `payload`, `group`), `FollowupPlan`
  (`serverTime`, `items` sorted by time; items without an id or a time are skipped), `FollowupPrefs`
  (`notificationsOff`, `emailsOff`, `reminderTime` as a `TimeOfDay` from "HH:MM" or "HH:MM:SS"; bad values are
  defaults), `parseReminderTime`, `formatReminderTime`.
- Client: `followupsPlan({days = 14})` → `rewards_followups_plan(days)`; `followupPrefs([patch])` →
  `rewards_followup_prefs(patch)` (only the three keys; `reminder_time` sent as "HH:MM");
  `trackFollowupOpened(program)` → `rewards_track` `followup_opened` with `dedupe_key` "<program>:<yyyy-mm-dd>"
  (phone-local day, `followupOpenedKey`) and props `{program}`.
- Controller: `followupOpened(program)` tracks, then reloads.
- `FollowupScheduler(controller:, notifier:, store:, debounce: 2 s, days: 14)`: `start()`, `replanNow()`, `stop()`
  (sign-out: cancels everything it scheduled). App-side `FollowupNotifier` (`cancel`, `schedule`) and
  `FollowupIdStore` (`MemoryFollowupIdStore` by default). Past items are never scheduled; errors never throw.
- `FollowupSettings` (builder + default look): "Reminders" and "Emails about my progress" switches and the
  reminder time (`showTimePicker`); `RewardsTexts.followups` (`FollowupTexts`).
- Analytics: `rewards_followup_opened` {program}, `rewards_followups_planned` {count},
  `rewards_followup_prefs_changed` {field}, `rewards_followups_failed` {reason}. Never a value or a message.
- Example: a Follow-ups tab (fake plan of three, prefs, a notifier that lists what it scheduled) and a smoke test.

## 0.3.0 (2026-11-14)

For the rewards engine surprise contract (ADR 0002 §18.6). Nothing changes for an app whose server sends no
surprise; 0.2 apps keep working (the one visible change: a grant with `surprise`, `mystery` or `range` in its params
now opens the reveal instead of a snackbar; pass `revealSurprises: false` to keep the snackbar).

- Models: `RewardSpec.chance` (`params.chance`, 0 < chance ≤ 1) and `RewardSpec.amountRange` (`params.amount_range`
  `[min, max]`); `RewardGrant.isSurprise`, `isMystery`, `range`, `shouldReveal`; `SurpriseOdd` and
  `RewardsState.surprises` (+ `surprisesOf`). Bad values are null, entries without a valid chance are skipped,
  nothing throws.
- Texts: a reward with a range reads "5–50 coins"; `RewardsTexts.reveal` (`RevealTexts`: "Surprise!", "Tap to open",
  "Open", "Nice!", "Close", "Surprises", `youGot`, `chance`, `odds`); `RewardsTexts.surpriseOdds`; `formatChance`
  ("1 in 10" near a whole number, otherwise "35 %"). There is no near-miss string.
- `RewardReveal`: closed gift → tap → haptic (`HapticFeedback.mediumImpact`), ~600 ms shake and scale-up, the reward
  pops in; instant with reduced motion; `autoOpen`, `onOpened` once, `builder`.
- `showRewardReveal(context, grant)`: the reveal in a dialog, completes when closed.
- `RewardToastListener(revealSurprises: true)`: reveal grants open the dialog one at a time (queued), others keep the
  snackbar; works with `holdUntilMoment`; `onGrant` still overrides everything.
- `SurpriseOdds`: the odds lines (all, or one program's), builder. `RewardsHub` shows one "Surprises" card under the
  inbox when the state has surprises (`showSurprises: false` hides it).
- Analytics: `rewards_reveal_opened` (`program`, `kind`).
- Example: "Read a chapter" pays a 5–50 coin surprise with a 30 % chance (at most 3 a day) and plays the reveal.

## 0.2.0 (2026-11-14)

For the rewards engine 0.2 contract (ADR 0002 §18.1–18.3, §18.5). Everything new is off unless the app's server
turns a program on; 0.1 apps keep working unchanged.

- Models: streak `dailyGoal`, `todayCount`, `weeklyFreeFreezesLeft`; `RewardSpec.odds` (`MysteryOdd`, also read from
  a rule's `params.table` weights); `QuestState`/`QuestTask`, `RechargeState`, `WindowState`, `FriendStreakState`,
  `QuizState`/`QuizQuestion`/`QuizAnswerResult`, `StreakHistory`/`HistoryDay`, `Recap`; social `postUrl`;
  `ProgramKind` `quiz`, `questSet`, `comeback`, `recharge`, `window`, `friendStreak`. Unknown values stay `unknown`.
- Client: `history`, `recap`, `useRecharge`, `friendInvite`, `friendAccept`, `friendRemove`, `submitSocialLink`,
  `quizToday`, `quizStart`, `quizQuestion`, `quizAnswer`; reasons `empty`, `bad_code`, `own_code`,
  `too_many_friends`, `already_friends`, `bad_link`, `no_pending_post`, `no_attempts_left`, `not_enough_questions`,
  `no_attempt`.
- Controller: `useRecharge`, `friendInvite` (+ `invite`), `friendAccept`, `friendRemove`, `submitSocialLink`,
  `quizToday`, `loadHistory` (+ `history`), `loadRecap` (+ `recap`), `applyGrants`, `applyQuiz`, `celebrateNow`
  (+ `moments`). A track updates today's heatmap cell and merges quests.
- `QuizController`: open / start / question with a server countdown / answer / reveal / auto-advance / finished;
  sends "no answer" (`-1`) when time is up; resumes the same question and deadline after a restart.
- Widgets (builder + default look): `QuizCard`, `QuizScreen` (+ `QuizBody`), `QuestList`, `RechargeMeter`,
  `WindowBadge`, `FriendStreaks`, `ActivityHeatmap`, `DailyGoalRing`, `MysteryOdds`, `RecapCard`,
  `RewardedAdButton`. `RewardsHub` shows the new kinds; `StreakCard` and `MilestoneProgress` show mystery odds;
  `SocialTagTask(showLinkField: true)` sends a post link.
- `RewardToastListener(holdUntilMoment: true)` waits for `controller.celebrateNow()`; default unchanged.
- `streakReminderAt(...)`: when to schedule the app's own streak reminder, with quiet hours.
- Texts: `RewardsTexts.quiz` (`QuizTexts`) and `RewardsTexts.programs` (`ProgramTexts`); reward names for
  `mystery` and `rc_currency`; lines for the new reasons.
- Analytics: `rewards_quiz_started`, `rewards_quiz_answered`, `rewards_quiz_finished`, `rewards_recharge_used`,
  `rewards_friend_invited`, `rewards_friend_accepted`, `rewards_friend_removed`, `rewards_social_link_submitted`,
  `rewards_ad_reward_shown`. Never a code, link, pair id or friend id.
- Example: a Quiz tab (four questions, two true/false) with the goal ring and heatmap, and a smoke test.

## 0.1.0 (2026-11-14)

First version, for the rewards engine in `supabase/migrations/20261114000002..5` (ADR 0002).

- `RewardsClient` for `rewards_state`, `rewards_track`, `rewards_offer_claim`, `rewards_social_start`,
  `rewards_mark_seen`; `RewardsHttpRpc` for apps without supabase_flutter; error mapping (`RewardsException` with the
  server's reason, `RewardsUnavailableException` for not deployed / signed out / no project).
- `RewardsController`: one state for every widget, merges tracking results, `newGrants` stream (each grant once),
  actions return a reason instead of throwing.
- `ServerClock`: countdowns run on the server's time, never the phone's.
- Widgets, each with a `builder` for a fully custom look: `StreakCard`, `MilestoneProgress`, `OfferBanner`,
  `SocialTagTask`, `RewardInbox`, `RewardToastListener`, `Countdown`, `RewardsHub`.
- `RewardsTheme` (falls back to the app's `ColorScheme`), `RewardsTexts` (every string replaceable).
- Analytics through `onEvent` (`rewards_*` names), never a user id, handle or code.
