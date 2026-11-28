import { isolatedCode } from './code-format';
import type { ReferralKitLocalizations } from './l10n';
import { ClaimReason, type ClaimResult, type MyClaim, type MyClaimReward, type ReferralRule, type ReferralTerms, type RewardItem } from './models';

/** App-supplied names for reward kinds (ADR 11.1): the kit knows amounts, the app knows what they buy. */
export interface RewardLabels {
  /** Full label per kind, e.g. `{minutes: (n) => `${n} min of natural voice`}`. Wins over the defaults. */
  readonly byKind?: Readonly<Record<string, (amount: number) => string>>;
  /** Display name per RevenueCat entitlement id for `entitlement_days`, e.g. `{premium: 'Premium'}`. */
  readonly entitlementNames?: Readonly<Record<string, string>>;
  /** Name used when a rule does not name its entitlement. Default `Premium`. */
  readonly defaultEntitlementName?: string;
}

/** Dart's `num.round()`: half away from zero. */
export const dartRound = (n: number): number => (n < 0 ? -Math.round(-n) : Math.round(n));

/**
 * Every user-facing sentence, built from the active rules in [terms] (ADR 11.1, 11.2). Nothing about amounts, caps or
 * windows is hard-coded: a rule the owner turns off disappears from every sentence.
 */
export class ReferralCopy {
  readonly l10n: ReferralKitLocalizations;
  readonly terms: ReferralTerms;
  readonly labels: RewardLabels;

  constructor(opts: { l10n: ReferralKitLocalizations; terms: ReferralTerms; labels?: RewardLabels }) {
    this.l10n = opts.l10n;
    this.terms = opts.terms;
    this.labels = opts.labels ?? {};
  }

  get sharerJoined(): ReferralRule | null {
    return this.terms.rule('joined', 'sharer');
  }
  get friendJoined(): ReferralRule | null {
    return this.terms.rule('joined', 'friend');
  }
  get sharerPaid(): ReferralRule | null {
    return this.terms.rule('paid', 'sharer');
  }

  /** Label for a reward kind and amount, e.g. "30 min" or "5 days of Premium". */
  reward(kind: string, amount: number, params: Readonly<Record<string, unknown>> = {}): string {
    const custom = this.labels.byKind?.[kind];
    if (custom) return custom(amount);
    const n = dartRound(amount);
    switch (kind) {
      case 'minutes':
        return this.l10n.rewardMinutes(n);
      case 'entitlement_days': {
        const id = params['entitlement_id'] == null ? '' : String(params['entitlement_id']);
        const name =
          this.labels.entitlementNames?.[id] ?? (id === '' ? (this.labels.defaultEntitlementName ?? 'Premium') : id);
        return this.l10n.rewardEntitlementDays(n, name);
      }
      default: {
        const a = amount === n ? `${n}` : String(amount);
        return this.l10n.rewardOther(a, kind.replaceAll('_', ' '));
      }
    }
  }

  ruleReward(r: ReferralRule): string {
    return this.reward(r.kind, r.amount, r.params);
  }
  itemReward(r: RewardItem): string {
    return this.reward(r.kind, r.amount, r.params);
  }

  private get sameJoinedReward(): boolean {
    const s = this.sharerJoined,
      f = this.friendJoined;
    return s != null && f != null && this.ruleReward(s) === this.ruleReward(f);
  }

  /** The rules as shown on the invite screen: one sentence per event that has a rule. */
  rules(): string[] {
    const out: string[] = [];
    const s = this.sharerJoined,
      f = this.friendJoined,
      p = this.sharerPaid,
      l = this.l10n;
    if (s && f) {
      out.push(this.sameJoinedReward ? l.rulesJoinedEach(this.ruleReward(s)) : l.rulesJoinedBoth(this.ruleReward(s), this.ruleReward(f)));
    } else if (s) {
      out.push(l.rulesJoinedSharerOnly(this.ruleReward(s)));
    } else if (f) {
      out.push(l.rulesJoinedFriendOnly(this.ruleReward(f)));
    }
    if (p) out.push(l.rulesPaid(this.ruleReward(p)));
    return out;
  }

  /** Cap sentences for the rules that exist. */
  caps(): string[] {
    const out: string[] = [];
    if (this.sharerJoined && this.terms.sharerJoinsPer30d > 0) out.push(this.l10n.capJoins(this.terms.sharerJoinsPer30d));
    if (this.sharerPaid && this.terms.sharerPaidPer365d > 0) out.push(this.l10n.capPaid(this.terms.sharerPaidPer365d));
    return out;
  }

  /** Secondary paywall line; null when there is no paid rule. */
  paywallLine(): string | null {
    const p = this.sharerPaid;
    return p == null ? null : this.l10n.paywallLine(this.ruleReward(p));
  }

  /** Shown to the friend before they confirm a code: names only events that reward the sharer. */
  friendDisclosure(): string | null {
    const joined = this.sharerJoined != null,
      paid = this.sharerPaid != null;
    if (joined && paid) return this.l10n.friendDisclosureBoth;
    if (joined) return this.l10n.friendDisclosureJoined;
    if (paid) return this.l10n.friendDisclosurePaid;
    return null;
  }

  /** Share sheet text, give-first; the code is wrapped in a left-to-right isolate. */
  shareText(opts: { appName: string; code: string; link: string }): string {
    const c = isolatedCode(opts.code);
    const s = this.sharerJoined,
      f = this.friendJoined,
      l = this.l10n;
    if (s && f && this.sameJoinedReward) return l.shareTextBoth(opts.appName, c, this.ruleReward(f), opts.link);
    if (f && (s || this.sharerPaid)) return l.shareTextEach(opts.appName, c, this.ruleReward(f), opts.link);
    if (f) return l.shareTextFriendOnly(opts.appName, c, this.ruleReward(f), opts.link);
    if (s || this.sharerPaid) return l.shareTextSharerOnly(opts.appName, c, opts.link);
    return l.shareTextPlain(opts.appName, c, opts.link);
  }

  /** Share text when the app has no invite page: the code to type in and the app's [storeLink] (or the code alone). */
  shareTextNoLink(opts: { appName: string; code: string; storeLink?: string | null }): string {
    const c = isolatedCode(opts.code);
    const store = opts.storeLink;
    const l = this.l10n;
    if (store == null || store === '') return l.shareTextCodeOnly(opts.appName, c);
    const f = this.friendJoined;
    if (f && this.sharerJoined && this.sameJoinedReward) return l.shareTextNoLinkBoth(opts.appName, c, this.ruleReward(f), store);
    if (f && (this.sharerJoined || this.sharerPaid)) return l.shareTextNoLinkEach(opts.appName, c, this.ruleReward(f), store);
    if (f) return l.shareTextNoLinkFriend(opts.appName, c, this.ruleReward(f), store);
    return l.shareTextNoLinkPlain(opts.appName, c, store);
  }

  /** The friend's reward ("4 free chapters"), or null when the terms give the friend nothing. */
  get friendReward(): string | null {
    const f = this.friendJoined;
    return f == null ? null : this.ruleReward(f);
  }

  /** True when both sides get the same joined reward. */
  get bothGetSame(): boolean {
    return this.friendJoined != null && this.sharerJoined != null && this.sameJoinedReward;
  }

  /** The sharer's joined reward ("30 min"), or null. */
  get sharerJoinedReward(): string | null {
    const s = this.sharerJoined;
    return s == null ? null : this.ruleReward(s);
  }

  /** The invite screen's give-first headline; null when no joined rule exists. */
  inviteHeadline(): string | null {
    const f = this.friendReward,
      s = this.sharerJoinedReward,
      l = this.l10n;
    if (f != null && s != null) return f === s ? l.inviteHeadlineBoth(f) : l.inviteHeadlineEach(f, s);
    if (f != null) return l.inviteHeadlineFriend(f);
    if (s != null) return l.inviteHeadlineSharer(s);
    return null;
  }

  /** The friend's next step as the sharer reads it: the app's [activationStep], or "Start using {app}". */
  nextStep(opts: { appName: string; activationStep?: string | null }): string {
    return opts.activationStep ?? this.l10n.stepStartUsing(opts.appName);
  }

  /** The sharer's line for [count] friends who used the code and have not started yet. Null for 0 / null. */
  waitingLine(count: number | null | undefined, opts: { appName: string; activationStep?: string | null }): string | null {
    if (count == null || count <= 0) return null;
    const s = this.sharerJoinedReward,
      f = this.friendReward,
      l = this.l10n;
    let reward: string | null;
    if (s != null && f != null) reward = s === f ? l.waitingRewardBoth(count, s) : l.waitingRewardEach(count, s, f);
    else if (s != null) reward = l.waitingRewardYou(count, s);
    else if (f != null) reward = l.waitingRewardFriend(count, f);
    else reward = null;
    const parts = [l.waitingFriends(count), l.waitingNextStep(this.nextStep(opts))];
    if (reward != null) parts.push(reward);
    return parts.join(' ');
  }

  /** The boost banner (G8), with the boost's real last day; null when no boost runs at [now]. */
  boostLine(now: Date): string | null {
    const b = this.terms.boostAt(now);
    if (b == null) return null;
    const date = formatBoostDay(b.endsAt, this.l10n.localeName);
    const friendOnly = b.forFriend && !b.forSharer;
    const l = this.l10n;
    if (b.multiplier === 2) return friendOnly ? l.boostFriendDouble(date) : l.boostDouble(date);
    const m = Number.isInteger(b.multiplier) ? `${b.multiplier}` : String(b.multiplier);
    return friendOnly ? l.boostFriendTimes(m, date) : l.boostTimes(m, date);
  }

  /** A reward the friend gets in `referral_my_claim` (already boosted). */
  claimReward(r: MyClaimReward): string {
    return this.reward(r.kind, r.amount, r.params);
  }

  /** The friend's card while their gift waits (G2). Days only when the server sent them. */
  welcomeWaiting(claim: MyClaim, opts: { appName: string; activationStep?: string | null }): string {
    const step = this.nextStep(opts);
    const rewards = claim.rewards.map((r) => this.claimReward(r));
    const head = rewards.length === 0 ? this.l10n.welcomeWaitingPlain(step) : this.l10n.welcomeWaiting(rewards.join(', '), step);
    const d = claim.daysLeft;
    return d == null || d <= 0 ? head : `${head} ${this.l10n.welcomeDaysLeft(d)}`;
  }

  /** The pass-it-on card after the friend's own welcome reward (G3). */
  passItOn(opts: { appName: string }): string {
    const f = this.friendReward;
    return f == null ? this.l10n.passItOnPlain(opts.appName) : this.l10n.passItOn(f);
  }

  /** The words for a `displayNameProblem` reason; null for none. */
  displayNameError(problem: string | null | undefined): string | null {
    switch (problem) {
      case null:
      case undefined:
        return null;
      case 'empty':
        return this.l10n.nameErrEmpty;
      case 'too_long':
        return this.l10n.nameErrTooLong;
      case 'no_letter':
        return this.l10n.nameErrNoLetter;
      default:
        return this.l10n.nameErrEmailOrLink;
    }
  }

  /** "A gift is waiting for you: 4 free chapters" (only when the friend rule really gives something). */
  giftTitle(): string {
    const r = this.friendReward;
    return r == null ? this.l10n.giftWaitingPlain : this.l10n.giftWaiting(r);
  }

  /** The real deadline from the server's `claim_days_left`, or null. Never a timer of its own. */
  deadline(): string | null {
    const d = this.terms.claimDaysLeft;
    if (d == null || d <= 0) return null;
    return this.l10n.daysLeftToAdd(d);
  }

  /** The three steps to the friend's reward. */
  steps(opts: { appName: string; activationStep?: string | null }): string[] {
    const r = this.friendReward,
      l = this.l10n;
    return [
      l.stepAddCode,
      opts.activationStep ?? l.stepStartUsing(opts.appName),
      r == null ? l.stepGift : this.bothGetSame ? l.stepRewardBoth(r) : l.stepRewardYou(r),
    ];
  }

  /** After a code is accepted: what the second step unlocks. */
  almostLine(): string {
    const r = this.friendReward;
    if (r == null) return this.l10n.almostLinePlain;
    return this.sharerJoined != null ? this.l10n.almostLineBoth(r) : this.l10n.almostLine(r);
  }

  /** Why a code can't be added, or null when it can (or the server does not say). */
  cannotAddReason(): string | null {
    if (!this.terms.hasClaimDaysLeft) return null;
    const d = this.terms.claimDaysLeft;
    if (d != null && d <= 0) return this.l10n.cannotAddClosed(this.terms.claimWindowDays);
    if (d == null) return this.l10n.cannotAddNotEligible(this.terms.claimWindowDays);
    return null;
  }

  /** Empty state of the invite screen. */
  emptyState(): string {
    const s = this.sharerJoined,
      f = this.friendJoined;
    if (s && f && this.sameJoinedReward) return this.l10n.emptyEach(this.ruleReward(s));
    if (s) return this.l10n.emptySharerOnly(this.ruleReward(s));
    return this.l10n.emptyPlain;
  }

  /** Card text for a reward from `referral_pending`. */
  rewardCard(r: RewardItem): string {
    const label = this.itemReward(r);
    if (r.state === 'banked') return this.l10n.bankedItem(label);
    if (r.who === 'friend') return this.l10n.friendWelcome(label);
    if (r.event === 'paid') return this.l10n.sharerPaidReward(label);
    return this.l10n.sharerJoinedReward(label);
  }

  /** A pending reward with its approximate date. */
  pendingLine(r: RewardItem): string {
    const at = r.availableAt;
    if (at == null) return this.itemReward(r);
    return this.l10n.pendingItem(this.itemReward(r), formatDate(at, this.l10n.localeName));
  }

  /** Message for a claim answer (ADR 11.2). Null for `ok`. */
  claimMessage(result: ClaimResult): string | null {
    return claimReasonMessage(this.l10n, result, { claimWindowDays: this.terms.claimWindowDays });
  }
}

const intlLocale = (locale: string): string => locale.replace('_', '-');

/** A short localised date ("Nov 20, 2026" in English), in the device's time zone. */
export function formatDate(at: Date, locale: string): string {
  for (const l of [intlLocale(locale), 'en-US']) {
    try {
      return new Intl.DateTimeFormat(l, { year: 'numeric', month: 'short', day: 'numeric' }).format(at);
    } catch {
      // Try the next locale.
    }
  }
  const m = String(at.getMonth() + 1).padStart(2, '0'),
    d = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${m}-${d}`;
}

/**
 * The boost's last day, short with the weekday ("Sun, 23 Nov"), in [locale]. [endsAt] is exclusive, so a boost ending
 * at midnight shows the day before.
 */
export function formatBoostDay(endsAt: Date, locale: string): string {
  const last = new Date(endsAt.getTime() - 1);
  for (const l of [intlLocale(locale), 'en-GB']) {
    try {
      const parts = new Intl.DateTimeFormat(l, { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(last);
      const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
      const wd = get('weekday'),
        day = get('day'),
        mon = get('month');
      if (wd && day && mon) return `${wd}, ${day} ${mon}`;
    } catch {
      // Try the next locale.
    }
  }
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

/** Message for a claim answer, usable without terms (ADR 11.2). Null for `ok`. */
export function claimReasonMessage(
  l10n: ReferralKitLocalizations,
  result: ClaimResult,
  opts: { claimWindowDays: number },
): string | null {
  switch (result.reason) {
    case ClaimReason.ok:
      return null;
    case ClaimReason.ownCode:
      return l10n.errOwnCode;
    case ClaimReason.alreadyReferred:
      return l10n.errAlreadyReferred;
    case ClaimReason.unknownCode:
      return l10n.errUnknownCode;
    case ClaimReason.windowClosed:
      return l10n.errWindowClosed(opts.claimWindowDays);
    case ClaimReason.rateLimited:
      return l10n.errRateLimited(retryMinutes(result.retryAfterSeconds));
    case ClaimReason.notVerified:
      return l10n.errNotVerified;
    case ClaimReason.sameInstall:
      return l10n.errSameInstall;
    case ClaimReason.programPaused:
      return l10n.errProgramPaused;
    case ClaimReason.underAge:
    case ClaimReason.anonymousUser:
      return l10n.errUnavailable;
    case ClaimReason.unknown:
      return l10n.errGeneric;
  }
}

/** Seconds → whole minutes, rounded up, at least 1. */
export function retryMinutes(seconds: number | null | undefined): number {
  const s = seconds ?? 60;
  const m = Math.trunc((s + 59) / 60);
  return m < 1 ? 1 : m;
}
