# referral_kit example

Shows `InviteFriendsScreen`, `InviteCodeEntry` and `ReferralRewardCard` over a fake RPC (no backend needed), and is
how the package's Kotlin and Swift code is compiled in development:

```bash
flutter run                      # or: flutter build apk --debug
cd ios && xcodebuild -workspace Runner.xcworkspace -scheme Runner -sdk iphonesimulator -arch arm64 build
```
