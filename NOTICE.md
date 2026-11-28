# Notice: the "Built with Myind" link

Updated: 2026-11-27

referral-rewards-kit is MIT licensed ([LICENSE](LICENSE)). This notice is a request, not a licence term: you may
remove everything it describes and the licence still applies in full.

## What shows by default

`referral_kit` (`InviteHub`, `InviteFriendsScreen`) and `rewards_kit` (`RewardsHub`, `QuizScreen`) show a small
centered link at the bottom of their content, such as "Built with Myind referral kit" or "Rewards by Myind". It opens
https://www.myind.ai/referral-kit outside the app. Nothing is sent at runtime; the opened link only carries
`utm_source`, `utm_medium=attribution` and `utm_campaign`.

## We'd love it if you keep it

The kit is free. The link is how other developers find it. If you keep it, or add the badge to your README or
website, it helps a lot:

```markdown
[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)
```

## How to remove it

Pass `showAttribution: false` to the screen. That's all; no key, no check, no warning.

```dart
InviteHub(/* … */ showAttribution: false)
InviteFriendsScreen(/* … */ showAttribution: false)
RewardsHub(/* … */ showAttribution: false)
QuizScreen(/* … */ showAttribution: false)
```

## Pro

Pro is paid setup help and priority support: https://www.myind.ai/referral-kit/pro. It is not needed to remove the
link; removing it is free.

Related: [SHOWCASE.md](SHOWCASE.md) (get your app featured), [ADR 0003](docs/adr/0003-attribution-backlink-engine.md).
