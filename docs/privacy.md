# Privacy policy text for the invite program

Updated: 2026-11-20
Paste-ready paragraphs for the app's privacy policy (ADR 9, 10). Replace the `<…>` parts. Have the final policy
checked for your countries; this is a starting text, not legal advice.
Related: [store review](store-review.md) · [integration](integration.md)

```text
Invite friends

If you use the invite program, we keep:
- your invite code, and who invited whom;
- a random install identifier created by the app (not your advertising identifier), stored only as a one-way
  hash, to stop the same phone being used to invite itself;
- whether an invited friend started using the app and whether they subscribed, so we can give the rewards
  described in the program terms (<TERMS URL>);
- the rewards you earned and when.

If you use someone's invite code, they get a reward when you start using the app and another if you subscribe,
so they can tell those things happened. They never see your email, your name or which plan you bought. Counts
of invited friends are only shown once at least three friends have joined.

We receive purchase events from our payment provider (RevenueCat) to decide rewards. We keep only the fields
needed for that (no names or email addresses from those events) and delete them after 30 days.

When you delete your account, we delete your invite data. To stop abuse of the program, we keep, for 12 months,
only one-way hashes of the install identifiers and store transaction identifiers you used, with the date, so a
new account on the same phone cannot claim invite rewards again. Then they are deleted too.

If you choose "Show my first name on my invite page", the first name you enter is shown to anyone who opens your
invite link, next to a note that you get a reward if they join. It is off unless you turn it on, and you can turn it
off at any time. We never show your surname, email or photo.

You can leave the invite program at any time in <WHERE IN THE APP>. Your code then stops working for new friends;
rewards you already earned are kept. You can join again later.

Invite program data is not used for advertising and is not sold or shared, except with RevenueCat to give
subscription rewards.
```

## India (DPDP Act 2023 and Rules 2025): notice shown before a code is used or shared

Shown once to a user in India before they first use or share a code, with links that work. Itemised as Rule 3 asks.
Set `minimum_age` to 18 for India (under 18 is a child), and `events_retention_days` to 365 from 2027-05-14 if your
lawyer confirms Rule 8(3) applies to you; say so in the retention paragraph above.

```text
To run the invite program we process: your invite code; a random install identifier (stored as a one-way hash);
who invited whom; whether an invited friend started using the app and whether they subscribed; the rewards given;
and, only if you turn it on, the first name shown on your invite page.
Purpose: to give the rewards in the program terms (<TERMS URL>) and to stop the program being abused.
You can withdraw at any time by leaving the invite program in <WHERE IN THE APP>; it is as easy as joining.
Your rights (access, correction, erasure, grievance): <RIGHTS URL>. Grievance officer: <CONTACT>.
You can also complain to the Data Protection Board of India: <BOARD URL>.
```
