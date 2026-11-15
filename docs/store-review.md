# Store review guide: invite program

Updated: 2026-11-12
What to tell App Review and Google Play about the invite program, the privacy answers, and a checklist before
submitting. The policy reasoning, with quoted guideline text, is in [ADR 0001 section 3](adr/0001-referral-kit.md).
Related: [integration](integration.md) · [privacy text](privacy.md) · [test plan](test-plan.md)

Anything marked **[unconfirmed]** is a judgement or form wording not checked against the live form; check it in the
console when filling it in.

## 1. Checklist before submitting

- [ ] Rewards come from the friend's activity in this app (activation) or a paid subscription, never from an install
      alone, and never for ratings or reviews.
- [ ] Entering a code is never required; the core app works without the program.
- [ ] Every reward sentence states its condition in the same sentence; the terms page is linked from the invite screen.
- [ ] Codes are free, cannot be bought or sold, and have no cash value; Premium is always buyable by in-app purchase.
- [ ] Referral minutes (or other credits) are kept apart from purchased credits and any expiry is shown.
- [ ] No Contacts permission; sharing uses the system share sheet; the preview shows the exact message.
- [ ] Push is optional: the reward push only says what happened, only to users who opted in to that type, with a
      setting to turn it off; never "invite more friends".
- [ ] Not used in a Kids Category app; off below the minimum age (`app_referral_age_ok`).
- [ ] Account deletion in the app removes referral data (`referral.delete_user`) and the privacy policy states the
      12-month fraud-prevention record.
- [ ] iOS never reads the clipboard by itself (paste only through the Paste button or the text field menu).
- [ ] No advertising id or IDFA; no App Tracking Transparency prompt needed for the kit.

## 2. App Review notes (App Store Connect → App Review Information → Notes)

```text
Invite friends: a signed-in user can share an invite code from Profile → Invite friends.
- When an invited friend signs up and starts using the app, both get <REWARD, e.g. 30 minutes of natural voice>.
- When an invited friend subscribes to Premium (after any free trial), the inviter gets 5 days of Premium,
  added about 3 days after the payment. The friend is told this before using a code.
Codes are free, cannot be bought or sold, have no cash value, and are never required to use the app. Premium is
only sold through in-app purchase. Rewards are not given for installs alone, ratings or reviews. No contacts
access; sharing uses the system share sheet. Rules and limits: <TERMS URL>.
To try it: sign in with the demo account below, open Profile → Invite friends to see the code; a second demo
account can enter it in Settings → Got an invite code?
```

## 3. Google Play review notes (App content → App access, if a demo account is needed)

```text
Invite friends (Profile → Invite friends) gives in-app rewards when an invited friend starts using the app or
subscribes. No reward for installs alone, ratings or reviews. Codes are free and never required. Demo accounts
for sharer and friend are listed above.
```

## 4. Apple privacy label answers [unconfirmed form wording]

Add to the app's existing answers. All are **linked to the user**, **not used for tracking**.

| Data type | Purpose | Why |
|---|---|---|
| Identifiers → User ID | App Functionality, Fraud Prevention | Who invited whom, rewards |
| Identifiers → Device ID | Fraud Prevention | Random install id (not the advertising id), stored hashed |
| Purchases → Purchase History | App Functionality | Whether an invited friend's subscription qualifies the inviter for a reward |
| Usage Data → Product Interaction | App Functionality | Whether the friend started using the app (activation) |

## 5. Google Play Data safety answers [unconfirmed form wording]

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Device or other IDs | Yes | No | Fraud prevention, security, and compliance | No (only when using invites) |
| Purchase history | Yes | No | App functionality | No (only when using invites) |
| App interactions | Yes | No | App functionality | No |
| User IDs | Yes (already declared for sign-in) | No | App functionality, fraud prevention | — |

Also: data is encrypted in transit; users can request deletion (in-app account deletion), with the 12-month
fraud-prevention record disclosed in the privacy policy.

## 6. If review asks about "referrals" (Apple 5.6.3)

```text
The program rewards real use of our own app, not installs or store rankings. Rewards need a verified account and
real activity in the app, are capped (10 friends a month, 6 subscriptions a year), one code per person and device,
self-invites are refused, and refunds after a reward count against the inviter. We can pause the program at any
time without an app update.
```
