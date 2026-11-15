# referral_kit starter app

Updated: 2026-11-14
A whole app with referral-kit wired in, running against a fake server, so a new app can copy it. Guide:
[docs/integration.md](../../docs/integration.md). Package: [packages/referral_kit](../../packages/referral_kit/README.md).

| File | What to copy |
|---|---|
| `lib/referral_setup.dart` | The client, claim queue, retrier, labels, invite and store links, analytics forwarding (lines marked `CHANGE`) |
| `lib/main.dart` | The two entry points (`Invite friends`, `Got a code from a friend?`) opening one `InviteHub`, hidden until `availability()` says yes; the reward card on Home |
| `lib/fake_referral_server.dart` | Not for apps: answers the kit's RPCs with the same JSON so the flow runs with no server |
| `test/flow_test.dart` | The whole flow as a widget test: share without an invite page, a friend's code, "almost yours", the gift landing, the event funnel |

Run it:

```bash
flutter pub get
flutter test
flutter run                       # fake server; try code H4PZ-8WNE
flutter run --dart-define=SUPABASE_URL=https://<ref>.supabase.co --dart-define=SUPABASE_ANON_KEY=<anon key> \
  --dart-define=INVITE_BASE_URL=https://<site>/i   # a real project (set accessToken in referral_setup.dart)
```

In this repo it depends on the package by path; in your app use the git dependency shown in `pubspec.yaml`.
