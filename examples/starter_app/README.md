# referral_kit starter app

Updated: 2026-11-20
A whole app with referral-kit wired in, running against a fake server, so a new app can copy it. It shows both sides of
the journey step by step: [docs/user-journey.md](../../docs/user-journey.md). Guide:
[docs/integration.md](../../docs/integration.md). Package: [packages/referral_kit](../../packages/referral_kit/README.md).

| File | What to copy |
|---|---|
| `lib/referral_setup.dart` | The client, claim queue, retrier (with your sign-in stream), install referrer, invite-link keep, labels, invite and store links, analytics forwarding (lines marked `CHANGE`) |
| `lib/invite_link.dart` | `codeFromInviteLink`: the code in `https://<site>/i/<CODE>`, the route `/i/<CODE>` or `?code=` |
| `lib/invite_screens.dart` | `InviteScreen` (one `InviteHub` for every entry point, rebuilt after sign-in) and `InviteLinkScreen` (where an invite link lands: keeps the code, then "Use code …") |
| `lib/main.dart` | Routes for `/i/<CODE>` (cold start and running); Home: the waiting-code card, the reward card, the sharer's "friend used your code" / "joined" line, the two entry rows hidden until `availability()` says yes, code entry after sign-in, reload when back on top |
| `android/app/src/main/AndroidManifest.xml` | The App Links filter for `/i/` (change the host) |
| `lib/fake_referral_server.dart` | Not for apps: answers the kit's RPCs with the same JSON, plays sign-in and the friend, so the flow runs with no server |
| `test/flow_test.dart`, `test/journey_test.dart` | The journey as widget tests: share, a friend's typed code, "almost yours", the gift; a link opened signed out → sign in → one tap; the install referrer; "Not now"; the sharer's counts; the event funnel |

Run it:

```bash
flutter pub get
flutter test
flutter run                       # fake server; try the Demo section at the bottom of Home
flutter run --dart-define=SUPABASE_URL=https://<ref>.supabase.co --dart-define=SUPABASE_ANON_KEY=<anon key> \
  --dart-define=INVITE_BASE_URL=https://<site>/i   # a real project (set accessToken and signInChanges in referral_setup.dart)
```

Try both sides in the Demo section:

- **You share**: Invite friends → Share / Copy → "A friend signs up with your code" (Home: "1 friend used your code")
  → "A friend starts using the app" (your reward card, "1 friend joined").
- **A friend with a link**: switch "Signed in" off → "Open an invite link" → Sign in → "Use code H4PZ-8WNE" → "Almost
  yours" → Start reading → "You start using the app" (the welcome gift on Home).

iOS invite links need the Associated Domains entitlement (`applinks:<site>`) added in Xcode with your team, and the
`apple-app-site-association` file served by the invite site ([integration.md §8](../../docs/integration.md)).

In this repo it depends on the package by path; in your app use the version from pub.dev (or the git dependency shown
in `pubspec.yaml`).
