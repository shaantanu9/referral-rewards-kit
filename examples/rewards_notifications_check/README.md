# Rewards notifications check

Updated: 2026-11-14
A small app that compiles the `FollowupNotifier` adapter shown in
[packages/rewards_kit/README.md](../../packages/rewards_kit/README.md) ("Follow-ups") against the real
`flutter_local_notifications`, and shows reading the device timezone with `flutter_timezone` and passing it to
`RewardsClient(timezone: …)`. It runs offline: `lib/demo_rpc.dart` stands in for the rewards RPCs and plans one
follow-up a minute ahead. Design: [ADR 0002 §18.7](../../docs/adr/0002-rewards-engine.md).

Checked against (Flutter 3.41.5, Dart 3.11.3): `flutter_local_notifications` 22.3.3, `timezone` 0.11.2,
`flutter_timezone` 5.1.1. (`flutter_local_notifications` 23 needs Flutter 3.44 / Dart 3.12.)

Status: **compiles (Android debug APK built, `flutter analyze` clean, 5 tests: the adapter against a fake plugin, the
scheduler driving it, the timezone sent with `rewards_track`). iOS not built (the machine's Xcode 27 simulator builds
are broken). Never run on a phone.**

## What to copy into an app

| File | What it is |
|---|---|
| `lib/local_followup_notifier.dart` | The `FollowupNotifier` for `flutter_local_notifications` (the README snippet is this file) |
| `lib/device_timezone.dart` | `deviceTimezone()` (IANA name from `flutter_timezone`) and `setUpTimezones()` (`tz.local`) |
| `android/app/build.gradle.kts` | Core library desugaring, which `flutter_local_notifications` requires |
| `android/app/src/main/AndroidManifest.xml` | `RECEIVE_BOOT_COMPLETED` and the two scheduled-notification receivers |

## Run

```bash
cd examples/rewards_notifications_check
flutter pub get
flutter analyze
flutter test
flutter run   # on an Android phone or emulator
```

On the phone: the first line shows the device timezone. **Send a rewards_track** logs the timezone the client sent.
**Plan follow-ups** asks for the notification permission, runs `FollowupScheduler.replanNow()` and lists what is
pending; the notification arrives about a minute later (inexact, so Android may delay it). **Stop (sign-out)** cancels
it.
