// Port of packages/referral_kit/test/copy_test.dart and growth_copy_test.dart.
import { describe, expect, it } from 'vitest';
import {
  ClaimReason,
  ClaimResult,
  claimReasonMessage,
  displayNameProblem,
  MyClaim,
  MyClaimState,
  ReferralCopy,
  referralLocalizations,
  ReferralTerms,
  retryMinutes,
  RewardItem,
} from '../src';
import { boostJson, myClaimClaimed } from './growth-json';
import { pendingJson, termsJson } from './support';

const en = referralLocalizations('en');

const copyWith = (o: { friend?: boolean; sharer?: boolean; paid?: boolean; paidEnabled?: boolean } = {}): ReferralCopy =>
  new ReferralCopy({
    l10n: en,
    terms: ReferralTerms.fromJson(
      termsJson({ friendRule: o.friend ?? true, sharerJoinedRule: o.sharer ?? true, paidRule: o.paid ?? true, paidEnabled: o.paidEnabled ?? true }),
    ),
    labels: { byKind: { minutes: (n) => `${Math.round(n)} min of natural voice` }, entitlementNames: { premium: 'Premium' } },
  });

describe('both rules on (ADR 11.1 defaults)', () => {
  const c = copyWith();
  it('rules and caps', () => {
    expect(c.rules()).toEqual([
      'You and your friend each get 30 min of natural voice when they sign up and start using the app.',
      'You get 5 days of Premium when a friend you invited subscribes (after any free trial).',
    ]);
    expect(c.caps()).toEqual(['Up to 10 friends a month count.', 'Up to 6 subscribing friends a year count.']);
  });
  it('paywall line carries its condition', () =>
    expect(c.paywallLine()).toBe('Or get 5 days of Premium free when a friend you invite subscribes.'));
  it('friend disclosure names both events', () =>
    expect(c.friendDisclosure()).toMatch(/^Your inviter gets a reward when you start using the app, and another/));
  it('share text wraps the code in an isolate', () =>
    expect(c.shareText({ appName: 'App', code: 'ABCDEFGH', link: 'https://x.test/i/ABCDEFGH' })).toBe(
      "Here's 30 min of natural voice in App, on me: join with my code ⁦ABCD-EFGH⁩ and we both get it " +
        'once you start using the app. https://x.test/i/ABCDEFGH',
    ));
  it('empty state', () =>
    expect(c.emptyState()).toMatch(/^No invites yet\. Share your code: you each get 30 min of natural voice/));
  it('reward cards', () => {
    const p = pendingJson().map((j) => RewardItem.fromJson(j));
    expect(c.rewardCard(p[0]!)).toBe('Welcome bonus: 30 min of natural voice, thanks to your invite.');
    expect(c.rewardCard(p[1]!)).toBe('5 days of Premium, added when your current plan ends.');
    expect(c.rewardCard(new RewardItem({ id: 'x', who: 'sharer', event: 'paid', kind: 'entitlement_days', amount: 5 }))).toBe(
      'A friend you invited subscribed. You got 5 days of Premium.',
    );
  });
  it('pending line has a date', () => {
    const r = new RewardItem({ id: 'p', kind: 'minutes', amount: 30, availableAt: new Date(Date.UTC(2026, 10, 15, 12)) });
    expect(c.pendingLine(r)).toBe('30 min of natural voice, around Nov 15, 2026');
  });
});

describe('friend rule off: sharer-only variants', () => {
  const c = copyWith({ friend: false });
  it('rules', () =>
    expect(c.rules()[0]).toBe('You get 30 min of natural voice when a friend you invited signs up and starts using the app.'));
  it('share text says "I get a bonus"', () => {
    const t = c.shareText({ appName: 'App', code: 'ABCDEFGH', link: 'L' });
    expect(t).toContain('and I get a bonus: L');
    expect(t).not.toContain('we both');
  });
  it('empty state', () => expect(c.emptyState()).toContain('you get 30 min of natural voice'));
  it('disclosure still names both sharer events', () => expect(c.friendDisclosure()).toBe(en.friendDisclosureBoth));
});

describe('paid rule off', () => {
  for (const [name, c] of [
    ['no paid rule', copyWith({ paid: false })],
    ['paid_enabled false', copyWith({ paidEnabled: false })],
  ] as const) {
    it(name, () => {
      expect(c.rules()).toHaveLength(1);
      expect(c.caps()).toEqual(['Up to 10 friends a month count.']);
      expect(c.paywallLine()).toBeNull();
      expect(c.friendDisclosure()).toBe(en.friendDisclosureJoined);
    });
  }
});

it('only the paid rule: disclosure names only subscribing', () => {
  const c = copyWith({ friend: false, sharer: false });
  expect(c.friendDisclosure()).toBe(en.friendDisclosurePaid);
  expect(c.shareText({ appName: 'A', code: 'ABCDEFGH', link: 'L' })).toContain('I get a bonus');
  expect(c.emptyState()).toBe(en.emptyPlain);
});

it('no rules: no disclosure, plain share text', () => {
  const c = copyWith({ friend: false, sharer: false, paid: false });
  expect(c.friendDisclosure()).toBeNull();
  expect(c.rules()).toHaveLength(0);
  expect(c.shareText({ appName: 'A', code: 'ABCDEFGH', link: 'L' })).toBe("I'm using A. Join with my code ⁦ABCD-EFGH⁩: L");
});

it('different joined rewards are named separately', () => {
  const t = ReferralTerms.fromJson({
    ...termsJson({ paidRule: false }),
    rules: [
      { event: 'joined', who: 'friend', kind: 'minutes', amount: 15, params: {} },
      { event: 'joined', who: 'sharer', kind: 'coins', amount: 100, params: {} },
    ],
  });
  const c = new ReferralCopy({ l10n: en, terms: t });
  expect(c.rules()[0]).toBe('You get 100 coins and your friend gets 15 min when they sign up and start using the app.');
  expect(c.shareText({ appName: 'A', code: 'ABCDEFGH', link: 'L' })).toMatch(/^Here's 15 min in A, on me: join with my code/);
  expect(c.shareText({ appName: 'A', code: 'ABCDEFGH', link: 'L' })).toContain('(I get a bonus too)');
});

it('default labels without app labels', () => {
  const c = new ReferralCopy({ l10n: en, terms: ReferralTerms.none });
  expect(c.reward('minutes', 1)).toBe('1 min');
  expect(c.reward('entitlement_days', 1, { entitlement_id: 'pro' })).toBe('1 day of pro');
  expect(c.reward('entitlement_days', 5)).toBe('5 days of Premium');
  expect(c.reward('coins', 2.5)).toBe('2.5 coins');
  expect(c.reward('free_chapters', 3)).toBe('3 free chapters');
});

describe('claim messages per reason (ADR 11.2)', () => {
  const c = copyWith();
  const expected: Array<[ClaimReason, string]> = [
    [ClaimReason.ownCode, "That's your own code. Share it with a friend instead."],
    [ClaimReason.alreadyReferred, "You've already used an invite code."],
    [ClaimReason.unknownCode, "We couldn't find that code. Codes have 8 letters or numbers and never contain O, 0, I, 1 or L."],
    [ClaimReason.windowClosed, 'Invite codes can be added in your first 7 days.'],
    [ClaimReason.notVerified, "Confirm your email and we'll add your code then."],
    [ClaimReason.sameInstall, "This code can't be used on this device."],
    [ClaimReason.programPaused, 'Invites are paused right now.'],
    [ClaimReason.underAge, "Invites aren't available for this account."],
    [ClaimReason.anonymousUser, "Invites aren't available for this account."],
    [ClaimReason.unknown, "We couldn't add that code right now. Try again later."],
  ];
  for (const [reason, text] of expected) {
    it(reason, () => expect(c.claimMessage(new ClaimResult({ reason }))).toBe(text));
  }
  it('ok has no error message', () => expect(c.claimMessage(new ClaimResult({ reason: ClaimReason.ok }))).toBeNull());
  it('rate_limited rounds retry_after_seconds up to minutes', () => {
    const msg = (s: number): string | null => c.claimMessage(new ClaimResult({ reason: ClaimReason.rateLimited, retryAfterSeconds: s }));
    expect(msg(3541)).toBe('Too many tries. Try again in 60 min.');
    expect(msg(61)).toBe('Too many tries. Try again in 2 min.');
    expect(msg(1)).toBe('Too many tries. Try again in 1 min.');
    expect(retryMinutes(null)).toBe(1);
  });
  it('every reason has a message in hi and id', () => {
    for (const loc of ['hi', 'id']) {
      const l = referralLocalizations(loc);
      for (const r of Object.values(ClaimReason).filter((r) => r !== ClaimReason.ok)) {
        const res = new ClaimResult({ reason: r, retryAfterSeconds: 120 });
        const m = claimReasonMessage(l, res, { claimWindowDays: 7 });
        expect(m).toBeTruthy();
        expect(m).not.toBe(claimReasonMessage(en, res, { claimWindowDays: 7 }));
      }
    }
  });
});

// ---- growth_copy_test.dart ----
const chapters = { byKind: { chapters: (n: number) => `${Math.round(n)} free chapters` } };
const rule = (who: string, amount: number, event = 'joined') => ({ event, who, kind: 'chapters', amount, params: {} });
const copyFor = (rules: unknown[], boost?: unknown, paid = false): ReferralCopy =>
  new ReferralCopy({ l10n: en, terms: ReferralTerms.fromJson({ ...termsJson({ paidEnabled: paid }), rules, boost }), labels: chapters });

describe('G1 give-first', () => {
  it("share text leads with the friend's reward, condition in the same sentence", () => {
    const c = copyFor([rule('friend', 4), rule('sharer', 4)]);
    expect(c.shareText({ appName: 'Reader', code: 'ABCDEFGH', link: 'https://x.test/i/ABCDEFGH' })).toBe(
      "Here's 4 free chapters in Reader, on me: join with my code ⁦ABCD-EFGH⁩ and we both get it once " +
        'you start using the app. https://x.test/i/ABCDEFGH',
    );
    expect(c.inviteHeadline()).toBe(
      'Give a friend 4 free chapters, and get the same, when they join with your code and start using the app',
    );
  });
  it("different rewards: the friend's first, the sharer's bonus disclosed", () => {
    const c = copyFor([rule('friend', 4), rule('sharer', 2)]);
    expect(c.shareText({ appName: 'R', code: 'ABCDEFGH', link: 'L' })).toContain('(I get a bonus too)');
    expect(c.inviteHeadline()).toMatch(/^Give a friend 4 free chapters and get 2 free chapters when/);
    expect(c.shareTextNoLink({ appName: 'R', code: 'ABCDEFGH', storeLink: 'S' })).toContain('(I get a bonus too). S');
  });
  it('friend only: no "we both", no bonus', () => {
    const c = copyFor([rule('friend', 4)]);
    const t = c.shareText({ appName: 'R', code: 'ABCDEFGH', link: 'L' });
    expect(t).toMatch(/^Here's 4 free chapters in R, on me/);
    expect(t).not.toContain('bonus');
    expect(c.inviteHeadline()).toBe('Give a friend 4 free chapters when they join with your code and start using the app');
  });
  it('sharer only: never claims the friend gets something', () => {
    const c = copyFor([rule('sharer', 4)]);
    const t = c.shareText({ appName: 'R', code: 'ABCDEFGH', link: 'L' });
    expect(t).not.toContain("Here's");
    expect(t).toContain('and I get a bonus');
    expect(c.inviteHeadline()).toBe('Get 4 free chapters when a friend joins with your code and starts using the app');
  });
  it('no rules: no headline', () => expect(copyFor([]).inviteHeadline()).toBeNull());
});

describe('G4 waiting line on claimedCount', () => {
  it("both, one friend, with the app's step", () => {
    const c = copyFor([rule('friend', 4), rule('sharer', 4)]);
    expect(c.waitingLine(1, { appName: 'Reader', activationStep: 'Read your first page' })).toBe(
      '1 friend used your code. Their next step: Read your first page. When they do it, you both get 4 free chapters.',
    );
    expect(c.waitingLine(3, { appName: 'Reader' })).toContain('Their next step: Start using Reader.');
    expect(c.waitingLine(3, { appName: 'Reader' })).toMatch(/For each friend who does it, you both get 4 free chapters\.$/);
  });
  it('each side its own, sharer only, friend only, none', () => {
    expect(copyFor([rule('friend', 4), rule('sharer', 2)]).waitingLine(1, { appName: 'R' })).toMatch(
      /you get 2 free chapters and they get 4 free chapters\.$/,
    );
    expect(copyFor([rule('sharer', 2)]).waitingLine(1, { appName: 'R' })).toMatch(/you get 2 free chapters\.$/);
    expect(copyFor([rule('friend', 4)]).waitingLine(1, { appName: 'R' })).toMatch(/they get 4 free chapters\.$/);
    expect(copyFor([]).waitingLine(1, { appName: 'R' })).toBe('1 friend used your code. Their next step: Start using R.');
  });
  it('null or zero: no line', () => {
    const c = copyFor([rule('friend', 4)]);
    expect(c.waitingLine(0, { appName: 'R' })).toBeNull();
    expect(c.waitingLine(null, { appName: 'R' })).toBeNull();
  });
});

describe('G8 boost line', () => {
  const now = new Date(Date.UTC(2026, 10, 20, 12));
  const localIso = (y: number, m: number, d: number, h = 0): string => new Date(y, m - 1, d, h).toISOString();
  it('×2 says "Double" with the weekday and the last day (end is exclusive)', () => {
    const c = copyFor([rule('friend', 4), rule('sharer', 4)], boostJson({ endsAt: localIso(2026, 11, 23) }));
    expect(c.boostLine(now)).toBe('Double rewards until Sun, 22 Nov for every friend who adds your code by then.');
  });
  it('×3 and ×1.5 use the number', () => {
    const end = localIso(2026, 11, 22, 18);
    expect(copyFor([], boostJson({ endsAt: end, multiplier: 3 })).boostLine(now)).toMatch(/^3× rewards until Sun, 22 Nov/);
    expect(copyFor([], boostJson({ endsAt: end, multiplier: 1.5 })).boostLine(now)).toMatch(/^1\.5× rewards/);
  });
  it('friend-only boost talks about the welcome gift', () => {
    expect(copyFor([], boostJson({ endsAt: localIso(2026, 11, 22, 18), who: ['friend'] })).boostLine(now)).toBe(
      'Double welcome gift until Sun, 22 Nov for friends who add your code by then.',
    );
  });
  it('ended or absent: no line', () => {
    expect(copyFor([], boostJson({ endsAt: '2026-11-20T11:00:00Z' })).boostLine(now)).toBeNull();
    expect(copyFor([]).boostLine(now)).toBeNull();
  });
  it('localized date (hi, id)', () => {
    const terms = ReferralTerms.fromJson({ ...termsJson(), boost: boostJson({ endsAt: localIso(2026, 11, 22, 18) }) });
    const hi = new ReferralCopy({ l10n: referralLocalizations('hi'), terms });
    const id = new ReferralCopy({ l10n: referralLocalizations('id'), terms });
    expect(hi.boostLine(now)).toContain('22');
    expect(hi.boostLine(now)).not.toContain('Sun');
    expect(id.boostLine(now)).toContain('Min, 22 Nov');
  });
});

describe('G2/G3 friend lines', () => {
  const c = copyFor([rule('friend', 4), rule('sharer', 4)]);
  it('welcome waiting with the boosted reward and days left', () => {
    const claim = MyClaim.fromJson({ ...myClaimClaimed, rewards: [{ kind: 'chapters', amount: 8, base_amount: 4, boosted: true }] });
    expect(c.welcomeWaiting(claim, { appName: 'Reader', activationStep: 'Read your first page' })).toBe(
      'Your welcome gift of 8 free chapters is waiting: Read your first page. 12 days left.',
    );
    expect(c.welcomeWaiting(new MyClaim({ state: MyClaimState.claimed, daysLeft: 1 }), { appName: 'Reader' })).toBe(
      'Your welcome gift is waiting: Start using Reader. Last day.',
    );
  });
  it('pass it on', () => {
    expect(c.passItOn({ appName: 'Reader' })).toBe(
      'Pass it on: give a friend 4 free chapters when they join with your code and start using the app.',
    );
    expect(copyFor([rule('sharer', 4)]).passItOn({ appName: 'Reader' })).toBe('Pass it on: invite a friend to Reader.');
  });
  it('name errors', () => {
    expect(c.displayNameError(displayNameProblem(''))).toBe('Enter your first name.');
    expect(c.displayNameError(displayNameProblem('a@b'))).toBe("A name can't contain @ or a link.");
    expect(c.displayNameError(null)).toBeNull();
  });
});
