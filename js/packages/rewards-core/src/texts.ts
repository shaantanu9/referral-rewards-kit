/**
 * Every string the default widgets show, in English (port of texts.dart, texts_v2.dart, texts_reveal.dart,
 * texts_followups.dart, texts_leagues.dart and texts_fair_play.dart). Override any of them per app:
 * `rewardsTexts({ claim: 'Grab it', reward: (r) => `${r.amount} gems`, quiz: { start: 'Go' } })`. Reward kinds are the
 * app's own, so [RewardsTexts.reward] is where an app names them. For another language, give every string.
 */
import type { RewardSpec } from './models';
import type { QuestTask } from './programs';
import type { SurpriseOdd } from './surprise-models';
import { formatChance, humanize, ordinalSuffix } from './texts-format';

/** The quiz card and quiz screen. */
export interface QuizTexts {
  readonly title: string;
  readonly start: string;
  readonly resume: string;
  readonly seeResult: string;
  readonly tryAgain: string;
  readonly done: string;
  readonly next: string;
  readonly retry: string;
  /** Before the countdown to the end of today's quiz. */
  readonly closesIn: string;
  readonly comeBack: string;
  readonly right: string;
  readonly wrong: string;
  readonly timeUp: string;
  readonly trueLabel: string;
  readonly falseLabel: string;
  readonly oddOneOut: string;
  readonly playSound: string;
  readonly noReward: string;
  readonly unavailable: string;
  /** The intro line, from the number of questions. */
  readonly rules: (total: number) => string;
  /** "Question 2 of 10" (1-based). */
  readonly questionOf: (number: number, total: number) => string;
  /** "7 of 10 right". */
  readonly score: (score: number, total: number) => string;
}

export const defaultQuizTexts: QuizTexts = {
  title: 'Daily quiz',
  start: 'Start',
  resume: 'Resume',
  seeResult: 'See result',
  tryAgain: 'Try again',
  done: 'Done',
  next: 'Next',
  retry: 'Retry',
  closesIn: 'New quiz in',
  comeBack: 'Come back tomorrow for a new quiz',
  right: 'Right!',
  wrong: 'Not quite',
  timeUp: "Time's up",
  trueLabel: 'True',
  falseLabel: 'False',
  oddOneOut: 'Which one does not belong?',
  playSound: 'Play sound',
  noReward: 'No reward this time. Keep practising!',
  unavailable: 'The quiz is not available right now.',
  rules: (total) => `${total} ${total === 1 ? 'question' : 'questions'}. Answer each one before its timer runs out.`,
  questionOf: (n, total) => `Question ${n} of ${total}`,
  score: (score, total) => `${score} of ${total} right`,
};

/** Quests, recharges, windows, friend streaks, heatmap, daily goal, mystery odds, recap, post links and ads. */
export interface ProgramTexts {
  readonly questsTitle: string;
  readonly questResetsIn: string;
  readonly questBonus: (reward: string) => string;
  /** A task's line; the default turns the task key into words (`read_3` → "Read 3"). */
  readonly questTask: (task: QuestTask) => string;
  readonly questDone: string;
  readonly rechargeNextIn: string;
  readonly rechargeFull: string;
  readonly rechargeUse: string;
  /** The window's name when the program has no `public.title`. */
  readonly windowTitle: string;
  readonly windowEndsIn: string;
  readonly windowStartsIn: string;
  readonly friendsTitle: string;
  readonly friendsEmpty: string;
  readonly friendInvite: string;
  readonly friendCodeLabel: string;
  readonly friendAccept: string;
  readonly friendRemove: string;
  readonly friendYourTurn: string;
  readonly friendBothDone: string;
  readonly friendWaiting: (name: string) => string;
  readonly friendDays: (days: number) => string;
  readonly heatmapLess: string;
  readonly heatmapMore: string;
  /** The daily goal ring's centre: "1/2". */
  readonly goal: (count: number, goal: number) => string;
  readonly goalDone: string;
  readonly oddsTitle: string;
  readonly recapTitle: string;
  readonly recapDaysActive: (days: number) => string;
  readonly recapBestStreak: (days: number) => string;
  readonly recapEarned: string;
  readonly recapEvent: (type: string, count: number) => string;
  readonly postLinkLabel: string;
  readonly postLinkSend: string;
  readonly postLinkSent: string;
  readonly adNotVerified: string;
  readonly adError: string;
}

const days = (d: number): string => `${d} ${d === 1 ? 'day' : 'days'}`;

export const defaultProgramTexts: ProgramTexts = {
  questsTitle: 'Quests',
  questResetsIn: 'Resets in',
  questBonus: (reward) => `Finish all for ${reward}`,
  questTask: (t) => humanize(t.key),
  questDone: 'All done!',
  rechargeNextIn: 'Next in',
  rechargeFull: 'Full',
  rechargeUse: 'Use one',
  windowTitle: 'Happy hour',
  windowEndsIn: 'ends in',
  windowStartsIn: 'starts in',
  friendsTitle: 'Friend streaks',
  friendsEmpty: 'Keep a streak going with a friend.',
  friendInvite: 'Invite a friend',
  friendCodeLabel: "Friend's code",
  friendAccept: 'Add',
  friendRemove: 'End streak',
  friendYourTurn: 'Your turn today',
  friendBothDone: 'Both done today',
  friendWaiting: (name) => `Waiting for ${name === '' ? 'your friend' : name}`,
  friendDays: (d) => `${days(d)} together`,
  heatmapLess: 'Less',
  heatmapMore: 'More',
  goal: (count, goal) => `${count}/${goal}`,
  goalDone: 'Goal met',
  oddsTitle: 'What it can be',
  recapTitle: 'Your recap',
  recapDaysActive: (d) => `${days(d)} active`,
  recapBestStreak: (d) => `Best streak: ${days(d)}`,
  recapEarned: 'Earned',
  recapEvent: (type, count) => `${humanize(type)}: ${count}`,
  postLinkLabel: 'Link to your post',
  postLinkSend: 'Send link',
  postLinkSent: 'Link sent. We will check it.',
  adNotVerified: 'The ad did not finish, so there is no reward this time.',
  adError: 'The ad could not be shown. Try again later.',
};

/** The surprise reveal and odds. There is deliberately no "almost" / "so close" line: the kit never shows a near miss. */
export interface RevealTexts {
  /** The closed gift's heading. */
  readonly title: string;
  readonly tapToOpen: string;
  /** The closed gift's button. */
  readonly open: string;
  /** Closes the reveal once it is open. */
  readonly nice: string;
  /** Closes the reveal before it is opened. */
  readonly close: string;
  /** The `SurpriseOdds` card's heading. */
  readonly oddsTitle: string;
  /** The opened line, from the reward's text: "You got 23 coins". */
  readonly youGot: (reward: string) => string;
  /** A chance 0..1 as text: "1 in 10" or "35 %". */
  readonly chance: (chance: number) => string;
  /** The odds line: "1 in 10 chance of 5–50 coins". */
  readonly odds: (chance: string, reward: string) => string;
}

export const defaultRevealTexts: RevealTexts = {
  title: 'Surprise!',
  tapToOpen: 'Tap to open',
  open: 'Open',
  nice: 'Nice!',
  close: 'Close',
  oddsTitle: 'Surprises',
  youGot: (reward) => `You got ${reward}`,
  chance: formatChance,
  odds: (chance, reward) => `${chance} chance of ${reward}`,
};

/** `FollowupSettings`. */
export interface FollowupTexts {
  readonly title: string;
  /** The notifications switch (on = `notifications_off` false). */
  readonly reminders: string;
  readonly remindersHint: string;
  /** The emails switch (on = `emails_off` false). */
  readonly emails: string;
  readonly emailsHint: string;
  /** The row that opens the time picker. */
  readonly reminderTime: string;
  /** Shown when the user has not picked a time. */
  readonly reminderTimeDefault: string;
  readonly retry: string;
}

export const defaultFollowupTexts: FollowupTexts = {
  title: 'Reminders and emails',
  reminders: 'Reminders',
  remindersHint: 'A short note when your streak or a reward is waiting',
  emails: 'Emails about my progress',
  emailsHint: 'At most a few, and you can stop them any time',
  reminderTime: 'Reminder time',
  reminderTimeDefault: 'Default',
  retry: 'Retry',
};

/** `LeagueBoard`. Plain and calm on purpose: no "hurry", nothing about moving down. */
export interface LeagueTexts {
  readonly title: string;
  /** Shown before joining: what it is and what is shared. */
  readonly pitch: (groupSize: number) => string;
  readonly join: string;
  readonly leave: string;
  readonly weekEndsIn: string;
  /** A member without a display name. */
  readonly member: string;
  /** Next to the user's own row. */
  readonly you: string;
  readonly points: (score: number) => string;
  /** "1st", "2nd", "3rd", "4th". */
  readonly place: (rank: number) => string;
  readonly unranked: string;
  /** "Top 3 move up to Silver" (`tier` null: "move up"). */
  readonly movesUp: (count: number, tier: string | null) => string;
  /** "1st: 100 coins", "Top 3: 30 coins". */
  readonly placeReward: (threshold: number, reward: string) => string;
  /** "Last week: 2nd with 12 points" (`rank` null: "Last week: 4 points"). */
  readonly lastWeek: (rank: number | null, score: number) => string;
  /** "You moved up to Silver". Moving down is never announced. */
  readonly movedUp: (tier: string | null) => string;
  readonly notLive: string;
}

const points = (s: number): string => `${s} ${s === 1 ? 'point' : 'points'}`;
const place = (r: number): string => `${r}${ordinalSuffix(r)}`;

export const defaultLeagueTexts: LeagueTexts = {
  title: 'Weekly league',
  pitch: (n) => `Compete with up to ${n} people this week. Only your display name and score are shown. Leave any time.`,
  join: 'Join',
  leave: 'Leave league',
  weekEndsIn: 'Week ends in',
  member: 'A member',
  you: 'You',
  points,
  place,
  unranked: 'Not ranked yet',
  movesUp: (n, tier) => `Top ${n} move up${tier == null ? '' : ` to ${tier}`}`,
  placeReward: (t, reward) => (t === 1 ? `1st: ${reward}` : `Top ${t}: ${reward}`),
  lastWeek: (rank, score) => (rank == null ? `Last week: ${points(score)}` : `Last week: ${place(rank)} with ${points(score)}`),
  movedUp: (tier) => (tier == null ? 'You moved up' : `You moved up to ${tier}`),
  notLive: 'This league is not running right now.',
};

/** `RewardsRecapCard`. */
export interface RecapCardTexts {
  /** "Your 2026" when the recap covers one whole calendar year. */
  readonly yearTitle: (year: number) => string;
  readonly rangeTitle: string;
  readonly daysActive: (days: number) => string;
  readonly bestStreak: (days: number) => string;
  readonly badges: (count: number) => string;
  readonly earned: string;
  readonly mostDone: string;
}

export const defaultRecapCardTexts: RecapCardTexts = {
  yearTitle: (y) => `Your ${y}`,
  rangeTitle: 'Your recap',
  daysActive: (d) => (d === 1 ? 'day active' : 'days active'),
  bestStreak: (d) => (d === 1 ? 'day best streak' : 'days best streak'),
  badges: (n) => (n === 1 ? 'badge' : 'badges'),
  earned: 'Earned',
  mostDone: 'Most done',
};

/** The 0.7 choices, streak repair and personal best, head start and levels. */
export interface FairPlayTexts {
  readonly choicesTitle: string;
  readonly showStreaks: string;
  readonly showStreaksHint: string;
  readonly surprises: string;
  readonly surprisesHint: string;
  readonly showTimers: string;
  readonly showTimersHint: string;
  /** Before the repair's countdown (hidden while timers are off). */
  readonly repairEndsIn: string;
  /** "Do 1 more today to bring back your 20-day streak". */
  readonly repair: (left: number, restoresTo: number) => string;
  /** "Your 21-day streak is back". */
  readonly streakBack: (days: number) => string;
  /** "New personal best: 4 today". */
  readonly personalBest: (count: number) => string;
  /** The program's `public.head_start_label` when set, else "Includes a head start of 2 from us". */
  readonly headStart: (headStart: number, label: string | null) => string;
  /** "Level 3 · Explorer" (or "Level 3" without a name). */
  readonly level: (number: number, name: string | null) => string;
  /** "4 of 8 to the next level". */
  readonly toNextLevel: (count: number, nextAt: number) => string;
}

export const defaultFairPlayTexts: FairPlayTexts = {
  choicesTitle: 'How rewards look',
  showStreaks: 'Show streaks',
  showStreaksHint: 'Off: your days still count, the streak is just not shown',
  surprises: 'Surprise rewards',
  surprisesHint: 'Off: every reward is a fixed amount, never a draw',
  showTimers: 'Show timers',
  showTimersHint: 'Off: no countdowns or deadlines',
  repairEndsIn: 'Ends in',
  repair: (left, to) => `Do ${left} more today to bring back your ${to}-day streak`,
  streakBack: (d) => `Your ${d}-day streak is back`,
  personalBest: (c) => `New personal best: ${c} today`,
  headStart: (h, label) => (label == null || label.trim() === '' ? `Includes a head start of ${h} from us` : label.trim()),
  level: (n, name) => (name == null ? `Level ${n}` : `Level ${n} · ${name}`),
  toNextLevel: (c, next) => `${c} of ${next} to the next level`,
};

/** The plain strings and line builders of the 0.1 widgets. */
export interface RewardsTexts {
  readonly streakLongest: string;
  readonly streakDoneToday: string;
  readonly streakDoToday: string;
  readonly streakAtRisk: string;
  readonly streakFreezes: string;
  readonly allEarned: string;
  readonly offerEndsIn: string;
  readonly claim: string;
  readonly claimed: string;
  readonly offerExpired: string;
  readonly soldOut: string;
  readonly socialHandleLabel: string;
  readonly socialStart: string;
  readonly socialDisclose: string;
  readonly copyCode: string;
  readonly codeCopied: string;
  readonly openInstagram: string;
  readonly socialCheckingIn: string;
  readonly socialVerified: string;
  readonly socialRejected: string;
  readonly socialExpired: string;
  readonly socialCooldown: string;
  readonly gotIt: string;
  readonly onItsWay: string;
  readonly inboxEmpty: string;
  readonly quiz: QuizTexts;
  readonly programs: ProgramTexts;
  readonly reveal: RevealTexts;
  readonly followups: FollowupTexts;
  readonly leagues: LeagueTexts;
  readonly recapCard: RecapCardTexts;
  readonly fairPlay: FairPlayTexts;
  /** A reward's words: `entitlement_days`, `minutes`, `badge`, `streak_freeze`, `mystery`, `rc_currency`, else "5 coins"; a range reads "5–50 coins". */
  reward(r: RewardSpec): string;
  /** Rewards joined with " + ". */
  rewards(list: readonly RewardSpec[]): string;
  /** "1 in 10 chance of 5–50 coins" for one surprise rule. */
  surpriseOdds(s: SurpriseOdd): string;
  streakDays(d: number): string;
  nextIn(reward: string, left: number): string;
  progress(count: number, target: number): string;
  stockLeft(left: number): string;
  socialTitle(account: string): string;
  socialSteps(account: string): string;
  gotReward(reward: string): string;
  /** A short line for a refusal reason from a controller action. */
  error(reason: string): string;
}

type Nested = 'quiz' | 'programs' | 'reveal' | 'followups' | 'leagues' | 'recapCard' | 'fairPlay';

/** Overrides for [rewardsTexts]: any plain string or builder, and any string of the nested groups. */
export type RewardsTextsOverrides = Partial<Omit<RewardsTexts, Nested>> & {
  readonly quiz?: Partial<QuizTexts>;
  readonly programs?: Partial<ProgramTexts>;
  readonly reveal?: Partial<RevealTexts>;
  readonly followups?: Partial<FollowupTexts>;
  readonly leagues?: Partial<LeagueTexts>;
  readonly recapCard?: Partial<RecapCardTexts>;
  readonly fairPlay?: Partial<FairPlayTexts>;
};

const optName = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const titleCase = (s: string): string => {
  const t = s.replaceAll('_', ' ');
  return t === '' ? t : t[0]!.toUpperCase() + t.substring(1);
};

/** The default English reward words (Dart `RewardsTexts.reward` without an override). */
export function defaultRewardText(r: RewardSpec): string {
  const range = r.amountRange;
  const n = range == null ? String(r.amount) : `${range[0]}–${range[1]}`;
  const one = range == null ? r.amount === 1 : range[1] === 1;
  switch (r.kind) {
    case 'entitlement_days':
      return `${n} ${one ? 'day' : 'days'} of Premium`;
    case 'minutes':
      return `${n} ${one ? 'minute' : 'minutes'}`;
    case 'badge':
      return `"${titleCase(r.badge ?? 'badge')}" badge`;
    case 'streak_freeze':
      return `${n} streak ${one ? 'freeze' : 'freezes'}`;
    case 'mystery':
      return 'a mystery reward';
    case 'rc_currency':
      return `${n} ${optName(r.params['currency_name']) ?? optName(r.params['currency_code']) ?? 'coins'}`;
    default:
      return `${n} ${r.kind.replaceAll('_', ' ')}`;
  }
}

/** The full texts: English defaults with [overrides] on top. Builders that use other strings see the overridden ones. */
export function rewardsTexts(overrides: RewardsTextsOverrides = {}): RewardsTexts {
  const { quiz, programs, reveal, followups, leagues, recapCard, fairPlay, ...top } = overrides;
  const self: RewardsTexts = {
    streakLongest: 'Best',
    streakDoneToday: 'Done for today',
    streakDoToday: 'Keep your streak: do it today',
    streakAtRisk: 'Your streak ends in',
    streakFreezes: 'Freezes',
    allEarned: 'All rewards earned',
    offerEndsIn: 'Ends in',
    claim: 'Claim',
    claimed: 'Claimed',
    offerExpired: 'This offer has ended',
    soldOut: 'All gone',
    socialHandleLabel: 'Your Instagram username',
    socialStart: 'Get my code',
    socialDisclose: 'Say it is a rewarded post (for example #ad).',
    copyCode: 'Copy code',
    codeCopied: 'Code copied',
    openInstagram: 'Open Instagram',
    socialCheckingIn: 'We look for your post for',
    socialVerified: 'Thanks for the post! Reward added.',
    socialRejected: 'We could not match your post. You can try again.',
    socialExpired: 'We did not find your post in time. You can try again.',
    socialCooldown: 'You can post again in',
    gotIt: 'Got it',
    onItsWay: 'On its way',
    inboxEmpty: 'No new rewards',
    quiz: { ...defaultQuizTexts, ...quiz },
    programs: { ...defaultProgramTexts, ...programs },
    reveal: { ...defaultRevealTexts, ...reveal },
    followups: { ...defaultFollowupTexts, ...followups },
    leagues: { ...defaultLeagueTexts, ...leagues },
    recapCard: { ...defaultRecapCardTexts, ...recapCard },
    fairPlay: { ...defaultFairPlayTexts, ...fairPlay },
    reward: defaultRewardText,
    rewards: (list) => list.map((r) => self.reward(r)).join(' + '),
    surpriseOdds: (s) => self.reveal.odds(self.reveal.chance(s.chance ?? 0), self.reward(s.spec)),
    streakDays: (d) => `${d}-day streak`,
    nextIn: (reward, left) => `${reward} in ${left} more ${left === 1 ? 'day' : 'days'}`,
    progress: (count, target) => `${count} of ${target}`,
    stockLeft: (left) => `${left} left`,
    socialTitle: (account) => `Tag @${account} on Instagram`,
    socialSteps: (account) => `Post a photo, reel or story, tag @${account}, and put this code in the caption.`,
    gotReward: (reward) => `You got ${reward}`,
    error: (reason) => {
      switch (reason) {
        case 'offer_expired':
          return self.offerExpired;
        case 'sold_out':
          return self.soldOut;
        case 'offer_claimed':
          return self.claimed;
        case 'bad_handle':
          return 'That does not look like an Instagram username.';
        case 'handle_taken':
          return 'That username is already used for this reward.';
        case 'already_posted':
          return 'You already got this reward.';
        case 'too_soon':
          return 'You can do this again later.';
        case 'offline':
          return 'You are offline. Try again in a moment.';
        case 'empty':
          return 'None left. More come back soon.';
        case 'bad_code':
          return 'That code does not work. Check it and try again.';
        case 'own_code':
          return 'That is your own code. Send it to a friend.';
        case 'too_many_friends':
          return 'You already have the most friend streaks.';
        case 'already_friends':
          return 'You already have a streak with this friend.';
        case 'bad_link':
          return 'That does not look like a link to a post.';
        case 'no_pending_post':
          return 'Get your code first, then send the link.';
        case 'no_attempts_left':
          return self.quiz.comeBack;
        case 'not_enough_questions':
        case 'unavailable':
          return self.quiz.unavailable;
        default:
          return 'Something went wrong. Try again.';
      }
    },
  };
  Object.assign(self, top);
  return Object.freeze(self);
}

/** The English defaults. */
export const defaultRewardsTexts: RewardsTexts = rewardsTexts();
