# Privacy policy text for the invite program

Updated: 2026-11-12
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

Invite program data is not used for advertising and is not sold or shared, except with RevenueCat to give
subscription rewards.
```
